import http from 'http';
import { app } from './app';
import { getConfig } from './config';
import { initSocket } from './socket';

async function startServer() {
  try {
    // Validate configuration on startup
    const config = getConfig();

    const server = http.createServer(app);

    // Initialize Socket.io
    initSocket(server);

    const port = config.PORT || 3000;
    server.listen(port, async () => {
      console.log(`\n=================================================`);
      console.log(`🚀 FB Page Unified Inbox Backend running on port ${port}`);
      console.log(`📡 Webhook endpoint: http://localhost:${port}/webhook/facebook`);
      console.log(`🔌 Socket.IO initialized`);
      console.log(`=================================================\n`);

      // Attempt to subscribe Page to Webhook events via Meta Graph API
      try {
        const { graphApiClient } = await import('./services/graphApi');
        await graphApiClient.subscribePageToWebhook();
      } catch (err: any) {
        console.warn('[Startup] Could not auto-subscribe page to webhooks:', err.message || err);
      }
    });
  } catch (err: any) {
    console.error('Fatal error during startup:', err.message || err);
    process.exit(1);
  }
}

startServer();

export default startServer;
