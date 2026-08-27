import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  onlineDiscoverySourcesTable: {
    id: {},
    userId: {},
  },
  userProfilesTable: {
    userId: {},
  },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId?: string }).userId = "test-user-id";
    next();
  },
}));

vi.mock("../../lib/onlineDiscovery", () => ({
  DiscoveryProfileRequiredError: class DiscoveryProfileRequiredError extends Error {},
  getOnlineDiscoverySources: vi.fn(),
  ONLINE_SOURCE_CATALOG: [
    {
      provider: "arbeitnow",
      name: "Arbeitnow",
      url: "https://www.arbeitnow.com/api/job-board-api",
    },
  ],
  prepareCustomSourceInput: vi.fn((name: string, url: string) => {
    if (url.includes("127.0.0.1")) {
      throw new Error("Source URL must point to a public HTTPS host.");
    }
    return {
      provider: url.includes("google.com/search") ? "brave" : "custom",
      name: name.trim() || "example.com",
      url,
      kind: url.includes("google.com/search") ? "search" : "custom",
    };
  }),
  runOnlineDiscovery: vi.fn(),
  toDiscoveryStatus: vi.fn(),
}));

import { db } from "@workspace/db";
import onlineDiscoveryRouter from "../onlineDiscovery";

const source = {
  id: 12,
  userId: "test-user-id",
  provider: "custom",
  name: "Original feed",
  url: "https://example.com/jobs.json",
  kind: "custom" as const,
  isSuppressed: false,
  createdAt: new Date("2026-08-01T12:00:00Z"),
  updatedAt: new Date("2026-08-01T12:00:00Z"),
};

function selectRows(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  };
}

function updateResult(result: unknown[] | Error) {
  const returning = vi.fn().mockImplementation(() => (
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  ));
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { chain: { set }, set };
}

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(onlineDiscoveryRouter);
  return instance;
}

describe("PATCH /online-discovery/sources/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectRows([source]));
  });

  it("renames a built-in source without changing its provider or URL", async () => {
    const builtin = {
      ...source,
      provider: "arbeitnow",
      name: "Arbeitnow",
      url: "https://www.arbeitnow.com/api/job-board-api",
      kind: "builtin" as const,
    };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectRows([builtin]));
    const updated = { ...builtin, name: "International jobs", updatedAt: new Date() };
    const update = updateResult([updated]);
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(update.chain);

    const response = await request(app())
      .patch("/online-discovery/sources/12")
      .send({ name: "  International jobs  " });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("International jobs");
    expect(update.set).toHaveBeenCalledWith(expect.objectContaining({
      name: "International jobs",
    }));
    expect(update.set).not.toHaveBeenCalledWith(expect.objectContaining({
      provider: expect.anything(),
      url: expect.anything(),
    }));
  });

  it("updates a custom URL and safely re-derives its source kind", async () => {
    const updated = {
      ...source,
      provider: "brave",
      name: "Leadership search",
      url: "https://www.google.com/search?q=site%3Alever.co+Head+of+Product",
      kind: "search" as const,
      updatedAt: new Date(),
    };
    const update = updateResult([updated]);
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(update.chain);

    const response = await request(app())
      .patch("/online-discovery/sources/12")
      .send({
        name: "Leadership search",
        url: "https://www.google.com/search?q=site%3Alever.co+Head+of+Product",
      });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("search");
    expect(update.set).toHaveBeenCalledWith(expect.objectContaining({
      provider: "brave",
      name: "Leadership search",
      kind: "search",
    }));
  });

  it("rejects an unsafe replacement URL before changing the source", async () => {
    const response = await request(app())
      .patch("/online-discovery/sources/12")
      .send({ url: "https://127.0.0.1/jobs.json" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("public HTTPS host");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects URL edits for built-in sources", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectRows([{
      ...source,
      provider: "arbeitnow",
      kind: "builtin",
    }]));

    const response = await request(app())
      .patch("/online-discovery/sources/12")
      .send({ url: "https://example.com/replacement.json" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Built-in source URLs cannot be changed.");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("returns a conflict without replacing an existing duplicate source", async () => {
    const conflict = Object.assign(new Error("duplicate"), { code: "23505" });
    const update = updateResult(conflict);
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(update.chain);

    const response = await request(app())
      .patch("/online-discovery/sources/12")
      .send({ name: "Duplicate feed", url: "https://duplicate.example/jobs.json" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("This source is already configured.");
  });

  it("rejects empty updates and sources not owned by the user", async () => {
    const emptyResponse = await request(app())
      .patch("/online-discovery/sources/12")
      .send({});
    expect(emptyResponse.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();

    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(selectRows([]));
    const missingResponse = await request(app())
      .patch("/online-discovery/sources/99")
      .send({ name: "Missing" });
    expect(missingResponse.status).toBe(404);
  });
});