import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/posting-cache.ts", import.meta.url), "utf8");
const module = { exports: {} };
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports });
const { removePostingFromCache, updateDismissalReasonInCache } = module.exports;
const items = [{ posting: { id: 1 } }, { posting: { id: 2 } }];

test("dismissal removes cards from paginated and legacy caches without mutating snapshots", () => {
  const page = { items, total: 31 };
  const next = removePostingFromCache(page, 1);
  assert.equal(next.total, 30);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].posting.id, 2);
  assert.equal(page.items.length, 2);
  assert.equal(removePostingFromCache(items, 1).length, 1);
  assert.equal(removePostingFromCache(page, 99), page);
  assert.equal(removePostingFromCache(undefined, 1), undefined);
});

test("reason updates preserve count and other jobs without refetching the list", () => {
  const page = { items, total: 31 };
  const feedback = { kind: "wrong_domain", createdAt: "2026-11-07" };
  const next = updateDismissalReasonInCache(page, 1, feedback);
  assert.equal(next.total, 31);
  assert.equal(next.items[0].feedback, feedback);
  assert.equal(next.items[1], items[1]);
  assert.equal(items[0].feedback, undefined);
  assert.equal(updateDismissalReasonInCache(items, 1, feedback)[0].feedback, feedback);
});
