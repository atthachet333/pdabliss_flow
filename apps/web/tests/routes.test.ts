/**
 * The client route table (src/routes.ts) must match the gateway allow-list
 * (apps/api/src/gateway.ts): every deep link the gateway serves has a real page, and the
 * SPA never renders an application page for a path the gateway would refuse.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as gateway from '../../api/src/gateway.js';
import { APP_ROUTE_PATTERNS, APP_ROUTES, isAppRoute } from '../src/routes.js';

const UUID = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const CORPUS = [
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
  `/appointments/${UUID}`,
  `/appointments/${UUID}/edit`,
  `/groups/${UUID}`,
  `/owner/users/${UUID}`,
  '/owner/requests',
  '/owner/users',
  '/owner/invitations',
  '/owner/groups',
  '/owner/audit',
  '/settings/preferences',
  '/settings/privacy',
  `/invite/${'A'.repeat(43)}`,
  // must be refused by both
  '/appointments/x',
  `/appointments/${UUID}/delete`,
  '/groups/not-a-uuid',
  '/owner/secret',
  '/settings/x',
  '/invite/short',
  '/api/v1/me',
  '/dev/auth-states',
  '/admin',
  '/today/',
  '/TODAY',
];

describe('client routes = gateway allow-list', () => {
  it('the six rich-menu destinations are real routes', () => {
    for (const p of [
      '/today',
      '/appointments/new',
      '/calendar',
      '/groups',
      '/history',
      '/settings',
    ])
      assert.ok(isAppRoute(p), p);
  });

  it('same static routes and same patterns', () => {
    assert.deepEqual([...APP_ROUTES].sort(), [...gateway.APP_ROUTES].sort());
    assert.deepEqual(APP_ROUTE_PATTERNS.map(String), gateway.APP_ROUTE_PATTERNS.map(String));
  });

  it('agree on every path in the corpus', () => {
    for (const p of CORPUS) assert.equal(isAppRoute(p), gateway.isAppRoute(p), p);
  });
});
