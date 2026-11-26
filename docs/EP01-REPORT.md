# EP01 report: LINE integration & authentication foundation

Report date: 2026-11-26 (Asia/Bangkok). Repository: public `atthachet333/pdabliss_flow`, branch
`main`, starting point `3c6af13` (EP00).

**Evidence labels used throughout:**

- **EXECUTED**: run by the owner on Windows or by Claude in the Linux VM, with log evidence.
- **OWNER-CONFIRMED**: reported by the owner from the real LINE test. Not independently
  reproducible.
- **SIMULATED**: automated tests or smoke runs with synthetic identities. No LINE calls.
- **NOT RUN**: not executed yet.

Status words: PASS, FAIL, PARTIAL, NOT RUN, BLOCKED.

## A. Final verdict: **PASS** (EP01 acceptance) · Git closure by `scripts\ep01-commit.ps1`

| Mandatory requirement                                                          | Status                                                                                                 | Evidence                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Offline implementation incl. closure fixes F01–F07                             | PASS                                                                                                   | Section H                                    |
| Windows final gate run after the fixes (`-Final`, 2026-11-26 15:40:19)         | **PASS**: 16 PASS, 1 SKIPPED (npm install reused by design), 0 FAIL                                    | Section C                                    |
| Automated tests (Windows G05)                                                  | **PASS 183/183**                                                                                       | Section C                                    |
| G09 cross-platform smoke (Windows)                                             | **PASS**: self-test 9/9, phase A 19/19, phase B 20/20                                                  | Section C                                    |
| Secret scan, Git history scan, real secret values vs. builds                   | **PASS** (3 real values checked against 226 files)                                                     | Section C                                    |
| Real LINE integration, first session (15:00–15:17)                             | **PASS**                                                                                               | Section E (EXECUTED log + OWNER-CONFIRMED)   |
| Real LINE retest after the fixes (5 scenarios)                                 | **PASS**                                                                                               | Section E (OWNER-CONFIRMED)                  |
| Backend session lifecycle (revocation, no reuse, new session, membership kept) | **PASS**                                                                                               | Section F (SIMULATED tests + EXECUTED log)   |
| Actual Vite-build visual QA at 6 widths                                        | **PASS**                                                                                               | Section L                                    |
| Public repository disclosure review                                            | **PASS**                                                                                               | Section M                                    |
| Temporary exposure shut down, safe settings restored                           | **PASS**                                                                                               | Section N (OWNER-CONFIRMED + EXECUTED check) |
| Commit + push to `origin/main`, sync, clean tree                               | Performed by `scripts\ep01-commit.ps1` on the owner's workstation (owner Git identity and credentials) | Section Q, `.qa\ep01\git.log`                |

## B. Scope delivered

| Area                      | Implementation                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Configuration and secrets | Strict env schema. External secret file `%USERPROFILE%\.pdabliss\flow\dev.env`, refused inside the project, OneDrive or other synced folders. User-only ACL. Fail closed |
| LIFF                      | `@line/liff` 2.32.0, lazily loaded. `liff.init` before any routing change. In-client auto login. External-browser login loop guard                                       |
| Identity                  | Server-side `POST /oauth2/v2.1/verify` plus a local re-check of iss/aud/exp/iat/sub. Client profile data never trusted                                                   |
| Sessions                  | HttpOnly `__Host-flow_session`, rotation on login, 2 h idle / 8 h absolute, revocation on logout or access removal, HMAC-keyed store (dev in-memory)                     |
| CSRF / Origin             | Per-session CSRF token (memory only in the SPA). Exact Origin allow-list, enforced before body parsing                                                                   |
| Rate limiting             | Login 10 per 5 min and session 120 per min per client. `429 RATE_LIMITED` + `Retry-After`. Thai countdown screen K                                                       |
| Access                    | Deny by default. 15-minute enrollment reference. Local-only owner and tester approval CLI. No HTTP admin surface                                                         |
| Webhook                   | Raw-body HMAC (constant time), destination check, dedupe, metadata only, no outbound calls                                                                               |
| Messaging API             | Read-only: bot info, quota, consumption. No send code exists                                                                                                             |
| Dev exposure              | Loopback gateway (allow-listed routes, CSP, client-address hardening). Owner-approved Quick Tunnel scripts with PID tracking                                             |
| UI                        | Thai screens A–K with Sally. Dev-only `/dev/auth-states`, compiled out of production                                                                                     |

