---
name: Express ETag 304 in Replit proxy
description: ETags cause 304 responses that the Replit proxy forwards bodyless to JS, making customFetch return null instead of cached data.
---

## Rule
Always call `app.disable("etag")` in the Express API server (`app.ts`).

**Why:** Express sets ETags on all JSON responses by default. Browsers then send `If-None-Match` on refetches. The server returns `304 Not Modified`. In a normal browser, the HTTP cache fills in the body transparently and JS sees a 200. In the Replit proxy environment, the proxy forwards the bare `304` without the cached body. `customFetch` includes 304 in `NO_BODY_STATUS` and returns `null`. React Query then replaces cached data with `null`, causing tabs/components to flash empty state.

**How to apply:** The fix is in `artifacts/api-server/src/app.ts` immediately after `const app = express()`. Do not remove it. Any new Express API server in this project should also have this line.
