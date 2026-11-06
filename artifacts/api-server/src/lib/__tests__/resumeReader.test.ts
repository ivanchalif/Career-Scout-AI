import { describe, expect, it } from "vitest";
import { resumeObjectPath } from "../resumeReader";
import { retryDelay } from "../scoringQueue";

describe("resume references", () => {
  it("accepts owned-storage paths only", () => {
    expect(resumeObjectPath("/api/storage/objects/uploads/abc-123")).toBe("/objects/uploads/abc-123");
    expect(() => resumeObjectPath("http://localhost:8080/admin")).toThrow();
    expect(() => resumeObjectPath("/api/storage/objects/../private")).toThrow();
  });
  it("bounds scoring retry delay", () => {
    expect(retryDelay(1)).toBe(60_000);
    expect(retryDelay(8)).toBe(900_000);
  });
});
