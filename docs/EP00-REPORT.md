# EP00 report: PDA BLISS FLOW foundation

Report date: 2026-11-26 (Asia/Bangkok) · Episode: **EP00 only** (EP01 not started)

## A. Executive summary

EP00 วางรากฐานของ PDA BLISS FLOW ครบทั้งตัวตนแบรนด์ ระบบออกแบบ และโครงสร้างวิศวกรรม
ทั้งหมดอยู่ในโฟลเดอร์ `D:\One Drive\OneDrive\Desktop\project\pdabliss_flow` เท่านั้น

**สิ่งที่ส่งมอบ**

- Monorepo แบบ npm workspaces ได้แก่ เว็บ LIFF (Vite + React), API (Fastify) ที่มี
  `/health`, worker (โครงร่าง ยังไม่ส่งข้อความ), แพ็กเกจ `shared` สำหรับตรรกะโดเมน
  และ `design-system` สำหรับ token และสไตล์
- **Sally (น้องแซลลี่) เป็นมาสคอตรถยนต์น่ารักตามภาพอ้างอิงที่เจ้าของอนุมัติ**
  - ใช้ภาพต้นฉบับเป็น canonical พร้อมไฟล์สำหรับเว็บ (portrait และอวตาร)
  - วาดอารมณ์ 6 แบบเป็นเวกเตอร์ตามภาพอ้างอิง
  - ใช้ Sally ในริชเมนู ในอวตารผู้ส่งของตัวอย่างแจ้งเตือน และในหน้า showcase
- ระบบสีผ่าน WCAG AA (มีเทสต์ตรวจ) ใช้ฟอนต์ IBM Plex Sans Thai และเลือกใช้
  CSS custom properties ตามที่เจ้าของอนุมัติ
- หน้า `/dev/design-showcase` สำหรับนักพัฒนา มีหัวข้อ A–K ครบ และถูกตัดออกจาก
  production build โดยอัตโนมัติ
- เอกสาร 11 ฉบับ รวมการตั้งค่า LINE ที่เจ้าของเตรียมไว้ (เฉพาะข้อมูลที่ไม่เป็นความลับ)

**ผลการตรวจสอบ**

- Quality gate บน Windows ผ่านครบ 17/17 ทั้งสองรอบ (ก่อนและหลังแก้ Sally)
- เทสต์อัตโนมัติผ่าน 79/79
- Visual QA บน Vite build จริงพร้อมฟอนต์ Plex ผ่านครบ 6 ความกว้าง
  และ flow การสร้างนัดหมายทำงานถูกต้องทั้งหมด

