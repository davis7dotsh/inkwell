import { describe, expect, it } from "vitest";

import { complete, createPending, fail, post } from "../src/convexService";
import { TEST_ENV, fetchQueue, jsonResponse } from "./helpers";

const SITE = TEST_ENV.CONVEX_SITE_URL;
const SECRET = TEST_ENV.WORKER_SHARED_SECRET;

describe("convexService", () => {
  it("createPending posts args with the shared-secret header", async () => {
    const { impl, calls } = fetchQueue([jsonResponse({ articleId: "art42" })]);
    const args = {
      userId: "user_1",
      url: "https://example.com/a",
      kind: "web" as const,
      title: "https://example.com/a",
      savedAt: 1717900000000,
    };

    const result = await createPending(impl, SITE, SECRET, args);

    expect(result).toEqual({ articleId: "art42" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${SITE}/ingest/create-pending`);
    expect(calls[0].headers["x-inkwell-key"]).toBe(SECRET);
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].body).toEqual(args);
  });

  it("complete and fail hit their ingest routes", async () => {
    const { impl, calls } = fetchQueue([
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }),
    ]);

    await complete(impl, SITE, SECRET, {
      articleId: "art1",
      expectedUserId: "user_test",
      title: "T",
      blocksJson: "[]",
    });
    await fail(impl, SITE, SECRET, {
      articleId: "art1",
      expectedUserId: "user_test",
      error: "boom",
    });

    expect(calls[0].url).toBe(`${SITE}/ingest/complete`);
    expect(calls[1].url).toBe(`${SITE}/ingest/fail`);
    expect(calls[1].body).toEqual({
      articleId: "art1",
      expectedUserId: "user_test",
      error: "boom",
    });
  });

  it("tolerates a trailing slash on the site URL", async () => {
    const { impl, calls } = fetchQueue([jsonResponse({ ok: true })]);

    await post(impl, `${SITE}/`, SECRET, "/ingest/fail", {});

    expect(calls[0].url).toBe(`${SITE}/ingest/fail`);
  });

  it("throws a readable error on non-2xx responses", async () => {
    const { impl } = fetchQueue([new Response("forbidden", { status: 403 })]);

    await expect(
      post(impl, SITE, SECRET, "/ingest/complete", {})
    ).rejects.toThrow(/\/ingest\/complete failed: HTTP 403.*forbidden/);
  });
});
