/**
 * Structured error catalog for CoreAPI.
 * Provides typed error codes, factory, and Fastify setErrorHandler integration.
 */

// ─── Error Code Catalog ──────────────────────────────────────────────────────
export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_STATE: 'INVALID_STATE',
  VALIDATION: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export interface SCARlineError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────
export function makeError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): SCARlineError {
  return { code: ErrorCodes[code], message, ...(details ? { details } : {}) };
}

// ─── Fastify setErrorHandler ──────────────────────────────────────────────────
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export function globalErrorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply
): void {
  // Zod validation errors — 400
  if (error instanceof ZodError) {
    reply.status(400).send({
      error: makeError('VALIDATION', 'Request validation failed', {
        issues: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message
        }))
      })
    });
    return;
  }

  // Fastify built-in errors (statusCode present)
  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode) {
    const statusCode = fastifyError.statusCode;
    let code: ErrorCode = 'INTERNAL';
    if (statusCode === 400) code = 'BAD_REQUEST';
    else if (statusCode === 401) code = 'UNAUTHORIZED';
    else if (statusCode === 403) code = 'FORBIDDEN';
    else if (statusCode === 404) code = 'NOT_FOUND';
    else if (statusCode === 409) code = 'CONFLICT';
    else if (statusCode === 422) code = 'VALIDATION';
    reply.status(statusCode).send({ error: makeError(code, fastifyError.message) });
    return;
  }

  // JWT errors (message patterns)
  if (
    error.message.includes('Unauthorized') ||
    error.message.includes('invalid signature') ||
    error.message.includes('jwt expired')
  ) {
    reply.status(401).send({ error: makeError('UNAUTHORIZED', 'Authentication token is invalid or expired') });
    return;
  }

  // PostgreSQL errors (unique violation, foreign key, etc.)
  const pgError = error as Error & { code?: string };
  if (pgError.code === '23505') {
    reply.status(409).send({ error: makeError('CONFLICT', 'A record with this identifier already exists') });
    return;
  }
  if (pgError.code === '23503') {
    reply.status(400).send({ error: makeError('BAD_REQUEST', 'Referenced resource does not exist') });
    return;
  }

  // Unhandled — surface sanitized 500
  reply.log.error({ err: error }, 'Unhandled error in CoreAPI');
  reply.status(500).send({
    error: makeError('INTERNAL', 'An unexpected error occurred. Please try again.')
  });
}
