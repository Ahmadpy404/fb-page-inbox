import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { getConfig } from '../config';
import { graphApiClient } from '../services/graphApi';

const router = Router();

/**
 * GET /api/settings
 * Fetch settings, global auto-reply status, and Meta connection status.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const config = getConfig();

    // Get global auto-reply setting
    const autoReplySetting = await prisma.setting.findUnique({
      where: { key: 'global_auto_reply' },
    });
    const globalAutoReply = autoReplySetting ? autoReplySetting.value === 'true' : true;

    // Check Facebook Graph API token health
    let fbStatus: {
      connected: boolean;
      pageId?: string;
      pageName?: string;
      pagePicture?: string;
      error?: string;
    } = { connected: false };

    try {
      const pageDetails = await graphApiClient.getPageDetails();
      fbStatus = {
        connected: true,
        pageId: pageDetails.id,
        pageName: pageDetails.name,
        pagePicture: pageDetails.picture?.data?.url,
      };
    } catch (err: any) {
      fbStatus = {
        connected: false,
        error: err.message || 'Unable to connect to Facebook Graph API',
      };
    }

    return res.json({
      globalAutoReply,
      facebookStatus: fbStatus,
      webhookConfig: {
        callbackPath: '/webhook/facebook',
        verifyTokenSet: Boolean(config.VERIFY_TOKEN),
        appSecretSet: Boolean(config.APP_SECRET),
        pageAccessTokenSet: Boolean(config.PAGE_ACCESS_TOKEN),
      },
    });
  } catch (err: any) {
    console.error('[API] Error fetching settings:', err);
    return res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * POST /api/settings
 * Update settings (e.g. global auto-reply on/off).
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { globalAutoReply } = req.body;

    if (globalAutoReply !== undefined) {
      await prisma.setting.upsert({
        where: { key: 'global_auto_reply' },
        update: { value: String(globalAutoReply) },
        create: { key: 'global_auto_reply', value: String(globalAutoReply) },
      });
    }

    return res.json({
      success: true,
      globalAutoReply: Boolean(globalAutoReply),
    });
  } catch (err: any) {
    console.error('[API] Error updating settings:', err);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * GET /api/settings/verify-connection
 * Check Facebook Graph API token live and auto-subscribe page to webhooks.
 */
router.get('/verify-connection', async (_req: Request, res: Response) => {
  try {
    const pageDetails = await graphApiClient.getPageDetails();
    // Auto-subscribe page to webhook events
    const subResult = await graphApiClient.subscribePageToWebhook();
    
    return res.json({
      connected: true,
      pageId: pageDetails.id,
      pageName: pageDetails.name,
      pagePicture: pageDetails.picture?.data?.url,
      webhookSubscribed: subResult.success,
      webhookMessage: subResult.message,
    });
  } catch (err: any) {
    return res.status(400).json({
      connected: false,
      error: err.message || 'Failed to verify Facebook connection',
    });
  }
});

/**
 * POST /api/settings/subscribe-webhook
 * Manually trigger Meta Page Webhook subscription via Graph API
 */
router.post('/subscribe-webhook', async (_req: Request, res: Response) => {
  try {
    const subResult = await graphApiClient.subscribePageToWebhook();
    return res.json(subResult);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to subscribe page to webhooks',
    });
  }
});

/**
 * GET /api/settings/diagnostics
 * Test every Meta endpoint live and report exact statuses.
 */
router.get('/diagnostics', async (_req: Request, res: Response) => {
  try {
    const page = await graphApiClient.getPageDetails();
    const convs = await graphApiClient.fetchConversationsList(5, page.id);
    return res.json({
      success: true,
      page,
      conversationsFound: convs.length,
      sampleConversation: convs[0] || null,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Diagnostic failed',
      stack: err.stack,
    });
  }
});

export default router;
