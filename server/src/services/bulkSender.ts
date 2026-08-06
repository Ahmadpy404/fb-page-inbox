import { prisma } from '../db';
import { graphApiClient } from './graphApi';
import { emitNewReply, getIO } from '../socket';

export interface BroadcastLogItem {
  id: string;
  conversationId: string;
  psid: string;
  userName: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  timestamp: string;
}

export interface BroadcastState {
  jobId: string | null;
  status: 'idle' | 'running' | 'completed' | 'cancelled';
  total: number;
  sent: number;
  failed: number;
  currentIndex: number;
  currentRecipientName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  logs: BroadcastLogItem[];
}

export interface StartBroadcastOptions {
  pageId?: string; // internal page ID or 'all'
  targetFilter: 'all' | 'active_window' | 'custom';
  conversationIds?: string[];
  text?: string;
  mediaUrl?: string;
  mediaBuffer?: Buffer;
  mediaMimeType?: string;
  mediaFilename?: string;
  delayMs?: number; // default 1000ms
}

class BulkSenderService {
  private activeState: BroadcastState = {
    jobId: null,
    status: 'idle',
    total: 0,
    sent: 0,
    failed: 0,
    currentIndex: 0,
    currentRecipientName: null,
    startedAt: null,
    finishedAt: null,
    logs: [],
  };

  private cancelRequested = false;

  public getStatus(): BroadcastState {
    return { ...this.activeState };
  }

  public cancel(): boolean {
    if (this.activeState.status === 'running') {
      this.cancelRequested = true;
      this.activeState.status = 'cancelled';
      this.emitProgress();
      return true;
    }
    return false;
  }

  private emitProgress() {
    try {
      const io = getIO();
      if (io) {
        io.emit('broadcast:progress', this.activeState);
      }
    } catch {
      // Ignore socket errors
    }
  }

