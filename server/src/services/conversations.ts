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
export async function getOrCreateConversation(psid: string, initialName?: string) {
  let conversation = await prisma.conversation.findUnique({
    where: { psid },
  });

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
      },
    });
  } else if (initialName && (!conversation.userName || conversation.userName.startsWith('User '))) {
    // If existing conversation has a generic name, upgrade it with the real name
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { userName: initialName },
    });
  }

  return conversation;
}

/**
 * Ingest an incoming webhook event (inbound message or outbound echo).
 */
export async function ingestWebhookEvent(event: ParsedWebhookEvent) {
  const { userPsid, text, isEcho, fbMessageId, timestamp, attachments } = event;

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

  // 2. Get or create conversation
  const conversation = await getOrCreateConversation(userPsid);

  // Format message content
  let messageText = text;
  if (!messageText && attachments && attachments.length > 0) {
    messageText = `[${attachments[0].type.toUpperCase()}]`;
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

  // 3. Create message row
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction,
      text: messageText || '',
      attachments: attachments ? JSON.stringify(attachments) : null,
      createdAt: timestamp || new Date(),
      fbMessageId: fbMessageId || undefined,
    },
  });

  // 4. Update conversation lastMessageAt & unread state
  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: timestamp || new Date(),
      unread: !isEcho ? true : conversation.unread,
    },
  });

  // 5. Emit socket events
  emitNewMessage({
    message,
    conversation: updatedConversation,
  });
  emitConversationUpdated(updatedConversation);

  // 6. If it's an inbound message, process auto-reply rules
  if (!isEcho && text) {
    // Process auto-reply asynchronously so webhook response is not blocked
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
 * Send a manual reply to a conversation.
 */
export async function sendManualReply(conversationId: string, text: string) {
  if (!text || !text.trim()) {
    throw new Error('Message text cannot be empty');
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw new Error(`Conversation not found for id: ${conversationId}`);
  }

  // Send via Meta Graph API
  const sendResult = await graphApiClient.sendMessage(conversation.psid, text.trim());

  // Save outbound_manual message in database
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'outbound_manual',
      text: text.trim(),
      fbMessageId: sendResult.message_id,
      createdAt: new Date(),
    },
  });

  // Update conversation lastMessageAt and mark as read
  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      unread: false,
    },
  });

  // Emit realtime updates
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
 * Backfill conversation history from Meta Graph API.
 */
export async function backfillFromGraphApi(): Promise<{
  conversationsSynced: number;
  messagesSynced: number;
}> {
  emitSyncStatus({ inProgress: true, message: 'Fetching conversations from Facebook...' });

  try {
    let pageId = '';
    try {
      const page = await graphApiClient.getPageDetails();
      pageId = page?.id || '';
    } catch {}

    const fbConversations = await graphApiClient.fetchConversationsList(30, pageId);
    let conversationsCount = 0;
    let messagesCount = 0;

    for (let i = 0; i < fbConversations.length; i++) {
      const fbConv = fbConversations[i];
      emitSyncStatus({
        inProgress: true,
        total: fbConversations.length,
        synced: i + 1,
        message: `Syncing conversation ${i + 1} of ${fbConversations.length}...`,
      });

      // Fetch participants from details
      const details = await graphApiClient.fetchConversationDetails(fbConv.id);
      const participants = details?.participants?.data || [];
      const customer = participants.find((p: any) => p.id !== pageId) || participants[0];

      // Fetch messages for this conversation
      const fbMessages = await graphApiClient.fetchConversationMessages(fbConv.id, 50);

      let psid = customer?.id;
      let userName = customer?.name;

      // If PSID wasn't in participants, infer from message sender/receiver
      if (!psid && fbMessages.length > 0) {
        for (const msg of fbMessages) {
          if (msg.from?.id && msg.from.id !== pageId && msg.from.name) {
            psid = msg.from.id;
            userName = msg.from.name;
            break;
          }
        }
      }

      if (!psid) {
        psid = fbConv.id;
      }

      // Upsert conversation
      const conversation = await getOrCreateConversation(psid, userName);
      conversationsCount++;

      // Ingest messages
      for (const fbMsg of fbMessages) {
        if (!fbMsg.id) continue;

        // Determine direction
        const isFromPage = fbMsg.from?.id === pageId;
        const direction = isFromPage ? 'outbound_manual' : 'inbound';
        const createdAt = fbMsg.created_time ? new Date(fbMsg.created_time) : new Date();

        const existing = await prisma.message.findUnique({
          where: { fbMessageId: fbMsg.id },
        });

        if (!existing) {
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              direction,
              text: fbMsg.message || '',
              createdAt,
              fbMessageId: fbMsg.id,
            },
          });
          messagesCount++;
        }
      }

      // Update lastMessageAt to the latest message time
      if (fbConv.updated_time) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date(fbConv.updated_time) },
        });
      }
    }

    emitSyncStatus({
      inProgress: false,
      message: `Sync complete! Synced ${conversationsCount} conversations and ${messagesCount} messages.`,
    });

    return { conversationsSynced: conversationsCount, messagesSynced: messagesCount };
  } catch (err: any) {
    emitSyncStatus({
      inProgress: false,
      message: `Sync failed: ${err.message || err}`,
    });
    throw err;
  }
}
