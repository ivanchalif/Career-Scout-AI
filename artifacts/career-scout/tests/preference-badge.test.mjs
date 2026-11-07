import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/components/preference-badge.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
runInNewContext(compiled, { module, exports: module.exports, require });
const render = module.exports.PreferenceBadge;
function text(node) {
  if (node == null) return "";
  if (typeof node !== "object") return String(node);
  return React.Children.toArray(node.props.children).map(text).join(" ");
}

test("does not show a learning badge without supporting reasons", () => {
  assert.equal(render({ posting: { id: 1, preferenceReasons: [] } }), null);
  assert.equal(render({ posting: { id: 1 } }), null);
});

test("provides a native keyboard-expandable explanation rather than hover-only text", () => {
  const element = render({ posting: { id: 1, preferenceReasons: ["Too junior (2 independent responses)"], preferenceAdjustment: -8 } });
  assert.equal(element.type, "details");
  const summary = React.Children.toArray(element.props.children)[0];
  assert.equal(summary.type, "summary");
  assert.match(summary.props["aria-label"], /Explain.*-8/);
  assert.match(summary.props.className, /focus-visible/);
  assert.match(text(element), /Lower priority/);
  assert.match(text(element), /not your Profile fit score/);
  assert.match(text(element), /2 independent responses/);
  assert.match(text(element), /Recorded when this job was imported/);
  assert.match(text(element), /Undoing/);
  let stopped = false;
  element.props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test("distinguishes positive and balanced adjustments without error styling", () => {
  for (const [adjustment, label] of [[8, "Higher priority"], [0, "Balanced signals"]]) {
    const element = render({ posting: { id: 1, preferenceReasons: ["Similar roles"], preferenceAdjustment: adjustment } });
    assert.ok(text(element).includes(label));
    assert.equal(React.Children.toArray(element.props.children)[0].props["data-tone"], "neutral");
  }
});
