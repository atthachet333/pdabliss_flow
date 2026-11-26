import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadSecretFile, mergeEnv, SecretFileError } from './config/secret-file.js';
import { EnvError, isAuthConfigured, isWebhookConfigured, loadEnv, type AppEnv } from './env.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  let env: AppEnv;
  let secretFileUsed = false;
  try {
    // Real credentials come from the external secret file (never from the project folder).
    const secrets = loadSecretFile({ projectRoot: PROJECT_ROOT });
    secretFileUsed = secrets.file !== null;
    env = loadEnv(mergeEnv(secrets.values, process.env, secrets.dir));
  } catch (err) {
    if (err instanceof EnvError || err instanceof SecretFileError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = buildApp({ env });
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
