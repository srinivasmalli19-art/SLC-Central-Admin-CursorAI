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
export function createApp(): Express {
  const app = express();

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

  // 404 + centralized error handling (must be last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
