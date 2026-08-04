import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/db';
import { graphApiClient } from '../../src/services/graphApi';

describe('Conversations, Rules & Settings REST API Integration Tests', () => {
  beforeEach(async () => {
    await prisma.message.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.rule.deleteMany();
    await prisma.setting.deleteMany();

    vi.spyOn(graphApiClient, 'sendMessage').mockResolvedValue({
      recipient_id: 'PSID_CONV_1',
      message_id: 'mid.manual_reply_123',
    });

    vi.spyOn(graphApiClient, 'getPageDetails').mockResolvedValue({
      id: 'PAGE_ID_999',
      name: 'My Official Test Facebook Page',
      picture: { data: { url: 'https://example.com/page.jpg' } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Conversations API', () => {
    it('GET /api/conversations returns list of conversations with latest message', async () => {
      const conv = await prisma.conversation.create({
        data: {
          psid: 'PSID_CONV_1',
          userName: 'John Doe',
          lastMessageAt: new Date(),
          unread: true,
        },
      });

      await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: 'inbound',
          text: 'Hello from John!',
        },
      });

      const res = await request(app).get('/api/conversations');
      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].userName).toBe('John Doe');
      expect(res.body.conversations[0].lastMessage.text).toBe('Hello from John!');
      expect(res.body.conversations[0].unread).toBe(true);
    });

    it('GET /api/conversations/:id/messages returns full message thread', async () => {
      const conv = await prisma.conversation.create({
        data: { psid: 'PSID_CONV_2', userName: 'Jane Doe' },
      });

      await prisma.message.createMany({
        data: [
          { conversationId: conv.id, direction: 'inbound', text: 'Msg 1', createdAt: new Date(1000) },
          { conversationId: conv.id, direction: 'outbound_manual', text: 'Reply 1', createdAt: new Date(2000) },
        ],
      });

      const res = await request(app).get(`/api/conversations/${conv.id}/messages`);
      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.messages[0].text).toBe('Msg 1');
      expect(res.body.messages[1].text).toBe('Reply 1');
    });

    it('POST /api/conversations/:id/reply sends manual message via Graph API and stores outbound_manual', async () => {
      const conv = await prisma.conversation.create({
        data: { psid: 'PSID_CONV_1', userName: 'John Doe' },
      });

      const res = await request(app)
        .post(`/api/conversations/${conv.id}/reply`)
        .send({ text: 'Thanks for reaching out! Here is our reply.' });

      expect(res.status).toBe(201);
      expect(res.body.message.direction).toBe('outbound_manual');
      expect(res.body.message.text).toBe('Thanks for reaching out! Here is our reply.');
      expect(res.body.message.fbMessageId).toBe('mid.manual_reply_123');

      expect(graphApiClient.sendMessage).toHaveBeenCalledWith(
        'PSID_CONV_1',
        'Thanks for reaching out! Here is our reply.'
      );
    });

    it('PATCH /api/conversations/:id/auto-reply toggles per-conversation auto-reply mute status', async () => {
      const conv = await prisma.conversation.create({
        data: { psid: 'PSID_CONV_1', autoReplyEnabled: true },
      });

      const res = await request(app)
        .patch(`/api/conversations/${conv.id}/auto-reply`)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.conversation.autoReplyEnabled).toBe(false);
    });

    it('POST /api/conversations/:id/read marks conversation as read', async () => {
      const conv = await prisma.conversation.create({
        data: { psid: 'PSID_CONV_1', unread: true },
      });

      const res = await request(app).post(`/api/conversations/${conv.id}/read`);
      expect(res.status).toBe(200);
      expect(res.body.conversation.unread).toBe(false);
    });
  });

  describe('Rules API (CRUD & Reorder)', () => {
    it('creates, updates, lists, reorders and deletes rules', async () => {
      // 1. Create rule 1
      const resCreate1 = await request(app)
        .post('/api/rules')
        .send({
          keyword: 'support',
          matchType: 'contains',
          replyText: 'Support line: 1-800-555-0199',
          priority: 0,
          enabled: true,
        });
      expect(resCreate1.status).toBe(201);
      const rule1Id = resCreate1.body.rule.id;

      // 2. Create rule 2
      const resCreate2 = await request(app)
        .post('/api/rules')
        .send({
          keyword: 'hours',
          matchType: 'exact',
          replyText: '9am-5pm daily',
          priority: 1,
          enabled: true,
        });
      expect(resCreate2.status).toBe(201);
      const rule2Id = resCreate2.body.rule.id;

      // 3. List rules
      const resList = await request(app).get('/api/rules');
      expect(resList.status).toBe(200);
      expect(resList.body.rules).toHaveLength(2);

      // 4. Update rule
      const resUpdate = await request(app)
        .put(`/api/rules/${rule1Id}`)
        .send({ enabled: false });
      expect(resUpdate.status).toBe(200);
      expect(resUpdate.body.rule.enabled).toBe(false);

      // 5. Reorder rules
      const resReorder = await request(app)
        .post('/api/rules/reorder')
        .send({ ruleIds: [rule2Id, rule1Id] });
      expect(resReorder.status).toBe(200);
      expect(resReorder.body.rules[0].id).toBe(rule2Id);
      expect(resReorder.body.rules[0].priority).toBe(0);

      // 6. Delete rule
      const resDelete = await request(app).delete(`/api/rules/${rule1Id}`);
      expect(resDelete.status).toBe(200);

      const resListAfter = await request(app).get('/api/rules');
      expect(resListAfter.body.rules).toHaveLength(1);
    });
  });

  describe('Settings API', () => {
    it('GET /api/settings retrieves global settings and Facebook status', async () => {
      const res = await request(app).get('/api/settings');
      expect(res.status).toBe(200);
      expect(res.body.globalAutoReply).toBe(true);
      expect(res.body.facebookStatus.connected).toBe(true);
      expect(res.body.facebookStatus.pageName).toBe('My Official Test Facebook Page');
    });

    it('POST /api/settings updates global auto reply toggle', async () => {
      const res = await request(app)
        .post('/api/settings')
        .send({ globalAutoReply: false });

      expect(res.status).toBe(200);
      expect(res.body.globalAutoReply).toBe(false);

      const getRes = await request(app).get('/api/settings');
      expect(getRes.body.globalAutoReply).toBe(false);
    });
  });
});
