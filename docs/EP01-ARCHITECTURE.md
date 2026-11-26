# EP01 — LINE integration & authentication (architecture and contracts)

Status: implemented and tested offline. Real LINE acceptance needs the owner steps in
[EP01-OWNER-CHECKLIST.md](EP01-OWNER-CHECKLIST.md). Evidence is in [EP01-REPORT.md](EP01-REPORT.md).

## 1. Architecture

```text
LINE app / external browser
  └─ LIFF (@line/liff ≥ 2.32) ── HTTPS ──► Cloudflare Quick Tunnel (owner-approved, temporary)
                                              └─► dev gateway 127.0.0.1:6769  (apps/api/src/gateway.ts)
                                                    ├─ built SPA (apps/web/dist) for app routes only
                                                    └─ 7 allow-listed /api routes ─► API 127.0.0.1:6768
LINE Platform ── signed webhook ──► same tunnel ──► gateway ──► POST /api/line/webhook
API ── read-only ──► api.line.me (ID-token verify, bot info, quota, consumption)
Secrets: %USERPROFILE%\.pdabliss\flow\dev.env  (outside the repo, outside OneDrive, user-only ACL)
```

Everything binds to loopback. The tunnel is the only public entry. It points at the
gateway, never at Vite or the API directly.

| Gateway exposes                                                                                                                                                      | Gateway refuses (404)                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/today`, `/calendar`, `/appointments/new`, `/groups`, `/history`, `/settings` (SPA), `/assets/*`, `/favicon.svg`                                               | `/dev/*`, `*.map`, dotfiles (`.env`), `/src`, `/node_modules`, `/@vite`, `/apps`, `/packages`, `/scripts`, `/docs`, any other path |
| `GET /api/health`, `GET /api/auth/config`, `POST /api/auth/line`, `GET /api/auth/session`, `POST /api/auth/logout`, `POST /api/line/webhook`, `GET /api/line/status` | every other `/api/*` route and method, `/health`                                                                                   |

HTML responses carry a CSP limited to `'self'` plus `*.line.me`, `*.line-scdn.net` and
`*.line-apps.com`, for the LIFF SDK's own calls.

## 2. Authentication contract

| Route                   | Request                                                                                         | Responses                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/config`  | —                                                                                               | `200 {authConfigured, liffId}`. `liffId` is `null` when not configured                                                                                                                                                                                                                                                                 |
| `POST /api/auth/line`   | `Origin` must be allowed. JSON body exactly `{ idToken }` (≤ 4096 chars). Any other field → 400 | `200 {state:'approved', user:{displayName, role}, session:{expiresAt}, csrfToken}` plus `Set-Cookie`. `403 {state:'not-approved', enrollmentRef}`. `403 {state:'revoked'}`. `401 ID_TOKEN_INVALID / ID_TOKEN_EXPIRED`. `403 ORIGIN_DENIED`. `429 RATE_LIMITED` (10 per 5 min per client). `503 LINE_UNAVAILABLE / AUTH_NOT_CONFIGURED` |
| `GET /api/auth/session` | cookie                                                                                          | `200` approved view (+ CSRF token). `401 {state:'unauthenticated'│'expired'│'revoked'}`                                                                                                                                                                                                                                                |
| `POST /api/auth/logout` | cookie, allowed `Origin`, header `x-flow-csrf`. Body: none or `{}`                              | `200 {state:'logged-out'}` (cookie cleared; also without a session). `403 CSRF_INVALID / ORIGIN_DENIED`. `400` if the body carries data. `415` unsupported media type                                                                                                                                                                  |
| `GET /api/line/status`  | owner session                                                                                   | `200 {bot, quota, consumption, webhook, outboundMessaging:'disabled'}`. `401`. `403`. `503 LINE_NOT_CONFIGURED`. `502 LINE_API_*`                                                                                                                                                                                                      |

**ID token verification:** `POST https://api.line.me/oauth2/v2.1/verify` with
`id_token` and `client_id` = LINE Login channel ID. LINE checks the signature, issuer,
audience and expiry. FLOW then re-checks `iss = https://access.line.me`, `aud`, `exp`, `iat`
(60 s skew) and `sub` = `U` + 32 hex. Identity comes only from `sub`. Display names are
shown but never used for authorization. The LINE user ID is never returned to the client.

## 3. Session security

- 32-byte random session ID, delivered only as a cookie. The server stores the
  HMAC-SHA256(SESSION_SECRET, id) key, never the raw ID.
- Cookie: `__Host-flow_session` (HTTPS) / `flow_session` (loopback HTTP), with `HttpOnly;
SameSite=Lax; Path=/`, `Secure` on HTTPS and no `Domain`. Nothing goes in localStorage or
  URLs.
- Rotation: every successful login issues a new ID and ends any session presented with the
  login request (fixation defence).
- Expiry: 2 h idle and 8 h absolute (configurable). Expired, revoked and logged-out IDs leave
  a 24 h tombstone, so the UI can say why.
- Revocation: the access list is re-checked on every session request. A revoked or removed
  user loses all sessions immediately.
- Origin first: for `POST /api/auth/line` and `/api/auth/logout` the Origin allow-list runs
  in Fastify `onRequest`, before body parsing. A cross-origin POST is always `403`, whatever
  its Content-Type (see EP01-REPORT §N.1).
- CSRF: a per-session random token, returned in JSON and kept in memory by the SPA. It is
  required as `x-flow-csrf` on logout. Exact `Origin` allow-list (`PUBLIC_BASE_URL` + dev
  origins) on all state-changing routes.
- **Store:** `MemorySessionStore` is development-only. Restarting the API logs everyone
  out. **EP03** replaces it with a PostgreSQL table behind the same `SessionStore`
  interface (hashed key, user, role, timestamps, revocation) and adds cleanup.

## 4. LINE webhook contract (`POST /api/line/webhook`)

1. JSON only (415 otherwise), ≤ 256 KiB (413). The raw bytes are kept for verification.
2. `x-line-signature` = Base64(HMAC-SHA256(Messaging API channel secret, raw body)),
   compared in constant time. Missing → `401 SIGNATURE_MISSING`. Wrong → `401
SIGNATURE_INVALID`. **No processing happens before this step.** There is no interactive
   auth wall in front of the webhook.
3. Shape `{destination: U…, events: [≤100]}` → else `400 INVALID_PAYLOAD`.
4. `destination` must equal Sally's bot user ID (`LINE_BOT_USER_ID`, or read once from
   `GET /v2/bot/info`) → else `403 UNEXPECTED_DESTINATION`. Unknown → `503` (fail closed).
5. Events are deduplicated by `webhookEventId` (24 h window). Redeliveries are accepted once.
6. Recorded metadata: type, source type, keyed hash of the source ID, redelivery flag. For
   messages only `message.type` is kept, never text. Postback data is never stored. Unknown
   event types are recorded as `unknown` without error.
7. `join` → the group is recorded as **pending-registration** only. Nothing is authorized,
   and registration is EP03. `leave` → `bot-removed`.
8. Answer `200 {ok, received, duplicates}`. **No reply, push or any other outbound call.**
   An empty `events` array (LINE's verification request) → `200`.

## 5. Secret configuration

| Key                                           | Kind               | Required for                                |
| --------------------------------------------- | ------------------ | ------------------------------------------- |
| `LINE_LOGIN_CHANNEL_ID`, `LINE_LIFF_ID`       | public identifiers | login                                       |
| `SESSION_SECRET` (≥ 32 chars, auto-generated) | secret             | login/sessions                              |
| `LINE_MESSAGING_CHANNEL_SECRET` (32 hex)      | secret             | webhook                                     |
| `LINE_CHANNEL_ACCESS_TOKEN` (long-lived)      | secret             | read-only status (optional)                 |
| `LINE_MESSAGING_CHANNEL_ID`                   | public identifier  | documentation and future use                |
| `FLOW_ALLOWED_LINE_USER_IDS`                  | private (user IDs) | extra testers (optional)                    |
| `PUBLIC_BASE_URL`                             | public             | set automatically by the integration script |

A LINE Login channel secret is **not** needed: verification uses LINE's verify endpoint
with the channel ID. Loading: `apps/api/src/config/secret-file.ts` refuses any location
inside the project, OneDrive (including the `OneDrive*` env paths), Dropbox, Google Drive
or iCloud. Missing values → features answer 503. Production refuses to start without full
auth configuration. Values are validated without echoing. Logs redact cookies,
authorization, `x-line-signature`, `x-flow-csrf`, tokens, secrets and descriptions.

## 6. Private access model

Deny by default. The sources are `access.json` in the secret directory (owner and testers,
with `revoked` status) and `FLOW_ALLOWED_LINE_USER_IDS` (testers only). Nobody becomes owner
by visiting first. Display names never grant access. No user IDs are written in source code.

| State                   | Meaning                                       | Screen                                |
| ----------------------- | --------------------------------------------- | ------------------------------------- |
| unauthenticated         | no or unknown session                         | C login required                      |
| not-approved            | verified LINE user, not on the list           | E pending (with enrollment reference) |
| approved owner / tester | on the list, active                           | D landing                             |
| expired                 | idle or absolute timeout                      | G                                     |
| revoked                 | `status: revoked`, or removed while signed in | F                                     |

**Owner bootstrap (local, proves identity):**

1. The owner opens FLOW in LINE. The token is verified, the user is unknown, and screen E
   shows a 15-minute reference like `K7QF-2M9X`.
2. The API stores reference → verified user ID in `pending-enrollments.json`, in the secret
   directory.
3. On the workstation the owner runs `npm run access -- approve K7QF-2M9X --role owner`.
   Only someone holding both that phone's LINE session and the workstation can do this.
4. The owner reopens FLOW and is approved. A second owner requires
   `--allow-additional-owner`.

**Tester enrollment:** the same flow with `--role tester`. The tester sends their reference
to the owner, and the owner approves locally. LINE Login stays "Developing", so testers must
also be added as testers of the LINE Login channel in LINE Developers.
`npm run access -- list | pending | revoke <id-suffix|label>`. Output shows masked IDs only.

EP03 keeps these role concepts: owner, administrator, member, viewer, pending, revoked.

## 7. Group compatibility (decision)

Verified: **only one LINE Official Account can be in a group chat**. Therefore:

- Existing HR groups keep the HR LINE Bot. Sally is never invited there, and the HR bot and
  its groups are not modified.
- Sally uses **separate** scheduling groups: family groups, optional executive scheduling
  groups, and a dedicated development test group created by the owner.
- A join only records `pending-registration`. Group registration, verification and
  visibility rules are EP03. No real group is activated in EP01.

## 8. LINE quota verification

The planning value of 300/month (Thai free plan, secondary sources) was **not** treated as
fact. **Verified 2026-11-26:** the real status panel read quota `limited`, 300 messages per
month, with 0 consumed (owner-confirmed).
The owner landing's "ตรวจสอบการเชื่อมต่อ LINE" button calls `GET /api/line/status`,
which reads the real values from `GET /v2/bot/message/quota` and
`/v2/bot/message/quota/consumption`. No paid plan or message purchase is ever triggered.

## 9. Security decisions

| Decision                                                                                                                                                                                                                                               | Reason                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| LINE verify endpoint instead of local JWT verification                                                                                                                                                                                                 | Official mechanism, no extra crypto dependency, no Login channel secret needed                                              |
| No backend "mock auth" mode                                                                                                                                                                                                                            | It cannot be enabled by accident. Visual QA uses the dev-only `/dev/auth-states` page with simulated identities instead     |
| Messaging adapter has no send method                                                                                                                                                                                                                   | Outbound delivery is EP04 and needs separate authorization                                                                  |
| Gateway allow-list, built SPA only                                                                                                                                                                                                                     | Keeps Vite tooling, dev pages, source and maps off the internet                                                             |
| Enrollment via local CLI, no admin HTTP endpoint                                                                                                                                                                                                       | No public administrative surface                                                                                            |
| Webhook: signature, then destination, then dedupe, with metadata only                                                                                                                                                                                  | Matches LINE guidance and data minimization                                                                                 |
| Rate limiting in memory, per client: the gateway sets `x-flow-client-ip` from a valid `CF-Connecting-IP` (else the peer) and drops client forwarding headers. The API trusts it only from loopback and only as an IP literal. `trustProxy` stays false | Adequate for a dev pilot. Production needs an authenticated hop or a fixed proxy list plus a persistent limiter (EP06/EP07) |

## 9a. Client request discipline (closure fixes F01–F04)

- **Single flight:** `start`, `retry`, `login` and `logout` never overlap. A second call joins
  the running one, so there is one config → session → exchange sequence.
- **HTTP 429** (login or session) → screen **K** (`rate-limited`, `retryAt`):
  - `Retry-After` is parsed per RFC 9110 (seconds or HTTP-date) and clamped to 1–900 s.
    Missing or invalid → 60 s.
  - There is a countdown (`role="timer"`) and one polite screen-reader announcement at the
    start and one when ready.
  - The button stays disabled until `retryAt`. Nothing retries automatically.
- **Retry cooldown:** retries are refused within 3 s of the previous attempt, in the
  controller and on the buttons.
- **Pending approval:** no polling. The user taps "ได้รับอนุมัติแล้ว ลองอีกครั้ง", which
  re-sends the still-valid ID token once.

## 9b. Session lifecycle contract

| Event                                      | Behaviour                                                                                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reopen within the idle and absolute limits | `GET /api/auth/session` → 200, with the same session and CSRF token. No LINE round-trip                                                                                           |
| Application logout                         | Server session ended (tombstone) and the cookie cleared. The old cookie gets 401 everywhere and cannot be revived. Approved membership unchanged. LINE itself is never logged out |
| Logout in the LINE app                     | The LINE identity stays. "เข้าสู่ระบบอีกครั้ง" exchanges the valid ID token for a **new** session (new ID, new CSRF token)                                                              |
| Logout in an external browser              | Also drops this site's LIFF token (shared-computer protection). The next sign-in goes through LINE Login (usually single sign-on)                                                 |
| Access revoked in `access.json`            | All of the user's sessions end on their next request                                                                                                                              |

## 9c. Local access CLI

`npm run access` → `scripts/flow-access.mjs`:

- If `apps/api/dist/cli/flow-access.js` is at least as new as all API and shared sources, it
  runs the built CLI directly (no rebuild).
- If the build is stale while an integration session is recorded, it refuses, so the running
  API's build is never rewritten.
- If the build is stale and nothing is running, it rebuilds once.

There is still no HTTP enrollment endpoint.

## 10. Known limitations

- Sessions, webhook metadata, dedupe state and pending groups are in memory and lost on
  restart (development only).
- The Quick Tunnel URL changes every run. The owner updates the LIFF endpoint and webhook URL
  each time.
- Per-IP rate limiting: clients behind one NAT share a budget. Local processes can choose the
  forwarded client address (loopback trust).
- No `X-Line-Retry-Key` use yet (no sending). The Flex alt-text limit is still unverified.
- Real LINE in-app rendering and cookies in the LIFF browser can only be confirmed in the
  owner-assisted test.

## 11. Boundaries

**EP02:** the real Today, Calendar and Create UI behind this authentication, and
replacement of the EP01 landing. **EP03:** PostgreSQL (sessions, access, workspaces,
destinations), group registration, visibility rules, roles beyond owner and tester.
**EP04:** notification engine and any outbound LINE message. **EP05:** rich menu
installation (owner-selected artwork), acknowledgements.
