/**
 * 24/7 Keep-Alive Background Service
 * Keeps Render free containers awake by issuing periodic health check heartbeats.
 */
export function startKeepAliveService(port: number | string) {
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;

  // Run ping every 9 minutes (540,000 ms) - before Render's 15-min idle timeout
  const INTERVAL_MS = 9 * 60 * 1000;

  console.log(`[KeepAlive] 24/7 background keep-alive active.`);

  setInterval(async () => {
    const targetUrl = externalUrl
      ? `${externalUrl.replace(/\/$/, '')}/health`
      : `http://127.0.0.1:${port}/health`;

    try {
      const res = await fetch(targetUrl, {
        headers: { 'User-Agent': 'FBInbox-KeepAlive/1.0' },
      });
      if (res.ok) {
        console.log(`[KeepAlive] Heartbeat ping successful at ${new Date().toLocaleTimeString()}`);
      }
    } catch (err: any) {
      // Ignore network errors on local
    }
  }, INTERVAL_MS);
}
