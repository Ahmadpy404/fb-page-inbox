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

  // 1. Primary Page/User Access Token from .env
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

  console.log(`[Bootstrap] Found ${tokenList.length} candidate token input(s) to bootstrap.`);

  // Expand any User Tokens into their constituent Facebook Pages
  const expandedPages: Array<{ pageId: string; name: string; accessToken: string; pictureUrl?: string }> = [];

  for (let i = 0; i < tokenList.length; i++) {
    const item = tokenList[i];
    const rawToken = item.token;

    // Check if token is a User Token or has accessible accounts via /me/accounts
    try {
      const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,picture,tasks&access_token=${encodeURIComponent(rawToken)}`;
      const accountsRes = await fetch(accountsUrl);
      const accountsData = (await accountsRes.json()) as any;

      if (accountsData && Array.isArray(accountsData.data) && accountsData.data.length > 0) {
        console.log(`[Bootstrap] Token #${i + 1} is a User/System Token with ${accountsData.data.length} linked page(s):`);
        for (const acct of accountsData.data) {
          if (acct.id && (acct.access_token || rawToken)) {
            const pageToken = acct.access_token || rawToken;
            const pictureUrl = acct.picture?.data?.url;
            console.log(`  - Found Page: "${acct.name}" (ID: ${acct.id})`);
            expandedPages.push({
              pageId: String(acct.id),
              name: acct.name || 'Facebook Page',
              accessToken: pageToken,
              pictureUrl,
            });
          }
        }
        continue;
      }
    } catch (e: any) {
      console.warn(`[Bootstrap] /me/accounts check error for token index ${i}:`, e.message);
    }

    // Otherwise, treat as Direct Page Token (/me)
    try {
      let finalToken = rawToken;
      let pageName = item.name;
      let pageId = item.pageId;
      let pictureUrl: string | undefined;

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

      if (pageId) {
        expandedPages.push({
          pageId: String(pageId),
          name: pageName || 'Facebook Page',
          accessToken: finalToken,
          pictureUrl,
        });
      } else {
        console.warn(`[Bootstrap] Could not resolve Page ID for token index ${i}. Skipping.`);
      }
    } catch (err: any) {
      console.warn(`[Bootstrap] Error resolving token index ${i}:`, err.message || err);
    }
  }

  // Deduplicate and save all discovered pages to database
  const seenPageIds = new Set<string>();

  for (const p of expandedPages) {
    if (seenPageIds.has(p.pageId)) continue;
    seenPageIds.add(p.pageId);

    try {
      let finalToken = p.accessToken;
      let pageName = p.name;

      // Try permanent exchange
      try {
        const exchangeResult = await exchangeForPermanentPageToken(finalToken, p.pageId);
        if (exchangeResult && exchangeResult.permanentPageToken) {
          finalToken = exchangeResult.permanentPageToken;
          if (exchangeResult.pageName) pageName = exchangeResult.pageName;
        }
      } catch {}

      const page = await prisma.page.upsert({
        where: { pageId: p.pageId },
        update: {
          name: pageName,
          accessToken: finalToken,
          pictureUrl: p.pictureUrl || undefined,
          isActive: true,
        },
        create: {
          pageId: p.pageId,
          name: pageName,
          accessToken: finalToken,
          pictureUrl: p.pictureUrl,
          isActive: true,
        },
      });

      console.log(`[Bootstrap] ✓ Page "${page.name}" (${page.pageId}) successfully bootstrapped into Database.`);

      // Auto-subscribe to Meta Webhooks
      try {
        const subUrl = `https://graph.facebook.com/v19.0/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes,message_reactions,message_reads&access_token=${encodeURIComponent(finalToken)}`;
        const subRes = await fetch(subUrl, { method: 'POST' });
        const subData = (await subRes.json()) as any;
        console.log(`[Bootstrap] ✓ Page "${page.name}" Webhook Subscription status:`, subData);
      } catch (subErr: any) {
        console.warn(`[Bootstrap] Webhook subscription failed for page "${page.name}":`, subErr.message);
      }
    } catch (dbErr: any) {
      console.error(`[Bootstrap] Failed to upsert page ${p.pageId}:`, dbErr.message);
    }
  }

  console.log(`[Bootstrap] Auto-Bootstrap completed. Active pages configured: ${seenPageIds.size}\n`);
}
