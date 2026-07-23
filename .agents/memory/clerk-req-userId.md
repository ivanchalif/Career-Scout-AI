---
name: Clerk Express req.userId vs req.auth.userId
description: In Clerk Express v2, req.auth.userId can resolve to undefined even after requireAuth passes; use req.userId instead.
---

## Rule
Always use `req.userId` to get the authenticated user ID in Express routes. **Never** use `req.auth.userId`.

**Why:** `requireAuth` validates the Clerk JWT via `getAuth(req)` and stores the confirmed userId as `req.userId`. In Clerk Express v2, `req.auth` is a raw property added by `clerkMiddleware()` that can differ from what `getAuth()` returns — in particular `req.auth.userId` can be undefined/null for sessions that are technically authenticated. When `undefined` is passed to Drizzle's `eq(col, undefined)`, it generates `col = NULL` in SQL, which silently matches zero rows and returns an empty 200 response.

**How to apply:** Grep for `req.auth.userId` before shipping any new route. The correct pattern is `const userId = req.userId;` inside a route guarded by `requireAuth`.
