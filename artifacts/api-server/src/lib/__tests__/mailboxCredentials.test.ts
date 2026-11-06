import { describe, expect, it } from "vitest";
import { decryptMailboxPassword, encryptMailboxPassword, validateMailboxTarget } from "../mailboxCredentials";

describe("mailbox credentials", () => {
  it("encrypts with account-bound authentication", () => {
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "test-only-secret-not-used-in-app";
    try {
      const encrypted = encryptMailboxPassword("example", "owner");
      expect(encrypted).not.toContain("example");
      expect(decryptMailboxPassword(encrypted, "owner")).toBe("example");
      expect(() => decryptMailboxPassword(encrypted, "other")).toThrow();
    } finally {
      if (original === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = original;
    }
  });
  it("rejects non-TLS and nonpublic targets before opening a socket", async () => {
    await expect(validateMailboxTarget("127.0.0.1", 993, true)).rejects.toThrow();
    await expect(validateMailboxTarget("mail.example.org", 143, true)).rejects.toThrow();
    await expect(validateMailboxTarget("mail.example.org", 993, false)).rejects.toThrow();
  });
});
