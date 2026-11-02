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