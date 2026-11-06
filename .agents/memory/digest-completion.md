---
name: Digest completion versus listing progress
description: Why partial Gmail listing keys must not mark a whole message complete.
---

A per-listing import marker or saved posting does not prove the whole email digest was processed. Only a terminal, successfully completed message outcome may suppress that email on subsequent syncs.

**Why:** A failed digest can import its first listing, then fail on the next one. Treating any listing key as “email seen” loses the remaining jobs permanently, even if the email stays unread.

**How to apply:** Keep per-listing imports idempotent, retry incomplete messages, and mark a message complete only after all its listings reach a durable outcome. Extraction errors must not mark read or complete.
