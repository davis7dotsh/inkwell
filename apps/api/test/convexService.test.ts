import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { ConvexService, type ConvexServiceShape } from "../src/convexService";
import { makeRequestLayer, runRequestEffect } from "../src/requestContext";
import { TEST_ENV, fetchQueue, jsonResponse } from "./helpers";

const call = <A>(
  fetchImpl: typeof fetch,
  operation: (service: ConvexServiceShape) => Effect.Effect<A, unknown>,
) =>
  runRequestEffect(
    Effect.flatMap(ConvexService, operation),
    makeRequestLayer({
      env: { ...TEST_ENV, MEMOS: {} as R2Bucket },
      userId: "user_1",
      executionCtx: { waitUntil: () => undefined },
      fetchImpl,
    }),
  );

describe("convexService", () => {
  it("posts createPending with shared-secret auth", async () => {
    const { impl, calls } = fetchQueue([jsonResponse({ articleId: "art42" })]);
    const args = {
      userId: "user_1",
      url: "https://example.com/a",
      kind: "web" as const,
      title: "https://example.com/a",
      savedAt: 1717900000000,
    };

    const result = await call(impl, (service) => service.createPending(args));

    expect(result).toEqual({ articleId: "art42" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${TEST_ENV.CONVEX_SITE_URL}/ingest/create-pending`,
    );
    expect(calls[0].headers["x-inkwell-key"]).toBe(
      TEST_ENV.WORKER_SHARED_SECRET,
    );
    expect(calls[0].headers["content-type"]).toBe("application/json");
    expect(calls[0].body).toEqual(args);
  });

  it("uses the ingest routes for complete and fail", async () => {
    const { impl, calls } = fetchQueue([
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }),
    ]);

    await call(impl, (service) =>
      service.complete({
        articleId: "art1",
        expectedUserId: "user_test",
        title: "T",
        blocksJson: "[]",
      }),
    );
    await call(impl, (service) =>
      service.fail({
        articleId: "art1",
        expectedUserId: "user_test",
        error: "boom",
      }),
    );

    expect(calls[0].url).toBe(`${TEST_ENV.CONVEX_SITE_URL}/ingest/complete`);
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
        pinned: false,
        tags: ["tag1"],
      },
    ];
    const { impl, calls } = fetchQueue([jsonResponse({ articles })]);

    await expect(
      call(impl, (service) =>
        service.listArticles({ userId: "user_1", limit: 10 }),
      ),
    ).resolves.toEqual(articles);
    expect(calls[0].url).toBe(
      `${TEST_ENV.CONVEX_SITE_URL}/agent/articles?userId=user_1&limit=10`,
    );
    expect(calls[0].headers["x-inkwell-key"]).toBe(
      TEST_ENV.WORKER_SHARED_SECRET,
    );
  });

  it("joins tagIds into a comma-separated filter param", async () => {
    const { impl, calls } = fetchQueue([jsonResponse({ articles: [] })]);

    await call(impl, (service) =>
      service.listArticles({
        userId: "user_1",
        tagIds: ["tag1", "tag2"],
      }),
    );

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/agent/articles");
    expect(url.searchParams.get("userId")).toBe("user_1");
    expect(url.searchParams.get("tagIds")).toBe("tag1,tag2");
  });

  it("omits the tagIds param when no tags are given", async () => {
    const { impl, calls } = fetchQueue([jsonResponse({ articles: [] })]);

    await call(impl, (service) =>
      service.listArticles({ userId: "user_1", tagIds: [] }),
    );

    expect(new URL(calls[0].url).searchParams.has("tagIds")).toBe(false);
  });

  it("reads tags from the agent route", async () => {
    const tags = [
      { id: "tag1", name: "AI", color: "#f00", createdAt: 1 },
      { id: "tag2", name: "Rust", createdAt: 2 },
    ];
    const { impl, calls } = fetchQueue([jsonResponse({ tags })]);

    await expect(
      call(impl, (service) => service.listTags({ userId: "user_1" })),
    ).resolves.toEqual(tags);
    expect(calls[0].url).toBe(
      `${TEST_ENV.CONVEX_SITE_URL}/agent/tags?userId=user_1`,
    );
    expect(calls[0].headers["x-inkwell-key"]).toBe(
      TEST_ENV.WORKER_SHARED_SECRET,
    );
  });

  it("creates a tag and returns the echoed row", async () => {
    const { impl, calls } = fetchQueue([
      jsonResponse({ tag: { id: "tag1", name: "AI", color: "#f00" } }),
    ]);

    await expect(
      call(impl, (service) =>
        service.createTag({
          userId: "user_1",
          name: "AI",
          color: "#f00",
        }),
      ),
    ).resolves.toEqual({ id: "tag1", name: "AI", color: "#f00" });
    expect(calls[0].url).toBe(`${TEST_ENV.CONVEX_SITE_URL}/agent/tags/create`);
    expect(calls[0].body).toEqual({
      userId: "user_1",
      name: "AI",
      color: "#f00",
    });
  });

  it("posts tag and article mutations to their write routes", async () => {
    const { impl, calls } = fetchQueue([
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }),
    ]);

    await call(impl, (service) =>
      Effect.all(
        [
          service.renameTag({
            userId: "user_1",
            tagId: "tag1",
            name: "ML",
          }),
          service.removeTag({ userId: "user_1", tagId: "tag1" }),
          service.addTagToArticle({
            userId: "user_1",
            articleId: "art1",
            tagId: "tag1",
          }),
          service.removeTagFromArticle({
            userId: "user_1",
            articleId: "art1",
            tagId: "tag1",
          }),
          service.setArticlePinned({
            userId: "user_1",
            id: "art1",
            pinned: true,
          }),
        ],
        { concurrency: 1, discard: true },
      ),
    );

    expect(calls.map((c) => c.url)).toEqual([
      `${TEST_ENV.CONVEX_SITE_URL}/agent/tags/rename`,
      `${TEST_ENV.CONVEX_SITE_URL}/agent/tags/remove`,
      `${TEST_ENV.CONVEX_SITE_URL}/agent/article-tags/add`,
      `${TEST_ENV.CONVEX_SITE_URL}/agent/article-tags/remove`,
      `${TEST_ENV.CONVEX_SITE_URL}/agent/article/pin`,
    ]);
    expect(calls[4].body).toEqual({
      userId: "user_1",
      id: "art1",
      pinned: true,
    });
  });

  it("returns null for missing articles", async () => {
    const missing = new Response("not found", { status: 404 });
    const { impl } = fetchQueue([missing]);

    await expect(
      call(impl, (service) =>
        service.getArticle({ userId: "user_1", id: "missing" }),
      ),
    ).resolves.toBeNull();
    expect(missing.bodyUsed).toBe(true);
  });

  it("surfaces Convex HTTP-action failures", async () => {
    const { impl } = fetchQueue([jsonResponse({ error: "forbidden" }, 403)]);

    await expect(
      call(impl, (service) =>
        service.fail({
          articleId: "art1",
          expectedUserId: "user_test",
          error: "boom",
        }),
      ),
    ).rejects.toThrow(/forbidden/);
  });
});