Excluded, as required: calendar, appointments, DB, group authorization, reminders or any
message delivery, rich-menu install, deploy, production DNS/PM2/tunnel, the HR bot, paid
plans, EP02.

## C. Windows verification evidence (EXECUTED, owner workstation)

| Run                                                                                | Entries | Result                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full run 2026-11-26 11:50:45 (`summary.txt`)                                       | 17      | 16 PASS, **G09 FAIL** (14/15 probes). Node v24.19.0, npm 11.17.0, `@line/liff` 2.32.0, `npm audit` 0 vulnerabilities                                                                                                                                                                       |
| `-G09Only` 13:10:45 (`summary-g09.txt`)                                            | 8       | 7 PASS (shared+API build, API typecheck, ESLint, Prettier, API tests, secret scan). **G09 FAIL**: harness defect, 19/35                                                                                                                                                                    |
| `-SmokeOnly` 14:51:50 (`summary-smoke.txt`, `smoke-only-smoke.log`)                | 5       | **5/5 PASS**. Harness self-test 9/9, phase A 19/19, phase B 20/20, all with exit code 0                                                                                                                                                                                                    |
| `-Final` 15:40:19 after the closure fixes (`summary-final.txt`, `final-smoke.log`) | 17      | **16 PASS, 1 SKIPPED (npm install), 0 FAIL**. Typecheck, format, lint, tests 183/183, production + showcase builds, showcase exclusion, secret scan, history scan (3 commits), secret values (3 values / 226 files), audit 0 vulnerabilities, `@line/liff` 2.32.0, G09 9/9 + 19/19 + 20/20 |

**Exact automated test counts:**

