import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  // /auth/check is a cheap cookie lookup the frontend may poll on reconnect —
  // never throttle it, or the UI gets stuck in a 429 loop on the loading screen.
  skip: (req) => req.path === '/auth/check',
});

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  validate: { trustProxy: false },
});

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self), camera=()');
  next();
}
