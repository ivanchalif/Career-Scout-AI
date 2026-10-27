---
name: Dismissal dialog behavior
description: Dismissal now uses a persistent dialog; timing cautions apply to other interactive toasts.
---

Dismissal uses a persistent centered dialog like the applied prompt, not an expiring notification. Reasons remain optional, and Undo must remain usable while the dialog is open.

**Why:** The user asked for the dismissed modal to work like the applied modal, superseding the earlier three-second dismissal-toast behavior.

**How to apply:** Keep the prompt mounted above job cards and routes so removing a job or leaving its detail page cannot close it. Close only on user action or successful Undo; retain the latest Undo token after changing reasons.

For other interactive toasts, do not assume that increasing a Radix toast's duration alone pauses it.

**Why:** Browser testing showed that a portaled menu moves focus outside the toast viewport. Radix can resume its previously captured remaining time despite a longer duration, closing both the toast and the open menu.

**How to apply:** If an interactive toast is used elsewhere, control automatic dismissal during interactive holds and restart the ordinary expiry after the hold ends. Avoid a second independent timer that bypasses these holds.