| Workspace                | Windows G05 11:50 (pre-closure) | After closure fixes: VM and Windows G05 15:40 (identical counts)                                                                           |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api`               | 70/70                           | **86/86** (+5 G09 Origin/contract, +4 F05 proxy identity, +5 F07/session lifecycle, +2 gateway forwarding)                                 |
| `apps/web`               | 27/27                           | **39/39** (+12: Retry-After parsing, 429 states, single flight, retry discipline, approval recovery, logout semantics, client 429 mapping) |
| `packages/shared`        | 42/42                           | 42/42 (unchanged)                                                                                                                          |
| `packages/design-system` | 14/14                           | 14/14 (unchanged)                                                                                                                          |
| `apps/worker`            | 2/2                             | 2/2 (unchanged)                                                                                                                            |
| **Total**                | **155/155**                     | **183/183**                                                                                                                                |

## D. VM verification after the closure fixes (EXECUTED, Linux VM, existing install)

| Check                                                                   | Result                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| TypeScript (API, web incl. `@line/liff`, worker)                        | PASS                                                                                                    |
| ESLint (whole repo, 0 warnings)                                         | PASS                                                                                                    |
| Prettier (whole repo)                                                   | PASS                                                                                                    |
| Tests                                                                   | PASS 183/183 (table above)                                                                              |
| G09 harness against the real API + gateway (loopback, synthetic config) | PASS: self-test 9/9, phase A 19/19, phase B 20/20, 0 error-level API log lines                          |
| Secret scan (files)                                                     | PASS                                                                                                    |
| Access-launcher freshness logic (sandbox)                               | PASS: fresh → runs the built CLI; stale + session → refuses (exit 2); stale + no session → rebuild path |
| Production build (Vite)                                                 | Not possible in the VM (Windows-native rollup binaries only). **PASS on Windows in `-Final`**           |

## E. Real LINE integration (2026-11-26): first session 15:00–15:17 and retest after the fixes

**Setup (OWNER-CONFIRMED):**

- Credentials were stored outside OneDrive with `ep01-setup-secrets.ps1`: channel secret,
  long-lived access token, generated session secret.
- cloudflared was installed and a temporary Quick Tunnel started by
  `ep01-integration.ps1 -Start -IApprovePublicExposure`.
- The LIFF endpoint and webhook URL were set to the tunnel. **Webhook Verify: SUCCESS**.
  "Use webhook" was ON only during the test.

**API request log** (EXECUTED; the private log is kept outside Git in `.qa\ep01\run\api.log`;
counts only, no identities):

| Endpoint                       | Results                                               |
| ------------------------------ | ----------------------------------------------------- |
| `GET /api/health`              | 2 × 200                                               |
| `GET /api/auth/config`         | 33 × 200                                              |
| `GET /api/auth/session`        | 1 × 200 (session restored), 27 × 401 (no session yet) |
| `POST /api/auth/line`          | 11 × 403 not-approved, **11 × 429**, 4 × 200 approved |
| `POST /api/auth/logout`        | 2 × 200                                               |
| `GET /api/line/status` (owner) | 4 × 200                                               |
| `POST /api/line/webhook`       | 4 × 200 (1 verification request + 3 events)           |

**Retest after the closure fixes** (OWNER-CONFIRMED, 2026-11-26, about 15:40, tunnel and
LIFF endpoint only, webhook OFF):

| #   | Scenario                                            | Result |
| --- | --------------------------------------------------- | ------ |
| 1   | Owner signs in with **no** new enrollment reference | PASS   |
| 2   | Close and reopen FLOW: session restored             | PASS   |
| 3   | Logout                                              | PASS   |
| 4   | Sign in again with the existing Owner authorization | PASS   |
| 5   | Messaging API status and quota (read-only)          | PASS   |

**Owner-confirmed results (first session):**

- Real LINE authentication on desktop and on iPhone (LIFF). The same approved account worked
  on both.
- Pending screen → reference → local approval (`npm run access -- approve … --role owner`) →
  owner landing.
- Read-only status: OA **Sally | PDA BLISS (@138zyggc)**, monthly quota **300 messages**
  (read from the Messaging API, so no longer an assumption), consumption **0**, webhook events
  0 → 3, pending group registrations 0.
- **No outbound message was sent.**

## F. Test B and Test C: owner-confirmed vs. independently verified

| Property                                                                | Evidence                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Test B**: reopening the app needs no new login or approval            | OWNER-CONFIRMED. EXECUTED log: `GET /api/auth/session` → **200** without any `POST /api/auth/line` (cookie session restored). SIMULATED: test "session restoration" (same session and CSRF token after 30 min, no new cookie) |
| **Test C**: logout, then sign in again                                  | OWNER-CONFIRMED. EXECUTED log, twice: `POST /logout` 200 → `GET /session` **401** → `POST /line` 200 (new session)                                                                                                            |
| Logout revokes the server-side session; the old cookie cannot be reused | SIMULATED (F07 tests): the old cookie gets 401 on `/session` and `/line/status`. Replaying the old cookie and CSRF token resurrects nothing. _The real screenshots alone do not prove this, and it is not claimed from them._ |
| A new login creates a different session                                 | SIMULATED: new session ID and new CSRF token. The old ID stays invalid                                                                                                                                                        |
| Logout does not remove the approved membership                          | SIMULATED: the access list is unchanged and no new enrollment is created after logout and login. EXECUTED log: the re-logins were approved, not pending                                                                       |
| Pending users get nothing                                               | SIMULATED: no session, `/line/status` 401, no user IDs or display names in the pending response                                                                                                                               |
| Reference codes                                                         | SIMULATED: unknown → rejected. Expired (15 min) → rejected. The same pending user gets the same reference (no spam)                                                                                                           |

**Application logout vs. LINE logout:**

- FLOW logout ends only the FLOW server session. It never logs the user out of LINE and never
  changes their approval.
- Inside the LINE app the LINE identity stays, so "sign in again" is one exchange with no LINE
  Login.
- In external browsers FLOW also drops the LIFF token this site holds (shared-computer
  protection). The next sign-in passes through LINE Login, normally with single sign-on and no
  password.

## G. G09: root causes and permanent solution

1. **11:50 run, 415 instead of 403.** Windows PowerShell 5.1 sends
   `Content-Type: application/x-www-form-urlencoded` on a bodyless POST, and Fastify parsed it
   before the route's Origin check ran.
   - Fix: the Origin allow-list moved to `onRequest`, before body parsing. A cross-origin POST
     is always `403 ORIGIN_DENIED`.
   - Logout's body contract is now "none or `{}`". An allowed origin with an unsupported media
     type still gets `415`.
2. **13:10 run, empty error bodies.** PS 5.1 consumes non-2xx bodies that have a
   `Content-Length` (into `ErrorDetails`) before a catch block can read them. One probe also
   used the PS-default form request.
   - Permanent fix: `scripts/ep01-smoke.mjs`, a Node harness with no dependencies. It
     controls headers and bodies explicitly, reads every body and asserts status plus error
     code or state.
   - It includes a self-test with a negative control. PowerShell now only orchestrates.
   - The 35 original assertions are kept, plus 4 new ones. The PS 5.1 request is reproduced
     exactly as a regression probe.

## H. Findings F01–F09: disposition

| ID  | Finding                                              | Root cause (evidence)                                                                                                                                                                                                                                                                                                                                                                                                                          | Disposition                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | 429 shown as a generic service error                 | The client mapped `rate-limited` to `unavailable('server')`                                                                                                                                                                                                                                                                                                                                                                                    | **Fixed:** dedicated screen **K** for 429 on login _and_ on the session check                                                                                                                                                                                                                                     |
| F02 | No Retry-After countdown                             | The client ignored the header                                                                                                                                                                                                                                                                                                                                                                                                                  | **Fixed:** RFC 9110 parsing (seconds or HTTP-date). Clamped to 1–900 s. Missing or invalid → 60 s. Accessible countdown (`role="timer"` plus a polite announcement at the start and when ready)                                                                                                                   |
| F03 | Retries could repeat requests                        | The log shows 7 exchanges in about 5 s from repeated taps. Each tap ran config + session + exchange. 10 exchanges in about 2.5 min used up the window                                                                                                                                                                                                                                                                                          | **Fixed:** retry refused before Retry-After. 3 s cooldown in the controller _and_ on the buttons. No automatic retries. Server limits **unchanged**                                                                                                                                                               |
| F04 | Duplicate or concurrent exchanges                    | The log shows **no** concurrent exchanges: each was user-initiated and sequential. Doubled config fetches match the external-browser LINE Login redirect. Nothing prevented overlap, though                                                                                                                                                                                                                                                    | **Fixed (preventive):** single flight for start/retry/login/logout. Concurrent calls join one sequence (test: 1 config, 1 session, 1 exchange)                                                                                                                                                                    |
| F05 | Do all clients share a gateway bucket?               | **Through Cloudflare: no.** The gateway copies `CF-Connecting-IP` into `x-flow-client-ip`, the API trusts it only from loopback, and `trustProxy` is false. It cannot be shown from the log whether desktop and iPhone shared a public IP (IPs are not logged). Direct local browsing without Cloudflare shares the 127.0.0.1 bucket (dev only). Hardening gaps found: unvalidated header values, and client forwarding headers passed through | **Hardened:** both hops accept only a single valid IP literal, otherwise they use the peer. The gateway drops client `X-Forwarded-*`, `Forwarded`, `X-Real-IP`, `True-Client-IP` and `x-flow-client-ip`. Tests: distinct identities get distinct buckets; forged headers cannot escape; remote peers cannot spoof |
| F06 | The access CLI rebuilt workspaces during the session | `npm run access` always rebuilt `apps/api/dist`, the build the running API was loaded from                                                                                                                                                                                                                                                                                                                                                     | **Fixed:** `scripts/flow-access.mjs` runs the verified build when it is fresh. Stale + session recorded → refuses. Stale + idle → rebuilds once. Still local-only                                                                                                                                                 |
| F07 | Logout revocation                                    | Not provable from screenshots                                                                                                                                                                                                                                                                                                                                                                                                                  | **Verified (SIMULATED)** and documented (section F)                                                                                                                                                                                                                                                               |
| F08 | Emoji display names wrap awkwardly                   | Cosmetic                                                                                                                                                                                                                                                                                                                                                                                                                                       | **EP02 backlog.** Not changed                                                                                                                                                                                                                                                                                     |
| F09 | Mobile welcome card is too tall                      | Cosmetic                                                                                                                                                                                                                                                                                                                                                                                                                                       | **EP02 backlog.** Not changed                                                                                                                                                                                                                                                                                     |
| —   | EP00 rich-menu docs header wraps "พื้นที่" mid-word      | Cosmetic (EP00)                                                                                                                                                                                                                                                                                                                                                                                                                                | **EP02 backlog**                                                                                                                                                                                                                                                                                                  |

Small UI defects found and fixed during the closure visual pre-check (EP01 scope):

- `/dev/auth-states` squeezed into the showcase's 236 px sidebar column at ≥ 1100 px.
- The enrollment reference could break mid-code at 320 px. It now never wraps and is sized
  responsively.
- Auth titles now use balanced wrapping.

## I. Proxy and identity review summary

```text
LINE user ─► Cloudflare edge (sets CF-Connecting-IP) ─► cloudflared ─► gateway 127.0.0.1:6769
  gateway: drop client forwarding headers; x-flow-client-ip := valid CF-Connecting-IP | peer
  ─► API 127.0.0.1:6768: trust x-flow-client-ip only from loopback + valid IP literal | peer
  rate-limit key = login:<client> / session:<client>   (trustProxy=false)
