import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createHarness, seedGroup, seedUser, seedWorkspace, tokenFor } from './support/harness.js';

it('untrusted single-line LINE, workspace and destination names strip all C0 controls and DEL', async (t) => {
  const h = await createHarness();
  t.after(() => h.close());
  const user = await seedUser(h.store, 1, { globalRole: 'OWNER' });
  const workspace = await seedWorkspace(h.store, 'ครอบครัว', 'FAMILY', [
    { userId: user.id, role: 'ADMIN' },
  ]);
  const group = await seedGroup(h.store, 1, workspace.id);
  const controls =
    Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join('') +
    String.fromCharCode(127);
  const dirty = `  ไทย${controls}🌸  `;
  const expected = 'ไทย🌸';
  const client = h.client();
  assert.equal((await client.login(tokenFor(user.line, dirty))).statusCode, 200);
  assert.equal((await h.store.getUser(user.id))?.displayName, expected);

  const workspaceUpdate = await client.patch(`/api/v1/workspaces/${workspace.id}`, {
    name: dirty,
    version: workspace.version,
  });
  assert.equal(workspaceUpdate.statusCode, 200);
  assert.equal((await h.store.getWorkspace(workspace.id))?.name, expected);

  const destinationUpdate = await client.patch(`/api/v1/admin/destinations/${group.id}`, {
    label: dirty,
  });
  assert.equal(destinationUpdate.statusCode, 200);
  assert.equal((await h.store.getDestination(group.id))?.label, expected);
});
