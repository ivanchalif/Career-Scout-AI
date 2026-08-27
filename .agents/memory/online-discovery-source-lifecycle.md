---
name: Online discovery source lifecycle
description: Durable behavior rules for built-in and custom online job source management.
---

Online discovery supports both a built-in catalog and user-added public HTTPS RSS, Atom, or JSON job feeds. A source is seeded only once for a user; removing it must not cause it to reappear automatically.

Suppressing a source pauses future discovery while keeping its configuration and history available to restore. Removing a source deletes only that per-user configuration and preserves all previously imported jobs and their provenance.

Custom feeds must stay publicly reachable: reject non-HTTPS and private-network URLs, validate resolved hosts before fetching, and validate every redirect target.

Google Search URLs are saved as the user supplied them, but their query text is executed through Brave Search because Google blocks unattended server requests. Keep the UI explicit about this distinction and preserve Google query operators unchanged.

**Why:** Users need reversible control over noisy sources without losing their saved job history, arbitrary feed URLs create SSRF risk, and silently scraping Google would create an unreliable source that often returns no jobs.

**How to apply:** New catalog adapters should use the same lifecycle. Never cascade a source configuration delete into job postings or provenance records. Search adapters should enrich direct job pages before final screening and scoring.