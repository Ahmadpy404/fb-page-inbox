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

      // Auto-bootstrap Facebook pages from environment variables
      try {
        const { autoBootstrapPages } = await import('./services/bootstrap');
        await autoBootstrapPages();
      } catch (err: any) {
        console.warn('[Startup] Page auto-bootstrap error:', err.message || err);
      }

      // Start 24/7 Keep-Alive heartbeat service
      try {
        const { startKeepAliveService } = await import('./services/keepAlive');
        startKeepAliveService(port);
      } catch {}
    });
  } catch (err: any) {
    console.error('Fatal error during startup:', err.message || err);
    process.exit(1);
  }
}

startServer();

export default startServer;
