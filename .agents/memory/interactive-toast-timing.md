---
name: Dismissal dialog behavior
description: Shared modal inactivity timing, duplicate shortcut exception, and portaled interaction safeguards.
---

All app modals auto-dismiss after three seconds without activity, or two seconds of pointer activity outside the modal. Inside keyboard/touch activity resets inactivity; saves in flight pause automatic closing. Ordinary dismissal remains a centered dialog with optional reasons and Undo.

**Why:** The user explicitly requested shared automatic timing for all modals, superseding the earlier persistent-dialog behavior.

**How to apply:** Use the shared modal timing rather than per-page timers. Count owned portaled menus as inside, do not extend the outside deadline for continued outside movement, preserve form drafts on timeout, and retain the latest Undo token after changing reasons.

Keep dialog-owned dropdowns modal even when standalone action menus use non-modal behavior.

**Why:** Making every dropdown non-modal broke repeated dismissal-reason selection: after one saved reason, the next menu would not stay available. The focused browser regression passed after retaining modal behavior inside dialogs.

**How to apply:** Derive the default from modal ownership, preserve explicit overrides, and test consecutive reason changes plus Undo. Every portaled selection surface must also inherit its modal owner for inactivity timing.

Dismissal choices must be uniform across entry points and ordered alphabetically by their displayed labels.

**Why:** The user explicitly requested both consistent choices in every dismissal flow and alphabetical ordering when extending the reasons.

**How to apply:** Keep additions in the shared list and API contract, preserve readable labels for stored feedback, and verify both initial dismissal and later reason changes accept each new option.

Explicitly flagging a possible duplicate skips the dismissal reason dialog; save the Duplicate reason directly and offer a non-modal Undo confirmation. Ordinary dismissals retain the reason dialog with shared automatic timing.

**Why:** The user already confirmed the duplicate reason through that action and explicitly asked not to be prompted for it again.

**How to apply:** Apply this exception in the shared dismissal flow so duplicate shortcuts remain consistent without losing reversible dismissal or error handling.

For other interactive toasts, do not assume that increasing a Radix toast's duration alone pauses it.

**Why:** Browser testing showed that a portaled menu moves focus outside the toast viewport. Radix can resume its previously captured remaining time despite a longer duration, closing both the toast and the open menu.

**How to apply:** If an interactive toast is used elsewhere, control automatic dismissal during interactive holds and restart the ordinary expiry after the hold ends. Avoid a second independent timer that bypasses these holds.