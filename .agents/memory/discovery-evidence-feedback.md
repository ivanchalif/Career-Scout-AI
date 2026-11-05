---
name: Discovery evidence and feedback
description: Product constraints for availability, posting dates, and personalized online discovery.
---

Missing evidence must not become a confident fact: query words cannot establish a job's location, a readable generic page does not establish Open, and discovery time is not the posting date. Blocked, gated, or ambiguous pages remain Unverified.

**Why:** The requested search improvements prioritize trustworthy results over apparently complete metadata. A false certainty can hide eligible jobs or show unavailable ones.

**How to apply:** Prefer listing-specific evidence when available, retain uncertain results with clear labeling and lower confidence, and exclude new listings only for confirmed closure or known profile mismatches.

Freshness and relevance feedback are ranking preferences, not permission to create broad exclusions. Already closed applies to that specific listing; Undo must remove the future-search signal. Preserve configured sources and saved history.

**Why:** The user requested personalization without a single feedback click silently excluding whole roles, regions, or companies; undated postings remain eligible.

**How to apply:** Keep feedback adjustments modest and reversible, rank using final page facts, and do not introduce historical mass-rechecks or provider changes without a separate request.

Dismissal alone is not negative match feedback. Reasons are optional and coupled to dismissal; reversing a dismissal must restore the prior preference rather than simply erase the latest reason.

**Why:** The user approved reducing cognitive load by making removal a one-click action and asking for a reason only when the user wants to provide one. An accidental removal must not alter future matches permanently.

**How to apply:** Keep ordinary dismissals neutral, preserve job content for recovery, and treat Undo as reversal of the entire dismissal operation.

Dismissal choices and labels must be uniform across every marking entry point, before and after dismissal, including duplicate-review shortcuts.

**Why:** The user clarified that the post-dismissal reason picker is included, then reiterated that reasons should be uniform across all ways of marking. Fixing only the overflow menu or a single missing option is insufficient.

**How to apply:** Treat all reason pickers as first-class entry points with the same choices, ordering and labels. Avoid synonymous closed options with different side effects. Duplicate marking must preserve dismissal Undo, job content and prior feedback rather than invoking irreversible cleanup through a shortcut.

Learning from job responses must apply consistently to future email and online imports. Applications and explicit likes are positive examples; generic dismissals and duplicate reports suppress repeated listings without implying dislike of the role or company. Filtering a broader pattern requires repeated independent, specific negative responses, with matching positive evidence preventing that exclusion.

**Why:** The user requested using applied, dismissed, duplicate, and other responses to improve future filtering. A neutral action or mirrored listing must not accidentally eliminate relevant opportunities.

**How to apply:** Derive signals from current saved actions so Undo and unapply remain effective. Keep adjustments bounded and separate from AI capability scores, show explanations, audit filtered email jobs, and do not retroactively remove saved jobs. Workday feedback requires a known Workday listing URL, not a textual guess.

Marking a job as applied must offer, not automatically save, an additional “More like this” preference.

**Why:** The user explicitly requested a separate optional choice after applying; applying and explicit preference are distinct responses.

**How to apply:** Prompt only after the application status is successfully saved, skip an existing explicit like, and keep applied status intact when the user declines, closes the prompt, or preference saving fails. Removing applied status must not silently remove an explicit like.

Workday exclusion is a reversible visibility preference, not an import ban.

**Why:** The user explicitly chose to hide current and future Workday jobs while keeping them recoverable, rather than skipping future imports.

**How to apply:** Retain detected Workday listings for review in Filtered and allow inclusion again through the saved dashboard filter. Do not let Workday dismissal history alone suppress imports; it may still affect ranking. Unknown ATS links remain eligible rather than guessing from a company name or a mention of Workday.

Discovery should make bounded progress beyond repeated search results, not relax eligibility or weaken duplicate protection to increase import counts.

**Why:** The user reported repeated runs returning previously processed listings and approved broader coverage plus accurate reporting. Unlimited requests would increase cost without guaranteeing eligible jobs.

**How to apply:** Persist per-user search progress across restarts, include a date-unrestricted fallback for undated listings, and distinguish saved listings, repeated results, real exclusions, temporary history skips, and budget deferrals. Rejection history must expire and invalidate when relevant preferences or feedback change; network failures must never become cached mismatches.

Sparse discovery searches should broaden retrieval terms within the same source, not only remove the date constraint or advance the page. Keep actual eligibility decisions in the posting-screening stage.

**Why:** Live validation found healthy search providers returning no results for exact senior titles combined with the exact phrase "SF Bay Area"; broader same-source queries returned candidates. The user approved this correction without relaxing eligibility or duplicate checks.

**How to apply:** Preserve the source site and explicit exclusions, use broader role terms without exact geographic phrases when focused results are thin or already known, and keep the existing bounded request budget. Validate retrieval separately from importing so checking source health does not modify jobs.

Configured source links that represent collections of jobs must yield their individual postings; a company board or category page is not itself a job.

**Why:** The user requested extraction support for all online sources whose links need page parsing, after validation exposed a listing page being treated as an empty feed.

**How to apply:** Route feeds, structured HTML, and known board links through appropriate parsers, expand search-result listing pages within a bounded budget, reject job redirects to known category pages, and report blocked or unsupported formats explicitly instead of returning a misleading empty success.

Check content negotiation and public page bootstrap data before treating a listing page as blocked or requiring browser automation.

**Why:** A public source returned HTTP 406 for JSON-preferred requests but HTTP 200 for HTML requests; its jobs were embedded in escaped page data rather than visible anchors.

**How to apply:** Request the source's supported representation, inspect public embedded job records when server-rendered links are absent, and distinguish genuine authentication gates from unsupported response formats. Do not reconstruct jobs from sign-in URLs.

Source health measures usable additions, authentic posting recency, and applied/dismissed outcomes—not raw retrieval volume or HTTP success alone.

**Why:** The user explicitly requested red/yellow/green source health based on added jobs, excluding filtered/excluded results, plus latest-search and total addition counts.

**How to apply:** Credit only the original importing source, not duplicate sightings. Preserve unknown posting dates and untracked historical per-search counts as unknown rather than substituting import dates or zero. Keep the health explanation visible so technical retrieval success is not confused with useful results.

Search-backed sources share one provider quota; automatic recovery must coordinate across sources rather than retry each source independently.

**Why:** Parallel discovery searches produced HTTP 429 for an otherwise working Lever source. Additional per-source concurrency or retries would increase the same shared rate pressure.

**How to apply:** Pace requests through the shared search connection, respect Retry-After, bound retries and queue waits, and record successful recovery separately from remaining failures. Never repair low yield by weakening user filters or making posting dates appear fresher.

The user's location rule allows ANY SF Bay Area role (on-site, hybrid, or remote), ANY fully remote role anywhere, and genuinely unknown locations. Known non-local locations require explicit remote eligibility even when the work-arrangement field is blank.

**Why:** After correcting the initial overly strict filter, known non-local roles still appeared because blank work arrangements were treated as uncertainty. The user explicitly chose to require remote evidence for known non-local jobs.

**How to apply:** Recognize Bay Area cities as well as regional labels; distinguish unknown location from unknown remote eligibility at a known outside location. Apply the reversible rule to existing and future postings and dashboard counts, and retain hidden jobs in Filtered with a reason. Do not delete jobs, infer location from headquarters, or treat a hybrid role's remote days as fully remote.