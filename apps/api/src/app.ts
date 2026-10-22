import { existsSync } from 'node:fs';
import path from 'node:path';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { API_VERSION } from '@slc/shared';

import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { v1Router } from './routes/v1.js';

/**
 * Express application factory.
 *
 * Builds a fully-configured app without binding a port, so it can be imported
 * directly by tests (supertest) and by the bootstrap entrypoint alike.
 */
export function createApp(options: { webDistDir?: string | null } = {}): Express {
  const app = express();
  const webDistDir = options.webDistDir === undefined ? config.webDistDir : options.webDistDir;

  // Trust the proxy (Render/Cloudflare) so client IPs / protocol are correct.
  app.set('trust proxy', 1);

  // Secure HTTP headers.
  app.use(helmet());

  // CORS: restrict to the configured web origin(s).
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
    }),
  );

  // Body & cookie parsing with sane limits.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // Structured request logging (silent during tests).
  app.use(pinoHttp({ logger }));

  // Baseline rate limiting for the API surface.
  app.use(
    `/api/${API_VERSION}`,
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  // CSRF protection (double-submit) for authenticated, state-changing requests.
  app.use(`/api/${API_VERSION}`, csrfProtection);

  // Versioned API routes.
  app.use(`/api/${API_VERSION}`, v1Router);

  // The built web app, when this server also hosts it (one address on Render).
  if (webDistDir) mountWebApp(app, webDistDir);

  // 404 + centralized error handling (must be last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Serve the built web app (Vite output) from the API server: static files,
 * plus index.html for any other GET outside /api so client-side routes such as
 * /admin-access load directly.
 */
function mountWebApp(app: Express, dir: string): void {
  const root = path.resolve(dir);
  const indexHtml = path.join(root, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`WEB_DIST_DIR: ${root} has no index.html; build the web app first (npm run build)`);
  }
  // Hashed asset files never change, so browsers may keep them for a year.
  app.use(
    '/assets',
    express.static(path.join(root, 'assets'), { immutable: true, maxAge: '365d' }),
  );
  // A missing asset is a plain 404, never the page (which would confuse the browser).
  app.use('/assets', notFoundHandler);
  app.use(express.static(root, { index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
