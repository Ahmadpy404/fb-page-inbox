import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { bulkSenderService, StartBroadcastOptions } from '../services/bulkSender';

export const broadcastRouter = Router();

const uploadsDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max
  },
});

/**
 * GET /api/broadcast/status
 * Get the current broadcast job state and logs
 */
broadcastRouter.get('/status', (_req: Request, res: Response) => {
  const status = bulkSenderService.getStatus();
  return res.json(status);
});

/**
 * POST /api/broadcast/start
 * Start a bulk messaging campaign to leads/contacts
 */
broadcastRouter.post('/start', upload.single('media'), async (req: Request, res: Response) => {
  try {
    const { pageId, targetFilter, conversationIds, text, mediaUrl, delayMs } = req.body;

    let parsedConversationIds: string[] | undefined;
    if (conversationIds) {
      try {
        parsedConversationIds = typeof conversationIds === 'string' ? JSON.parse(conversationIds) : conversationIds;
      } catch {
        parsedConversationIds = undefined;
      }
    }

    const options: StartBroadcastOptions = {
      pageId: pageId || undefined,
      targetFilter: targetFilter || 'all',
      conversationIds: parsedConversationIds,
      text: text ? String(text).trim() : undefined,
      mediaUrl: mediaUrl ? String(mediaUrl).trim() : undefined,
      delayMs: delayMs ? parseInt(String(delayMs), 10) : 1000,
    };

    if (req.file) {
      options.mediaBuffer = req.file.buffer;
      options.mediaMimeType = req.file.mimetype;
      options.mediaFilename = req.file.originalname;
    }

    const state = await bulkSenderService.startBroadcast(options);
    return res.json({ success: true, broadcast: state });
  } catch (error: any) {
    console.error('[Broadcast API] Error starting broadcast:', error);
    return res.status(400).json({ error: error.message || 'Failed to start broadcast' });
  }
});

/**
 * POST /api/broadcast/cancel
 * Cancel an ongoing broadcast campaign
 */
broadcastRouter.post('/cancel', (_req: Request, res: Response) => {
  const success = bulkSenderService.cancel();
  return res.json({ success, message: success ? 'Broadcast cancellation requested' : 'No running broadcast' });
});