```

**Remaining limitations (for the production security audit):**

- Any local process can choose `x-flow-client-ip` or `CF-Connecting-IP` (loopback trust).
- Clients behind one NAT share one per-IP budget.
- Limiter, sessions, dedupe and webhook metadata are in memory and reset on restart.
- Production (EP07) needs an authenticated hop or a fixed trusted-proxy list plus a
  persistent store.

## J. Security and privacy (unchanged controls, re-verified)

- CSRF and Origin protection are intact (G09 smoke + tests).
- Webhook signature, destination and dedupe are intact (smoke phase B).
- Content-type protections are intact (415 assertions).
- No rate limit was raised or disabled.
- No secrets in the repository or builds (G08). Secret values are re-checked against builds
  in `-Final`.
- Public documentation contains no enrollment references, LINE user IDs, display names,
  session tokens, tunnel URLs or screenshots of real accounts. Visual QA uses simulated
  identities only.

## K. Closure changes (files)

- **API:** `src/auth/routes.ts` (G09 ordering, earlier), `src/http/security.ts`,
  `src/gateway.ts`, `tests/auth.test.ts`, `tests/config-and-gateway.test.ts`.
- **Web:** `src/auth/{types,api-client,flow,AuthScreen}.ts(x)`,
  `src/showcase/AuthStatesShowcase.tsx`, `src/app.css`, `tests/auth-flow.test.ts`.
- **Tooling:**
  - `scripts/ep01-smoke.mjs` and `scripts/flow-access.mjs` (new);
  - `scripts/ep01-verify.ps1` (`-SmokeOnly`, `-Final`);
  - `scripts/ep01-commit.ps1` (requires a passing `-Final`);
  - `package.json` (`access`).
- **Docs:** this report, EP01-ARCHITECTURE, EP01-OWNER-CHECKLIST, LINE-INTEGRATION-PLAN,
  SECURITY-AND-PRIVACY, PRODUCT-ROADMAP, README.

## L. Visual QA (EXECUTED on the actual Windows Vite build, 2026-11-26)

**Method.** The `dist-showcase` and `dist` built by `-Final` (15:40) were served on loopback and
captured with headless Chrome (Playwright) at **320, 375, 390, 430, 768 and 1440 px**. Only
simulated identities were used.

- **`/dev/auth-states` (showcase build):** 14 variants × 6 widths = 84 captures. Covered:
  - A starting, B verifying, I retrying (loading);
  - C sign-in;
  - D owner and D tester (authenticated);
  - E pending approval;
  - F access denied;
  - G session expired;
  - H network and H LINE (service errors);
  - J logged out;
  - **K rate-limited**, counting down and ready.

  Captures were taken 3.5 s after load, so retry buttons are past the cooldown.

- **Production `dist`, real route `/`:** the API was answered with the fail-closed
  configuration. It renders screen H "FLOW ยังไม่เปิดให้เข้าสู่ระบบ" at every width.
- **Exclusion:** the auth-states marker is absent from `dist` and present only in
  `dist-showcase` (an independent check alongside `check-showcase-excluded`).

| Check (all 6 widths)                                                          | Result |
| ----------------------------------------------------------------------------- | ------ |
| Page horizontal overflow                                                      | None   |
| Content escaping its card                                                     | None   |
| Console or page errors                                                        | None   |
| K counting: countdown "ลองใหม่ได้ในอีก 4:32 นาที", retry button disabled          | PASS   |
| K ready: "ลองใหม่ได้แล้วค่ะ", retry button enabled                                | PASS   |
| E reference code stays on one line, including at 320 px                       | PASS   |
| Sally artwork and brand typography (IBM Plex Sans Thai) render in every state | PASS   |
| Production route renders fail-closed H with no errors                         | PASS   |

Contact sheets and machine-readable results are kept outside Git in `.qa\ep01\visual-qa\`.
Cosmetic notes left for the EP02 backlog: F08, F09, and the narrow-screen wrapping of long Thai
titles inside the 4-column showcase grid at 1440 px (showcase only).

## M. Public repository disclosure review

- History scan PASS. EP00 notes are unchanged: low-risk hardware list in
  MASTER-SPECIFICATION; malformed author e-mail on two EP00 commits. No rewrite.
- Full EP01 change set reviewed (tracked diff + new files, about 9.7k lines). The review
  checked for non-synthetic LINE IDs, tunnel URLs, non-documentation IPv4 addresses, personal
  e-mail addresses (only the attribution address appears), enrollment references (only
  fictional examples appear) and long tokens (only lockfile integrity hashes appear).
- The staged EP01 change set contains code, tests, scripts and docs only. `.qa/` (logs,
  real-session API log, screenshots) is git-ignored.
- Owner screenshots, raw webhook data, real IDs, secrets and session credentials are not in
  the repository.

## N. Temporary integration shutdown (OWNER-CONFIRMED 15:18, EXECUTED check)

- Use webhook **OFF**. Quick Tunnel, gateway and API **stopped**.
- LIFF endpoint restored to `https://flow.pdabliss.com/`.
- Credentials and owner authorization preserved.
- Check: no recorded session (`.qa\ep01\run\processes.json` absent). Run logs last written
  15:17.

