import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadSecretFile, mergeEnv, SecretFileError } from './config/secret-file.js';
import { DbGuardError, describeTarget, parseDatabaseUrl } from './db/guard.js';
import { EnvError, isAuthConfigured, isWebhookConfigured, loadEnv, type AppEnv } from './env.js';
import { createPrismaClient, PrismaStore } from './store/prisma.js';
import type { Store } from './store/types.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  let env: AppEnv;
  let secretFileUsed = false;
  let store: Store | null = null;
  let databaseTarget = 'not configured (auth and application routes answer 503)';
  try {
    // Real credentials come from the external secret file (never from the project folder).
    const secrets = loadSecretFile({ projectRoot: PROJECT_ROOT });
    secretFileUsed = secrets.file !== null;
    const merged = mergeEnv(secrets.values, process.env, secrets.dir);
    env = loadEnv(merged);
    // EP02: the runtime database must be pdabliss_flow_dev on this computer (guarded);
    // a wrong or production target refuses to start instead of silently connecting.
    if (merged.DATABASE_URL) {
      // NODE_ENV=test + FLOW_DB_PURPOSE=test lets the smoke harness run the API on the TEST
      // database; every other combination is pinned to the development database.
      const purpose = merged.NODE_ENV === 'test' && merged.FLOW_DB_PURPOSE === 'test' ? 'test' : 'dev-runtime';
      store = new PrismaStore(createPrismaClient(merged.DATABASE_URL, purpose));
      databaseTarget = describeTarget(parseDatabaseUrl(merged.DATABASE_URL));
    }
  } catch (err) {
    if (err instanceof EnvError || err instanceof SecretFileError || err instanceof DbGuardError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = buildApp({ env, store });
  app.log.info(
    {
      secretFile: secretFileUsed ? 'loaded' : 'not found',
      auth: isAuthConfigured(env.integration)
        ? 'configured'
        : 'not configured (auth routes answer 503)',
      webhook: isWebhookConfigured(env.integration)
        ? 'configured'
        : 'not configured (webhook answers 503)',
      messagingRead: env.integration?.line.channelAccessToken ? 'configured' : 'not configured',
      database: databaseTarget,
      outboundMessaging: 'disabled (EP01)',
    },
    'FLOW API integration status',
  );

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'Shutting down');
    const timer = setTimeout(() => {
      app.log.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    try {
      await app.close();
      await store?.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: env.host, port: env.port });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      app.log.error(
        `Port ${env.port} is already in use. Not terminating the other process — set API_PORT to a free port.`,
      );
    } else {
      app.log.error({ err }, 'Failed to start');
    }
    process.exit(1);
  }
}

void main();
