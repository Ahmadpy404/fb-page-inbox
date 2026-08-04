import crypto from 'crypto';

export interface WebhookMessageAttachment {
  type: string;
  payload: {
    url?: string;
    sticker_id?: number;
    title?: string;
    [key: string]: any;
  };
}

export interface ParsedWebhookEvent {
  type: 'message' | 'message_echo' | 'unknown';
  pageId: string;
  userPsid: string;
  senderId: string;
  recipientId: string;
  timestamp: Date;
  fbMessageId?: string;
  text: string;
  isEcho: boolean;
  attachments?: WebhookMessageAttachment[];
  appId?: number;
  metadata?: string;
  rawEvent: any;
}

/**
 * Verify Meta's X-Hub-Signature-256 against raw request body using App Secret.
 * Uses crypto.timingSafeEqual to protect against timing attacks.
 */
export function verifySignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return false;
  }

  const signatureHash = parts[1];
  const bodyBuffer = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;

  try {
    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(bodyBuffer)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedHash, 'utf8');
    const signatureBuffer = Buffer.from(signatureHash, 'utf8');

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch (err) {
    console.error('[Webhook] Signature verification error:', err);
    return false;
  }
}

/**
 * Parses Meta's Messenger webhook payload array into structured events.
 * Supports: entry.messaging, entry.standby, entry.changes, postbacks, and echoes.
 */
export function parseWebhookPayload(payload: any): ParsedWebhookEvent[] {
  if (!payload || !Array.isArray(payload.entry)) {
    console.warn('[Webhook] Payload is not a standard page webhook structure:', JSON.stringify(payload));
    return [];
  }

  const parsedEvents: ParsedWebhookEvent[] = [];

  for (const entry of payload.entry) {
    const pageId = entry.id || '';

    // Collect all event arrays from entry
    const messagingList = [
      ...(Array.isArray(entry.messaging) ? entry.messaging : []),
      ...(Array.isArray(entry.standby) ? entry.standby : []),
    ];

    // Also check entry.changes for feed or message changes
    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (change.field === 'messages' && change.value) {
          messagingList.push(change.value);
        }
      }
    }

    for (const messagingEvent of messagingList) {
      const senderId = messagingEvent.sender?.id;
      const recipientId = messagingEvent.recipient?.id;
      const timestamp = messagingEvent.timestamp ? new Date(messagingEvent.timestamp) : new Date();

      // Handle standard message or echo
      if (messagingEvent.message) {
        const msg = messagingEvent.message;
        const isEcho = Boolean(msg.is_echo);
        const fbMessageId = msg.mid;
        const text = msg.text || (msg.attachments && msg.attachments.length > 0 ? `[${msg.attachments[0].type?.toUpperCase()}]` : '');
        const attachments = msg.attachments;
        const appId = msg.app_id;
        const metadata = msg.metadata;

        // If it's an echo, the sender is the page and recipient is the user
        // If inbound, the sender is the user and recipient is the page
        const userPsid = isEcho ? recipientId : senderId;

        if (userPsid) {
          parsedEvents.push({
            type: isEcho ? 'message_echo' : 'message',
            pageId,
            userPsid,
            senderId,
            recipientId,
            timestamp,
            fbMessageId,
            text,
            isEcho,
            attachments,
            appId,
            metadata,
            rawEvent: messagingEvent,
          });
        }
      }
      // Handle postback (button clicks / Get Started)
      else if (messagingEvent.postback) {
        const postback = messagingEvent.postback;
        const fbMessageId = postback.mid || `postback.${Date.now()}`;
        const text = postback.title || postback.payload || '[Button Clicked]';
        const userPsid = senderId;

        if (userPsid) {
          parsedEvents.push({
            type: 'message',
            pageId,
            userPsid,
            senderId,
            recipientId,
            timestamp,
            fbMessageId,
            text,
            isEcho: false,
            rawEvent: messagingEvent,
          });
        }
      }
    }
  }

  return parsedEvents;
}