  public async startBroadcast(options: StartBroadcastOptions): Promise<BroadcastState> {
    if (this.activeState.status === 'running') {
      throw new Error('A broadcast campaign is already in progress. Please wait or cancel it first.');
    }

    if (!options.text && !options.mediaUrl && !options.mediaBuffer) {
      throw new Error('Broadcast must have either text message or media attachment.');
    }

    // 1. Fetch eligible target conversations
    const whereClause: any = {};
    if (options.pageId && options.pageId !== 'all') {
      whereClause.pageId = options.pageId;
    }

    if (options.targetFilter === 'custom' && options.conversationIds && options.conversationIds.length > 0) {
      whereClause.id = { in: options.conversationIds };
    } else if (options.targetFilter === 'active_window') {
      // Last message within 24 hours
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      whereClause.lastMessageAt = { gte: twentyFourHoursAgo };
    }

    const conversations = await prisma.conversation.findMany({
      where: whereClause,
      include: {
        page: true,
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    if (conversations.length === 0) {
      throw new Error('No conversations found matching the selected audience criteria.');
    }

    // 2. Initialize job state
    const jobId = `job_${Date.now()}`;
    this.cancelRequested = false;
    this.activeState = {
      jobId,
      status: 'running',
      total: conversations.length,
      sent: 0,
      failed: 0,
      currentIndex: 0,
      currentRecipientName: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logs: conversations.map((c: any) => ({
        id: c.id,
        conversationId: c.id,
        psid: c.psid,
        userName: c.userName || `User ${c.psid.slice(-4)}`,
        status: 'pending',
        timestamp: new Date().toISOString(),
      })),
    };

    this.emitProgress();

    // 3. Run execution in background worker asynchronously
    const delay = Math.max(options.delayMs || 1000, 500);

    (async () => {
      console.log(`[BulkSender] Starting broadcast ${jobId} for ${conversations.length} recipients with delay=${delay}ms`);

      for (let i = 0; i < conversations.length; i++) {
        if (this.cancelRequested) {
          console.log(`[BulkSender] Broadcast ${jobId} cancelled by user at index ${i}`);
          this.activeState.status = 'cancelled';
          this.activeState.finishedAt = new Date().toISOString();
          this.emitProgress();
          break;
        }

        const conv: any = conversations[i];
        const logItem = this.activeState.logs[i];
        this.activeState.currentIndex = i + 1;
        this.activeState.currentRecipientName = conv.userName || `User ${conv.psid.slice(-4)}`;

        // Resolve page access token
        const pageToken = conv.page?.accessToken;

        try {
          // A. Send Media Attachment if provided
          if (options.mediaBuffer) {
            await graphApiClient.sendMediaAttachment(
              conv.psid,
              'image',
              options.mediaBuffer,
              options.mediaFilename || 'broadcast.jpg',
              options.mediaMimeType || 'image/jpeg',
              pageToken
            );

            // Record media message in DB
            const mediaMsg = await prisma.message.create({
              data: {
                conversationId: conv.id,
                fbMessageId: `mid.bcast.media.${Date.now()}`,
                direction: 'outbound_manual',
                text: '📷 [Broadcast Photo Attachment]',
                createdAt: new Date(),
              },
            });
            emitNewReply({ message: mediaMsg, conversationId: conv.id });
          } else if (options.mediaUrl) {
            await graphApiClient.sendMediaAttachment(
              conv.psid,
              'image',
              options.mediaUrl,
              'image.jpg',
              'image/jpeg',
              pageToken
            );

            const mediaMsg = await prisma.message.create({
              data: {
                conversationId: conv.id,
                fbMessageId: `mid.bcast.media.${Date.now()}`,
                direction: 'outbound_manual',
                text: `📷 ${options.mediaUrl}`,
                createdAt: new Date(),
              },
            });
            emitNewReply({ message: mediaMsg, conversationId: conv.id });
          }

          // B. Send Text Message if provided
          if (options.text) {
            // Replace personalized variables
            const firstName = (conv.userName || 'there').split(' ')[0];
            const personalizedText = options.text
              .replace(/\{name\}/gi, conv.userName || 'Customer')
              .replace(/\{first_name\}/gi, firstName);

            const metaRes = await graphApiClient.sendMessage(conv.psid, personalizedText, pageToken);

            const textMsg = await prisma.message.create({
              data: {
                conversationId: conv.id,
                fbMessageId: metaRes.message_id || `mid.bcast.txt.${Date.now()}`,
                direction: 'outbound_manual',
                text: personalizedText,
                createdAt: new Date(),
              },
            });
            emitNewReply({ message: textMsg, conversationId: conv.id });
          }

          // Update conversation timestamp
          await prisma.conversation.update({
            where: { id: conv.id },
            data: { lastMessageAt: new Date() },
          });

          this.activeState.sent++;
          logItem.status = 'success';
          logItem.timestamp = new Date().toISOString();
        } catch (err: any) {
          console.warn(`[BulkSender] Failed to send to ${conv.psid} (${conv.userName}):`, err?.message);
          this.activeState.failed++;
          logItem.status = 'failed';
          logItem.error = err?.message || 'Failed to deliver message';
          logItem.timestamp = new Date().toISOString();
        }

        this.emitProgress();

        // Safety throttle sleep between messages
        if (i < conversations.length - 1 && !this.cancelRequested) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      if (this.activeState.status !== 'cancelled') {
        this.activeState.status = 'completed';
        this.activeState.finishedAt = new Date().toISOString();
        this.emitProgress();
      }

      console.log(
        `[BulkSender] Broadcast ${jobId} finished. Total: ${this.activeState.total}, Sent: ${this.activeState.sent}, Failed: ${this.activeState.failed}`
      );
    })().catch((err) => {
      console.error('[BulkSender] Unexpected worker crash:', err);
      this.activeState.status = 'completed';
      this.activeState.finishedAt = new Date().toISOString();
      this.emitProgress();
    });

    return { ...this.activeState };
  }
}

export const bulkSenderService = new BulkSenderService();
