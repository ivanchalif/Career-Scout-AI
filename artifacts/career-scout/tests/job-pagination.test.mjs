import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/components/job-pagination.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
const Button = () => null;
runInNewContext(compiled, {
  exports: module.exports, module,
  require: (name) => name === "@/components/ui/button" ? { Button } : require(name),
});
const { JobPagination } = module.exports;
const buttons = (tree) => React.Children.toArray(tree.props.children).filter(React.isValidElement);

test("pagination is absent for zero or one page", () => {
  for (const totalPages of [0, 1]) {
    assert.equal(JobPagination({ page: 0, totalPages, onPageChange() {} }), null);
  }
});

test("every page is listed with First, Previous, Next and Last", () => {
  const tree = JobPagination({ page: 1, totalPages: 4, onPageChange() {} });
  assert.deepEqual(buttons(tree).map(b => b.props.children), ["First", "Previous", 1, 2, 3, 4, "Next", "Last"]);
  assert.equal(buttons(tree).filter(b => b.props["aria-current"] === "page")[0].props.children, 2);
  assert.equal(tree.props["aria-label"], "Job pages");
});

test("all navigation actions use the correct zero-based page", () => {
  const calls = [];
  const tree = JobPagination({ page: 1, totalPages: 4, onPageChange: p => calls.push(p) });
  for (const button of buttons(tree)) button.props.onClick();
  assert.deepEqual(calls, [0, 0, 0, 1, 2, 3, 2, 3]);
});

test("boundaries and loading disable the appropriate controls", () => {
  const first = buttons(JobPagination({ page: 0, totalPages: 3, onPageChange() {} }));
  assert.equal(first[0].props.disabled, true);
  assert.equal(first[1].props.disabled, true);
  const last = buttons(JobPagination({ page: 2, totalPages: 3, onPageChange() {} }));
  assert.equal(last.at(-1).props.disabled, true);
  assert.equal(last.at(-2).props.disabled, true);
  const loading = buttons(JobPagination({ page: 1, totalPages: 3, loading: true, onPageChange() {} }));
  assert.equal(loading.every(b => b.props.disabled), true);
});
