import { test, expect } from '@playwright/test';
import crypto from 'crypto';

const TEST_SECRET = process.env.APP_SECRET || 'dev_app_secret_12345';
const BACKEND_URL = 'http://localhost:3000';

function generateSignature(payload: any, secret: string = TEST_SECRET): string {
  const raw = JSON.stringify(payload);
  const hash = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return `sha256=${hash}`;
}

test.describe('FB Page Unified Inbox E2E Smoke Test', () => {
  test('full lifecycle: loads UI, ingests webhook in real-time, displays chat, sends manual reply, and manages rules', async ({
    page,
    request,
  }) => {
    // 1. Open the Unified Inbox Dashboard
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('FB Page Unified Inbox');
    await expect(page.locator('.navbar')).toBeVisible();

    // Verify WebSocket is connected (Live pill)
    await expect(page.locator('.status-pill').first()).toContainText('Live');

    // 2. Simulate an inbound webhook event from Facebook
    const uniqueUserPsid = `psid_e2e_${Date.now()}`;
    const inboundMessageText = `Hello! Interested in your services [${Date.now()}]`;

    const webhookPayload = {
      object: 'page',
      entry: [
        {
          id: 'PAGE_ID_E2E',
          time: Date.now(),
          messaging: [
            {
              sender: { id: uniqueUserPsid },
              recipient: { id: 'PAGE_ID_E2E' },
              timestamp: Date.now(),
              message: {
                mid: `mid.e2e.${Date.now()}`,
                text: inboundMessageText,
              },
            },
          ],
        },
      ],
    };

    const signature = generateSignature(webhookPayload, TEST_SECRET);

    // POST to webhook endpoint
    const webhookRes = await request.post(`${BACKEND_URL}/webhook/facebook`, {
      headers: {
        'x-hub-signature-256': signature,
        'content-type': 'application/json',
      },
      data: webhookPayload,
    });

    expect(webhookRes.status()).toBe(200);
    expect(await webhookRes.text()).toBe('EVENT_RECEIVED');

    // 3. Assert conversation appears in the inbox UI in real time via WebSocket
    const convItem = page.locator('.conversation-item').first();
    await expect(convItem).toBeVisible({ timeout: 10000 });
    await expect(convItem).toContainText(inboundMessageText);

    // 4. Click the conversation to open chat thread
    await convItem.click();

    // Verify message appears in Chat Thread
    const chatContainer = page.locator('#chat-messages-container');
    await expect(chatContainer).toContainText(inboundMessageText);

    // 5. Send a manual reply via the UI
    const manualReplyText = `Thanks for messaging us! How can we assist you today? [${Date.now()}]`;
    const replyInput = page.locator('#input-chat-reply');
    await replyInput.fill(manualReplyText);

    // Click Send
    await page.locator('#btn-send-reply').click();

    // Verify manual reply appears in the chat thread as outbound message
    await expect(chatContainer).toContainText(manualReplyText);

    // 6. Navigate to Auto-Reply Rules Tab
    await page.locator('#nav-tab-rules').click();
    await expect(page.locator('h2')).toContainText('Auto-Reply Keyword Rules');

    // Click New Rule
    await page.locator('#btn-add-rule').click();
    await expect(page.locator('.modal-card')).toBeVisible();

    // Fill rule form
    const keyword = `promo_${Date.now()}`;
    await page.locator('#input-rule-keyword').fill(keyword);
    await page.locator('#textarea-rule-reply').fill('Here is your 20% discount code: PROMO20');

    // Save Rule
    await page.locator('#btn-save-rule').click();
    await expect(page.locator('.rules-table')).toContainText(keyword);

    // 7. Navigate to Settings Tab
    await page.locator('#nav-tab-settings').click();
    await expect(page.locator('h2')).toContainText('Settings & Configuration');
    await expect(page.locator('#switch-global-auto-reply')).toBeChecked();
  });
});
