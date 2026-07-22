---
name: api-client-react dist rebuild
description: lib/api-client-react uses TypeScript composite project references; the dist/ must be rebuilt after editing src/ or TypeScript IDEs won't see new exports.
---

## Rule
After adding new hooks or types to `lib/api-client-react/src/`, run:
```
cd lib/api-client-react && pnpm exec tsc -p tsconfig.json
```

**Why:** `career-scout/tsconfig.json` lists `lib/api-client-react` in `references`. TypeScript project references use compiled `.d.ts` output from `dist/`, not source. Vite (runtime) ignores project references and uses `"exports": "./src/index.ts"` directly, so the runtime app works fine — but `tsc --noEmit` and IDE type checking uses the stale dist and reports new exports as missing.

**How to apply:** Any time you add a new hook, type, or mutation to `lib/api-client-react/src/generated/api.ts` or `api.schemas.ts`, rebuild the dist as part of the same commit.
