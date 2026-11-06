---
name: Duplicate identity policy
description: Evidence required for duplicate handling and the distinction between similar roles and the same opening.
---

Automatic duplicate blocking or removal requires proof of the same individual listing: an individual-job URL or an employer-scoped ATS requisition ID. Title/company resemblance is not proof. Same-employer jobs with supporting details may be offered for review; different employers require verified shared listing identity, not fuzzy company matching.

**Why:** The user rejected a comparison between Uber's Senior Product Manager – Uber Parcel and Cultura Technologies' Product Manager, then approved stricter identity-based rules. Generic Product Manager titles and the shared word Technologies must not make different openings duplicates.

**How to apply:** Preserve seniority, specialty, team, and location differences. Generic careers or collection URLs are not listing identities. Use the same policy for review suggestions, import suppression, and cleanup. Preserve descriptions and reversible state when removing confirmed copies.

“Not a duplicate” applies to the specific unordered pair and must persist per user; it must not suppress all comparisons involving either job.

**Why:** The user approved persistent pair-specific feedback rather than temporary page-state dismissal.

**How to apply:** Check pair exceptions in suggestions and cleanup, save only owned pairs, and show successful persistence only after the server confirms it.

Do not retroactively restore or remove historical jobs as part of deploying duplicate-policy improvements.

**Why:** The approved implementation explicitly excluded automatic historical restoration or deletion.

**How to apply:** Do not trigger a historical cleanup on page load or scheduled sync. Historical auditing/restoration requires a separate user decision; explicit cleanup and action-triggered matching must still require listing identity and preserve content.

Hide confirmed copies of applied/dismissed jobs through reversible visibility filtering rather than automatically changing the copies' saved lifecycle.

**Why:** The user explicitly approved fixing duplicate-filtering gaps “without changing history.” Secondary auto-deletions also make undoing the original action incomplete.

**How to apply:** Keep the applied/dismissed records and their copies intact. Expose hidden copies and their evidence in Filtered; pair-specific exceptions or undoing the anchor action restore visibility. Only an explicit cleanup selection may change additional records.
