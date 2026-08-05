import { prisma } from '../db';
import { graphApiClient, GraphApiConversation } from './graphApi';
import { ParsedWebhookEvent } from './webhook';
import { processAutoReply } from './autoReply';
import {
  emitNewMessage,
  emitNewReply,
  emitConversationUpdated,
  emitSyncStatus,
} from '../socket';

/**
 * Find or create a Conversation row for a PSID.
 * Fetches user profile in background if name is missing.
 */
export async function getOrCreateConversation(
  psid: string,
  initialName?: string,
  fbPageId?: string
) {
  let conversation = await prisma.conversation.findUnique({
    where: { psid },
  });

  // Resolve internal page ID
  let internalPageId: string | undefined;
  if (fbPageId) {
    const page = await prisma.page.findUnique({ where: { pageId: fbPageId } });
    if (page) internalPageId = page.id;
  }
  if (!internalPageId) {
    const defaultPage = await prisma.page.findFirst({ where: { isActive: true } });
    if (defaultPage) internalPageId = defaultPage.id;
  }

  if (!conversation) {
    let userName = initialName;
    let userAvatarUrl: string | undefined;

    // Fetch user profile from Meta Graph API only if name is not already known
    if (!userName) {
      try {
        const profile = await graphApiClient.getUserProfile(psid);
        if (profile) {
          userName = profile.name || (profile.first_name ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : userName);
          userAvatarUrl = profile.profile_pic;
        }
      } catch (err) {
        console.warn(`[Conversations] Failed to fetch profile for PSID ${psid}:`, err);
      }
    }

    conversation = await prisma.conversation.create({
      data: {
        psid,
        userName: userName || `User ${psid.slice(-4)}`,
        userAvatarUrl,
        lastMessageAt: new Date(),
        unread: true,
        autoReplyEnabled: true,
        pageId: internalPageId,
      },
    });
  } else {
    // If existing conversation needs page association or name upgrade
    const updates: any = {};
    if (initialName && (!conversation.userName || conversation.userName.startsWith('User '))) {
      updates.userName = initialName;
    }
    if (!conversation.pageId && internalPageId) {
      updates.pageId = internalPageId;
    }
    if (Object.keys(updates).length > 0) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: updates,
      });
    }
  }

  return conversation;
}

/**
 * Ingest an incoming webhook event (inbound message or outbound echo).
 */
export async function ingestWebhookEvent(event: ParsedWebhookEvent) {
  const { pageId: fbPageId, userPsid, text, isEcho, fbMessageId, timestamp, attachments } = event;

  // 1. Check for deduplication if fbMessageId exists
  if (fbMessageId) {
    const existingMsg = await prisma.message.findUnique({
      where: { fbMessageId },
    });
    if (existingMsg) {
      console.log(`[Conversations] Message ${fbMessageId} already ingested. Skipping duplicate.`);
      return { conversation: null, message: existingMsg, duplicate: true };
    }
  }

  // 2. Get or create conversation linked to this page
  const conversation = await getOrCreateConversation(userPsid, undefined, fbPageId);

  // Format message content & attachments
  let messageText = text;
  let attachmentsJson: string | null = null;

  if (attachments && attachments.length > 0) {
    if (!messageText) {
      messageText = `[${attachments[0].type?.toUpperCase() || 'ATTACHMENT'}]`;
    }
    attachmentsJson = JSON.stringify(
      attachments.map((att) => ({
        type: att.type || 'file',
        url: att.payload?.url || '',
        title: att.payload?.title,
      }))
    );
  }

  // 3. For outbound echoes: deduplicate against messages recently sent from this app (within last 30 seconds)
  if (isEcho && messageText) {
    const recentSent = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        direction: 'outbound_manual',
        text: messageText,
        createdAt: {
          gte: new Date(Date.now() - 30000), // within last 30 seconds
        },
      },
    });

    if (recentSent) {
      console.log(`[Conversations] Echo matches recently sent manual reply. Skipping duplicate creation.`);
      if (fbMessageId && !recentSent.fbMessageId) {
        await prisma.message.update({
          where: { id: recentSent.id },
          data: { fbMessageId },
        });
      }
      return { conversation, message: recentSent, duplicate: true };
    }
  }

  const direction = isEcho ? 'outbound_manual' : 'inbound';

  // 4. Create message row
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction,
      text: messageText || '',
      attachments: attachmentsJson,
      createdAt: timestamp || new Date(),
      fbMessageId: fbMessageId || undefined,
    },
  });

  // 5. Update conversation lastMessageAt & unread state
  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: timestamp || new Date(),
      unread: !isEcho ? true : conversation.unread,
    },
  });

  // 6. Emit socket events with page context
  emitNewMessage({
    message,
    conversation: updatedConversation,
  });
  emitConversationUpdated(updatedConversation);

  // 7. If it's an inbound message, process auto-reply rules
  if (!isEcho && text) {
    setImmediate(async () => {
      try {
        await processAutoReply(conversation.id, userPsid, text);
      } catch (err) {
        console.error('[Conversations] Error processing auto-reply:', err);
      }
    });
  }

  return { conversation: updatedConversation, message, duplicate: false };
}

