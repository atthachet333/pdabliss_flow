/**
 * The 9-role permission matrix (docs/EP02-PERMISSION-MATRIX.md), exercised over HTTP so the
 * server — not the UI — is shown to be the boundary. Shared by the MemoryStore and MariaDB
 * suites. "allow" = 2xx; "deny" = 4xx (never 5xx, never data).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Store } from '../../src/store/types.js';
import { appointmentPayload, createHarness, idem, seedUser, seedWorkspace, type Client } from './harness.js';

export const ROLES = [
  'globalOwner',
  'globalAdmin',
  'workspaceAdmin',
  'member',
  'viewer',
  'outsider',
  'pending',
  'suspended',
  'revoked',
] as const;
type Role = (typeof ROLES)[number];

type Action =
  | 'view workspace appointment'
  | 'view a member’s private appointment'
  | 'create appointment in workspace'
  | 'edit workspace appointment'
  | 'manage workspace members'
  | 'open owner console (users)'
  | 'change a global role'
  | 'manage LINE destinations';

/** Expected outcome per action, in ROLES order. */
export const MATRIX: Record<Action, readonly (0 | 1)[]> = {
  //                                          own adm wsA mem vie out pen sus rev
  'view workspace appointment':              [0,  0,  1,  1,  1,  0,  0,  0,  0],
  'view a member’s private appointment':     [0,  0,  0,  0,  0,  0,  0,  0,  0],
  'create appointment in workspace':         [0,  0,  1,  1,  0,  0,  0,  0,  0],
  'edit workspace appointment':              [0,  0,  1,  0,  0,  0,  0,  0,  0],
  'manage workspace members':                [0,  0,  1,  0,  0,  0,  0,  0,  0],
  'open owner console (users)':              [1,  1,  0,  0,  0,  0,  0,  0,  0],
  'change a global role':                    [1,  0,  0,  0,  0,  0,  0,  0,  0],
  'manage LINE destinations':                [1,  0,  0,  0,  0,  0,  0,  0,  0],
};

export function definePermissionMatrix(label: string, makeStore: () => Promise<Store>): void {
  describe(`permission matrix — 9 roles (${label})`, () => {
    it('every role × action matches the documented matrix, enforced by the server', async () => {
      const h = await createHarness({ store: await makeStore() });
      const s = h.store;
      const users = {
        globalOwner: await seedUser(s, 1, { globalRole: 'OWNER' }),
        globalAdmin: await seedUser(s, 2, { globalRole: 'ADMIN' }),
        workspaceAdmin: await seedUser(s, 3),
        member: await seedUser(s, 4),
        viewer: await seedUser(s, 5),
        outsider: await seedUser(s, 6),
        pending: await seedUser(s, 7, { status: 'PENDING' }),
        suspended: await seedUser(s, 8),
        revoked: await seedUser(s, 9),
      };
      const author = await seedUser(s, 10);
      const family = await seedWorkspace(s, 'ครอบครัวทดสอบ', 'FAMILY', [
        { userId: users.workspaceAdmin.id, role: 'ADMIN' },
        { userId: users.member.id, role: 'MEMBER' },
        { userId: users.viewer.id, role: 'VIEWER' },
        { userId: author.id, role: 'MEMBER' },
        { userId: users.suspended.id, role: 'MEMBER' },
        { userId: users.revoked.id, role: 'MEMBER' },
      ]);
      await seedWorkspace(s, 'อื่น', 'COMPANY', [{ userId: users.outsider.id, role: 'ADMIN' }]);

      const ac = h.client();
      await ac.login(author.token);
      const mk = async (visibility: 'WORKSPACE' | 'PRIVATE') => {
        const r = await ac.post('/api/v1/appointments', appointmentPayload(family.id, { visibility }), idem());
        assert.equal(r.statusCode, 201);
        return r.json().appointment as { id: string; version: number };
      };
      const shared = await mk('WORKSPACE');
      const priv = await mk('PRIVATE');

      const clients = {} as Record<Role, Client>;
      for (const role of ROLES) {
        clients[role] = h.client();
        await clients[role].login(users[role].token);
      }
      // Suspend and revoke through the console after login: existing sessions must die too.
      const owner = clients.globalOwner;
      assert.equal((await owner.post(`/api/v1/admin/users/${users.suspended.id}/status`, { action: 'suspend' })).statusCode, 200);
      assert.equal((await owner.post(`/api/v1/admin/users/${users.revoked.id}/status`, { action: 'revoke' })).statusCode, 200);
      for (const role of ['suspended', 'revoked'] as const) await clients[role].login(users[role].token);

      let extra = 100;
      const run: Record<Action, (c: Client) => Promise<{ statusCode: number; body: string }>> = {
        'view workspace appointment': (c) => c.get(`/api/v1/appointments/${shared.id}`),
        'view a member’s private appointment': (c) => c.get(`/api/v1/appointments/${priv.id}`),
        'create appointment in workspace': (c) => c.post('/api/v1/appointments', appointmentPayload(family.id), idem()),
        'edit workspace appointment': async (c) => {
          const a = await mk('WORKSPACE');
          return c.put(`/api/v1/appointments/${a.id}`, { version: a.version, appointment: appointmentPayload(family.id, { visibility: 'WORKSPACE', title: 'แก้ไข' }) });
        },
        'manage workspace members': async (c) => {
          const target = await seedUser(s, (extra += 1));
          return c.post(`/api/v1/workspaces/${family.id}/members`, { userId: target.id, role: 'MEMBER' });
        },
        'open owner console (users)': (c) => c.get('/api/v1/admin/users'),
        'change a global role': async (c) => {
          const target = await seedUser(s, (extra += 1));
          return c.post(`/api/v1/admin/users/${target.id}/role`, { globalRole: 'ADMIN' });
        },
        'manage LINE destinations': (c) => c.get('/api/v1/admin/destinations'),
      };

      const failures: string[] = [];
      for (const [action, expected] of Object.entries(MATRIX) as [Action, readonly (0 | 1)[]][]) {
        for (const [i, role] of ROLES.entries()) {
          const r = await run[action](clients[role]);
          const allowed = r.statusCode >= 200 && r.statusCode < 300;
          if (r.statusCode >= 500) failures.push(`${action} / ${role}: ${r.statusCode}`);
          if (allowed !== (expected[i] === 1)) failures.push(`${action} / ${role}: got ${r.statusCode}, expected ${expected[i] ? 'allow' : 'deny'}`);
          if (!allowed && action.startsWith('view') && r.body.includes('appointment')) {
            if (/"title"/.test(r.body)) failures.push(`${action} / ${role}: denial leaked content`);
          }
        }
      }
      assert.deepEqual(failures, []);
      await h.close();
    });
  });
}
