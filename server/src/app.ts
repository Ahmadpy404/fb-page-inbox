import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import webhookRoutes from './routes/webhook';
import conversationsRoutes from './routes/conversations';
import rulesRoutes from './routes/rules';
import settingsRoutes from './routes/settings';
import pagesRoutes from './routes/pages';
import authRoutes from './routes/auth';
import { requireAuth } from './middleware/auth';

// Custom request interface with rawBody buffer
export interface AppRequest extends Request {
  rawBody?: Buffer;
}

export function createApp(): express.Application {
  const app = express();

  // Ensure uploads directory exists
  const uploadsDir = path.resolve(__dirname, '../../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Enable CORS
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256'],
    })
  );

  // Serve media uploads
  app.use('/uploads', express.static(uploadsDir));

  // Capture raw body buffer for webhook signature verification
  app.use(
    express.json({
      verify: (req: AppRequest, _res: any, buf: Buffer) => {
        req.rawBody = buf;
      },
    })
  );

  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount Public Webhooks & Auth routes
  app.use('/webhook', webhookRoutes);
  app.use('/api/auth', authRoutes);

  // Mount Protected API routers
  app.use('/api/conversations', requireAuth, conversationsRoutes);
  app.use('/api/rules', requireAuth, rulesRoutes);
  app.use('/api/settings', requireAuth, settingsRoutes);
  app.use('/api/pages', requireAuth, pagesRoutes);

  // Serve static client assets if built in production
  const clientDistPath = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDistPath));

  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path.startsWith('/uploads')) {
      return next();
    }
    const indexHtml = path.join(clientDistPath, 'index.html');
    res.sendFile(indexHtml, (err: any) => {
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
