import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import webhookRoutes from './routes/webhook';
import conversationsRoutes from './routes/conversations';
import rulesRoutes from './routes/rules';
import settingsRoutes from './routes/settings';

// Custom request interface with rawBody buffer
export interface AppRequest extends Request {
  rawBody?: Buffer;
}

export function createApp(): express.Application {
  const app = express();

  // Enable CORS
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256'],
    })
  );

  // Capture raw body buffer for webhook signature verification
  app.use(
    express.json({
      verify: (req: AppRequest, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount API & Webhook routers
  app.use('/webhook', webhookRoutes);
  app.use('/api/conversations', conversationsRoutes);
  app.use('/api/rules', rulesRoutes);
  app.use('/api/settings', settingsRoutes);

  // Serve static client assets if built in production
  const clientDistPath = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDistPath));

  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) {
      return next();
    }
    const indexHtml = path.join(clientDistPath, 'index.html');
    res.sendFile(indexHtml, (err) => {
      if (err) {
        next();
      }
    });
  });

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[App] Unhandled error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
    });
  });

  return app;
}

export const app = createApp();
export default app;
