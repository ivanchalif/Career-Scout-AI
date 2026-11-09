---
name: Duplicate identity policy
description: Evidence required for duplicate handling and the distinction between similar roles and the same opening.
---

Identical job titles and companies now qualify for automatic duplicate classification without user review. Equality ignores case and whitespace, not specialty, seniority, or punctuation. Verified individual-job identity remains an independent duplicate signal; fuzzy title/company resemblance alone is insufficient.

**Why:** The user explicitly changed the policy on 2026-11-08: identical titles and companies should be marked automatically; discrepancies such as title or role scope should be reviewed. The earlier rejection of the Uber/Cultura comparison still prohibits cross-employer fuzzy matches.

**How to apply:** Preserve seniority, specialty, team, location, known requisition, and substantial description discrepancies for review. Missing employer identity cannot establish equality. Generic careers URLs are not listing identities. Automatically classify existing exact copies recoverably in Filtered, retain one stable active original, honor pair exceptions, and keep saved applied/dismissed history intact. Apply the same comparison policy to future imports.

“Not a duplicate” applies to the specific unordered pair and must persist per user; it must not suppress all comparisons involving either job.

**Why:** The user approved persistent pair-specific feedback rather than temporary page-state dismissal.

**How to apply:** Check pair exceptions in suggestions and cleanup, save only owned pairs, and show successful persistence only after the server confirms it.

Do not retroactively restore or remove historical jobs as part of deploying duplicate-policy improvements.

**Why:** The approved implementation explicitly excluded automatic historical restoration or deletion.

**How to apply:** Do not trigger a historical cleanup on page load or scheduled sync. Historical auditing/restoration requires a separate user decision; explicit cleanup and action-triggered matching must still require listing identity and preserve content.

Hide confirmed copies of applied/dismissed jobs through reversible visibility filtering rather than automatically changing the copies' saved lifecycle.

**Why:** The user explicitly approved fixing duplicate-filtering gaps “without changing history.” Secondary auto-deletions also make undoing the original action incomplete.

**How to apply:** Keep the applied/dismissed records and their copies intact. Expose hidden copies and their evidence in Filtered; pair-specific exceptions or undoing the anchor action restore visibility. Only an explicit cleanup selection may change additional records.

Aggregator metadata identifiers are not automatically employer requisitions. Treat a bare JSON-LD identifier as uncertain unless its issuer and employer scope are established.

**Why:** Aggregators can assign their own IDs, and unrelated employers can reuse the same requisition number. A matching identifier value alone would silently discard distinct openings.

**How to apply:** Prefer checked individual-posting redirects, recognized employer-scoped ATS URLs, or original-posting metadata tied to an explicit hiring-organization website. Conflicting metadata and blocked pages must not promote a redirect destination into verified identity. Keep provider provenance and prior verified evidence without rewriting lifecycle history.
