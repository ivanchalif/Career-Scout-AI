import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../src/hooks/use-posting-decision.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture({ fail = false } = {}) {
  const dialogs = [], toasts = [], dismissals = [], undos = [], invalidations = [];
  const module = { exports: {} };
  const mutation = (mutateAsync = async () => ({})) => ({ isPending: false, mutateAsync });
  const api = {
    useDismissPosting: () => mutation(async args => {
      dismissals.push(args);
      if (fail) throw new Error("Save failed");
      return { undoToken: "test-undo-token" };
    }),
    useUndoPostingDismissal: () => mutation(async args => { undos.push(args); }),
    useSetPostingFeedback: () => mutation(),
    useUndoPostingFeedback: () => mutation(),
    getListPostingsQueryKey: () => ["/api/postings"],
    getListDeletedPostingsQueryKey: () => ["/api/postings/deleted"],
    getGetPostingQueryKey: id => ["/api/postings", id],
    getGetDashboardSummaryQueryKey: () => ["/api/dashboard/summary"],
  };
  const mocks = {
    "@tanstack/react-query": { useQueryClient: () => ({
      cancelQueries: async () => {},
      setQueriesData: () => {},
      invalidateQueries: args => { invalidations.push(args); },
    }) },
    "@workspace/api-client-react": api,
    "@/hooks/use-toast": { toast: args => { toasts.push(args); } },
    "@/components/ui/toast": { ToastAction: () => null },
    "@/components/dismissal-dialog-provider": { useDismissalDialog: () => args => { dialogs.push(args); } },
    "@/lib/dismissal-reasons": {},
    "@/lib/posting-cache": { removePostingFromCache: old => old },
  };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: name => mocks[name] ?? require(name),
  });
  return { decision: module.exports.usePostingDecision(), dialogs, toasts, dismissals, undos, invalidations };
}

test("confirming a duplicate saves the reason and skips the dismissal dialog", async () => {
  const f = fixture();
  assert.equal(await f.decision.dismiss(42, "duplicate"), true);
  assert.equal(f.dismissals[0].id, 42);
  assert.equal(f.dismissals[0].data.reason, "duplicate");
  assert.equal(f.dialogs.length, 0);
  assert.equal(f.toasts[0].title, "Flagged as duplicate");
  assert.ok(f.invalidations.length > 0);
  await f.toasts[0].action.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.undos[0].id, 42);
  assert.equal(f.undos[0].data.undoToken, "test-undo-token");
  assert.equal(f.toasts[1].title, "Job restored");
});

test("ordinary dismissal still opens the optional reason dialog", async () => {
  const f = fixture();
  assert.equal(await f.decision.dismiss(42), true);
  assert.equal(f.dismissals[0].data.reason, null);
  assert.equal(f.dialogs[0].undoToken, "test-undo-token");
  assert.equal(f.dialogs[0].reason, null);
});

test("non-duplicate reasons preserve the existing dialog behavior", async () => {
  const f = fixture();
  await f.decision.dismiss(42, "wrong_domain");
  assert.equal(f.dialogs[0].reason, "wrong_domain");
  assert.equal(f.toasts.length, 0);
});

test("failed duplicate saves do not report success or offer an invalid Undo", async () => {
  const f = fixture({ fail: true });
  assert.equal(await f.decision.dismiss(42, "duplicate"), false);
  assert.equal(f.dialogs.length, 0);
  assert.equal(f.toasts[0].variant, "destructive");
  assert.equal(f.toasts[0].action, undefined);
  assert.equal(f.invalidations.length, 0);
});
