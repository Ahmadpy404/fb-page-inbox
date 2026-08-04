import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { graphApiClient } from '../services/graphApi';
import { exchangeForPermanentPageToken } from '../utils/tokenExchanger';

const router = Router();

/**
 * GET /api/pages
 * List all configured Facebook pages with status & stats
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pages = await prisma.page.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            conversations: true,
          },
        },
      },
    });

    const enrichedPages = await Promise.all(
      pages.map(async (page) => {
        const unreadCount = await prisma.conversation.count({
          where: { pageId: page.id, unread: true },
        });

        return {
          id: page.id,
          pageId: page.pageId,
          name: page.name,
          pictureUrl: page.pictureUrl,
          isActive: page.isActive,
          totalConversations: page._count.conversations,
          unreadConversations: unreadCount,
          createdAt: page.createdAt,
        };
      })
    );

    return res.json(enrichedPages);
  } catch (err: any) {
    console.error('[API] Error listing pages:', err);
    return res.status(500).json({ error: 'Failed to list pages' });
  }
});

/**
 * POST /api/pages
 * Add a new Facebook page
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { token, pageId: inputPageId, name: inputName } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Access token is required' });
    }

    let finalToken = token.trim();
    let pageName = inputName;
    let pageId = inputPageId;
    let pictureUrl: string | undefined;

    // 1. Try to convert to permanent token if it's a short-lived user or page token
    try {
      const exchangeResult = await exchangeForPermanentPageToken(finalToken);
      finalToken = exchangeResult.permanentPageToken;
      if (!pageName) pageName = exchangeResult.pageName;
    } catch {
      // Continue with provided token if exchange fails or not needed
    }

    // 2. Fetch page details from Meta using the token
    try {
      const detailsUrl = `https://graph.facebook.com/v19.0/me?fields=id,name,picture&access_token=${encodeURIComponent(finalToken)}`;
      const detailsRes = await fetch(detailsUrl);
      const details = (await detailsRes.json()) as any;
      if (details && details.id) {
        pageId = details.id;
        pageName = pageName || details.name;
        pictureUrl = details.picture?.data?.url;
      }
    } catch (e: any) {
      console.warn('[Pages] Could not fetch page details from Meta:', e.message);
    }

    if (!pageId) {
      return res.status(400).json({ error: 'Could not determine Facebook Page ID from token' });
    }

    // 3. Upsert Page in DB
    const page = await prisma.page.upsert({
      where: { pageId },
      update: {
        name: pageName || 'Facebook Page',
        accessToken: finalToken,
        pictureUrl,
        isActive: true,
      },
      create: {
        pageId,
        name: pageName || 'Facebook Page',
        accessToken: finalToken,
        pictureUrl,
        isActive: true,
      },
    });

    // 4. Auto-subscribe new page to webhooks
    try {
      const subUrl = `https://graph.facebook.com/v19.0/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes&access_token=${encodeURIComponent(finalToken)}`;
      await fetch(subUrl, { method: 'POST' });
    } catch {}

    return res.status(201).json({
      success: true,
      page: {
        id: page.id,
        pageId: page.pageId,
        name: page.name,
        pictureUrl: page.pictureUrl,
        isActive: page.isActive,
      },
    });
  } catch (err: any) {
    console.error('[API] Error adding page:', err);
    return res.status(500).json({ error: err.message || 'Failed to add Facebook page' });
  }
});

/**
 * PATCH /api/pages/:id
 * Update page settings or toggle status
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, isActive, accessToken } = req.body;

    const page = await prisma.page.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(isActive !== undefined && { isActive }),
        ...(accessToken !== undefined && { accessToken }),
      },
    });

    return res.json({ success: true, page });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to update page' });
  }
});

/**
 * DELETE /api/pages/:id
 * Remove page
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const count = await prisma.page.count();
    if (count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only remaining page' });
    }

    await prisma.page.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to delete page' });
  }
});

export default router;
