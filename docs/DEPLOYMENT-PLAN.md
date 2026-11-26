# Deployment plan (EP07, requires separate authorization)

**EP00 changed nothing on any server.** This is a plan only.

## Target

| Item            | Value (proposed)                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Host            | Existing PDA BLISS Windows 11 Pro server (i7-10700, 64 GB)                                            |
| Domain          | `flow.pdabliss.com` via the existing Cloudflare Tunnel (new ingress rule only)                        |
| Processes (PM2) | `pdabliss-flow-frontend` (static/preview), `pdabliss-flow-backend` (API), `pdabliss-flow-worker`      |
| Database        | New isolated MariaDB database `pdabliss_flow` with dedicated least-privilege accounts (EP02 decision) |
| Ports           | Bound to 127.0.0.1 only. Chosen after discovering free ports on the server (6767/6768 proposed)       |

## Steps

1. **Discovery (read-only)**: list PM2 processes, listening ports, tunnel ingress, MariaDB
   roles and databases, disk space. Record everything in EP07 notes. Change nothing.
2. **Directory**: a dedicated folder outside OneDrive (for example `D:\apps\pdabliss_flow`),
   deployed from Git by tag.
3. **Database**: create the role and DB, run migrations, take a backup before and after.
4. **Secrets**: server-local env file with a restricted ACL. Never in Git, never on OneDrive.
5. **Build**: `npm ci && npm run build`. Verify that the showcase is excluded (automatic check).
6. **PM2**: start the three named processes with `NODE_ENV=production`. Do not touch existing
   processes. Use `pm2 save` only after verification.
7. **Cloudflare Tunnel**: add one ingress rule for `flow.pdabliss.com`, leave other rules
   unchanged, and verify HTTPS.
8. **LINE production config**: webhook URL, LIFF endpoint, rich menu (EP05 asset).
9. **Smoke tests**: `/health`, login, a private test reminder to the owner only, and a group
   reminder to a **test** group.
10. **Pilot**: owner first, then family, then the company group, with a quota watch.

## Rollback

Keep the previous release folder and DB backup. Rollback = stop the 3 FLOW PM2 processes, switch
the folder, `pm2 start`, and restore the DB only if migrations were not backward compatible. Remove
the tunnel rule to take FLOW offline without affecting other systems.

## Isolation guarantees

FLOW never shares a database, PM2 process, port or credentials with PDA ONE, CORE, Property, the
S2 site, Payroll or the HR LINE Bot.
