import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifySignature, parseWebhookPayload } from '../../src/services/webhook';

describe('Webhook Verification & Parser Module', () => {
  const appSecret = 'my_super_secret_fb_app_secret_12345';

  function generateSignature(payload: string | Buffer, secret: string): string {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload)
      .digest('hex');
    return `sha256=${hash}`;
  }

  describe('Signature Verification (verifySignature)', () => {
    it('returns true when X-Hub-Signature-256 matches HMAC-SHA256 of raw body', () => {
      const rawBody = JSON.stringify({ object: 'page', entry: [] });
      const signature = generateSignature(rawBody, appSecret);

      const isValid = verifySignature(rawBody, signature, appSecret);
      expect(isValid).toBe(true);
    });

    it('returns false when signature hash is invalid or tampered', () => {
      const rawBody = JSON.stringify({ object: 'page', entry: [] });
      const signature = generateSignature(rawBody, appSecret);
      const tamperedSignature = signature.slice(0, -4) + 'abcd';

      const isValid = verifySignature(rawBody, tamperedSignature, appSecret);
      expect(isValid).toBe(false);
    });

    it('returns false when signature header is missing or undefined', () => {
      const rawBody = JSON.stringify({ object: 'page' });
      expect(verifySignature(rawBody, undefined, appSecret)).toBe(false);
      expect(verifySignature(rawBody, '', appSecret)).toBe(false);
    });

    it('returns false when signature header is malformed (missing sha256= prefix)', () => {
      const rawBody = JSON.stringify({ object: 'page' });
      const hash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      expect(verifySignature(rawBody, hash, appSecret)).toBe(false);
      expect(verifySignature(rawBody, `sha1=${hash}`, appSecret)).toBe(false);
    });

    it('returns false when signed with a different app secret', () => {
      const rawBody = JSON.stringify({ object: 'page' });
      const signature = generateSignature(rawBody, 'different_secret');

      const isValid = verifySignature(rawBody, signature, appSecret);
      expect(isValid).toBe(false);
    });
  });

  describe('Payload Parsing (parseWebhookPayload)', () => {
    it('parses standard inbound user message fixture correctly', () => {
      const fixture = {
        object: 'page',
        entry: [
          {
            id: 'PAGE_ID_123',
            time: 1700000000000,
            messaging: [
              {
                sender: { id: 'PSID_USER_456' },
                recipient: { id: 'PAGE_ID_123' },
                timestamp: 1700000000000,
                message: {
                  mid: 'mid.1700000000:abc1234',
                  text: 'Hello, what are your business hours?',
                },
              },
            ],
          },
        ],
      };

      const events = parseWebhookPayload(fixture);
      expect(events).toHaveLength(1);

      const event = events[0];
      expect(event.type).toBe('message');
      expect(event.pageId).toBe('PAGE_ID_123');
      expect(event.userPsid).toBe('PSID_USER_456');
      expect(event.senderId).toBe('PSID_USER_456');
      expect(event.recipientId).toBe('PAGE_ID_123');
      expect(event.text).toBe('Hello, what are your business hours?');
      expect(event.fbMessageId).toBe('mid.1700000000:abc1234');
      expect(event.isEcho).toBe(false);
    });

    it('parses message echo fixture (outbound from Page / Meta Business Suite)', () => {
      const fixture = {
        object: 'page',
        entry: [
          {
            id: 'PAGE_ID_123',
            time: 1700000005000,
            messaging: [
              {
                sender: { id: 'PAGE_ID_123' },
                recipient: { id: 'PSID_USER_456' },
                timestamp: 1700000005000,
                message: {
                  mid: 'mid.1700000005:echo789',
                  text: 'Our hours are 9am to 5pm Monday to Friday.',
                  is_echo: true,
                  app_id: 123456789,
                },
              },
            ],
          },
        ],
      };

      const events = parseWebhookPayload(fixture);
      expect(events).toHaveLength(1);

      const event = events[0];
      expect(event.type).toBe('message_echo');
      expect(event.pageId).toBe('PAGE_ID_123');
      expect(event.userPsid).toBe('PSID_USER_456'); // Should correctly map to the user's PSID
      expect(event.senderId).toBe('PAGE_ID_123');
      expect(event.recipientId).toBe('PSID_USER_456');
      expect(event.isEcho).toBe(true);
      expect(event.text).toBe('Our hours are 9am to 5pm Monday to Friday.');
      expect(event.fbMessageId).toBe('mid.1700000005:echo789');
    });

    it('parses message with image attachments', () => {
      const fixture = {
        object: 'page',
        entry: [
          {
            id: 'PAGE_ID_123',
            messaging: [
              {
                sender: { id: 'PSID_USER_456' },
                recipient: { id: 'PAGE_ID_123' },
                message: {
                  mid: 'mid.image.123',
                  attachments: [
                    {
                      type: 'image',
                      payload: { url: 'https://example.com/receipt.jpg' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const events = parseWebhookPayload(fixture);
      expect(events).toHaveLength(1);
      expect(events[0].attachments).toHaveLength(1);
      expect(events[0].attachments?.[0].type).toBe('image');
      expect(events[0].attachments?.[0].payload.url).toBe('https://example.com/receipt.jpg');
    });

    it('gracefully handles non-page objects or malformed payloads', () => {
      expect(parseWebhookPayload(null)).toEqual([]);
      expect(parseWebhookPayload({})).toEqual([]);
      expect(parseWebhookPayload({ object: 'user' })).toEqual([]);
      expect(parseWebhookPayload({ object: 'page', entry: 'invalid' })).toEqual([]);
    });
  });
});
