import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../../src/app';
import { prisma } from '../../src/db';
import { graphApiClient } from '../../src/services/graphApi';

describe('Webhook API Integration Tests', () => {
  const testSecret = 'test_app_secret_12345';
  const testVerifyToken = 'test_verify_token_abcde';

  function signPayload(body: any): string {
    const raw = JSON.stringify(body);
    const hash = crypto.createHmac('sha256', testSecret).update(raw).digest('hex');
    return `sha256=${hash}`;
  }

  beforeEach(async () => {
    // Clear test tables
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.rule.deleteMany();
    await prisma.setting.deleteMany();

    // Mock Graph API client calls
    vi.spyOn(graphApiClient, 'getUserProfile').mockResolvedValue({
      id: 'PSID_TEST_USER_100',
      first_name: 'Alice',
      last_name: 'Smith',
      name: 'Alice Smith',
      profile_pic: 'https://example.com/alice.jpg',
    });

    vi.spyOn(graphApiClient, 'sendMessage').mockResolvedValue({
      recipient_id: 'PSID_TEST_USER_100',
      message_id: 'mid.sent_reply_99999',
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('GET /webhook/facebook (Verification Handshake)', () => {
    it('returns 200 with challenge when hub.mode and hub.verify_token match', async () => {
      const challenge = 'random_challenge_string_123456';
      const response = await request(app)
        .get('/webhook/facebook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': testVerifyToken,
          'hub.challenge': challenge,
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe(challenge);
    });

    it('returns 403 when verify_token does not match', async () => {
      const response = await request(app)
        .get('/webhook/facebook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong_token',
          'hub.challenge': '12345',
        });

      expect(response.status).toBe(403);
    });

    it('returns 400 when missing query parameters', async () => {
      const response = await request(app).get('/webhook/facebook');
      expect(response.status).toBe(400);
    });
  });

  describe('POST /webhook/facebook (Event Ingestion & Auto-Reply)', () => {
    it('rejects unsigned or invalidly signed requests with 403 Forbidden', async () => {
      const payload = { object: 'page', entry: [] };

      // Missing signature
      const res1 = await request(app).post('/webhook/facebook').send(payload);
      expect(res1.status).toBe(403);

      // Invalid signature
      const res2 = await request(app)
        .post('/webhook/facebook')
        .set('x-hub-signature-256', 'sha256=invalid_hash')
        .send(payload);
      expect(res2.status).toBe(403);
    });

    it('successfully ingests valid inbound message, persists conversation and message', async () => {
      const payload = {
        object: 'page',
        entry: [
          {
            id: 'PAGE_123',
            time: Date.now(),
            messaging: [
              {
                sender: { id: 'PSID_TEST_USER_100' },
                recipient: { id: 'PAGE_123' },
                timestamp: Date.now(),
                message: {
                  mid: 'mid.test.inbound.001',
                  text: 'Hi there, I need assistance!',
                },
              },
            ],
          },
        ],
      };

      const signature = signPayload(payload);

      const response = await request(app)
        .post('/webhook/facebook')
        .set('x-hub-signature-256', signature)
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.text).toBe('EVENT_RECEIVED');

      // Verify conversation in DB
      const conversation = await prisma.conversation.findUnique({
        where: { psid: 'PSID_TEST_USER_100' },
        include: { messages: true },
      });

      expect(conversation).not.toBeNull();
      expect(conversation?.userName).toBe('Alice Smith');
      expect(conversation?.unread).toBe(true);
      expect(conversation?.messages).toHaveLength(1);
      expect(conversation?.messages[0].direction).toBe('inbound');
      expect(conversation?.messages[0].text).toBe('Hi there, I need assistance!');
      expect(conversation?.messages[0].fbMessageId).toBe('mid.test.inbound.001');
    });

    it('correctly handles message echoes sent from Page without duplicating', async () => {
      const payload = {
        object: 'page',
        entry: [
          {
            id: 'PAGE_123',
            time: Date.now(),
            messaging: [
              {
                sender: { id: 'PAGE_123' },
                recipient: { id: 'PSID_TEST_USER_100' },
                timestamp: Date.now(),
                message: {
                  mid: 'mid.test.echo.002',
                  text: 'Echo message from Meta Business Suite',
                  is_echo: true,
                },
              },
            ],
          },
        ],
      };

      const signature = signPayload(payload);

      const response = await request(app)
        .post('/webhook/facebook')
        .set('x-hub-signature-256', signature)
        .send(payload);

      expect(response.status).toBe(200);

      const message = await prisma.message.findUnique({
        where: { fbMessageId: 'mid.test.echo.002' },
      });

      expect(message).not.toBeNull();
      expect(message?.direction).toBe('outbound_manual');
      expect(message?.text).toBe('Echo message from Meta Business Suite');
    });

    it('triggers auto-reply when inbound message matches an active keyword rule', async () => {
      // Create auto-reply rule
      await prisma.rule.create({
        data: {
          keyword: 'support',
          matchType: 'contains',
          replyText: 'Our support team is available 24/7!',
          priority: 0,
          enabled: true,
        },
      });

      const payload = {
        object: 'page',
        entry: [
          {
            id: 'PAGE_123',
            time: Date.now(),
            messaging: [
              {
                sender: { id: 'PSID_TEST_USER_100' },
                recipient: { id: 'PAGE_123' },
                timestamp: Date.now(),
                message: {
                  mid: 'mid.test.support.003',
                  text: 'Can I get support with my order?',
                },
              },
            ],
          },
        ],
      };

      const signature = signPayload(payload);

      const response = await request(app)
        .post('/webhook/facebook')
        .set('x-hub-signature-256', signature)
        .send(payload);

      expect(response.status).toBe(200);

      // Wait a tick for async auto-reply execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(graphApiClient.sendMessage).toHaveBeenCalledWith(
        'PSID_TEST_USER_100',
        'Our support team is available 24/7!'
      );

      // Verify outbound_auto message stored in DB
      const autoMsg = await prisma.message.findFirst({
        where: { direction: 'outbound_auto' },
      });

      expect(autoMsg).not.toBeNull();
      expect(autoMsg?.text).toBe('Our support team is available 24/7!');
    });

    it('does NOT trigger auto-reply when conversation has autoReplyEnabled = false', async () => {
      // Create muted conversation
      const conv = await prisma.conversation.create({
        data: {
          psid: 'PSID_TEST_USER_MUTED',
          userName: 'Muted User',
          autoReplyEnabled: false,
        },
      });

      // Create rule
      await prisma.rule.create({
        data: {
          keyword: 'help',
          matchType: 'contains',
          replyText: 'Auto help response',
          priority: 0,
          enabled: true,
        },
      });

      const payload = {
        object: 'page',
        entry: [
          {
            id: 'PAGE_123',
            time: Date.now(),
            messaging: [
              {
                sender: { id: 'PSID_TEST_USER_MUTED' },
                recipient: { id: 'PAGE_123' },
                message: {
                  mid: 'mid.test.muted.004',
                  text: 'I need help please',
                },
              },
            ],
          },
        ],
      };

      const signature = signPayload(payload);

      await request(app)
        .post('/webhook/facebook')
        .set('x-hub-signature-256', signature)
        .send(payload);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const autoMessages = await prisma.message.findMany({
        where: { conversationId: conv.id, direction: 'outbound_auto' },
      });

      expect(autoMessages).toHaveLength(0);
    });
  });
});
