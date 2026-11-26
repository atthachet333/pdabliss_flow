# EP01 — Owner checklist (real LINE integration test)

All steps happen on your own workstation and in your own LINE Developers account.
**Never paste secrets into chat, issues, screenshots or reports.** Your existing provider,
channels, Official Account and LIFF app are reused. Do not create new ones.

## 0. One-time gates (no public exposure)

```powershell
cd "D:\One Drive\OneDrive\Desktop\project\pdabliss_flow"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-verify.ps1
```

After a fix that touches only the API, re-run just the targeted gates (no reinstall, no web
builds):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-verify.ps1 -G09Only
```

If only the smoke harness changed, run just the smoke. It reuses the verified build, checks the
harness files and writes `.qa\ep01\summary-smoke.txt`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-verify.ps1 -SmokeOnly
```

## 1–4. Credentials, stored locally

1. Open <https://developers.line.biz/console/>, then provider **PDA BLISS**, then the
   **Messaging API** channel of _Sally | PDA BLISS_ (channel ID 2012804462).
2. **Channel secret:** _Basic settings_ tab → _Channel secret_. You rotated it earlier; use
   the current value.
3. **Access token (optional, for the read-only quota check):** _Messaging API_ tab →
   _Channel access token (long-lived)_ → **Issue**. Issuing a new long-lived token disables
   the previous one.
4. Store both locally. Input is hidden, and the file goes to
   `%USERPROFILE%\.pdabliss\flow\dev.env` with a user-only ACL:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-setup-secrets.ps1
   ```

   Accept the bracketed defaults for the public IDs and paste the secret and token when
   asked. A session secret is generated automatically.

## 5. Start the temporary HTTPS tunnel (your approval)

Prerequisite: `cloudflared` is installed (`winget install --id Cloudflare.cloudflared`, done
by you). The script refuses to run if `%USERPROFILE%\.cloudflared\config.yml` exists and does
not modify it. The company production tunnel is not touched.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Start -IApprovePublicExposure
```

It prints two URLs, for example `https://<random>.trycloudflare.com/` and
`https://<random>.trycloudflare.com/api/line/webhook`.

## 6. LIFF endpoint (temporary)

LINE Login channel (2012804685) → _LIFF_ tab → LIFF app `2012804685-QPWPdFGL` → **Endpoint
URL** = the printed `https://<random>.trycloudflare.com/`. Keep Size Full and scopes
`openid` + `profile`. Leave everything else unchanged.

## 7–9. Webhook

7. Messaging API channel → _Messaging API_ tab → _Webhook settings_ → **Webhook URL** = the
   printed `…/api/line/webhook` → **Update**.
8. Click **Verify**. Expect **Success**: LINE sends an empty `events` array, signed with your
   channel secret.
9. Only after Verify succeeds, turn **Use webhook** ON. Auto-reply and greeting messages stay
   disabled.

## 10. Test Sally through LINE

1. On your phone, open `https://liff.line.me/2012804685-QPWPdFGL` (send it to yourself in
   LINE, or use the OA's link).
2. First time: screen **E** shows a reference such as `K7QF-2M9X`. On the workstation run:

   ```powershell
   npm.cmd run access -- approve K7QF-2M9X --role owner --label "Owner phone"
   ```

3. Tap "ได้รับอนุมัติแล้ว ลองอีกครั้ง". You should see screen **D**. As owner, tap
   **ตรวจสอบการเชื่อมต่อ LINE**. It shows the real quota and usage (read-only).
4. Send Sally a message in the 1:1 chat. Sally does **not** reply (by design). The status
   panel's webhook count should increase.
5. Tap **ออกจากระบบ** → screen J.
6. Optional: in a **new test group** that does not contain the HR bot, invite Sally. The join
   is recorded as _pending registration_ only. Do not invite production groups.

## 11. Additional testers (optional)

LINE Login is "Developing", so add them under LINE Login channel → _Roles_ → testers. Each
tester opens the LIFF URL and sends you their reference. You run `npm.cmd run access --
approve <REF> --role tester --label "Tester A"`. Revoke with `npm.cmd run access -- revoke
"Tester A"`.

## 12. Stop and restore safe settings

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Stop
```

Then turn **Use webhook** OFF and keep the LINE Login channel in **Developing**. Optionally
set the LIFF Endpoint URL back to `https://flow.pdabliss.com/`. The tunnel URL is dead after
stop, and a new run produces a new URL, so steps 6 and 7 repeat each time.

## R. Closure: final gates and minimal real-LINE retest (after the F01–F07 fixes)

Only what the closure fixes touched. Your secrets, the owner approval and the LINE settings
are reused. The webhook is **not** needed.

1. Final gates (no reinstall, rebuilds everything):
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-verify.ps1 -Final`
2. Start the tunnel:
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Start -IApprovePublicExposure`
3. LINE Login channel → LIFF → Endpoint URL = the printed tunnel URL. Leave "Use webhook" OFF.
4. On the iPhone, open the LIFF URL. Expect the owner landing **without** a new reference code
   (no re-enrollment).
5. Close FLOW and reopen it. Expect the landing again with no login (session restored).
6. Tap **ออกจากระบบ** → screen J, then **เข้าสู่ระบบอีกครั้ง**. Expect the landing again.
7. Tap **ตรวจสอบการเชื่อมต่อ LINE**. Expect the quota and usage figures.
8. Optional, desktop: repeat 4–6.
9. `ep01-integration.ps1 -Stop`, then restore the LIFF endpoint to
   `https://flow.pdabliss.com/`.

Do **not** try to trigger the rate limit on the real account. Screen K is verified with
simulated identities.

## Report back

Report pass or fail per step (not values or screenshots containing IDs). Logs with no secrets
are in `.qa\ep01\`.
