---
name: Gmail mark-as-read guard
description: Why extractJobListings returns a discriminated union and when markEmailAsRead must NOT be called
---

## Rule
`extractJobListings` returns `{ listings: ExtractedJobListing[], hadError: boolean }`.
Call `markEmailAsRead` only when `!hadError`. When `hadError: true`, skip the call so the email stays unread and is automatically retried on the next sync (which uses `is:unread` as its Gmail query).

## Why
The original code always called `markEmailAsRead` after processing each email, even when the OpenAI API call threw (bad model name, rate limit, network error). Once marked read, the email disappeared from future `is:unread` queries permanently. This silently swallowed all extraction errors and lost job postings.

## How to apply
- `gmailScheduler.ts`: `if (!hadError) { await markEmailAsRead(...) }`
- `gmail.ts` manual sync route: same pattern
- `/api/gmail/reprocess` endpoint: handles its own mark-as-read after successful import
- If you add a new email-processing path, always guard `markEmailAsRead` with `!hadError`

Mailbox acknowledgment is separate from successful job processing. Retry a failed read/archive update even when extraction is already complete, and never silently treat a Gmail modification error as success.

**Why:** Completed alerts were skipped on subsequent syncs after label updates failed, leaving them unread or in Inbox indefinitely.

**How to apply:** Preserve a durable pending mailbox action until Google acknowledges it. Only successfully processed job alerts may be marked read and archived; leave incomplete extraction, blocked unrelated messages, and application responses untouched. Do not blanket-archive historical mail or override a message deliberately returned to Inbox after acknowledgment.
