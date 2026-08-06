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

    // 1. Check /me/accounts first (for User tokens) and /me (for direct Page tokens)
    let metaDetails: any = null;
    let metaError: any = null;

    // Check /me/accounts for user tokens
    try {
      const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,picture,tasks&access_token=${encodeURIComponent(finalToken)}`;
      const accountsRes = await fetch(accountsUrl);
      const accountsData = (await accountsRes.json()) as any;

      if (accountsData && Array.isArray(accountsData.data) && accountsData.data.length > 0) {
        const matchedPage = inputPageId
          ? accountsData.data.find((p: any) => p.id === inputPageId) || accountsData.data[0]
          : accountsData.data[0];

        if (matchedPage) {
          pageId = matchedPage.id;
          pageName = pageName || matchedPage.name;
          pictureUrl = matchedPage.picture?.data?.url;
          if (matchedPage.access_token) {
            finalToken = matchedPage.access_token;
          }
        }
      }
    } catch (e: any) {
      console.warn('[Pages] /me/accounts check error:', e.message);
    }

    // If not found via /me/accounts, try direct /me (direct Page Token)
    if (!pageId) {
      try {
        const detailsUrl = `https://graph.facebook.com/v19.0/me?fields=id,name,picture&access_token=${encodeURIComponent(finalToken)}`;
        const detailsRes = await fetch(detailsUrl);
        metaDetails = (await detailsRes.json()) as any;
        if (metaDetails && metaDetails.error) {
          metaError = metaDetails.error;
        } else if (metaDetails && metaDetails.id) {
          pageId = metaDetails.id;
          pageName = pageName || metaDetails.name;
          pictureUrl = metaDetails.picture?.data?.url;
        }
      } catch (e: any) {
        console.warn('[Pages] Direct /me check error:', e.message);
      }
    }

    // 3. Try to convert to permanent token if possible
    try {
      const exchangeResult = await exchangeForPermanentPageToken(finalToken, pageId);
      if (exchangeResult && exchangeResult.permanentPageToken) {
        finalToken = exchangeResult.permanentPageToken;
        if (!pageName) pageName = exchangeResult.pageName;
        if (!pageId) pageId = exchangeResult.pageId;
      }
    } catch {
      // Continue with valid token
    }

    // 4. If we still don't have pageId, check error
    if (!pageId) {
      if (metaError) {
        if (metaError.code === 190 && metaError.error_subcode === 463) {
          return res.status(400).json({
            error: 'This Facebook Access Token has expired. Please generate a fresh User or Page Access Token from Meta Graph API Explorer.',
          });
        }
        return res.status(400).json({
          error: `Facebook API Error (${metaError.code}): ${metaError.message || 'Invalid access token'}`,
        });
      }
      return res.status(400).json({
        error: 'Could not determine Facebook Page from token. Please ensure the token has "pages_show_list", "pages_messaging", and "pages_read_engagement" permissions.',
      });
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
    await prisma.page.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to delete page' });
  }
});

/**
 * POST /api/pages/sync-vault
 * Reconcile client-side stored pages with backend database.
 * If backend database was reset (e.g. Render restart), this seamlessly re-creates them.
 */
router.post('/sync-vault', async (req: Request, res: Response) => {
  try {
    const { pages } = req.body;
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    let restoredCount = 0;
    for (const item of pages) {
      if (!item.token || !item.pageId) continue;

      const existing = await prisma.page.findUnique({
        where: { pageId: item.pageId },
      });

      if (!existing) {
        let finalToken = item.token;
        let pageName = item.name;
        let pictureUrl: string | undefined;

        try {
          const detailsUrl = `https://graph.facebook.com/v19.0/me?fields=id,name,picture&access_token=${encodeURIComponent(finalToken)}`;
          const detailsRes = await fetch(detailsUrl);
          const details = (await detailsRes.json()) as any;
          if (details && details.id) {
            pageName = pageName || details.name;
            pictureUrl = details.picture?.data?.url;
          }
        } catch {}

        await prisma.page.create({
          data: {
            pageId: item.pageId,
            name: pageName || 'Facebook Page',
            accessToken: finalToken,
            pictureUrl,
            isActive: true,
          },
        });
        restoredCount++;
      }
    }

    return res.json({ success: true, restoredCount });
  } catch (err: any) {
    console.warn('[Pages] Vault sync error:', err.message);
    return res.status(500).json({ error: 'Failed to sync vault' });
  }
});

export default router;
