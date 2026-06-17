import { describe, expect, it } from "vitest";

import { createConvexService } from "../src/convexService";
import { TEST_ENV, fetchQueue, jsonResponse } from "./helpers";

describe("convexService", () => {
  it("posts createPending with shared-secret auth", async () => {
    const { impl, calls } = fetchQueue([
      jsonResponse({ articleId: "art42" }),
    ]);
    const service = createConvexService(impl, TEST_ENV);
    const args = {
      userId: "user_1",
      url: "https://example.com/a",
      kind: "web" as const,
      title: "https://example.com/a",
      savedAt: 1717900000000,
    };

    const result = await service.createPending(args);

    expect(result).toEqual({ articleId: "art42" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${TEST_ENV.CONVEX_SITE_URL}/ingest/create-pending`
    );
    expect(calls[0].headers["x-inkwell-key"]).toBe(
      TEST_ENV.WORKER_SHARED_SECRET
    );
    expect(calls[0].headers["content-type"]).toBe("application/json");
    expect(calls[0].body).toEqual(args);
  });

  it("uses the ingest routes for complete and fail", async () => {
    const { impl, calls } = fetchQueue([
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }),
    ]);
    const service = createConvexService(impl, TEST_ENV);

    await service.complete({
      articleId: "art1",
      expectedUserId: "user_test",
      title: "T",
      blocksJson: "[]",
    });
    await service.fail({
      articleId: "art1",
      expectedUserId: "user_test",
      error: "boom",
    });

    expect(calls[0].url).toBe(
      `${TEST_ENV.CONVEX_SITE_URL}/ingest/complete`
    );
    expect(calls[1].url).toBe(`${TEST_ENV.CONVEX_SITE_URL}/ingest/fail`);
    expect(calls[1].body).toEqual({
      articleId: "art1",
      expectedUserId: "user_test",
      error: "boom",
    });
  });

  it("uses the agent read route and preserves typed results", async () => {
    const articles = [
      {
        id: "art1",
        url: "https://example.com",
        kind: "web" as const,
        status: "ready" as const,
        title: "Example",
        savedAt: 1,
        readStatus: "unread" as const,
      },
    ];
    const { impl, calls } = fetchQueue([
      jsonResponse({ articles }),
    ]);
    const service = createConvexService(impl, TEST_ENV);

    await expect(
      service.listArticles({ userId: "user_1", limit: 10 })
    ).resolves.toEqual(articles);
    expect(calls[0].url).toBe(
      `${TEST_ENV.CONVEX_SITE_URL}/agent/articles?userId=user_1&limit=10`
    );
    expect(calls[0].headers["x-inkwell-key"]).toBe(
      TEST_ENV.WORKER_SHARED_SECRET
    );
  });

  it("returns null for missing articles", async () => {
    const { impl } = fetchQueue([
      new Response("not found", { status: 404 }),
    ]);
    const service = createConvexService(impl, TEST_ENV);

    await expect(
      service.getArticle({ userId: "user_1", id: "missing" })
    ).resolves.toBeNull();
  });

  it("surfaces Convex HTTP-action failures", async () => {
    const { impl } = fetchQueue([
      jsonResponse({ error: "forbidden" }, 403),
    ]);
    const service = createConvexService(impl, TEST_ENV);

    await expect(
      service.fail({
        articleId: "art1",
        expectedUserId: "user_test",
        error: "boom",
      })
    ).rejects.toThrow(/forbidden/);
  });
});
