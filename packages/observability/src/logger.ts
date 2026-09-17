// Structured logging with redaction applied before the sink — security.md §12.
//
// Logs are telemetry: sampled, lossy, 90-day retention. They are NOT audit
// (U7). Nothing here is a substitute for an AuditEvent, and an audit record
// must never be reconstructed from logs.

import pino, { type Logger as PinoLogger } from 'pino';
import { redact } from './redaction.js';

export interface LogContext {
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly subjectId?: string;
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** A child logger carrying fixed context, typically the correlation ID. */
  child(context: LogContext): Logger;
}

export interface LoggerOptions {
  readonly serviceName: string;
  readonly environment: string;
  readonly level?: 'debug' | 'info' | 'warn' | 'error';
  /** Pretty output for local development only. */
  readonly pretty?: boolean;
}

const wrap = (base: PinoLogger): Logger => ({
  debug: (message, context) => base.debug(redact(context ?? {}) as object, message),
  info: (message, context) => base.info(redact(context ?? {}) as object, message),
  warn: (message, context) => base.warn(redact(context ?? {}) as object, message),
  error: (message, context) => base.error(redact(context ?? {}) as object, message),
  child: (context) => wrap(base.child(redact(context) as object)),
});

export const createLogger = (options: LoggerOptions): Logger => {
  const base = pino({
    name: options.serviceName,
    level: options.level ?? 'info',
    base: { service: options.serviceName, env: options.environment },
    // Belt and braces: the redactor above already removes these, but pino's
    // own paths catch anything that reaches the sink by another route.
    redact: {
      paths: [
        'authorization',
        'headers.authorization',
        'headers.cookie',
        'req.headers.authorization',
        'req.headers.cookie',
        '*.secret',
        '*.token',
        '*.password',
        '*.clientSecret',
        '*.apiKey',
      ],
      censor: '[redacted]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(options.pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });

  return wrap(base);
};

/** A logger that discards everything, for tests that assert on behaviour. */
export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => nullLogger,
};