/**
 * Send a manual reply to a conversation, supporting text and/or photo/video media attachments.
 */
export async function sendManualReply(
  conversationId: string,
  text?: string,
  mediaFile?: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    localUrl: string;
  }
) {
  if ((!text || !text.trim()) && !mediaFile) {
    throw new Error('Message text or media file is required');
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { page: true },
  });

  if (!conversation) {
    throw new Error(`Conversation not found for id: ${conversationId}`);
  }

  const pageToken = conversation.page?.accessToken;
  let sendResult: { recipient_id: string; message_id: string } | null = null;
  let attachmentsJson: string | null = null;

  // 1. If media file is provided (Photo / Video)
  if (mediaFile) {
    const isVideo = mediaFile.mimetype.startsWith('video/');
    const attachmentType = isVideo ? 'video' : 'image';

    sendResult = await graphApiClient.sendMediaAttachment(
      conversation.psid,
      attachmentType,
      mediaFile.buffer,
      mediaFile.originalname,
      mediaFile.mimetype,
      pageToken
    );

    attachmentsJson = JSON.stringify([
      {
        type: attachmentType,
        url: mediaFile.localUrl,
        name: mediaFile.originalname,
      },
    ]);
  }

  // 2. If text message is also provided
  if (text && text.trim()) {
    sendResult = await graphApiClient.sendMessage(conversation.psid, text.trim(), pageToken);
  }

  const messageText = text ? text.trim() : (mediaFile?.mimetype.startsWith('video/') ? '[VIDEO]' : '[IMAGE]');

  // 3. Save outbound_manual message in database
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'outbound_manual',
      text: messageText,
      attachments: attachmentsJson,
      fbMessageId: sendResult?.message_id,
      createdAt: new Date(),
    },
  });

  // 4. Update conversation lastMessageAt and mark as read
  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      unread: false,
    },
  });

  // 5. Emit realtime updates
  emitNewReply({
    message,
    conversationId: conversation.id,
  });
  emitConversationUpdated(updatedConversation);

  return { message, conversation: updatedConversation };
}

/**
 * Toggle per-conversation auto-reply status.
 */
export async function toggleConversationAutoReply(conversationId: string, enabled?: boolean) {
  const current = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!current) {
    throw new Error(`Conversation not found for id: ${conversationId}`);
  }

  const newValue = enabled !== undefined ? enabled : !current.autoReplyEnabled;

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { autoReplyEnabled: newValue },
  });

  emitConversationUpdated(updated);
  return updated;
}

/**
 * Mark a conversation as read.
 */
export async function markConversationRead(conversationId: string) {
  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { unread: false },
  });

  emitConversationUpdated(updated);
  return updated;
}

/**
 * Backfill conversation history from Meta Graph API for a specific or all active pages.
 */
