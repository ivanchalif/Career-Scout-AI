---
name: Cold-start regression tests
description: Router imports can exceed the default per-test timeout in this workspace.
---

Keep expensive initial router imports in test setup rather than charging them against the first test case's five-second timeout.

**Why:** Repeated full-suite runs timed out only on the first router-importing test, including with fewer workers. A longer timeout passed the entire suite; the delay was cold module loading rather than a failed assertion.

**How to apply:** When adding route tests or diagnosing a first-test-only timeout, separate import/setup time from request/assertion time. Do not weaken functional assertions or broadly raise timeouts to hide slow handlers.
