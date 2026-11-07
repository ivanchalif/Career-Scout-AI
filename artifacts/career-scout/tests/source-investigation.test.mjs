import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";

const require = createRequire(import.meta.url);
const sourceCode = await readFile(new URL("../src/components/source-investigation.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(sourceCode, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture({ failed = false } = {}) {
  const source = {
    id: 1, name: "Example", kind: "search", url: "https://www.google.com/search?q=product",
    updatedAt: "2026-11-06T12:00:00.000Z",
  };
  const report = {
    sourceId: 1, sourceUpdatedAt: source.updatedAt, investigatedAt: source.updatedAt,
    summary: "Recent responses indicate poor relevance.", findings: ["3 dismissed, 0 applied."],
    dismissals: [{ reason: "too_junior", count: 3 }],
    probe: { status: "ok", retrieved: 4, unseen: 2, eligibleBySavedFilters: 2, error: null, warnings: [], recoveryNotes: [] },
    recommendations: [
      { id: "junior", action: "update_query", title: "Exclude junior", explanation: "Source only", proposedUrl: "https://www.google.com/search?q=product+-junior" },
      { id: "pause", action: "pause", title: "Pause source", explanation: "Recoverable", proposedUrl: null },
    ],
  };
  const calls = [], updates = [], invalidations = [];
  const states = [];
  let cursor = 0;
  const Button = () => null;
  const investigation = {
    data: undefined, isPending: false, isError: false,
    mutate: args => {
      calls.push(args);
      if (failed) {
        investigation.isError = true;
        investigation.error = { data: { error: "Please wait for the current investigation." } };
      } else investigation.data = report;
    },
  };
  const mocks = {
    react: { useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    } },
    "lucide-react": { Loader2: () => null, SearchCheck: () => null },
    "@tanstack/react-query": { useQueryClient: () => ({
      invalidateQueries: async args => { invalidations.push(args); },
    }) },
    "@workspace/api-client-react": {
      useInvestigateOnlineDiscoverySource: () => investigation,
      useUpdateOnlineDiscoverySource: () => ({ isPending: false, mutateAsync: async args => {
        updates.push(args);
        Object.assign(source, args.data.url ? { url: args.data.url } : { isSuppressed: args.data.suppressed });
        source.updatedAt = "2026-11-06T12:01:00.000Z";
      } }),
      getGetOnlineDiscoverySourcesQueryKey: () => ["/api/online-discovery/sources"],
    },
    "@/components/ui/button": { Button },
    "@/lib/dismissal-reasons": { reasonLabel: reason => reason },
  };
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, require: name => mocks[name] ?? require(name) });
  function flatten(node) {
    if (!React.isValidElement(node)) return [];
    return [node, ...React.Children.toArray(node.props.children).flatMap(flatten)];
  }
  function render() {
    cursor = 0;
    return flatten(module.exports.SourceInvestigation({ source, onEdit() {} }));
  }
  const button = (text, index = 0) => render().filter(node => node.type === Button && node.props.children === text)[index];
  return { source, report, calls, updates, invalidations, render, button };
}

test("user triggers an inline investigation without silently changing configuration", () => {
  const f = fixture();
  f.render().find(node => node.props["aria-label"] === "Investigate Example").props.onClick();
  assert.equal(f.calls[0].id, 1);
  assert.equal(f.updates.length, 0);
  assert.ok(f.render().some(node => node.type === "section"));
  assert.ok(!f.render().some(node => node.props.role === "dialog"));
});

test("query fix is previewed and only saved after Apply solution", async () => {
  const f = fixture();
  f.render().find(node => node.props["aria-label"] === "Investigate Example").props.onClick();
  f.button("Review change").props.onClick();
  assert.equal(f.updates.length, 0);
  assert.ok(f.render().some(node => node.props["data-testid"] === "source-solution-review-1"));
  await f.button("Apply solution").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.updates[0].id, 1);
  assert.equal(f.updates[0].data.url, f.report.recommendations[0].proposedUrl);
  assert.equal(f.invalidations.length, 1);
  assert.equal(f.calls.length, 1);
});

test("pausing is an explicit source-only update, not deleting existing jobs", async () => {
  const f = fixture();
  f.render().find(node => node.props["aria-label"] === "Investigate Example").props.onClick();
  f.button("Review change", 1).props.onClick();
  await f.button("Apply solution").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.updates[0].data.suppressed, true);
  assert.equal(Object.keys(f.updates[0].data).length, 1);
});

test("recommendations become non-actionable when source settings changed since investigation", () => {
  const f = fixture();
  f.render().find(node => node.props["aria-label"] === "Investigate Example").props.onClick();
  f.source.updatedAt = "2026-11-06T12:01:00.000Z";
  assert.equal(f.button("Review change").props.disabled, true);
});

test("investigation errors show an actionable retry without suggesting a saved fix", () => {
  const f = fixture({ failed: true });
  f.render().find(node => node.props["aria-label"] === "Investigate Example").props.onClick();
  assert.ok(f.render().some(node => node.props.role === "alert" && node.props.children.includes("Please wait")));
  assert.ok(f.button("Retry investigation"));
  assert.equal(f.updates.length, 0);
});
