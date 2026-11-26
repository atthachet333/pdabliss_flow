# PDA BLISS FLOW

**THE INTELLIGENCE OF EVERYDAY LIFE** · ทุกนัดหมาย ถูกเวลา ถูกคน ถูกกลุ่ม

Shared Calendar & LINE Personal Assistant, with **Sally (น้องแซลลี่)** as the mascot.
Designed & Engineered by PDA BLISS.

> **Status: EP01, LINE integration & authentication foundation.** LIFF login with server-side
> token verification, private access list, secure sessions and a signed (receive-only) LINE webhook.
> It still has no database, no appointment features and sends **no** LINE messages. The roadmap is in [docs/PRODUCT-ROADMAP.md](docs/PRODUCT-ROADMAP.md).

## Local development (Windows)

Project folder (local workstation, **not** production):
`D:\One Drive\OneDrive\Desktop\project\pdabliss_flow`

Requirements: Node.js **22.12+**, npm 10+, Git. PostgreSQL is not needed for EP00.

```powershell
cd "D:\One Drive\OneDrive\Desktop\project\pdabliss_flow"
npm install
npm run dev
```

| What                       | URL (configured)                                                         |
| -------------------------- | ------------------------------------------------------------------------ |
| Web app                    | <http://127.0.0.1:6767/>                                                 |
| Design showcase (dev only) | <http://127.0.0.1:6767/dev/design-showcase>                              |
| Auth states (dev only)     | <http://127.0.0.1:6767/dev/auth-states> (simulated identities)           |
| API health                 | <http://127.0.0.1:6768/health> (also via the web proxy at `/api/health`) |

Both servers bind to loopback only. If a port is already in use, the server **fails loudly**
and does not stop the other process. To pick another port, set `WEB_PORT` or `API_PORT`.

## Commands

| Command                           | Does                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Builds shared, then runs API (tsx watch) + web (Vite). The worker is not started                |
| `npm run build`                   | Builds shared, API, worker and web, then verifies that the showcase is excluded from production |
| `npm run build:showcase`          | Builds a local QA bundle that includes the showcase (`apps/web/dist-showcase`, never deployed)  |
| `npm run typecheck`               | `tsc --noEmit` in every workspace                                                               |
| `npm run lint`                    | ESLint (flat config) with zero warnings allowed                                                 |
| `npm run format` / `format:check` | Prettier                                                                                        |
| `npm run test`                    | Node test runner (via tsx) in every workspace                                                   |
| `npm run check:secrets`           | Scans committable files for likely secrets                                                      |
| `npm run brand:generate`          | Regenerates the SVG brand assets from `scripts/generate-brand-assets.mjs`                       |
| `scripts\ep00-verify.ps1`         | Runs every EP00 quality gate and writes logs to `.qa\`                                          |
| `scripts\ep00-commit.ps1`         | Makes a local commit after review (never pushes)                                                |
| `scripts\ep01-setup-secrets.ps1`  | Creates the external secret file (outside OneDrive, hidden input, user-only ACL)                |
| `scripts\ep01-verify.ps1`         | Runs the EP01 gates (install, typecheck, lint, tests, builds, secret scans, local smoke)        |
| `node scripts/ep01-smoke.mjs`     | G09 HTTP smoke harness (`--self-test`, `--phase A\|B`; loopback only, synthetic config)         |
| `scripts\ep01-integration.ps1`    | Owner-approved temporary Quick Tunnel test session (`-Start -IApprovePublicExposure` / `-Stop`) |
| `npm run access -- <cmd>`         | Local access list: `pending`, `list`, `approve <REF> --role owner\|tester`, `revoke`            |
| `npm run gateway`                 | Dev gateway on 127.0.0.1:6769 serving the built app + allow-listed API routes                   |

## Structure

```text
apps/
  web/        React + Vite LIFF app shell, dev-only design showcase
  api/        Fastify app factory, /health, env validation, redacted logging
  worker/     Notification worker scaffold (no scheduler in EP00)
packages/
  shared/         Domain contracts + pure logic (time zones, reminders, quota, destinations, Flex model)
  design-system/  Colour/typography tokens (TS + CSS) and component styles
assets/       Original brand art: FLOW mark, Sally, rich menu concept
docs/         Specification and plans (start with MASTER-SPECIFICATION.md)
scripts/      Dev runner, asset generator, verification and safety scripts
```

## Documentation

- [Master specification (authoritative)](docs/MASTER-SPECIFICATION.md)
- [Product roadmap](docs/PRODUCT-ROADMAP.md) · [EP00 report](docs/EP00-REPORT.md)
- [Design system](docs/DESIGN-SYSTEM.md) · [UX & information architecture](docs/UX-INFORMATION-ARCHITECTURE.md)
- [System architecture](docs/SYSTEM-ARCHITECTURE.md) · [Security & privacy](docs/SECURITY-AND-PRIVACY.md)
- [LINE integration plan](docs/LINE-INTEGRATION-PLAN.md) · [Notification engine plan](docs/NOTIFICATION-ENGINE-PLAN.md)
- [Deployment plan](docs/DEPLOYMENT-PLAN.md)
- [EP01 architecture & contracts](docs/EP01-ARCHITECTURE.md) · [EP01 owner checklist](docs/EP01-OWNER-CHECKLIST.md) · [EP01 report](docs/EP01-REPORT.md)

## OneDrive note

This folder is synced by OneDrive. `node_modules`, build output and `.qa` logs are git-ignored,
but **OneDrive still syncs them**. Never put real secrets or real appointment data here. From
EP01 onward, secrets load from outside this folder (see
[docs/SECURITY-AND-PRIVACY.md](docs/SECURITY-AND-PRIVACY.md#local-secret-loading)).
