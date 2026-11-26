# Cross-workspace tests

Unit tests live next to each workspace (`packages/*/tests`, `apps/*/tests`) and run with
`npm run test`.

This folder is reserved for cross-workspace suites added in later episodes:

- EP03 — authorization and cross-group isolation tests against `pdabliss_flow_test`
- EP04 — notification-engine integration tests (claiming, idempotency, quota)
- EP06 — end-to-end and mobile browser QA

EP00 does not place tests here.
