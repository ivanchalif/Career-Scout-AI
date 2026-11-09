import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { readDashboardSorts, saveDashboardSort } from "../src/lib/dashboard-sorts.ts";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/components/dashboard-sort-select.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const selectParts = Object.fromEntries(
  ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map(name => [name, () => null]),
);
const module = { exports: {} };
runInNewContext(compiled, {
  module, exports: module.exports,
  require: name => name === "@/components/ui/select" ? selectParts
    : name === "@/components/ui/label" ? { Label: () => null } : require(name),
});
const { DashboardSortSelect, DASHBOARD_SORT_OPTIONS } = module.exports;
function find(node, type) {
  if (!React.isValidElement(node)) return [];
  return [
    ...(node.type === type ? [node] : []),
    ...React.Children.toArray(node.props.children).flatMap(child => find(child, type)),
  ];
}

test("every sort option updates the controlled value and persists independently per view", () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  saveDashboardSort(storage, "a", "applied", "company-asc");
  saveDashboardSort(storage, "a", "deleted", "date-asc");
  let value = "score-desc";
  for (const [key] of DASHBOARD_SORT_OPTIONS) {
    const tree = DashboardSortSelect({
      view: "active", value,
      onValueChange: next => { value = next; saveDashboardSort(storage, "a", "active", next); },
    });
    const select = find(tree, selectParts.Select)[0];
    assert.equal(select.props.value, value);
    const items = find(tree, selectParts.SelectItem);
    assert.equal(items.length, 9);
    assert.ok(items.some(item => item.props.value === key));
    select.props.onValueChange(key);
    const rerender = DashboardSortSelect({ view: "active", value, onValueChange: () => {} });
    assert.equal(find(rerender, selectParts.Select)[0].props.value, key);
    assert.deepEqual(readDashboardSorts(storage, "a"), {
      active: key, applied: "company-asc", deleted: "date-asc",
    });
  }
});

test("selector keeps a labeled trigger and all choices during background rerenders", () => {
  for (const view of ["active", "applied", "deleted"]) {
    const tree = DashboardSortSelect({ view, value: "title-asc", onValueChange: () => {} });
    const trigger = find(tree, selectParts.SelectTrigger)[0];
    assert.equal(trigger.props.id, "dashboard-sort");
    assert.equal(trigger.props["data-testid"], "sort-select");
    assert.equal(find(tree, selectParts.SelectItem).length, 9);
  }
});
