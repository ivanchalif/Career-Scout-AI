---
name: Online discovery source lifecycle
description: Durable behavior rules for built-in and custom online job source management.
---

Online discovery supports both a built-in catalog and user-added public HTTPS RSS, Atom, or JSON job feeds. A source is seeded only once for a user; removing it must not cause it to reappear automatically.

Suppressing a source pauses future discovery while keeping its configuration and history available to restore. Removing a source deletes only that per-user configuration and preserves all previously imported jobs and their provenance.

Custom feeds must stay publicly reachable: reject non-HTTPS and private-network URLs, validate resolved hosts before fetching, and validate every redirect target.

Google Search URLs are saved as the user supplied them, but their query text is executed through Brave Search because Google blocks unattended server requests. Keep the UI explicit about this distinction and preserve Google query operators unchanged.

For web listings, never apply email-envelope include criteria such as sender allowlists or generic subject terms. Reuse blocked-body exclusions only; source queries plus profile role, skill, location, and company criteria decide inclusion.

Treat “San Francisco” and “SF Bay Area” as equivalent locations. HiringCafe URLs are dynamic result pages, not feeds; consume their server-rendered job records through the dedicated adapter.

**Why:** Users need reversible control over noisy sources without losing their saved job history, arbitrary feed URLs create SSRF risk, and silently scraping Google would create an unreliable source. Email senders and alert wording do not exist on direct web jobs and previously rejected every valid result.

**How to apply:** New catalog adapters should use the same lifecycle. Never cascade a source configuration delete into job postings or provenance records. Search adapters should enrich direct job pages before final screening and scoring.