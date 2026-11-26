# EP02 — Permission matrix

Deny by default. All checks run on the server (`apps/api/src/domain/policy.ts`) on **every
request**: the session carries no privileges — the user, their status and their ACTIVE
memberships in ACTIVE workspaces are reloaded each time, so removals, suspensions and
revocations apply immediately to existing sessions. The UI only hides what the server refuses.

Three independent dimensions — never interchangeable:

1. **Workspace access** (membership + workspace role)
2. **Appointment visibility** (PRIVATE / WORKSPACE / SELECTED)
3. **Notification destination authorization** (who may send to which LINE chat/group)

## Account states

| State     | Session | Application | Can do                                          |
| --------- | ------- | ----------- | ----------------------------------------------- |
| NEW       | yes     | no          | submit one access request; redeem an invitation |
| PENDING   | yes     | no          | wait; re-check; redeem an invitation            |
| ACTIVE    | yes     | yes         | per roles below                                 |
| REJECTED  | yes     | no          | submit a new request                            |
| SUSPENDED | ended   | no          | nothing (invitations cannot bypass suspension)  |
| REVOKED   | ended   | no          | nothing (invitations cannot bypass revocation)  |

## Global roles (Owner Console)

| Action                                    | OWNER | ADMIN               | USER |
| ----------------------------------------- | ----- | ------------------- | ---- |
| Open console, see pending count           | ✓     | ✓                   | –    |
| Approve / reject access requests          | ✓     | ✓                   | –    |
| View users, user detail, admin audit      | ✓     | ✓                   | –    |
| Suspend / reinstate / revoke / reactivate | ✓     | ordinary users only | –    |
| Assign workspace memberships              | ✓     | ordinary users only | –    |
| Create / revoke invitations               | ✓     | ✓                   | –    |
| Change global roles (ADMIN ↔ USER)        | ✓     | –                   | –    |
| Register / map / grant LINE groups        | ✓     | –                   | –    |
| Read LINE status (read-only)              | ✓     | –                   | –    |
| Create workspaces                         | ✓     | ✓                   | ✓    |
| **Read anyone's appointment content**     | **–** | **–**               | –    |

Guards: no action on yourself (status/role); OWNER can never be granted through the API, an
invitation or the console (only the local owner import/bootstrap); the last active owner cannot
be suspended/revoked; an admin cannot touch owners or admins.

## Workspace roles

| Action                                             | ADMIN | MEMBER | VIEWER |
| -------------------------------------------------- | ----- | ------ | ------ |
| See the workspace and its member list              | ✓     | ✓      | ✓      |
| See WORKSPACE-visible appointments                 | ✓     | ✓      | ✓      |
| Create appointments                                | ✓     | ✓      | –      |
| Edit/cancel own appointments                       | ✓     | ✓      | –      |
| Edit/cancel others' WORKSPACE-visible appointments | ✓     | –      | –      |
| See others' PRIVATE appointments                   | –     | –      | –      |
| Rename, archive; add/remove members; change roles  | ✓     | –      | –      |
| Leave                                              | ✓\*   | ✓      | ✓      |
| Use the workspace's LINE groups as destinations    | ✓     | grant  | –      |

\* The last workspace admin cannot leave or be demoted/removed. Personal workspaces cannot be
archived, left or shared. Only the creator may change an appointment's visibility or sharing.

## Appointment visibility

| Visibility | Who can read                                                 |
| ---------- | ------------------------------------------------------------ |
| PRIVATE    | creator only (not group admins, not the global owner)        |
| WORKSPACE  | every ACTIVE member of that workspace                        |
| SELECTED   | creator + explicitly granted ACTIVE members of the workspace |

Applied identically to list, detail, calendar items **and per-day counts**, Today, search,
history, lifecycle history, duplicate, preview and estimate. Unknown, foreign or unauthorized
ids all answer 404 (no existence oracle). The audit trail shows actions and actors, never
titles, notes or locations.

## Destinations

| Destination                   | Who may select it                                          |
| ----------------------------- | ---------------------------------------------------------- |
| My private chat               | me                                                         |
| Another member's private chat | creator, only if that member can see the appointment       |
| LINE group                    | workspace ADMIN of the mapped workspace, or explicit grant |

A LINE join only creates a PENDING registration (grants nothing). Rules enforced by the server:
`PRIVATE`/`SELECTED` appointments may go to a group only as `PRIVACY_SAFE` (no title,
location, notes); sensitive categories (health, personal, family) need explicit confirmation
before `FULL` content goes to a group; notes are never sent anywhere.

## The 9-role test (`tests/support/permission-matrix.ts`, MemoryStore + MariaDB)

| Action                              | Owner | G-Admin | WS-Admin | Member | Viewer | Outsider | Pending | Suspended | Revoked |
| ----------------------------------- | ----- | ------- | -------- | ------ | ------ | -------- | ------- | --------- | ------- |
| View workspace appointment          | –     | –       | ✓        | ✓      | ✓      | –        | –       | –         | –       |
| View a member's private appointment | –     | –       | –        | –      | –      | –        | –       | –         | –       |
| Create appointment in workspace     | –     | –       | ✓        | ✓      | –      | –        | –       | –         | –       |
| Edit workspace appointment          | –     | –       | ✓        | –      | –      | –        | –       | –         | –       |
| Manage workspace members            | –     | –       | ✓        | –      | –      | –        | –       | –         | –       |
| Open owner console (users)          | ✓     | ✓       | –        | –      | –      | –        | –       | –         | –       |
| Change a global role                | ✓     | –       | –        | –      | –      | –        | –       | –         | –       |
| Manage LINE destinations            | ✓     | –       | –        | –      | –      | –        | –       | –         | –       |

(Owner and global admin are deliberately **not** members of the test workspace: global roles
grant no workspace or appointment access.)
