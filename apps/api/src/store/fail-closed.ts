/**
 * Fail-closed query filters.
 *
 * Prisma treats a filter whose value is `undefined` as "no condition": `{ where: { userId: undefined } }`
 * matches EVERY row. For an authorization-sensitive query (visibility, session revocation,
 * deleteMany of child rows…) a missing identifier must never widen the result. PrismaStore
 * installs `assertFailClosedWhere` on every model operation, so any `where` that contains an
 * explicit `undefined` anywhere is rejected before it reaches MariaDB.
 *
 * Conditional filters must therefore be written as `...(x ? { field: x } : {})`, never
 * `{ field: x }` with a possibly-undefined `x`. (`null` is a real SQL condition and is allowed.)
 */
export class UnsafeQueryError extends Error {
  constructor(
    readonly model: string,
    readonly operation: string,
    readonly path: string,
  ) {
    super(`Refusing ${model}.${operation}: filter "${path}" is undefined (would match every row)`);
    this.name = 'UnsafeQueryError';
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Path of the first explicitly-undefined value inside a filter, or null when the filter is safe. */
export function findUndefinedFilter(where: unknown, path = 'where'): string | null {
  if (Array.isArray(where)) {
    for (const [i, v] of where.entries()) {
      if (v === undefined) return `${path}[${i}]`;
      const hit = findUndefinedFilter(v, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (!isPlainObject(where)) return null; // scalars, Date, Uint8Array, Decimal…
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) return `${path}.${k}`;
    const hit = findUndefinedFilter(v, `${path}.${k}`);
    if (hit) return hit;
  }
  return null;
}

export function assertFailClosedWhere(model: string, operation: string, args: unknown): void {
  if (!isPlainObject(args) || !('where' in args)) return;
  if (args.where === undefined) {
    // Only "all rows" operations may legitimately omit a filter, and then they omit the key.
    throw new UnsafeQueryError(model, operation, 'where');
  }
  const hit = findUndefinedFilter(args.where);
  if (hit) throw new UnsafeQueryError(model, operation, hit);
}
