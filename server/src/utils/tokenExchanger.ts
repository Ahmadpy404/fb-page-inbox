const DEFAULT_APP_ID = '1728111101837341';
const DEFAULT_APP_SECRET = 'bd9c2225839d1b8973c37337fcf564b3';

export async function exchangeForPermanentPageToken(
  userOrPageToken: string,
  targetPageId?: string
): Promise<{
  permanentPageToken: string;
  pageName: string;
  pageId: string;
  expiresIn: string;
}> {
  const cleanToken = userOrPageToken.trim();
  const appId = process.env.FB_APP_ID || process.env.APP_ID || DEFAULT_APP_ID;
  const appSecret = process.env.FB_APP_SECRET || process.env.APP_SECRET || DEFAULT_APP_SECRET;

  // Step 1: Exchange for Long-Lived User Token
  const exchangeUrl = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(cleanToken)}`;
  const exchangeRes = await fetch(exchangeUrl);
  const exchangeData = (await exchangeRes.json()) as any;

  if (exchangeData.error) {
    throw new Error(`Exchange Error: ${exchangeData.error.message}`);
  }

  const longLivedUserToken = exchangeData.access_token;

  // Step 2: Fetch Permanent Page Access Token from /me/accounts
  const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?access_token=${encodeURIComponent(longLivedUserToken)}`;
  const accountsRes = await fetch(accountsUrl);
  const accountsData = (await accountsRes.json()) as any;

  if (accountsData.error || !Array.isArray(accountsData.data) || accountsData.data.length === 0) {
    if (targetPageId) {
      // Fallback directly to page endpoint if targetPageId is known
      const pageUrl = `https://graph.facebook.com/v19.0/${targetPageId}?fields=access_token,name,id&access_token=${encodeURIComponent(longLivedUserToken)}`;
      const pageRes = await fetch(pageUrl);
      const pageData = (await pageRes.json()) as any;

      if (pageData.error || !pageData.access_token) {
        throw new Error(`Page Token Fetch Error: ${pageData?.error?.message || 'Could not fetch page token'}`);
      }

      return {
        permanentPageToken: pageData.access_token,
        pageName: pageData.name || 'Page',
        pageId: pageData.id || targetPageId,
        expiresIn: 'Never (Permanent)',
      };
    }

    throw new Error(accountsData?.error?.message || 'Could not find connected pages for this token');
  }

  const targetPage = targetPageId
    ? accountsData.data.find((p: any) => p.id === targetPageId) || accountsData.data[0]
    : accountsData.data[0];

  if (!targetPage || !targetPage.access_token) {
    throw new Error('Could not find Page Access Token in accounts list');
  }

  return {
    permanentPageToken: targetPage.access_token,
    pageName: targetPage.name,
    pageId: targetPage.id,
    expiresIn: 'Never (Permanent)',
  };
}
