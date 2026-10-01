---
name: Interactive toast timing
description: Keep optional dismissal-reason controls usable while a portaled menu is open.
---

Interactive dismissal notifications must not expire while their reason menu is open or a mutation is pending. Do not assume that increasing a Radix toast's duration alone pauses it.

**Why:** Browser testing showed that a portaled menu moves focus outside the toast viewport. Radix can resume its previously captured remaining time despite a longer duration, closing both the toast and the open menu.

**How to apply:** Keep automatic dismissal controlled during interactive holds and restart the ordinary expiry after the hold ends. Avoid a second independent timer that bypasses these holds. Verify with a deliberate wait longer than the ordinary timeout.