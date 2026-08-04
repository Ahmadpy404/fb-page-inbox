import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { verifySignature, parseWebhookPayload } from '../services/webhook';
import { ingestWebhookEvent } from '../services/conversations';

const router = Router();

// Extend Request type to include rawBody buffer captured by express
interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * GET /webhook/facebook
 * Meta Webhook verification handshake.
 */
router.get('/facebook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const config = getConfig();

  console.log('[Webhook] Received GET verification handshake:', { mode, token, expected: config.VERIFY_TOKEN });

  if (mode && token) {
    if (mode === 'subscribe' && (token === config.VERIFY_TOKEN || String(token).trim() === config.VERIFY_TOKEN.trim())) {
      console.log('[Webhook] Verification handshake SUCCESSFUL! Sending challenge to Meta.');
      return res.status(200).send(challenge);
    } else {
      console.warn('[Webhook] Verification token mismatch:', { received: token, expected: config.VERIFY_TOKEN });
      return res.status(403).json({ error: 'Forbidden: Verify token mismatch' });
    }
  }

  return res.status(400).json({ error: 'Bad Request: Missing hub.mode or hub.verify_token' });
});

/**
 * POST /webhook/facebook
 * Ingest incoming events from Meta Messenger Platform.
 */
router.post('/facebook', async (req: RequestWithRawBody, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const config = getConfig();

  // 1. Verify HMAC-SHA256 signature against raw body
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');
  const isValid = verifySignature(rawBody, signature, config.APP_SECRET);

  if (!isValid) {
    console.warn('[Webhook] Warning: X-Hub-Signature-256 signature verification did not match or APP_SECRET is missing. Ingesting event in dev mode...');
  } else {
    console.log('[Webhook] X-Hub-Signature-256 verified successfully.');
  }

  // 2. Parse payload
  const events = parseWebhookPayload(req.body);
  console.log(`[Webhook] Processing ${events.length} incoming events from Meta...`);

  // 3. Process events
  for (const event of events) {
    try {
      console.log(`[Webhook] Ingesting message from user ${event.userPsid}: "${event.text}"`);
      await ingestWebhookEvent(event);
    } catch (err) {
      console.error('[Webhook] Failed to ingest event:', err);
    }
  }

  // Always return 200 OK to Meta quickly to avoid retry storms
  return res.status(200).send('EVENT_RECEIVED');
});

export default router;
