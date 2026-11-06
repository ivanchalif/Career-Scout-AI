---
name: Mailbox credential key rotation
description: Operational constraint when changing the key that protects saved IMAP credentials.
---

Keep the mailbox encryption key stable across deployments. If the session secret must be rotated, plan a separate credential re-encryption or reconnection flow before replacing it.

**Why:** Saved mailbox passwords are authenticated with a key derived from the session secret; old ciphertext cannot be recovered if the old secret is lost. A normal app restart with the same secret is safe.

**How to apply:** Do not silently rotate or replace the session secret as a routine deployment step. For an intentional rotation, protect existing mailbox connectivity through a migration while the old secret is still available, or ask affected users to reconnect.
