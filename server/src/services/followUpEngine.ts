import { prisma } from '../db';
import { graphApiClient } from './graphApi';
import { emitNewReply, emitConversationUpdated } from '../socket';

export interface FollowUpConfig {
  enabled: boolean;
  triggerHours: number; // e.g. 21 hours
  templateText: string;
}

const DEFAULT_FOLLOWUP_TEMPLATE =
  '🔥 Quick reminder: Your exclusive bonus & $5 freeplay is reserved for just a few more hours! Reply "YES" or message us here to claim it before time runs out. 🎁';

/**
 * Fetch follow-up configuration from database settings.
 */
export async function getFollowUpConfig(): Promise<FollowUpConfig> {
  try {
    const enabledSetting = await prisma.setting.findUnique({ where: { key: 'auto_followup_enabled' } });
    const hoursSetting = await prisma.setting.findUnique({ where: { key: 'auto_followup_hours' } });
    const textSetting = await prisma.setting.findUnique({ where: { key: 'auto_followup_template' } });

    return {
      enabled: enabledSetting ? enabledSetting.value === 'true' : true, // Default enabled
      triggerHours: hoursSetting ? parseInt(hoursSetting.value, 10) || 21 : 21, // Default 21 hours
      templateText: textSetting ? textSetting.value : DEFAULT_FOLLOWUP_TEMPLATE,
    };
  } catch (err) {
    return {
      enabled: true,
      triggerHours: 21,
      templateText: DEFAULT_FOLLOWUP_TEMPLATE,
    };
  }
}

/**
 * Scan active conversations and send 23rd-hour auto follow-ups to re-open the 24-hour window.
 */
export async function checkAndSendFollowUps(): Promise<number> {
  const config = await getFollowUpConfig();
  if (!config.enabled) {
    return 0;
  }

  const now = Date.now();
  const triggerMs = config.triggerHours * 60 * 60 * 1000;
  const maxWindowMs = 23.5 * 60 * 60 * 1000; // Under 23.5 hours to guarantee delivery inside 24h

  // Find conversations where auto-reply is enabled
  const conversations = await prisma.conversation.findMany({
    where: {
      autoReplyEnabled: true,
    },
    include: {
      page: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  });

  let followUpCount = 0;

  for (const conv of conversations) {
    if (!conv.messages || conv.messages.length === 0) continue;

    // Find the last inbound customer message
    const lastInbound = conv.messages.find((m) => m.direction === 'inbound');
    if (!lastInbound) continue;

    const timeSinceLastInbound = now - new Date(lastInbound.createdAt).getTime();

    // Check if within the target re-engagement window (e.g. between 21h and 23.5h)
    if (timeSinceLastInbound >= triggerMs && timeSinceLastInbound < maxWindowMs) {
      // Check if we already sent a follow-up recently after the customer's last inbound message
      const hasFollowUpAlready = conv.messages.some(
        (m) =>
          m.direction === 'outbound_auto' &&
          new Date(m.createdAt).getTime() > new Date(lastInbound.createdAt).getTime() &&
          m.text.includes('reserved')
      );

      if (hasFollowUpAlready) {
        continue;
      }

      console.log(
        `[FollowUpEngine] Sending 23rd-hour re-engagement follow-up to PSID ${conv.psid} (Conversation ${conv.id})...`
      );

      try {
        const pageToken = conv.page?.accessToken;
        const sendResult = await graphApiClient.sendMessage(conv.psid, config.templateText, pageToken);

        const newMsg = await prisma.message.create({
          data: {
            conversationId: conv.id,
            direction: 'outbound_auto',
            text: config.templateText,
            fbMessageId: sendResult.message_id,
          },
        });

        const updatedConv = await prisma.conversation.update({
          where: { id: conv.id },
          data: { lastMessageAt: new Date() },
        });

        emitNewReply({
          message: newMsg,
          conversationId: conv.id,
        });
        emitConversationUpdated(updatedConv);

        followUpCount++;
        console.log(`[FollowUpEngine] Successfully sent follow-up to PSID ${conv.psid}`);
      } catch (err: any) {
        console.warn(`[FollowUpEngine] Failed to send follow-up to ${conv.psid}:`, err.message || err);
      }
    }
  }

  return followUpCount;
}

let followUpTimer: NodeJS.Timeout | null = null;

/**
 * Start the 23rd-hour Auto-Followup background worker.
 */
export function startFollowUpWorker(intervalMinutes: number = 10): void {
  if (followUpTimer) {
    clearInterval(followUpTimer);
  }

  console.log(`[FollowUpEngine] Auto-Followup background service started (interval: ${intervalMinutes}m).`);

  // Initial check after 30 seconds
  setTimeout(() => {
    checkAndSendFollowUps().catch((e) => console.warn('[FollowUpEngine] Initial run error:', e.message));
  }, 30000);

  // Periodic interval
  followUpTimer = setInterval(() => {
    checkAndSendFollowUps().catch((e) => console.warn('[FollowUpEngine] Periodic run error:', e.message));
  }, intervalMinutes * 60 * 1000);
}
