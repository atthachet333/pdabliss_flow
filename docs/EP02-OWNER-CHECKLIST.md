# EP02 — Owner checklist

Everything runs on your own PC. **Never paste passwords, secrets or connection strings into
chat, issues or screenshots.** Commands are for Windows PowerShell, run from the repository
folder. Each step says what it changes.

## 1. Confirm the local EP02 working tree

Review the checkpoint on `origin/main` and check the office working tree before updating. The condominium remediation started from `4421d6f`. Preserve office credentials and database settings. Use the [office handover](EP02-OFFICE-HANDOVER.md) for the locked dependency install and preflight.

## 2. LINE settings on this PC (skip if `%USERPROFILE%\.pdabliss\flow\dev.env` already has them)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-setup-secrets.ps1
```

Reuse the **existing** channels (do not create new ones, do not regenerate the channel secret).
The access token is optional (read-only quota check); issuing a new long-lived token disables
the one on the office PC.

## 3. MariaDB (development + test databases only)

For a configured office FLOW installation, use the guarded status and drift checks in the office handover. If initial provisioning is needed and MariaDB is missing, install **one** MariaDB Community Server (current LTS, Windows
x64 MSI from mariadb.org; keep remote root access disabled). If a MariaDB/MySQL server already
exists for another system, do not install a second one. Then:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep02-db-setup.ps1
```

It asks for the MariaDB administrator password (hidden), creates `pdabliss_flow_dev`,
`pdabliss_flow_test`, `pdabliss_flow_shadow` and four FLOW-only accounts, writes the connection
strings to `%USERPROFILE%\.pdabliss\flow\` (never printed), and applies the committed
migrations. It never creates or touches `pdabliss_flow` (production).

## 4. Owner account on the office workstation

- Keep any existing active office owner. If there is no active owner and a trusted legacy `access.json` already exists in the office’s external FLOW directory, run `npm.cmd run admin -- import-ep01-owner` locally.
- For secure bootstrap, open FLOW from LINE with the verified owner identity before filing an access request. Run `npm.cmd run admin -- recent-signins`. Compare the locally shown masked ID to **Your user ID** in LINE Developers, then run `npm.cmd run admin -- bootstrap-owner <uuid> --confirm` using the matching UUID. Keep the identifiers and command output private. Reopen FLOW after bootstrap.

## 5. Full verification

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep02-verify.ps1
```

The script runs the local automated gates and records the result in `.qa\ep02\summary.txt`.
Exit 0 confirms those gates. The script validates the Effect override using npm 11.21.3 and
installs from the lockfile only if Prisma is missing. Local browser evidence is recorded in the
[remediation report](EP02.1-REMEDIATION-REPORT.md).

## 6. Continue real LINE acceptance in the office

The owner already verified login, bootstrap, primary navigation, private appointment create and reschedule, and preview-only reminder calculations on iPhone. Use steps 5–7 in this section for the open persistence, history, console, approval, invitation and privacy checks. Repeat the appointment scenario during final device regression. Review the [real-device backlog](EP02-REAL-DEVICE-FINDINGS.md) first.

1. Confirm that you approve a temporary public endpoint and that the existing LINE Login/LIFF
   and Messaging API channels are the FLOW channels. Keep **Use webhook** off. Sign in to
   LINE Developers and record the canonical endpoint `https://flow.pdabliss.com/` for restoration.
2. Confirm `cloudflared` is available on `PATH` with `Get-Command cloudflared`. Build and start
   the local integration harness once public exposure is approved.

```powershell
npm.cmd run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Start -IApprovePublicExposure
```

3. Set the existing LIFF app’s Endpoint URL to the printed temporary endpoint. Leave Messaging
   API webhook and Rich Menu settings alone. Open FLOW from LINE on mobile, complete real LINE
   sign-in, and apply the secure import or bootstrap procedure in step 4 if an owner is needed.
4. Open Today. Create a synthetic appointment for tomorrow at 10:00 Bangkok time with the
   calendar reminder at 06:00 and the relative reminder one hour before. Verify 06:00 and 09:00
   in the details and inspect the Flex preview. Reschedule for 13:00 and verify 06:00 and 12:00.
5. Close and reopen LIFF. Verify session restoration and appointment persistence. Log out and
   sign in again, then reopen the same appointment and verify its updated time. Confirm the full event history, including creation and rescheduling.
6. In Owner Console, check summary, users, pending requests, invitations and audit. With an
   owner-approved second test identity, submit an access request from mobile. Approve it in
   Owner Console and verify the pending user can refresh into Today with the assigned access.
7. If a separate approved test identity and synthetic workspace are available, create a
   single-use invitation, open it manually in LINE, request access, and verify replay is refused.
   Verify membership requires approval. Create a private appointment and confirm the second
   identity cannot see it in Today, calendar, search, or via its detail URL. Use only synthetic
   content and test identities. Record any scenario that could not run.

After the test, including an interrupted or failed run, stop the temporary tunnel and its local
processes.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ep01-integration.ps1 -Stop
```

Restore the LIFF Endpoint to `https://flow.pdabliss.com/` and verify **Use webhook** is off.
Check the existing channel’s outbound message history or usage for unexpected sends during the
test. Record the pass/fail outcomes and endpoint restoration without personal data or tokens.

## 7. Shutdown evidence and closure

The condominium guarded `-Stop` and `-Status` commands found no recorded FLOW session or listener on the FLOW ports. MariaDB stayed running. Confirm canonical LIFF endpoint restoration and **Use webhook** off in LINE Developers, and then complete the outbound usage review.

The owner authorized the office handover checkpoint on `main`. Final EP02 acceptance follows the pending real LINE scenarios, iOS WebKit and iPhone regression, and closure of RD01–RD06 and RD08. RD07 remains an enhancement proposal subject to owner approval.

## 8. EP02 consolidated (28 Nov 2026)

The consolidated application adds recurring items, bills, member colours and the `/admin`
Administration Center. It is implemented and locally verified on the condominium workstation.
Apply the new migration with the guarded commands (`node scripts/db.mjs deploy dev`), already
done on this workstation. The remaining real LINE checks and the exact guarded integration
commands are in [EP02-FINAL-ACCEPTANCE.md](EP02-FINAL-ACCEPTANCE.md).
