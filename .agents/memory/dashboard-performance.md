---
name: Dashboard responsiveness
description: Duplicate review must not block interactive requests as job history grows.
---

Treat duplicate-review analysis as secondary work that must yield to interactive actions. Async request handlers do not make CPU-heavy loops nonblocking.

**Why:** A duplicate-review request occupied the shared API event loop for over 100 seconds, delaying dashboard interactions and even authentication refresh, although ordinary dashboard reads took only a few hundred milliseconds.

**How to apply:** Measure against the full saved history, not just the visible page. Prune impossible pairs without weakening identity evidence or exception rules, and bound uninterrupted CPU work using cooperative batches or workers. Avoid retriggering reviews on score-only refreshes or reason-only edits.

Description retrieval must follow conservative identity/employer prerequisites; missing description evidence is not evidence that jobs are distinct. Prefer the canonical identity policy over approximate SQL URL or employer normalization.

**Why:** Unicode employer names, provider URL aliases, and verified original URLs can identify off-page or cross-employer matches. Independently approximating those rules in SQL risks silent warning loss.

**How to apply:** Keep candidate pruning on the same policy path as final comparisons. If replacing the compact metadata scan with stored lookup keys, version and backfill keys using the canonical policy and verify warning equivalence before switching readers.
