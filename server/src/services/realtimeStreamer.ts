import { prisma } from '../db';
import { getIO, emitNewMessage, emitConversationUpdated } from '../socket';
import { processAutoReply } from './autoReply';

interface GraphMessageItem {
  id: string;
  message?: string;
  from?: {
    id: string;
    name?: string;
    email?: string;
  };
  created_time: string;
  attachments?: {
    data?: Array<{
      id?: string;
      mime_type?: string;
      name?: string;
      size?: number;
      file_url?: string;
      image_data?: {
        url?: string;
        preview_url?: string;
      };
      video_data?: {
        url?: string;
        preview_url?: string;
      };
    }>;
  };
}

interface GraphConversationItem {
  id: string;
  updated_time: string;
  unread_count?: number;
  participants?: {
    data?: Array<{
      id: string;
      name?: string;
      email?: string;
    }>;
  };
  messages?: {
    data?: GraphMessageItem[];
  };
}

// In-memory set of recently processed Meta message IDs to guarantee 0 duplicate DB writes/emits
const processedMessageIds = new Set<string>();
let isStreamerRunning = false;
let streamerInterval: NodeJS.Timeout | null = null;

/**
 * Checks Meta Graph API for all active pages and streams any new messages in real-time
 */
export async function pollMetaUpdatesForActivePages() {
  if (isStreamerRunning) return;
  isStreamerRunning = true;

  try {
    const activePages = await prisma.page.findMany({
      where: {
        isActive: true,
        accessToken: { not: '' },
      },
    });

    if (!activePages || activePages.length === 0) {
      isStreamerRunning = false;
      return;
    }

    const io = getIO();

    for (const page of activePages) {
      try {
        const url = `https://graph.facebook.com/v19.0/${page.pageId}/conversations?fields=id,updated_time,unread_count,participants,messages.limit(2){id,message,from,created_time,attachments}&limit=6&access_token=${encodeURIComponent(
          page.accessToken
        )}`;

        const response = await fetch(url, {
          headers: { 'User-Agent': 'FBInbox-RealTimeStreamer/1.0' },
        });

        if (!response.ok) {
          // If token issue or rate limit, continue to next page gracefully
          continue;
        }

        const data = (await response.json()) as { data?: GraphConversationItem[] };
        const fbConversations = data.data || [];

        for (const fbConv of fbConversations) {
          const messages = fbConv.messages?.data || [];
          if (messages.length === 0) continue;

          // Identify participant (the customer, not the page)
          const participants = fbConv.participants?.data || [];
          const customerParticipant =
            participants.find((p) => p.id !== page.pageId) || participants[0];

          const customerPsid = customerParticipant?.id || 'unknown_psid';
          const customerName = customerParticipant?.name || 'Customer';

          for (const msg of messages) {
            if (processedMessageIds.has(msg.id)) {
              continue;
            }

            // Check if already in DB
            const existingMsg = await prisma.message.findFirst({
              where: { fbMessageId: msg.id },
            });

            if (existingMsg) {
              processedMessageIds.add(msg.id);
              // Prevent unbounded memory growth
              if (processedMessageIds.size > 2000) {
                const [first] = processedMessageIds;
                processedMessageIds.delete(first);
              }
              continue;
            }

            // Determine if message is inbound or outbound
            const isFromCustomer = msg.from?.id ? msg.from.id !== page.pageId : true;
            const direction = isFromCustomer ? 'inbound' : 'outbound_manual';

            // Extract attachments JSON if any
            let attachmentsJson: string | null = null;
            if (msg.attachments?.data && msg.attachments.data.length > 0) {
              attachmentsJson = JSON.stringify(
                msg.attachments.data.map((att: any) => {
                  const mediaUrl =
                    att.image_data?.url ||
                    att.video_data?.url ||
                    att.file_url ||
                    att.payload?.url ||
                    '';
                  const previewUrl =
                    att.image_data?.preview_url ||
                    att.video_data?.preview_url ||
                    '';
                  const isVid = Boolean(att.video_data || att.type === 'video');
                  const isImg = Boolean(att.image_data || att.type === 'image' || (!isVid && mediaUrl));
                  return {
                    type: isVid ? 'video' : isImg ? 'image' : 'file',
                    url: mediaUrl || previewUrl,
                    preview_url: previewUrl,
                    title: att.name || att.title || '',
                  };
                })
              );
            }

            // Upsert conversation in DB
            const conversation = await prisma.conversation.upsert({
              where: {
                psid: customerPsid,
              },
              update: {
                pageId: page.id,
                userName: customerName,
                unread: isFromCustomer ? true : undefined,
                lastMessageAt: new Date(msg.created_time),
              },
              create: {
                pageId: page.id,
                psid: customerPsid,
                userName: customerName,
                unread: isFromCustomer,
                lastMessageAt: new Date(msg.created_time),
              },
              include: {
                page: {
                  select: { id: true, pageId: true, name: true, pictureUrl: true },
                },
              },
            });

            // Create new message record
            const savedMessage = await prisma.message.create({
              data: {
                conversationId: conversation.id,
                fbMessageId: msg.id,
                text: msg.message || (attachmentsJson ? 'Attachment' : ''),
                direction,
                attachments: attachmentsJson,
                createdAt: new Date(msg.created_time),
              },
            });

            processedMessageIds.add(msg.id);

            // Emit instant Socket.io event to all connected browsers
            emitNewMessage({
              message: savedMessage,
              conversation,
            });

            emitConversationUpdated({
              ...conversation,
              lastMessage: savedMessage,
            });

            console.log(
              `[RealTimeStreamer] ⚡ Live message delivered: "${savedMessage.text?.slice(0, 35)}" from ${customerName} on "${page.name}"`
            );

            // If inbound message and auto-reply is active for this thread, process auto-reply
            if (isFromCustomer && conversation.autoReplyEnabled) {
              setImmediate(async () => {
                try {
                  await processAutoReply(
                    conversation.id,
                    customerPsid,
                    msg.message || ''
                  );
                } catch (autoErr: any) {
                  console.warn(
                    '[RealTimeStreamer] Auto-reply processing error:',
                    autoErr.message
                  );
                }
              });
            }
          }
        }
      } catch (pageErr: any) {
        // Log lightly and continue
      }
    }
  } catch (err: any) {
    console.warn('[RealTimeStreamer] Polling cycle exception:', err.message);
  } finally {
    isStreamerRunning = false;
  }
}

/**
 * Starts the Autonomous 24/7 Real-Time Meta Streamer
 * Runs a rapid non-blocking cycle every 3.5 seconds
 */
export function startRealtimeStreamer(intervalMs: number = 3500) {
  if (streamerInterval) {
    clearInterval(streamerInterval);
  }

  console.log(
    `[RealTimeStreamer] ⚡ Autonomous Meta Real-Time Streamer started (cycle: ${intervalMs}ms).`
  );

  // Trigger initial check immediately
  setTimeout(() => {
    pollMetaUpdatesForActivePages();
  }, 1000);

  // Set interval loop
  streamerInterval = setInterval(() => {
    pollMetaUpdatesForActivePages();
  }, intervalMs);
}
