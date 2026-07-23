---
name: One-off Node scripts in pnpm workspace
description: How to run quick JS scripts when tsx/ts-node are unavailable
---

## Rule
`tsx` and `ts-node` are not installed in this workspace. For one-off administrative scripts:
1. Write plain `.mjs` (ESM) JavaScript
2. Import packages using **absolute paths** into the pnpm virtual store: `/home/runner/workspace/node_modules/.pnpm/<pkg@ver>/node_modules/<pkg>/`
3. Run with `node script.mjs` (no TypeScript compilation needed)

## Why
pnpm hoists packages into a virtual store, not the root `node_modules/`. Direct package name imports from a script fail with `ERR_MODULE_NOT_FOUND` unless you're inside a package that lists them as a dependency. Absolute pnpm store paths bypass this.

## How to apply
- Find location: `ls /home/runner/workspace/node_modules/.pnpm/ | grep "^packagename@"`
- Then use: `import foo from "/home/runner/workspace/node_modules/.pnpm/<pkg@ver>/node_modules/<pkg>/build/src/index.js"`
- Always delete the script after use — never commit admin scripts
