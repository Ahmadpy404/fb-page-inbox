const APP_ID = '1728111101837341';
const APP_SECRET = '22338e523454d418adcdccde09db890b';
const PAGE_ID = '752790171249695';

export async function exchangeForPermanentPageToken(userOrPageToken: string): Promise<{
  permanentPageToken: string;
  pageName: string;
  expiresIn: string;
}> {
  const cleanToken = userOrPageToken.trim();

  // Step 1: Exchange for Long-Lived User Token
  const exchangeUrl = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${encodeURIComponent(cleanToken)}`;
  const exchangeRes = await fetch(exchangeUrl);
  const exchangeData = (await exchangeRes.json()) as any;

  if (exchangeData.error) {
    throw new Error(`Exchange Error: ${exchangeData.error.message}`);
  }

  const longLivedUserToken = exchangeData.access_token;

  // Step 2: Fetch Permanent Page Access Token
  const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?access_token=${encodeURIComponent(longLivedUserToken)}`;
  const accountsRes = await fetch(accountsUrl);
  const accountsData = (await accountsRes.json()) as any;

  if (accountsData.error || !Array.isArray(accountsData.data)) {
    // Fallback directly to page endpoint
    const pageUrl = `https://graph.facebook.com/v19.0/${PAGE_ID}?fields=access_token,name&access_token=${encodeURIComponent(longLivedUserToken)}`;
    const pageRes = await fetch(pageUrl);
    const pageData = (await pageRes.json()) as any;

    if (pageData.error || !pageData.access_token) {
      throw new Error(`Page Token Fetch Error: ${pageData?.error?.message || 'Could not fetch page token'}`);
    }

    return {
      permanentPageToken: pageData.access_token,
      pageName: pageData.name || 'Page',
      expiresIn: 'Never (Permanent)',
    };
  }

  const targetPage = accountsData.data.find((p: any) => p.id === PAGE_ID) || accountsData.data[0];
  if (!targetPage || !targetPage.access_token) {
    throw new Error('Could not find Page Access Token in accounts list');
  }

  return {
    permanentPageToken: targetPage.access_token,
    pageName: targetPage.name,
    expiresIn: 'Never (Permanent)',
  };
}
