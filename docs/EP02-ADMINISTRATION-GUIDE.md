# EP02 — Platform Administration Center guide

_EP02 consolidated (former EP02.3 scope), 2026-11-28, Asia/Bangkok._

`/admin` is a desktop-first administration experience. It uses the **same origin, API, session
and database** as the LIFF app: production `https://flow.pdabliss.com/admin`, development
gateway `127.0.0.1:6769`. It adds no server, port or hostname. The layout is a separate route
tree, lazy-loaded with no mobile tab bar. The mobile Owner Console at `/owner` is unchanged.
Production routing is an EP05 task.

## Sign-in

- **In the LINE app:** open FLOW, then `/admin`. The existing session applies.
- **In a desktop or iPad browser:** open `https://flow.pdabliss.com/admin`. LIFF runs in the
  external browser, choose **Log in with LINE**, and LINE returns you to the same path. The
  server verifies the ID token with LINE as for every login, so there is no second password and
  no mock session.
- **Fresh confirmation:** changing an account status, changing a global role, or removing a
  membership needs a LINE login within the last **15 minutes**. Otherwise the server answers
  `403 REAUTH_REQUIRED` and the page asks you to confirm with LINE, then retries. Inside the LINE
  app with an expired token, close and reopen FLOW.
- The LIFF endpoint `https://flow.pdabliss.com/` already covers `/admin`. If a future external
  test needs another callback, record the exact LINE Developers change and stop until the owner
  approves it. No LINE console change is required for EP02.

## Authorization

The UI hides what the server refuses; the server is the boundary.

| Area                                                                          | OWNER | ADMIN                   | USER / workspace admin |
| ----------------------------------------------------------------------------- | ----- | ----------------------- | ---------------------- |
| Dashboard (users, requests, workspaces, audit cards)                          | ✓     | ✓                       | 404                    |
| Requests, users, workspaces, permissions, invitations, audit                  | ✓     | ✓ (ordinary users only) | 404                    |
| Global role changes                                                           | ✓     | –                       | –                      |
| LINE groups, friends, quota, Activity Center, notifications, health, settings | ✓     | 404                     | 404                    |
| Reading anyone's appointment content                                          | –     | –                       | –                      |

Personal workspaces are counted but can never be opened or browsed from administration.
Membership endpoints refuse them, so an owner cannot reach a private workspace by
manipulating membership.

## Pages

| Route                                                 | What it shows (real data only)                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`                                              | Clickable KPI cards, keyboard and touch. Each opens its detail route with the filter in the URL. Unavailable and EP03 metrics are labelled, never zero.                                                                                                              |
| `/admin/requests?status=…`                            | Display name, server-verified masked LINE ID, request time with age, message, invitation context and account status. Approval reviews the result: global USER, personal workspace, invitation target and optional extra memberships (Viewer, Member or Group Admin). |
| `/admin/users?status&role&workspaceId&q`              | Search and filters (RESTRICTED means suspended or revoked) with pagination.                                                                                                                                                                                          |
| `/admin/users/:id`                                    | Account, masked LINE ID, open sessions, memberships, history; the three offboarding options; reactivation with explicit review; owner-only role change.                                                                                                              |
| `/admin/workspaces`, `/admin/workspaces/:id`          | Shared workspaces with role counts, members with identity colours, linked LINE groups and invitation counts.                                                                                                                                                         |
| `/admin/permissions`                                  | Global and workspace role matrix as enforced.                                                                                                                                                                                                                        |
| `/admin/invitations`, `/admin/groups`, `/admin/audit` | The existing Owner Console panels, embedded.                                                                                                                                                                                                                         |
| `/admin/activity?from&to&status&workspaceId`          | The Activity Center (below).                                                                                                                                                                                                                                         |
| `/admin/notifications`                                | Calculated reminder counts. Pause, resume and emergency stop are shown as **not enabled** because no dispatcher exists yet.                                                                                                                                          |
| `/admin/quota`                                        | LINE OA monthly quota and consumption read live on the server, shown as used / quota, remaining and percentage, with month, last success and stale/error/unlimited states. Reservations and the FLOW delivery log are EP03.                                          |
| `/admin/friends`                                      | Four separate concepts: OA follower statistics (EP03), identifiable friends (EP03), registered FLOW accounts and approved users. The list holds FLOW-observed LINE identities with masked IDs and friendship **unknown**.                                            |
| `/admin/health`                                       | API, database latency, LINE configuration flags and outbound status. The worker shows "not enabled", which does not mean healthy.                                                                                                                                    |
| `/admin/settings`                                     | Read-only facts that are actually enforced. No fake switches.                                                                                                                                                                                                        |

## Activity Center privacy

The redaction is applied in `apps/api/src/domain/operations.ts`, the API projection, not by
the UI.

- No creator identity appears anywhere in this overview.
- A title, bill flag, recurring flag, group label and exact minute appear **only** when the
  viewer already has content access under the normal visibility rule.
- Restricted rows show the hour-truncated time, reminder kind, status, workspace (a personal
  workspace never names its owner) and destination kind. They never show the title, category,
  amount, notes, location, recipient identity, recurrence pattern or appointment ID.
- Delivery shows **not enabled**. LINE API acceptance will never be presented as a read receipt.

## Offboarding

| Option                   | Effect                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Remove from workspace | The membership becomes REMOVED. The account stays active elsewhere and the workspace's appointments disappear for that user at once.                                                                                                              |
| B. Suspend               | Every session ends and the private chat destination is disabled. Memberships are kept; **Reinstate** restores them.                                                                                                                               |
| C. Revoke                | Every session ends, every shared-workspace membership is removed, global ADMIN drops to USER, LINE-group send grants are removed and the private chat is disabled. No data is deleted, and shared company appointments stay with their workspace. |
| Reactivate (after C)     | Only the memberships reviewed in the dialog are granted; global USER. Old privileges are never restored blindly, and stale reminders are never replayed.                                                                                          |

Owner protection: no action on yourself, the last active owner cannot be suspended or revoked,
and an ADMIN cannot act on OWNER or ADMIN accounts. **FLOW cannot remove anyone from a LINE chat
or recall delivered messages.** Remove people from LINE groups separately in the LINE app. EP03
must re-check eligibility before every send (see [EP03 handover](EP03-HANDOVER.md)).
