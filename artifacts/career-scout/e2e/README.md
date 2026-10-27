# Browser regression tests

## Dismissal dialog (isolated UI integration)

```sh
pnpm --filter @workspace/career-scout test:dismissal
```

Install Playwright's Chromium first (`pnpm --filter @workspace/career-scout exec
playwright install chromium`), or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an
installed Chromium executable. The suite starts and stops its own Vite server
on `127.0.0.1:5189`; it does not require the app workflows to be running.

The command type-checks the browser tests and configs before running them.
This suite renders the production `App`, dashboard, detail page, query/mutation
hooks, Radix menus, and persistent dismissal provider. Only Clerk identity and
HTTP responses are replaced. Every test has a fresh browser context, unique
synthetic account, posting, feedback snapshot, and undo token. Every API call
is intercepted; unknown calls fail the test, and external network traffic is
blocked. No existing Clerk accounts, saved sessions, database records, Gmail,
discovery, or AI calls are touched. Failure artifacts go to the ignored
`generated-artifacts/dismissal-tests` directory.

Coverage:
- Card removal and 60 seconds of virtual time do not close the dialog/menu.
- All five shared reason labels, order, payloads, and Deleted display after reload.
- Multiple reason changes and Undo, including latest-token handling and original feedback.
- Skipping with/without existing feedback, and Undo from Deleted after reload.
- Real detail-to-dashboard navigation with the provider/dialog still mounted.
- Pending and failed reason saves / Undo retain controls and support retry or exit.
- Failed initial dismissal keeps the detail page and permits another attempt.

These are UI integration tests, **not** live-service end-to-end tests. Persistence
is modeled by the per-test HTTP fixture. The complementary server tests execute
the real Express dismissal handlers with an isolated transaction double to
check all five reasons, snapshot preservation, original timestamp restoration,
stale-token rejection, and no-feedback Undo:

```sh
pnpm --filter @workspace/api-server test -- src/routes/__tests__/dismissals.test.ts
```

The existing AI-scoring E2E suite still uses `playwright.config.ts` and its
Clerk session setup; the isolated dismissal suite is deliberately excluded
from that configuration.