/**
 * Backfill conversation history from Meta Graph API for a specific or all active pages.
 * Supports smart Incremental Delta Sync (only fetches new messages since the last saved message).
 */
export async function backfillFromGraphApi(
  targetPageId?: string,
  options?: { forceFullSync?: boolean }
): Promise<{
  conversationsSynced: number;
  messagesSynced: number;
  isDelta?: boolean;
}> {
  emitSyncStatus({ inProgress: true, message: 'Initiating smart inbox synchronization...' });

  try {
    let pagesToSync: Array<{ id: string; pageId: string; name: string; accessToken: string }> = [];

    if (targetPageId && targetPageId !== 'all') {
      const page = await prisma.page.findFirst({
        where: {
          OR: [{ id: targetPageId }, { pageId: targetPageId }],
        },
      });
      if (page && page.accessToken) {
        pagesToSync.push(page);
      }
    } else {
      const activePages = await prisma.page.findMany({
        where: { isActive: true },
      });
      pagesToSync = activePages.filter((p) => p.accessToken && p.accessToken.length > 0);
    }

    // Fallback: If no pages in DB yet, try to discover default page from config PAGE_ACCESS_TOKEN
    if (pagesToSync.length === 0) {
      try {
        const details = await graphApiClient.getPageDetails();
        if (details && details.id) {
          const configToken = graphApiClient['accessToken'];
          if (configToken && !configToken.startsWith('dev_') && !configToken.startsWith('test_')) {
            const page = await prisma.page.upsert({
              where: { pageId: details.id },
              update: { name: details.name, accessToken: configToken, isActive: true },
              create: { pageId: details.id, name: details.name, accessToken: configToken, isActive: true },
            });
            pagesToSync.push(page);
          }
        }
      } catch (err: any) {
        console.warn('[Conversations] Could not discover default page from config:', err.message);
      }
    }

    if (pagesToSync.length === 0) {
      const msg = 'No active Facebook Pages configured. Please add a Facebook Page to sync.';
      emitSyncStatus({ inProgress: false, total: 0, synced: 0, message: msg });
      return { conversationsSynced: 0, messagesSynced: 0, isDelta: false };
    }

    let totalConversationsCount = 0;
    let totalMessagesCount = 0;
    let isDeltaSync = false;

    for (const page of pagesToSync) {
      let sinceTimestamp: number | undefined;

      if (!options?.forceFullSync) {
        // Find most recent message timestamp in DB for this page
        const latestMsg = await prisma.message.findFirst({
          where: {
            conversation: {
              pageId: page.id,
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (latestMsg && latestMsg.createdAt) {
          // 60-second safety buffer to capture concurrent updates
          sinceTimestamp = Math.max(0, Math.floor(new Date(latestMsg.createdAt).getTime() / 1000) - 60);
          isDeltaSync = true;
        }
      }

      emitSyncStatus({
        inProgress: true,
        message: sinceTimestamp
          ? `Checking for new updates on "${page.name}" (Delta Sync)...`
          : `Fetching full conversation history from Meta for "${page.name}"...`,
      });

      // Fetch conversations from Meta Graph API
      const fbConversations = await graphApiClient.fetchAllConversations(
        page.pageId,
        page.accessToken,
        3000,
        sinceTimestamp
      );

      const total = fbConversations.length;
      console.log(
        `[Conversations] Page "${page.name}" returned ${total} conversation(s)${
          sinceTimestamp ? ` since timestamp ${sinceTimestamp}` : ''
        }.`
      );

      if (total === 0) {
        continue;
      }

      emitSyncStatus({
        inProgress: true,
        total,
        synced: 0,
        message: `Syncing ${total} active conversation(s) for "${page.name}"...`,
      });

      // Process in parallel chunks of 6
      const BATCH_SIZE = 6;
      for (let i = 0; i < fbConversations.length; i += BATCH_SIZE) {
        const chunk = fbConversations.slice(i, i + BATCH_SIZE);

        await Promise.all(
          chunk.map(async (fbConv, chunkIdx) => {
            const currentIndex = i + chunkIdx + 1;
            try {
              // 1. Resolve participants
              let participants = fbConv.participants?.data || [];
              if (participants.length === 0) {
                const details = await graphApiClient.fetchConversationDetails(fbConv.id, page.accessToken);
                participants = details?.participants?.data || [];
              }

              // Customer is the participant whose ID is NOT the Facebook Page ID
              const customer =
                participants.find((p: any) => p.id !== page.pageId) || participants[0];

              // 2. Resolve messages
              let fbMessages = fbConv.messages?.data || [];
              if (fbMessages.length === 0) {
                fbMessages = await graphApiClient.fetchAllConversationMessages(
                  fbConv.id,
                  page.accessToken,
                  300,
                  sinceTimestamp
                );
              }

              let psid = customer?.id;
              let userName = customer?.name;

              if (!psid && fbMessages.length > 0) {
                for (const msg of fbMessages) {
                  if (msg.from?.id && msg.from.id !== page.pageId && msg.from.name) {
                    psid = msg.from.id;
                    userName = msg.from.name;
                    break;
                  }
                }
              }

              if (!psid) {
                psid = fbConv.id;
              }

              // 3. Upsert conversation
              const conversation = await getOrCreateConversation(psid, userName, page.pageId);
              totalConversationsCount++;

              // 4. Ingest messages
              for (const fbMsg of fbMessages) {
                if (!fbMsg.id) continue;

                const isFromPage = fbMsg.from?.id === page.pageId;
                const direction = isFromPage ? 'outbound_manual' : 'inbound';
                const createdAt = fbMsg.created_time ? new Date(fbMsg.created_time) : new Date();

                const existing = await prisma.message.findUnique({
                  where: { fbMessageId: fbMsg.id },
                });

                if (!existing) {
                  let attachmentsJson: string | undefined;
                  if (
                    fbMsg.attachments &&
                    Array.isArray(fbMsg.attachments.data) &&
                    fbMsg.attachments.data.length > 0
                  ) {
                    const attList = fbMsg.attachments.data
                      .map((att: any) => ({
                        type: att.video_data ? 'video' : att.image_data ? 'image' : 'file',
                        url: att.image_data?.url || att.video_data?.url || att.file_url,
                        name: att.name,
                      }))
                      .filter((a: any) => a.url);

                    if (attList.length > 0) {
                      attachmentsJson = JSON.stringify(attList);
                    }
                  }

                  await prisma.message.create({
                    data: {
                      conversationId: conversation.id,
                      direction,
                      text: fbMsg.message || '',
                      attachments: attachmentsJson,
                      createdAt,
                      fbMessageId: fbMsg.id,
                    },
                  });
                  totalMessagesCount++;
                }
              }

              if (fbConv.updated_time) {
                await prisma.conversation.update({
                  where: { id: conversation.id },
                  data: { lastMessageAt: new Date(fbConv.updated_time) },
                });
              }
            } catch (itemErr: any) {
              console.warn(`[Conversations] Failed to sync thread ${fbConv.id}:`, itemErr.message);
            } finally {
              emitSyncStatus({
                inProgress: true,
                total,
                synced: Math.min(currentIndex, total),
                message: `Syncing ${page.name} (${Math.min(currentIndex, total)}/${total})...`,
              });
            }
          })
        );
      }
    }

    const completionMessage =
      isDeltaSync && totalConversationsCount === 0 && totalMessagesCount === 0
        ? 'Inbox is up to date. (0 new changes)'
        : `Sync complete! Synced ${totalConversationsCount} conversation(s) and ${totalMessagesCount} message(s).`;

    emitSyncStatus({
      inProgress: false,
      total: totalConversationsCount,
      synced: totalConversationsCount,
      message: completionMessage,
    });

    return {
      conversationsSynced: totalConversationsCount,
      messagesSynced: totalMessagesCount,
      isDelta: isDeltaSync,
    };
  } catch (err: any) {
    emitSyncStatus({
      inProgress: false,
      message: `Sync error: ${err.message || err}`,
    });
    throw err;
  }
}
