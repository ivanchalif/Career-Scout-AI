import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dismissReasons, reasonLabel } from "../src/lib/dismissal-reasons.ts";

test("all dismissal choices have one uniform order and label", () => {
  assert.deepEqual(dismissReasons, [
    { kind: "not_my_role", label: "Not my role" },
    { kind: "wrong_location", label: "Wrong location" },
    { kind: "already_closed", label: "Mark as closed" },
    { kind: "workday", label: "Workday" },
    { kind: "duplicate", label: "Flag as duplicate" },
  ]);
  assert.equal(new Set(dismissReasons.map(({ kind }) => kind)).size, dismissReasons.length);
  for (const { kind, label } of dismissReasons) assert.equal(reasonLabel(kind), label);
});

test("other feedback still has a readable label", () => {
  assert.equal(reasonLabel("more_like_this"), "More like this");
  assert.equal(reasonLabel("future_reason"), "future_reason");
});

test("every reason picker uses the shared renderer instead of a local list", async () => {
  for (const path of [
    "../src/hooks/use-posting-decision.tsx",
    "../src/pages/dashboard.tsx",
    "../src/pages/posting-detail.tsx",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /<DismissReasonItems\b/, path);
    assert.doesNotMatch(source, /dismissReasons\.map/, path);
  }
});

test("duplicate-review shortcut uses the reversible reason flow too", async () => {
  const source = await readFile(new URL("../src/pages/dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /decision\.dismiss\(postingId, "duplicate"\)/);
  assert.doesNotMatch(source, /\/flag-duplicate/);
});