**สิ่งที่เจ้าของตรวจได้ทันที:** รัน `npm run dev` แล้วเปิด
<http://127.0.0.1:6767/dev/design-showcase> หรือดูภาพหน้าจอจริงใน
`.qa\screenshots-ep00-final\`

## B. Final verdict: **PASS**, conditional on the local commit (section K)

- All mandatory EP00 deliverables are implemented, including the owner corrections (car
  mascot, approved design-system decisions, LINE settings recorded).
- Applicable automated gates passed on the Windows workstation in two independent runs, the
  second after all changes.
- Real-build visual QA was performed at all six required widths with the intended font.
- No unresolved security or correctness findings.
- Mock and planned features are labelled.

The EP00 local commit is produced by `scripts\ep00-commit.ps1` with the owner's Git identity.
Section K records the hash. If K still shows the placeholder, the commit has not been made and
EP00 is not yet closed.

**Not tested, by design:** rendering inside the real LINE app. No LINE connection is
permitted in EP00.

## C. Verified local environment (from `.qa\g01-environment.log`)

| Item                         | Result                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Project path                 | `D:\One Drive\OneDrive\Desktop\project\pdabliss_flow`, verified. The folder was empty before EP00 and no nested duplicate was created |
| OS / shell                   | Windows NT 10.0.26300 · PowerShell 5.1.26100                                                                                          |
| Node.js / npm                | v24.19.0 (`D:\download s2a\node.exe`) / 11.17.0                                                                                       |
| Git                          | 2.55.0.windows.5                                                                                                                      |
| PostgreSQL                   | Service `postgresql-x64-18` **Running** (status only, not connected). `psql` is not on PATH. EP00 does not use a database             |
| Ports                        | 6767 **free**, 6768 **free**, 5432 in use by postgres (expected)                                                                      |
| Git status before the commit | Not a repository (initialised by `ep00-commit.ps1`)                                                                                   |

## D. Implementation summary

- **apps/web**: Vite 7.3.8 + React 19.3.1 + React Router 7.18.7. Routes are `/` (welcome,
  Sally portrait), `/dev/design-showcase` (dev and `--mode showcase` only) and not-found.
  Components: Button, CategoryBadge, When, Notice, ProtoBadge, Switch, SallyImage (expression,
  avatar and portrait variants), StateView, Skeleton, FlexBubble/ChatPreview,
  DestinationSelector, AppointmentPrototype, QuotaMeter, TodayPrototype.
- **apps/api**: Fastify 5.12.8 `buildApp()` factory, `loadEnv()` (zod 4.6.7), graceful
  shutdown. Endpoints: **`GET /health`** and CORS preflight only.
- **apps/worker**: typed contracts (JobRepository, DestinationGuard, QuotaReserver,
  DeliveryProvider, RetryPolicy) plus exponential backoff. The process prints its scaffold
  status and exits.
- **packages/shared**: time zones and Buddhist Era formatting, reminder planner, quota
  estimator, destination rules, zod draft schema, Flex presentation model (10 templates).
- **packages/design-system**: tokens (TS + CSS), component CSS, contrast utility.
- **assets**: Sally reference and derivatives, vector expressions, FLOW marks, rich menu
  (with Sally) plus spec using the real LIFF ID.
- **scripts**: `dev.mjs`, `ep00-verify.ps1`, `ep00-commit.ps1`, `generate-brand-assets.mjs`,
  `check-secrets.mjs`, `check-showcase-excluded.mjs`, `list-licenses.mjs`.

## E. Brand and design

- **FLOW identity:** ivory canvas, deep forest, emerald accent, and the **time-ring** motif
  (symbol, wordmark O, hero rings).
- **Sally (updated per owner correction):** an original anthropomorphic compact car in
  pastel blue. She has a windshield face with large emerald eyes, a silver clock crown with a
  mint halo, emerald headphones with a calendar-check mark, an emerald bow with a heart gem,
  heart headlights and a FLOW plate. Assets:
  - `assets/mascot/reference/sally-reference-owner.png` is the canonical image supplied by the
    owner.
  - `assets/mascot/web/` holds portrait 360/720 WebP, avatar 128/256 WebP and avatar 512 PNG.
  - `assets/mascot/sally-{default,happy,reminder,thoughtful,empty,error}.svg` keep one body
    and change face, clock hands, headlight glow and a status badge.
  - No third-party artwork or logos are used, and no licensing relationship is implied.
- **Palette:** brief tokens kept. Added `emerald700 #127261` for AA text. Muted Blue is
  decoration only.
- **Typography:** IBM Plex Sans Thai 5.3.0 (OFL), line-height 1.65, 13 px minimum, tabular
  numerals.
- **Rich menu:** 2500×1686, 6 areas. "เพิ่มนัดหมาย" is the forest hero cell, with the FLOW
  mark and Sally in it. The six URIs use LIFF `2012804685-QPWPdFGL`. Not uploaded.
- **Notifications:** 10 templates from one shared model. Minimal disclosure hides the title,
  location, description, category colour and alt-text details.
- **Live preview:** one preview per destination with no cross-group content, real reminder
  times and a quota estimate (mock values).

## F. Local preview

|                 | Value                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Start           | `npm run dev` from the project folder (dependencies already installed)                                 |
| Frontend        | <http://127.0.0.1:6767/>                                                                               |
| Design showcase | <http://127.0.0.1:6767/dev/design-showcase>                                                            |
| Backend health  | <http://127.0.0.1:6768/health> (also `/api/health` through the web proxy)                              |
| Running now?    | **No.** These are configured URLs. The smoke test started the built API, got HTTP 200, then stopped it |

## G. Visual QA (real build)

