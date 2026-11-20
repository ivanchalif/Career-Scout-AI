import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("sign-in defaults to the base-prefixed dashboard while signup retains onboarding", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /signInFallbackRedirectUrl=\{`\$\{basePath\}\/dashboard`\}/);
  assert.match(source, /signUpFallbackRedirectUrl=\{`\$\{basePath\}\/profile`\}/);
  // A fallback preserves explicit return destinations rather than forcing all navigation.
  assert.doesNotMatch(source, /signInForceRedirectUrl=/);
});
