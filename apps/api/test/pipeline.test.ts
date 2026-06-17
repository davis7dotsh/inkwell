import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block } from "@inkwell/content";

import { processArticleEffect } from "../src/pipeline";
import {
  makeRequestLayer,
  runRequestEffect,
} from "../src/requestContext";
import { FIXTURE_HTML, TEST_ENV, fakeNetwork, firecrawlOk } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processArticle", () => {
  const processArticle = (
    fetchImpl: typeof fetch,
    options: {
      articleId: string;
      userId: string;
      url: string;
    }
  ) =>
    runRequestEffect(
      processArticleEffect(options),
      makeRequestLayer({
        env: { ...TEST_ENV, MEMOS: {} as R2Bucket },
        userId: options.userId,
        executionCtx: { waitUntil: () => undefined },
        fetchImpl,
      })
    );

  it("scrapes, parses through @inkwell/content, and completes", async () => {
    const { impl, ingest } = fakeNetwork(() =>
      firecrawlOk({
        html: FIXTURE_HTML,
        metadata: {
          title: "Hello Inkwell",
          description: "A greeting",
          sourceURL: "https://example.com/hello",
        },
      })
    );

    await processArticle(impl, {
      userId: "user_test",
      articleId: "art1",
      url: "https://example.com/hello",
    });

    expect(ingest.fail).toHaveLength(0);
    expect(ingest.complete).toHaveLength(1);
    const body = ingest.complete[0].body as {
      articleId: string;
      title: string;
      siteName?: string;
      excerpt?: string;
      blocksJson: string;
    };
    expect(body.articleId).toBe("art1");
    expect(body.title).toBe("Hello Inkwell");
    expect(body.siteName).toBe("example.com");
    expect(body.excerpt).toBe("A greeting");

    const blocks = JSON.parse(body.blocksJson) as Block[];
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({
      type: "heading",
      spans: [{ text: "Hello Inkwell" }],
    });
    expect(blocks[1].type).toBe("paragraph");
  });

  it("marks the article failed when Firecrawl errors", async () => {
    const { impl, ingest } = fakeNetwork(
      () => new Response("kaboom", { status: 500 })
    );

    await processArticle(impl, {
      userId: "user_test",
      articleId: "art1",
      url: "https://example.com/hello",
    });

    expect(ingest.complete).toHaveLength(0);
    expect(ingest.fail).toHaveLength(1);
    expect(ingest.fail[0].body).toMatchObject({
      articleId: "art1",
      error: expect.stringMatching(/HTTP 500/),
    });
  });

  it("marks the article failed when content normalizes to nothing", async () => {
    // success: true but no html/markdown — the real firecrawlToArticle throws.
    const { impl, ingest } = fakeNetwork(() => firecrawlOk({ metadata: {} }));

    await processArticle(impl, {
      userId: "user_test",
      articleId: "art1",
      url: "https://example.com/empty",
    });

    expect(ingest.complete).toHaveLength(0);
    expect(ingest.fail).toHaveLength(1);
    expect(ingest.fail[0].body).toMatchObject({
      articleId: "art1",
      error: expect.stringMatching(/no content/i),
    });
  });

  it("never throws, even when the fail write itself fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const impl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      processArticle(impl, {
        userId: "user_test",
        articleId: "art1",
        url: "https://example.com",
      })
    ).resolves.toEqual({ status: "failed", error: "network down" });
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