**Method:** `npm run build:showcase` (Vite 7.3.8, `--mode showcase`), built on Windows at
2026-11-26 10:57:41 +07:00 with self-hosted IBM Plex Sans Thai. Served statically and tested in
headless Chrome (Playwright 1.63).

| Width | Horizontal overflow | Overflow offenders | Visibly clipped text\* | Targets < 32 px | Broken images | Plex renders Thai | Unexpected console errors |
| ----- | ------------------- | ------------------ | ---------------------- | --------------- | ------------- | ----------------- | ------------------------- |
| 320   | 0 px                | none               | none                   | none            | none          | yes               | none                      |
| 375   | 0 px                | none               | none                   | none            | none          | yes               | none                      |
| 390   | 0 px                | none               | none                   | none            | none          | yes               | none                      |
| 430   | 0 px                | none               | none                   | none            | none          | yes               | none                      |
| 768   | 0 px                | none               | none                   | none            | none          | yes               | none                      |
| 1440  | 0 px                | none               | none                   | none            | none          | yes               | none                      |

\*The only elements flagged by the overflow test are screen-reader-only headings
(`.f-sr-only`), which are hidden by design (verified). Fonts loaded: IBM Plex Sans Thai
400/500/600/700. The only console message is a 404 for `/api/health`, which is expected
because no API ran during the static test. The showcase reports this honestly as offline.

**Interaction checks (real build):**

- Live preview updates as the title is typed (mouse and keyboard).
- Group selector: search narrows to 1 result. Viewer-only and pending groups are refused.
  Private plus family produces 2 separate preview tabs.
- Minimal disclosure: the group preview shows "นัดหมายสำคัญ" with the brand theme and "คุณมี
  นัดหมายสำคัญเวลา 09:00 น.", while the private preview keeps the real title.
- Reminder calculation: 08:00 and 08:30 on ศุกร์ 27 พ.ย. 2569, for a 09:00 appointment with
  1 h and 30 min reminders.
- Quota estimate: 10 messages (5 recipients × 2). Used 96, reserved 48, safety 30. "เหลือใช้ได้
  116 จาก 300".
- The review screen shows warnings for group visibility, minimal-disclosure advice, inability
  to revoke, and save ≠ send.
- Simulated confirmation states that nothing was saved or sent, and does **not** use the
  "happy" Sally.
- All 10 templates render. Sally's portrait, 6 expressions, avatar and rich menu images load.
- Reduced motion: transitions 0 s and shimmer off (default: 0.14 s and `f-shimmer`).
- Keyboard: the first 14 Tab stops all show the focus ring.
- Contrast: enforced by `packages/design-system/tests/tokens.test.ts` (AA or better for every
  text pair).

**Screenshots (actual browser output):** `.qa\screenshots-ep00-final\showcase-320.png`,
`showcase-375.png`, `showcase-390.png`, `showcase-430.png`, `showcase-768.png`,
`showcase-1440.png`, `create-review-390.png`. Raw results are in `qa-results.json` and
`interaction-results.json` in the same folder.

**Fixed during QA:** vector Sally expressions were clipped into circles, which hid their
badges. They now use rounded squares.

**Remaining minor (cosmetic, deferred to EP02):** at 390 px or narrower, the rich-menu
mapping table wraps the "พื้นที่" header mid-word. Nothing is clipped, and the table scrolls
within its container.

**NOT TESTED:** Flex rendering in the real LINE app and the rich menu on LINE devices
(EP01/EP05).

## H. Automated quality gates

Two complete Windows runs of `scripts\ep00-verify.ps1`:

- **Run 1** at 2026-11-26 10:30:18 +07:00, on the initial EP00 code.
- **Run 2** at 2026-11-26 10:57:08 +07:00, after the Sally update, CSS fix and docs.

Both runs produced 17/17 exit 0. The values below are from run 2's logs.

