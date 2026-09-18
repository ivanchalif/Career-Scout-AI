---
name: One-off Node scripts in pnpm workspace
description: How to run quick scripts when pnpm does not expose a needed transitive CLI
---

## Rule
`pnpm exec` only exposes declared binaries, so a transitive CLI such as `tsx` may exist in the virtual store while `pnpm exec tsx` still fails. For one-off administrative scripts:
1. Prefer plain `.mjs` (ESM) JavaScript with absolute virtual-store imports.
2. If the script must import project TypeScript, find the transitive CLI path under `node_modules/.pnpm/` and invoke it with `node`.
3. When using `tsx -e`, wrap asynchronous work in an async IIFE because eval defaults to CommonJS output and rejects top-level await.

## Why
pnpm keeps undeclared packages and binaries in its virtual store. A dependency can therefore be present without being resolvable by package name or exposed through `pnpm exec`.

## How to apply
- Find location: `ls /home/runner/workspace/node_modules/.pnpm/ | grep "^packagename@"`
- Then use: `import foo from "/home/runner/workspace/node_modules/.pnpm/<pkg@ver>/node_modules/<pkg>/build/src/index.js"`
- For a transitive CLI: `node "$(find node_modules/.pnpm -path '*/node_modules/<package>/<cli-file>' | head -1)" ...`
- Always delete the script after use — never commit admin scripts
