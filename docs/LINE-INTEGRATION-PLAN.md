# LINE integration plan

Verification date: **2026-11-26** (Asia/Bangkok). Official LINE sources are preferred.
Every statement is marked **VERIFIED** (official LINE page read on that date), **SECONDARY**
(non-LINE source) or **ASSUMPTION** (to verify in EP01).

## 1. Platform facts

| #   | Fact                                                                                                                                                                                                           | Status                                                                                  | Source                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Push, multicast, broadcast and narrowcast count toward the plan's monthly messages. **Reply messages do not**                                                                                                  | VERIFIED                                                                                | https://developers.line.biz/en/docs/messaging-api/pricing/                                                                                                |
| 2   | Counting is **per recipient**: a push to a 5-person chat counts 5, whatever the number of message objects (up to 5)                                                                                            | VERIFIED                                                                                | pricing page; https://developers.line.biz/en/docs/messaging-api/sending-messages/ ; https://developers.line.biz/en/tips/2026/05/28/how-to-count-messages/ |
| 3   | Messages to users who blocked the OA, or to non-existent IDs, are not counted                                                                                                                                  | VERIFIED                                                                                | pricing page; tips article                                                                                                                                |
| 4   | Over the limit, the request **fails** with an error and nothing is sent                                                                                                                                        | VERIFIED                                                                                | pricing page                                                                                                                                              |
| 5   | `GET /v2/bot/message/quota` (monthly target limit) and `GET /v2/bot/message/quota/consumption` (sent this month) exist                                                                                         | VERIFIED                                                                                | https://developers.line.biz/en/reference/messaging-api/                                                                                                   |
| 6   | **Only one LINE Official Account can be in a group chat at a time**                                                                                                                                            | VERIFIED                                                                                | https://developers.line.biz/en/docs/messaging-api/group-chats/                                                                                            |
| 7   | "Allow bot to join group chats" must be enabled in the console (off by default)                                                                                                                                | VERIFIED                                                                                | group-chats page                                                                                                                                          |
| 8   | Multicast cannot target groups. Reply and push work in groups. Messages are visible to all members                                                                                                             | VERIFIED                                                                                | group-chats page                                                                                                                                          |
| 9   | Group APIs: summary, `GET /v2/bot/group/{groupId}/members/count`, member IDs, member profile, leave                                                                                                            | VERIFIED (exist)                                                                        | reference + group-chats page                                                                                                                              |
| 10  | The member-ID list endpoint may require a verified or premium OA                                                                                                                                               | ASSUMPTION                                                                              | check in EP01                                                                                                                                             |
| 11  | Webhook events include join, leave, member join and member leave                                                                                                                                               | VERIFIED (listed)                                                                       | reference                                                                                                                                                 |
| 12  | Webhook signature: header `x-line-signature` = Base64(HMAC-SHA256(channel secret, **raw body**)), UTF-8, body must not be re-serialized                                                                        | VERIFIED                                                                                | https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/                                                                               |
| 13  | Redelivery is opt-in. It retries on non-2xx at undisclosed intervals. Redelivered events keep the same `webhookEventId` with `deliveryContext.isRedelivery`. Deduplicate on `webhookEventId`. Order can change | VERIFIED                                                                                | https://developers.line.biz/en/docs/messaging-api/receiving-messages/                                                                                     |
| 14  | LIFF: send the **ID token or access token** to the server and verify it with LINE. Do not send profile data. Access tokens are revoked when the LIFF app closes                                                | VERIFIED                                                                                | https://developers.line.biz/en/docs/liff/using-user-profile/                                                                                              |
| 15  | Rich menu image: JPEG/PNG, **≤ 1 MB**, full size 2500×1686 (also 1200×810, 800×540); compact 2500×843                                                                                                          | VERIFIED (OA Manager manual: 2500×1686 / 2500×843, ≤ 1 MB) + SECONDARY (full size list) | https://linebiz.com/jp-en/manual/OfficialAccountManager/rich-menus ; dev.classmethod.jp                                                                   |
| 16  | Flex boxes support box, button, image, text, separator (and icon/span in baseline/text)                                                                                                                        | VERIFIED                                                                                | https://developers.line.biz/en/docs/messaging-api/flex-message-layout/                                                                                    |
| 17  | Flex alt-text max length and bubble size limits                                                                                                                                                                | ASSUMPTION                                                                              | FLOW uses its own **400-char** alt-text cap; confirm in the Flex reference in EP04                                                                        |
| 18  | `X-Line-Retry-Key` for idempotent push retries                                                                                                                                                                 | ASSUMPTION (not on the pages read)                                                      | confirm in the reference "Retrying an API request" (EP04)                                                                                                 |
| 19  | User IDs are scoped to the **provider**. LINE Login and the Messaging API must share a provider for consistent identity                                                                                        | ASSUMPTION (well established; re-check)                                                 | EP01                                                                                                                                                      |

