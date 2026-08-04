import { prisma } from '../db';
import { graphApiClient } from './graphApi';
import { emitNewReply, emitConversationUpdated } from '../socket';

export interface RuleModel {
  id: string;
  keyword: string;
  matchType: string; // 'exact' | 'contains' | 'regex'
  replyText: string;
  priority: number;
  enabled: boolean;
}

/**
 * Pure function to test whether a message matches a specific rule.
 */
export function matchRule(text: string, rule: RuleModel): boolean {
  if (!rule.enabled || !rule.keyword || !text) {
    return false;
  }

  const normalizedText = text.trim().toLowerCase();
  const normalizedKeyword = rule.keyword.trim().toLowerCase();

  switch (rule.matchType) {
    case 'exact':
      return normalizedText === normalizedKeyword;

    case 'contains':
      return normalizedText.includes(normalizedKeyword);

    case 'regex': {
      try {
        const regex = new RegExp(rule.keyword.trim(), 'i');
        return regex.test(text.trim());
      } catch (err) {
        console.warn(`[AutoReply] Invalid regex in rule id=${rule.id}:`, rule.keyword);
        return false;
      }
    }

    default:
      return false;
  }
}

/**
 * Find the first matching rule from an ordered list of rules.
 */
export function findMatchingRule(text: string, rules: RuleModel[]): RuleModel | null {
  const sortedRules = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (matchRule(text, rule)) {
      return rule;
    }
  }

  return null;
}

/**
 * Check if global auto-reply setting is enabled. Defaults to true.
 */
export async function isGlobalAutoReplyEnabled(): Promise<boolean> {
  const setting = await prisma.setting.findUnique({
    where: { key: 'global_auto_reply' },
  });

  if (!setting) {
    return true; // Default is ON
  }

  return setting.value === 'true' || setting.value === '1';
}

/**
 * Process inbound message through auto-reply engine.
 */
export async function processAutoReply(
  conversationId: string,
  userPsid: string,
  messageText: string
): Promise<{ matched: boolean; ruleId?: string; replyText?: string; messageId?: string }> {
  if (!messageText || !messageText.trim()) {
    return { matched: false };
  }

  // 1. Check Global Auto-Reply setting
  const globalEnabled = await isGlobalAutoReplyEnabled();
  if (!globalEnabled) {
    console.log(`[AutoReply] Global auto-reply is disabled. Skipping.`);
    return { matched: false };
  }

  // 2. Check per-conversation auto-reply status
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation || !conversation.autoReplyEnabled) {
    console.log(`[AutoReply] Auto-reply is disabled for conversation ${conversationId}. Skipping.`);
    return { matched: false };
  }

  // 3. Fetch active rules ordered by priority
  const rules = await prisma.rule.findMany({
    where: { enabled: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  const matchingRule = findMatchingRule(messageText, rules);
  if (!matchingRule) {
    return { matched: false };
  }

  console.log(`[AutoReply] Rule "${matchingRule.keyword}" (${matchingRule.matchType}) matched for PSID ${userPsid}. Sending reply...`);

  // 4. Send the automatic reply via Graph API
  try {
    const sendResult = await graphApiClient.sendMessage(userPsid, matchingRule.replyText);

    // 5. Store outbound_auto message in DB
    const autoReplyMessage = await prisma.message.create({
      data: {
        conversationId,
        direction: 'outbound_auto',
        text: matchingRule.replyText,
        fbMessageId: sendResult.message_id,
      },
    });

    // Update conversation timestamp
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    // 6. Emit real-time updates via Socket.IO
    emitNewReply({
      message: autoReplyMessage,
      conversationId,
    });
    emitConversationUpdated(updatedConversation);

    return {
      matched: true,
      ruleId: matchingRule.id,
      replyText: matchingRule.replyText,
      messageId: autoReplyMessage.id,
    };
  } catch (err: any) {
    console.error(`[AutoReply] Failed to send automated reply to ${userPsid}:`, err?.message || err);
    return { matched: true, ruleId: matchingRule.id, replyText: matchingRule.replyText };
  }
}
