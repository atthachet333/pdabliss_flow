import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect, createServer, type Socket } from 'node:net';
import { it } from 'node:test';
import { assertDatabaseTarget, DB_NAMES } from '../src/db/guard.js';
import { createPrismaClient, PrismaStore } from '../src/store/prisma.js';
import { createHarness, seedUser } from '../tests/support/harness.js';
import { testStore, testUrl } from './support/db.js';

it('an authenticated session fails closed and recovers after its own MariaDB connections are cut', async (t) => {
  const direct = await testStore();
  const user = await seedUser(direct, 1);
  const url = testUrl();
  const target = assertDatabaseTarget(url, 'test');

  // The relay handles only this test's pool. Existing MariaDB clients and the service stay up.
  let offline = false;
  const sockets = new Set<Socket>();
  const relay = createServer((incoming) => {
    if (offline) {
      incoming.destroy();
      return;
    }
    const host = target.host === 'localhost' ? '127.0.0.1' : target.host.replace(/^\[|\]$/g, '');
    const outgoing = connect(target.port, host);
    for (const [socket, peer] of [
      [incoming, outgoing],
      [outgoing, incoming],
    ] as const) {
      sockets.add(socket);
      socket.on('error', () => peer.destroy());
      socket.once('close', () => {
        sockets.delete(socket);
        peer.destroy();
      });
      socket.pipe(peer);
    }
  });
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve, reject) =>
      relay.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = relay.address();
  assert.ok(address && typeof address !== 'string');
  const relayUrl = new URL(url!);
  relayUrl.hostname = '127.0.0.1';
  relayUrl.port = String(address.port);
  const isolated = new PrismaStore(createPrismaClient(relayUrl.href, 'test'));
  t.after(() => isolated.close());
  await isolated.verifyConnection(DB_NAMES.test);
  const logs: string[] = [];
  const h = await createHarness({
    store: isolated,
    logStream: { write: (line) => logs.push(line) },
  });
  t.after(() => h.close());
  const client = h.client();
  assert.equal((await client.login(user.token)).statusCode, 200);
  assert.equal((await client.get('/api/v1/me')).statusCode, 200);

  offline = true;
  for (const socket of sockets) socket.destroy();
  const response = await client.get('/api/v1/me');
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'DATABASE_UNAVAILABLE');
  assert.deepEqual(Object.keys(response.json()), ['error']);
  assert.equal(response.headers['retry-after'], '30');
  assert.equal(response.headers['set-cookie'], undefined);
  const [entry] = logs.map((line) => JSON.parse(line));
  assert.equal(entry.msg, 'Database unavailable');
  assert.ok(!('err' in entry));
  t.diagnostic(`Sanitized runtime classification: ${entry.code}`);

  offline = false;
  assert.equal((await client.get('/api/v1/me')).statusCode, 200);
  assert.equal((await client.get('/api/auth/session')).json().state, 'approved');
});
