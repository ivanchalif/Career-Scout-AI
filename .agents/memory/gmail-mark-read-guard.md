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
