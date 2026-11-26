import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { hashToken } from '../src/domain/invitations.js';
import type { Store } from '../src/store/types.js';
import { createHarness, seedUser, seedWorkspace } from '../tests/support/harness.js';
import { openTestStore, testStore } from './support/db.js';

async function setup(t: TestContext, store: Store) {
  const app = await createHarness({ store });
  t.after(() => app.close());
  const owner = await seedUser(store, 1, { globalRole: 'OWNER' });
  const workspace = await seedWorkspace(store, 'บริษัทจำลอง 🌸', 'COMPANY', [
    { userId: owner.id, role: 'ADMIN' },
  ]);
  const admin = app.client();
  assert.equal((await admin.login(owner.token)).statusCode, 200);
  const invite = async () => {
    const response = await admin.post('/api/v1/admin/invitations', {
      workspaceId: workspace.id,
      role: 'MEMBER',
      expiresInHours: 1,
    });
    assert.equal(response.statusCode, 201);
    return (response.json().link as string).split('/invite/')[1]!;
  };
  return { app, admin, workspace, invite };
}

it('MariaDB invitation and approval races across two pools remain atomic over 12 rounds', async (t) => {
  const store = await testStore();
  const first = await setup(t, store);
  const secondStore = await openTestStore();
  t.after(() => secondStore.close());
  const second = await createHarness({ store: secondStore });
  t.after(() => second.close());
  const otherAdmin = second.client();
  const decisionOwner = await seedUser(store, 2, { globalRole: 'OWNER' });
  assert.equal((await otherAdmin.login(decisionOwner.token)).statusCode, 200);

  let issuedMemberships = 1;
  for (let round = 0; round < 12; round += 1) {
    const token = await first.invite();
    const contenders = [];
    for (let index = 0; index < (round < 6 ? 2 : 5); index += 1) {
      const user = await seedUser(store, 100 + round * 10 + index, { status: 'NEW' });
      const client = (index % 2 === 0 ? first.app : second).client();
      assert.equal((await client.login(user.token)).statusCode, 200);
      contenders.push({ user, client });
    }
    const responses = await Promise.all(
      contenders.map(({ client }) => client.post('/api/v1/invitations/redeem', { token })),
    );
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [
      200,
      ...contenders.slice(1).map(() => 410),
    ]);
    const winner = contenders[responses.findIndex((response) => response.statusCode === 200)]!;
    for (const [index, response] of responses.entries()) {
      const contender = contenders[index]!;
      assert.equal(await store.getMember(first.workspace.id, contender.user.id), null);
      if (contender !== winner) {
        assert.equal(response.json().error.code, 'INVITATION_USED');
        assert.equal(await store.getOpenAccessRequest(contender.user.id), null);
        assert.equal((await store.getUser(contender.user.id))?.status, 'NEW');
      }
    }
    const invitation = await store.getInvitationByTokenHash(hashToken(token));
    assert.equal(invitation?.status, 'REDEEMED');
    assert.equal(invitation?.redeemedByUserId, winner.user.id);
    const request = await store.getOpenAccessRequest(winner.user.id);
    assert.ok(request);
    assert.equal(request.invitationId, invitation?.id);
    assert.equal(request.targetRole, 'MEMBER');
    assert.equal((await winner.client.get('/api/v1/workspaces')).statusCode, 403);
    const replay = await winner.client.post('/api/v1/invitations/redeem', { token });
    assert.equal(replay.statusCode, 410);
    assert.equal(replay.json().error.code, 'INVITATION_USED');

    const base = `/api/v1/admin/access-requests/${request.id}`;
    const [approve, reject] = await Promise.all([
      first.admin.post(`${base}/approve`, {}),
      otherAdmin.post(`${base}/reject`, {}),
    ]);
    assert.deepEqual([approve.statusCode, reject.statusCode].sort(), [200, 409]);
    const approved = approve.statusCode === 200;
    assert.equal((approved ? reject : approve).json().error.code, 'REQUEST_ALREADY_DECIDED');
    assert.equal(
      (await store.getAccessRequest(request.id))?.status,
      approved ? 'APPROVED' : 'REJECTED',
    );
    assert.equal(await store.getOpenAccessRequest(winner.user.id), null);
    assert.equal((await store.getUser(winner.user.id))?.globalRole, 'USER');
    assert.equal(
      (await store.getMember(first.workspace.id, winner.user.id))?.role,
      approved ? 'MEMBER' : undefined,
    );
    if (approved) issuedMemberships += 1;
    assert.equal((await store.listMembers(first.workspace.id)).length, issuedMemberships);
    assert.equal((await store.listAccessRequests({ limit: 100 })).length, round + 1);
  }
});

it('MariaDB rolls back invitation, access request and user state if audit persistence fails', async (t) => {
  const store = await testStore();
  const { app, invite, workspace } = await setup(t, store);
  const user = await seedUser(store, 2, { status: 'NEW' });
  const token = await invite();
  const client = app.client();
  assert.equal((await client.login(user.token)).statusCode, 200);

  const transaction = store.transaction.bind(store);
  let auditAttempts = 0;
  store.transaction = (work) =>
    transaction(async (tx) => {
      tx.appendAudit = async () => {
        auditAttempts += 1;
        throw new Error('Injected synthetic audit write failure');
      };
      return work(tx);
    });
  try {
    const failed = await client.post('/api/v1/invitations/redeem', { token });
    assert.equal(auditAttempts, 1, 'permanent errors do not retry the transaction');
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.json().error.code, 'INTERNAL_ERROR');
  } finally {
    store.transaction = transaction;
  }
  assert.equal((await store.getInvitationByTokenHash(hashToken(token)))?.status, 'ACTIVE');
  assert.equal(await store.getOpenAccessRequest(user.id), null);
  assert.deepEqual(await store.listAccessRequests({ limit: 100 }), []);
  assert.equal((await store.getUser(user.id))?.status, 'NEW');
  assert.equal(await store.getMember(workspace.id, user.id), null);
  assert.equal((await client.post('/api/v1/invitations/redeem', { token })).statusCode, 200);
  assert.ok(await store.getOpenAccessRequest(user.id));
});
