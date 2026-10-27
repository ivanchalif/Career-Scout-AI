---
name: Safe interaction regressions
description: Why decision-control regression tests isolate identity and network boundaries.
---

Prefer credential-free UI integration tests for repeatable decision-control coverage, paired with real server-handler tests. Keep production components, hooks, query caches, and route navigation under test; substitute identity and HTTP at the boundary, not the behavior being tested.

**Why:** The dismissal coverage was requested to protect an already verified interaction using test-owned postings and accounts. Shared saved logins make repeatability depend on credentials and risk modifying unrelated jobs or invoking paid AI scoring.

**How to apply:** Keep test identity substitutions out of production configuration. Give each test its own account and data, block unexpected service calls, and clearly distinguish simulated persistence from live database verification. Use a separate live-service test only when the integration boundary itself needs verification.