## O. Decisions made without explicit owner guidance

1. Missing or invalid `Retry-After` → wait 60 s. Valid values are clamped to 1–900 s.
2. User retry cooldown: 3 s, in both the controller and the buttons.
3. Logout semantics as in section F (external browsers drop the LIFF token; the LINE app keeps
   the LINE identity).
4. The gateway strips client forwarding headers, and both hops require IP literals.
5. The access launcher refuses to rebuild while an integration session is recorded.
6. Rate-limit values unchanged (10 per 5 min login, 120 per min session).
7. Thai copy for screen K. It uses Sally's existing "reminder" expression; no new art.
8. The pending screen does not poll for approval. The user taps retry, to avoid background
   request storms.

## P. Closure

All acceptance steps are complete. The only remaining action is the Git closure, which
runs on the owner's workstation with the owner's Git identity and credentials:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-commit.ps1
```

The script:

- refuses unless `summary-final.txt` has no FAIL and a passing G09;
- re-runs the secret, history and secret-value scans and the Prettier check;
- blocks forbidden paths and commits;
- runs a normal `git push origin main` (never forced; refused if local is behind);
- verifies sync and a clean working tree, writing the result to `.qa\ep01\git.log`.

## Q. Git

| Item                 | Value                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base                 | `3c6af13` on `origin/main` (no history rewrite)                                                                                                           |
| EP01 commit and push | By `scripts\ep01-commit.ps1` (section P). The commit hash is recorded in `.qa\ep01\git.log`, not in tracked files (avoids the EP00 hash-formatting issue) |
| Force push           | Never                                                                                                                                                     |

## R. EP02 readiness (recorded only, nothing implemented)

**EP02 — Complete Application, Database & Privacy** (merges the original EP02 and EP03; owner
approval 2026-11-26):

- PostgreSQL + Prisma, with separate development, test and production databases.
- Calendar and appointment CRUD.
- User management, with mobile user approval and invitation links.
- Group membership and permissions.
- Private appointment visibility.
- Multi-stage reminder configuration: **same-day morning** and **relative** reminders on the
  same appointment. Example: an appointment at 10:00 gets a reminder at 06:00 (morning) and
  another at 09:00 (one hour before).
- Audit logs.
- EP01's in-memory sessions and file-based access list move to the database.

The EP02 cosmetic backlog is F08, F09 and the EP00 rich-menu docs header. EP02 has **not** been
started.
