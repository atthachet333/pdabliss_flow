/**
 * Prisma 7 configuration. Connection strings are NEVER read from files here: they are
 * injected by scripts/db.mjs (after the database-target guard) as FLOW_PRISMA_URL /
 * FLOW_PRISMA_SHADOW_URL for the one command being run. Without them every command that
 * needs a database fails closed (port 1 is never a database).
 */
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.FLOW_PRISMA_URL ?? 'mysql://unset@127.0.0.1:1/unset',
    ...(process.env.FLOW_PRISMA_SHADOW_URL ? { shadowDatabaseUrl: process.env.FLOW_PRISMA_SHADOW_URL } : {}),
  },
});
