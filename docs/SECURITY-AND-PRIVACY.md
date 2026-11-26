# Security & privacy

Model: **deny by default**. Every request is anonymous until a LINE identity is verified
server-side. Every data access is scoped by explicit membership.

## 1. Implemented in EP00 (verifiable in code and tests)

| Control                                                                                                                                 | Where                                            | Test                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------- |
| Environment validation, loopback-only binding outside production, no wildcard CORS, values never echoed                                 | `apps/api/src/env.ts`                            | `apps/api/tests/app.test.ts` |
| Structured logs with redaction (auth headers, cookies, LINE signature, tokens, secrets, **appointment descriptions**)                   | `apps/api/src/app.ts`                            | log-redaction test           |
| Consistent error envelope; 500s hide internal messages                                                                                  | `app.ts`                                         | error tests                  |
| Security headers (nosniff, frame DENY, CSP `default-src 'none'`, no-referrer, CORP, no-store) and request id                            | `app.ts`                                         | header test                  |
| CORS allow-list (exact origins), preflight refused for others                                                                           | `app.ts`                                         | CORS tests                   |
| `/health` exposes no host, environment or dependency details                                                                            | `app.ts`                                         | health test                  |
| No endpoint sends notifications                                                                                                         | `app.ts`                                         | route-scan test              |
| Dev showcase excluded from production bundle                                                                                            | `App.tsx`, `scripts/check-showcase-excluded.mjs` | runs inside `npm run build`  |
| Secret scan of committable files                                                                                                        | `scripts/check-secrets.mjs`                      | gate G08                     |
| Mock data only, generic and clearly labelled                                                                                            | `apps/web/src/fixtures/mock.ts`                  | review                       |
| UI: default destination is private. Viewer-only and inactive destinations cannot be chosen. Minimal disclosure also strips the alt text | `packages/shared`                                | shared and web tests         |

## 2. Planned (not implemented; do not treat as present)

**Authentication (EP01).** The LIFF app sends the **ID token** (or access token) and never the
profile. The server verifies it with LINE (`POST /oauth2/v2.1/verify` for ID tokens) and checks
`aud` = our channel, expiry and nonce. Sessions are short-lived, httpOnly, SameSite=Lax and
secure in production, with rotation and revocation on logout or membership change. User IDs are
**provider-scoped**: LINE Login and the Messaging API must sit under the same LINE Developers
provider.

**Authorization (EP03).** Workspace-scoped membership and per-appointment audience, with
destination authorization checked separately (on create **and** before each send). Admin
capabilities are separate from content visibility. Revocation takes effect immediately. Every
object lookup filters by membership (prevents cross-group IDOR), and IDs are random (UUIDv7 or
v4) to stop enumeration. Search, calendar counts and summaries use the same visibility filter.

**Webhooks (EP01).** Verify `x-line-signature` = Base64(HMAC-SHA256(channel secret, **raw
body**)), compare in constant time, reject if missing or mismatched. Deduplicate on
`webhookEventId`, accept redeliveries (`deliveryContext.isRedelivery`) idempotently, acknowledge
fast and process asynchronously. Postback data is a server-signed opaque token, never trusted
parameters.

**Scheduling (EP04).** Atomic claiming, idempotency keys, cancellation and revision checks,
quota reservation, destination revalidation (see NOTIFICATION-ENGINE-PLAN.md).

**Application.** Rate limiting per IP and per user (EP01), CSRF protection for cookie sessions,
input validation with shared zod schemas, safe URL handling (allow-listed LIFF and deep-link
targets only).

**Data protection.** Minimal personal data: LINE userId, display name, memberships. No phone
numbers or email. Retention: delivery attempts 180 days and audit events 1 year, both to be
confirmed by the owner. Backups are encrypted, kept off the OneDrive folder and restore-tested
(EP07).

## 3. Privacy rules (product)

- Family ↛ employees, company ↛ unauthorized family, personal stays private.
- A LINE group message is visible to **all current members** and **cannot be recalled**. The UI
  says so before confirmation.
- To notify only part of a group, FLOW sends **individual private messages**. It never assumes a
  group message can be hidden from some members.
- **Minimal-disclosure mode** for health, family and personal categories in groups: "คุณมีนัดหมาย
  สำคัญเวลา 09:00 น.", with a neutral theme and alt text without details. Details only open in
  LIFF after authorization.
- Audit logs record actions and IDs, not descriptions.

## 4. Local secret loading

The project folder is synced by OneDrive, and `.gitignore` does **not** stop syncing. From EP01:

1. Keep real values in `%USERPROFILE%\.pdabliss\flow\dev.env`, outside OneDrive. Restrict its
   ACL to your Windows user.
2. The API loads `FLOW_ENV_FILE` (path) at startup when set. The project contains only
   `.env.example` with placeholders.
3. Production secrets live only on the production server (EP07). They are never copied to the
   workstation.

## 5. Threats considered in EP00 design

| Threat                              | Mitigation (status)                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Group member sees private details   | Separate audience vs. destination; minimal disclosure; private routing for subsets (design + prototype) |
| Forged webhook or postback          | Signature verification, signed postbacks (EP01)                                                         |
| Spoofed identity from LIFF          | Server-side token verification only (EP01)                                                              |
| Duplicate or late reminders         | Idempotency keys, expiry policy (EP04)                                                                  |
| Quota overspend by concurrent sends | Atomic reservation (EP04)                                                                               |
| Secrets leaking via OneDrive or Git | Placeholders only; secret scan (implemented)                                                            |
| Dev tools exposed in prod           | Showcase compiled out; loopback binding (implemented)                                                   |
