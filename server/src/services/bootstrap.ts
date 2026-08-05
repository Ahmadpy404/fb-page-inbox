import { getConfig } from '../config';
import { prisma } from '../db';
import { graphApiClient } from './graphApi';
import { exchangeForPermanentPageToken } from '../utils/tokenExchanger';

/**
 * Bootstrap all configured Facebook pages from environment variables on server startup.
 * Automatically exchanges short-lived tokens, retrieves metadata, upserts to DB,
 * and subscribes them to webhooks so they persist seamlessly across server restarts.
 */
export async function autoBootstrapPages(): Promise<void> {
  console.log('\n[Bootstrap] Initializing Auto-Bootstrap for Facebook Pages...');
  const config = getConfig();

  const tokenList: Array<{ token: string; name?: string; pageId?: string }> = [];

  // 1. Primary Page Access Token from .env
  if (config.PAGE_ACCESS_TOKEN && !config.PAGE_ACCESS_TOKEN.startsWith('dev_') && !config.PAGE_ACCESS_TOKEN.startsWith('test_')) {
    tokenList.push({ token: config.PAGE_ACCESS_TOKEN.trim() });
  }

  // 2. Extra numbered tokens: PAGE_ACCESS_TOKEN_2, _3, _4, _5
  const extraTokens = [
    config.PAGE_ACCESS_TOKEN_2,
    config.PAGE_ACCESS_TOKEN_3,
    config.PAGE_ACCESS_TOKEN_4,
    config.PAGE_ACCESS_TOKEN_5,
  ];

  for (const t of extraTokens) {
    if (t && t.trim().length > 10) {
      tokenList.push({ token: t.trim() });
    }
  }

  // 3. Additional tokens string (comma separated or JSON array)
  if (config.ADDITIONAL_PAGE_TOKENS && config.ADDITIONAL_PAGE_TOKENS.trim().length > 0) {
    const raw = config.ADDITIONAL_PAGE_TOKENS.trim();
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'string') {
              tokenList.push({ token: item.trim() });
            } else if (item && item.token) {
              tokenList.push({ token: item.token.trim(), name: item.name, pageId: item.pageId });
            }
          }
        }
      } catch (e: any) {
        console.warn('[Bootstrap] Could not parse ADDITIONAL_PAGE_TOKENS JSON:', e.message);
      }
    } else {
      const parts = raw.split(',');
      for (const p of parts) {
        if (p.trim().length > 10) {
          tokenList.push({ token: p.trim() });
        }
      }
    }
  }

  console.log(`[Bootstrap] Found ${tokenList.length} candidate page token(s) to bootstrap.`);

  for (let i = 0; i < tokenList.length; i++) {
    const item = tokenList[i];
    try {
      let finalToken = item.token;
      let pageName = item.name;
      let pageId = item.pageId;
      let pictureUrl: string | undefined;

      // Try permanent exchange
      try {
        const exchangeResult = await exchangeForPermanentPageToken(finalToken);
        finalToken = exchangeResult.permanentPageToken;
        if (!pageName) pageName = exchangeResult.pageName;
      } catch {}

      // Fetch page details from Graph API
      try {
        const detailsUrl = `https://graph.facebook.com/v19.0/me?fields=id,name,picture&access_token=${encodeURIComponent(finalToken)}`;
        const res = await fetch(detailsUrl);
        const details = (await res.json()) as any;
        if (details && details.id) {
          pageId = details.id;
          pageName = pageName || details.name;
          pictureUrl = details.picture?.data?.url;
        }
      } catch {}

      if (!pageId) {
        console.warn(`[Bootstrap] Could not determine Page ID for token index ${i}. Skipping.`);
        continue;
      }

      // Upsert into Database
      const page = await prisma.page.upsert({
        where: { pageId },
        update: {
          name: pageName || 'Facebook Page',
          accessToken: finalToken,
          pictureUrl: pictureUrl || undefined,
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

      console.log(`[Bootstrap] ✓ Page "${page.name}" (${page.pageId}) successfully bootstrapped into Database.`);

      // Auto-subscribe to webhooks
      try {
        const subUrl = `https://graph.facebook.com/v19.0/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes,message_reactions,message_reads&access_token=${encodeURIComponent(finalToken)}`;
        await fetch(subUrl, { method: 'POST' });
        console.log(`[Bootstrap] ✓ Page "${page.name}" subscribed to Webhooks.`);
      } catch {}
    } catch (err: any) {
      console.warn(`[Bootstrap] Error bootstrapping token index ${i}:`, err.message || err);
    }
  }

  console.log('[Bootstrap] Auto-Bootstrap completed.\n');
}
