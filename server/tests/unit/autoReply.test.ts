import { describe, it, expect } from 'vitest';
import { matchRule, findMatchingRule, RuleModel } from '../../src/services/autoReply';

describe('Auto-Reply Rules Engine (Unit Tests)', () => {
  describe('Match Types (matchRule)', () => {
    it('matches exact keyword case-insensitively', () => {
      const rule: RuleModel = {
        id: '1',
        keyword: 'Pricing',
        matchType: 'exact',
        replyText: 'Our pricing starts at $49/mo.',
        priority: 0,
        enabled: true,
      };

      expect(matchRule('pricing', rule)).toBe(true);
      expect(matchRule('PRICING', rule)).toBe(true);
      expect(matchRule('  Pricing  ', rule)).toBe(true);
      expect(matchRule('pricing info please', rule)).toBe(false);
      expect(rule.replyText).toBe('Our pricing starts at $49/mo.');
    });

    it('matches contains keyword as substring case-insensitively', () => {
      const rule: RuleModel = {
        id: '2',
        keyword: 'hours',
        matchType: 'contains',
        replyText: 'We are open 9am - 5pm EST.',
        priority: 1,
        enabled: true,
      };

      expect(matchRule('What are your opening hours?', rule)).toBe(true);
      expect(matchRule('HOURS please', rule)).toBe(true);
      expect(matchRule('Are you open today?', rule)).toBe(false);
    });

    it('matches regex pattern accurately', () => {
      const rule: RuleModel = {
        id: '3',
        keyword: '^order\\s+#?\\d+$',
        matchType: 'regex',
        replyText: 'Please hold while we check your order status.',
        priority: 0,
        enabled: true,
      };

      expect(matchRule('order 12345', rule)).toBe(true);
      expect(matchRule('order #9988', rule)).toBe(true);
      expect(matchRule('ORDER 555', rule)).toBe(true);
      expect(matchRule('cancel my order 12345', rule)).toBe(false);
    });

    it('handles invalid regex without throwing, returns false', () => {
      const rule: RuleModel = {
        id: '4',
        keyword: '[unclosed bracket(',
        matchType: 'regex',
        replyText: 'Fallback',
        priority: 0,
        enabled: true,
      };

      expect(() => matchRule('test text', rule)).not.toThrow();
      expect(matchRule('test text', rule)).toBe(false);
    });

    it('returns false when rule is disabled', () => {
      const rule: RuleModel = {
        id: '5',
        keyword: 'help',
        matchType: 'exact',
        replyText: 'How can I help?',
        priority: 0,
        enabled: false,
      };

      expect(matchRule('help', rule)).toBe(false);
    });
  });

  describe('Priority Ordering and Rule Selection (findMatchingRule)', () => {
    const rules: RuleModel[] = [
      {
        id: 'low-prio',
        keyword: 'help',
        matchType: 'contains',
        replyText: 'General Help',
        priority: 10,
        enabled: true,
      },
      {
        id: 'high-prio',
        keyword: 'urgent help',
        matchType: 'contains',
        replyText: 'Urgent Support Escalated',
        priority: 1,
        enabled: true,
      },
      {
        id: 'disabled-high-prio',
        keyword: 'urgent',
        matchType: 'contains',
        replyText: 'Disabled rule',
        priority: 0,
        enabled: false,
      },
    ];

    it('picks the highest priority (lowest priority number) matching enabled rule', () => {
      const match = findMatchingRule('I need urgent help with my account', rules);
      expect(match).not.toBeNull();
      expect(match?.id).toBe('high-prio');
      expect(match?.replyText).toBe('Urgent Support Escalated');
    });

    it('falls back to lower priority rule when higher priority rules do not match', () => {
      const match = findMatchingRule('Can you help me?', rules);
      expect(match).not.toBeNull();
      expect(match?.id).toBe('low-prio');
      expect(match?.replyText).toBe('General Help');
    });

    it('skips disabled rules even if their priority is higher', () => {
      const match = findMatchingRule('This is urgent', rules);
      // 'disabled-high-prio' matches 'urgent' but is disabled; nothing else matches 'urgent' alone
      expect(match).toBeNull();
    });

    it('returns null when no rules match', () => {
      const match = findMatchingRule('Random unsolicited message', rules);
      expect(match).toBeNull();
    });
  });
});
