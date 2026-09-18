import { pino } from 'pino';

import { config } from '../config/env.js';

/**
 * Centralized structured logger.
 *
 * Uses pretty transport in development for readability and plain JSON
 * elsewhere. Never log secrets; sensitive fields must be redacted by callers.
 */
export const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  transport: config.isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
  redact: {
    // Never log credentials, cookies, or tokens. `set-cookie` on responses
    // carries the session token and MUST be stripped.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.passwordHash',
    ],
    remove: true,
  },
});

export type Logger = typeof logger;
