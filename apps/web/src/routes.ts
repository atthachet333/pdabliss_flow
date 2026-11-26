/** Client routes. Kept identical to the gateway allow-list (apps/api/src/gateway.ts); a test compares them. */
/** LIFF endpoint, rich-menu deep links and EP02 pages (must match the gateway allow-list). */
export const APP_ROUTES = new Set([
  '/',
  '/today',
  '/calendar',
  '/appointments/new',
  '/groups',
  '/history',
  '/settings',
  '/search',
  '/privacy',
  '/terms',
  '/owner',
]);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const APP_ROUTE_PATTERNS: readonly RegExp[] = [
  new RegExp(`^/appointments/${UUID}(/edit)?$`),
  new RegExp(`^/groups/${UUID}$`),
  /^\/owner\/(requests|users|invitations|groups|audit)$/,
  new RegExp(`^/owner/users/${UUID}$`),
  /^\/settings\/(preferences|privacy)$/,
  /^\/invite\/[A-Za-z0-9_-]{43}$/,
];
export const isAppRoute = (p: string) =>
  APP_ROUTES.has(p) || APP_ROUTE_PATTERNS.some((re) => re.test(p));