| Gate  | Command                                    | Exit      | Evidence                                                                                                                                                             |
| ----- | ------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G01   | environment discovery                      | 0         | See section C                                                                                                                                                        |
| G02   | `npm install --no-fund`                    | 0         | Run 1: added 241 packages, audited 247. Run 2: up to date                                                                                                            |
| G02   | `npm ls --depth=0`                         | 0         | Resolved: vite 7.3.8, react 19.3.1, fastify 5.12.8, zod 4.6.7, typescript 5.9.3, eslint 9.39.5, prettier 3.10.1, tsx 4.23.15, lucide-react 0.544.0                   |
| G02   | `npm audit --omit=dev` / `npm audit`       | 0 / 0     | **found 0 vulnerabilities** (both)                                                                                                                                   |
| G02   | `node scripts/list-licenses.mjs`           | 0         | 229 packages, all permissive (MIT 183, ISC 14, Apache-2.0 15, BSD-3 6, BSD-2 6, BlueOak 2, OFL-1.1 1, Python-2.0 1, CC-BY-4.0 1)                                     |
| G02   | `package-lock.json` present                | 0         | Present, committed                                                                                                                                                   |
| G03   | `npm run typecheck`                        | 0         | shared, design-system, api, worker, web: 0 errors                                                                                                                    |
| G04   | `npm run format` / `lint` / `format:check` | 0 / 0 / 0 | Run 2: Prettier changed **0** files. ESLint `--max-warnings=0` clean. "All matched files use Prettier code style!"                                                   |
| G05   | `npm run test`                             | 0         | **79/79**: shared 42/42 · design-system 14/14 · api 12/12 · worker 2/2 · web 9/9 (0 fail, 0 skipped)                                                                 |
| G06   | `npm run build`                            | 0         | Shared, API, worker and web built. "PASS: production bundle contains no design-showcase code or route."                                                              |
| G06   | `npm run build:showcase`                   | 0         | Local QA bundle `apps/web/dist-showcase` (never deployed)                                                                                                            |
| G06   | `node apps/worker/dist/index.js`           | 0         | `{"mode":"scaffold","schedulerEnabled":false,…}`                                                                                                                     |
| G08   | `npm run check:secrets`                    | 0         | Scanned 102 files: **no secrets detected**                                                                                                                           |
| SMOKE | `GET http://127.0.0.1:6768/health`         | 0         | HTTP 200 `{"status":"ok","service":"pdabliss-flow-api",…}` with nosniff, DENY, CSP, no-store and request id. `/nope` returns 404. The process was stopped afterwards |
| G07   | Real-build visual QA                       | —         | PASS (section G)                                                                                                                                                     |
| G09   | Repository review                          | —         | PASS (section K)                                                                                                                                                     |

Notes:

- npm 11 printed an `allow-scripts` notice for `esbuild@0.28.2` (postinstall not approved).
  The build is unaffected because the platform binary comes from esbuild's optional
  dependency. Optionally run `npm approve-scripts esbuild` later.
- npm also flagged `eslint@9.39.5` as no longer supported. An ESLint major upgrade is deferred,
  per the spec (no forced major upgrades).
- Between runs, typecheck, lint, format, tests and the secret scan were also pre-checked in
  Linux against the installed dependencies, with the same results.

## I. Security and privacy

**Implemented:**

- Env validation: loopback only outside production, no wildcard CORS, values never echoed.
- Log redaction, including appointment descriptions.
- Error envelope that hides internals. Security headers and a CORS allow-list.
- Minimal `/health`, and no notification endpoint (a test asserts this).
- Showcase compiled out of production (checked on every build).
- Secret scan.
- Destinations default to private. Viewer-only and inactive destinations are blocked in the UI.
  Minimal disclosure covers the alt text.
- Placeholders only in `.env.example`. LINE identifiers are recorded only as non-secret
  documentation.

**Planned (not implemented):** LINE ID-token verification and sessions, authorization and
visibility enforcement, webhook signature verification and dedupe, signed postbacks, rate
limiting, CSRF, atomic job claiming, quota reservation, destination revalidation, retention
and backups (SECURITY-AND-PRIVACY.md).

## J. Scope and infrastructure impact

| Question                            | Answer                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Production services accessed?       | **No**                                                                                    |
| Production systems changed?         | **No** (no PM2, Cloudflare, DNS, firewall, scheduled-task or database changes)            |
| Real LINE messages sent?            | **No**                                                                                    |
| Real LINE credentials used?         | **No.** No secrets were requested, received or stored. Only non-secret IDs are documented |
| LINE resources created or modified? | **No.** The owner's existing resources are recorded, not changed                          |
| External paid services activated?   | **No**                                                                                    |
| Other processes terminated?         | **No.** The smoke test stopped only the API process it started                            |

