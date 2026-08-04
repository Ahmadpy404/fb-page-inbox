import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import {
  sendManualReply,
  toggleConversationAutoReply,
  markConversationRead,
  backfillFromGraphApi,
} from '../services/conversations';

const router = Router();

/**
 * GET /api/conversations
 * List conversations sorted by last_message_at with last message preview.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;

    const where: any = {};
    if (search) {
      where.OR = [
        { userName: { contains: search } },
        { psid: { contains: search } },
        { messages: { some: { text: { contains: search } } } },
      ];
    }

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const formatted = conversations.map((conv) => ({
      id: conv.id,
      psid: conv.psid,
      userName: conv.userName,
      userAvatarUrl: conv.userAvatarUrl,
      lastMessageAt: conv.lastMessageAt,
      autoReplyEnabled: conv.autoReplyEnabled,
      unread: conv.unread,
      createdAt: conv.createdAt,
      lastMessage: conv.messages[0] || null,
    }));

    return res.json({ conversations: formatted });
  } catch (err: any) {
    console.error('[API] Error fetching conversations:', err);
    return res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * GET /api/conversations/:id/messages
 * Full chat history for a conversation.
 */
router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({ conversation, messages });
  } catch (err: any) {
    console.error('[API] Error fetching conversation messages:', err);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /api/conversations/:id/reply
 * Send manual reply to a conversation.
 */
router.post('/:id/reply', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const result = await sendManualReply(id, text);
    return res.status(201).json(result);
  } catch (err: any) {
    console.error('[API] Error sending manual reply:', err);
    return res.status(500).json({ error: err.message || 'Failed to send reply' });
  }
});

/**
 * PATCH /api/conversations/:id/auto-reply
 * Toggle auto-reply mute status for a specific conversation.
 */
router.patch('/:id/auto-reply', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;

    const updated = await toggleConversationAutoReply(id, enabled);
    return res.json({ conversation: updated });
  } catch (err: any) {
    console.error('[API] Error toggling auto-reply:', err);
    return res.status(500).json({ error: err.message || 'Failed to toggle auto-reply' });
  }
});

/**
 * POST /api/conversations/:id/read
 * Mark conversation as read.
 */
router.post('/:id/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = await markConversationRead(id);
    return res.json({ conversation: updated });
  } catch (err: any) {
    console.error('[API] Error marking conversation as read:', err);
    return res.status(500).json({ error: err.message || 'Failed to mark as read' });
  }
});

/**
 * POST /api/sync
 * Trigger full conversation history backfill from Facebook Graph API.
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const result = await backfillFromGraphApi();
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[API] Error syncing conversations:', err);
    return res.status(500).json({ error: err.message || 'Failed to sync conversations' });
  }
});

export default router;
