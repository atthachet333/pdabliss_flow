/** Shared primitives for EP02 services: ids, clock, typed API errors. */
import { randomUUID } from 'node:crypto';

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
export const newId = (): string => randomUUID();

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Typed, safe error: the code and status are public, nothing else leaks. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message = 'Request could not be processed',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Resource not found');
export const forbidden = (code = 'FORBIDDEN') => new ApiError(403, code, 'Not permitted');
export const conflictError = (code = 'CONFLICT', message = 'The resource changed; reload and try again') =>
  new ApiError(409, code, message);
export const badRequest = (code = 'VALIDATION_ERROR', details?: Record<string, unknown>) =>
  new ApiError(400, code, 'Request validation failed', details);

export function assertUuid(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw notFound();
  return id;
}
