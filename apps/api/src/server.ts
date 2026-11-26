import { buildApp } from './app.js';
import { EnvError, loadEnv, type AppEnv } from './env.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  let env: AppEnv;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = buildApp({ env });

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
