import { describe, expect, it } from "vitest";

import { createConvexService } from "../src/convexService";
import {
  TEST_ENV,
  convexResponse,
  fetchQueue,
  jsonResponse,
} from "./helpers";

describe("convexService", () => {
  it("calls an internal mutation with deployment-key auth", async () => {
    const { impl, calls } = fetchQueue([convexResponse("art42")]);
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
    expect(calls[0].url).toBe(`${TEST_ENV.CONVEX_URL}/api/mutation`);
    expect(calls[0].headers.Authorization).toBe(
      `Convex ${TEST_ENV.CONVEX_DEPLOY_KEY}`
    );
    expect(calls[0].body).toMatchObject({
      path: "articles:createPending",
      args: [args],
    });
  });

  it("uses the native mutation endpoint for complete and fail", async () => {
    const { impl, calls } = fetchQueue([
      convexResponse(null),
      convexResponse(null),
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

    expect(calls[0].body).toMatchObject({ path: "articles:complete" });
    expect(calls[1].body).toMatchObject({
      path: "articles:fail",
      args: [
        {
          articleId: "art1",
          expectedUserId: "user_test",
          error: "boom",
        },
      ],
    });
  });

  it("calls internal queries directly and preserves typed results", async () => {
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
    const { impl, calls } = fetchQueue([convexResponse(articles)]);
    const service = createConvexService(impl, TEST_ENV);

    await expect(
      service.listArticles({ userId: "user_1", limit: 10 })
    ).resolves.toEqual(articles);
    expect(calls[0].url).toBe(`${TEST_ENV.CONVEX_URL}/api/query`);
    expect(calls[0].body).toMatchObject({
      path: "articles:listForAgent",
      args: [{ userId: "user_1", limit: 10 }],
    });
  });

  it("surfaces native Convex HTTP failures", async () => {
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
