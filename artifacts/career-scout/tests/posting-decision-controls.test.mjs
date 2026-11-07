import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/components/posting-decision-controls.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture({ pending = false } = {}) {
  const calls = [];
  const Button = () => null;
  const mocks = {
    "@/components/ui/button": { Button },
    "@/components/ui/tooltip": Object.fromEntries(
      ["Tooltip", "TooltipContent", "TooltipProvider", "TooltipTrigger"].map(key => [key, () => null])),
    "@/hooks/use-posting-decision": { usePostingDecision: () => ({
      pending,
      dismiss: async (...args) => { calls.push(["dismiss", ...args]); return true; },
      toggleMoreLikeThis: async (...args) => { calls.push(["more-like-this", ...args]); },
    }) },
  };
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports, require: name => mocks[name] ?? require(name),
  });
  function buttons(element) {
    if (!React.isValidElement(element)) return [];
    return [
      ...(element.type === Button ? [element] : []),
      ...React.Children.toArray(element.props.children).flatMap(buttons),
    ];
  }
  return {
    calls,
    render: props => buttons(module.exports.PostingDecisionControls({ postingId: 42, ...props })),
  };
}

test("dashboard shortcut replaces More like this and dismisses with duplicate reason", async () => {
  const f = fixture();
  const buttons = f.render({ primaryAction: "duplicate", feedback: { kind: "more_like_this" } });
  assert.deepEqual(buttons.map(button => button.props["aria-label"]), ["Flag as duplicate", "Dismiss"]);
  assert.equal(buttons[0].props["aria-pressed"], undefined);
  await buttons[0].props.onClick();
  assert.deepEqual(f.calls, [["dismiss", 42, "duplicate"]]);
});

test("regular Dismiss still uses the optional reason flow", async () => {
  const f = fixture();
  await f.render({ primaryAction: "duplicate" })[1].props.onClick();
  assert.deepEqual(f.calls, [["dismiss", 42]]);
});

test("detail pages retain More like this", async () => {
  const f = fixture();
  const button = f.render({ feedback: { kind: "more_like_this" } })[0];
  assert.equal(button.props["aria-label"], "More like this");
  assert.equal(button.props["aria-pressed"], true);
  await button.props.onClick();
  assert.deepEqual(f.calls, [["more-like-this", 42, true]]);
});

test("both controls are disabled during a pending decision", () => {
  const f = fixture({ pending: true });
  assert.ok(f.render({ primaryAction: "duplicate" }).every(button => button.props.disabled));
});

test("only the dashboard opts in to the duplicate shortcut", async () => {
  const dashboard = await readFile(new URL("../src/pages/dashboard.tsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("../src/pages/posting-detail.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /<PostingDecisionControls\b[^>]*primaryAction="duplicate"/);
  assert.doesNotMatch(detail, /primaryAction="duplicate"/);
});