## K. Git information

| Item                      | Value                                                                       |
| ------------------------- | --------------------------------------------------------------------------- |
| Branch                    | `main` (created by `scripts\ep00-commit.ps1` if no repository exists)       |
| EP00 foundation commit    | `PENDING_EP00_COMMIT`                                                       |
| Follow-up commit          | Writes this hash into the report (made automatically by the same script)    |
| Author                    | The owner's configured Git identity (`git config user.name` / `user.email`) |
| Remote / push             | **None.** No remote is configured and nothing is pushed                     |
| Working tree after commit | Expected clean. The script records `git status` in `.qa\git.log`            |

**G09 repository review (before the commit):**

- 103 files will be committed.
- Ignored: `.qa/`, `node_modules/`, `apps/*/dist/`, `apps/web/dist-showcase/`,
  `packages/shared/dist/`.
- No `.env`, key, log, dump or build file is tracked.
- The largest tracked file is the owner's 2.0 MB reference PNG (intended).
- `.ps1` files use CRLF. Everything else is LF, enforced by `.gitattributes`.
- The secret scan passes, and is re-run by the commit script before committing.

## L. Decisions and limitations

**Approved by the owner (2026-11-26):**

- CSS custom properties instead of Tailwind.
- React Hook Form, TanStack Query and Framer Motion deferred.
- Sally as a car mascot following the supplied reference.

**Decisions made without explicit owner guidance:**

1. Sally's six expressions are vector redraws of the reference, because only one raster pose
   was supplied. Identity-critical spots (portrait, avatar, chat sender) use the actual
   reference image.
2. Avatar crop region `(190,20)–(1000,830)` of the reference, recognisable down to 32 px.
3. Sally sits in the rich-menu hero cell, and the six URIs use the owner's LIFF ID.
4. Node's built-in test runner (via tsx). All-day reminders anchor at 08:00. Maximum 5
   reminders. 400-character alt-text cap.
5. `emerald700` token added for accessible text. Node.js 22.12+ required.
6. Mock quota values: 300 limit, 96 used, 48 reserved, 30 safety reserve.

**Unverified assumptions:** the Thai free plan of 300 messages/month (secondary sources), the
member-ID API's eligibility, `X-Line-Retry-Key`, the Flex alt-text limit, and the reported Thai
Reply-API charging from Feb 2027 (single secondary source).

**Limitations and deferred:** LINE in-app rendering not tested. Rich-menu PNG export and
upload (EP05). Refinement of the vector expressions (EP05). Rich-menu table wrap at ≤ 390 px
(EP02). Everything in EP01–EP07.

**Compatibility:** Sally cannot join groups that already contain the HR LINE Bot (one OA per
group, verified). Options are in LINE-INTEGRATION-PLAN.md §3.

## M. EP01 preparation

LINE resources already exist (LINE-INTEGRATION-PLAN.md §4). Do not recreate them.

1. ★ Approve how EP01 exposes HTTPS for the webhook and LIFF (temporary tunnel, or staging on
   `flow.pdabliss.com`). The LIFF endpoint is currently set to `https://flow.pdabliss.com/`.
2. ★ Issue the channel access token when EP01 starts. Store it with the rotated channel
   secret in `%USERPROFILE%\.pdabliss\flow\dev.env`, outside OneDrive. Never share it in chat.
3. ★ Decide how to handle groups that contain the HR LINE Bot.
4. ★ Check the real monthly message quota in OA Manager.
5. EP01 build: webhook signature verification (raw body, HMAC-SHA256), LIFF init, server-side
   ID-token verification, sessions, private-access allow-list, tests first.

## N. Final confirmation

- **EP00 complete:** yes, once `scripts\ep00-commit.ps1` has recorded the commit in section K.
- **Production unchanged:** yes.
- **Ready for owner review:** yes.
- **EP01 can safely begin after owner approval:** yes.
- **EP01 has not been started.**