## 2. Thailand quota

| Item                                                                                                              | Status                                                                    | Notes                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Free plan = **300 messages/month**                                                                                | **SECONDARY**: z.com Thailand and True Business LINE pages list 300/month | Planning assumption only. Read the real value from the quota API and OA Manager. Never hard-code it                                          |
| Paid: Basic 1,280 THB (15,000), Pro 1,780 THB (35,000)                                                            | SECONDARY                                                                 | FLOW never upgrades or buys messages automatically                                                                                           |
| From **1 Feb 2027**, Reply API messages in Thailand get a free allowance of 25,000/month, with charges above that | **SECONDARY, single source** (relevantaudience.com, 5 Nov 2026)           | FLOW's reply usage (webhook responses) is far below that, but treat replies as a configurable cost and verify with LINE Thailand before EP04 |

Budget example with the 300 assumption: a 4-member family group with 2 reminders per
appointment costs 8 messages, so about 37 such appointments a month. One 18-member company group
reminder costs 18. Group notifications are the main cost driver, which is why FLOW shows the
estimate before confirmation and keeps a safety reserve.

## 3. Existing HR LINE Bot (compatibility)

Because only one OA can be in a group (fact 6), **Sally cannot join any group that already
contains the HR LINE Bot.** Options for owner decision (none taken in EP00):

1. Create separate FLOW groups (for example "บริษัท – นัดหมาย").
2. Use private delivery to each authorized member (more quota, maximum privacy).
3. Later, consider whether one OA should host both functions (an architectural change with
   impact on the HR bot; needs explicit owner approval).

The HR bot is not inspected, modified or removed.

## 4. Owner-prepared LINE configuration (recorded 2026-11-26; non-secret)

The owner created these resources before EP01. **Do not create duplicates.** No secrets are
stored here or anywhere in the project. EP00 made **no** connection to LINE.

| Setting                                   | Value                                                    |
| ----------------------------------------- | -------------------------------------------------------- |
| Provider                                  | PDA BLISS (Provider ID `2005850219`)                     |
| LINE Official Account                     | Sally \| PDA BLISS (`@138zyggc`)                         |
| Messaging API channel ID                  | `2012804462`                                             |
| LINE Login channel ID                     | `2012804685`                                             |
| LIFF ID                                   | `2012804685-QPWPdFGL`                                    |
| LIFF URL                                  | <https://liff.line.me/2012804685-QPWPdFGL>               |
| LIFF endpoint (configured or planned)     | <https://flow.pdabliss.com/>                             |
| LIFF size / scopes                        | Full · `openid`, `profile`                               |
| Add friend option                         | On (Normal)                                              |
| Scan QR / Module mode / shareTargetPicker | Off / Off / Off                                          |
| Linked OA                                 | Sally \| PDA BLISS                                       |
| Allow bot to join group chats             | Enabled                                                  |
| Auto-reply / Greeting messages            | Disabled / Disabled                                      |
| LINE Login publishing status              | Developing                                               |
| Webhook URL                               | Not configured                                           |
| Channel access token                      | Not issued yet                                           |
| Messaging API channel secret              | Rotated by the owner (value never shared or stored here) |

Consequences for EP01:

- Login and Messaging API sit under the same provider, so user IDs are consistent (fact 19).
- The LIFF endpoint points at the production domain. EP01 testing on real devices needs either
  a separately approved HTTPS development endpoint or a deliberate decision to stage on
  `flow.pdabliss.com`. Either one requires explicit owner approval, and EP00 configures neither.
- The rich-menu spec (`assets/rich-menu/rich-menu.spec.json`) now uses this LIFF ID for its
  six URIs. It is still not uploaded.
- Secrets (channel secret, access token) go only into the out-of-OneDrive secret file
  (SECURITY-AND-PRIVACY.md §4), never into chat, docs or Git.

## 5. EP01 setup checklist (★ = owner action)

1. ~~Provider, Messaging API channel, LINE Login channel, LIFF app, group join setting~~
   **Done by the owner** (§4).
2. ★ Approve how EP01 exposes HTTPS for the webhook and LIFF endpoint (temporary tunnel vs.
   staged `flow.pdabliss.com`).
3. ★ Issue the channel access token when EP01 starts, and place it with the channel secret in
   `%USERPROFILE%\.pdabliss\flow\dev.env`.
4. ★ Decide how to handle groups that already contain the HR LINE Bot (§3).
5. EP01 build: webhook signature verification, LIFF init, ID-token verification, sessions,
   private-access allow-list, tests first.
6. Register the webhook URL and enable redelivery. Test join, leave and message events in a
   **test group without the HR bot**.
7. ★ Check the real monthly quota in OA Manager.
8. Rich menu upload is EP05, after the final art is approved.
