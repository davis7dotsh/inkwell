import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import { FirecrawlService } from "../src/firecrawl";
import {
  makeRequestLayer,
  runRequestEffect,
} from "../src/requestContext";
import {
  FIRECRAWL_ENDPOINT,
  TEST_ENV,
  fetchQueue,
  firecrawlOk,
  jsonResponse,
} from "./helpers";

const scrapeUrl = (
  fetchImpl: typeof fetch,
  apiKey: string,
  url: string
) =>
  runRequestEffect(
    Effect.flatMap(FirecrawlService, (service) =>
      service.scrapeUrl(url)
    ),
    makeRequestLayer({
      env: {
        ...TEST_ENV,
        FIRECRAWL_API_KEY: apiKey,
        MEMOS: {} as R2Bucket,
      },
      userId: "user_1",
      executionCtx: { waitUntil: () => undefined },
      fetchImpl,
    })
  );

const rateLimited = (retryAfter?: string) =>
  new Response("rate limited", {
    status: 429,
    headers: retryAfter !== undefined ? { "Retry-After": retryAfter } : {},
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("scrapeUrl", () => {
  it("posts the v2 scrape body and returns html/markdown/metadata", async () => {
    const { impl, calls } = fetchQueue([
      firecrawlOk({
        html: "<p>hi</p>",
        markdown: "hi",
        metadata: { title: "T", sourceURL: "https://example.com/a" },
      }),
    ]);

    const result = await scrapeUrl(impl, "fc-key", "https://example.com/a");

    expect(result).toEqual({
      html: "<p>hi</p>",
      markdown: "hi",
      metadata: { title: "T", sourceURL: "https://example.com/a" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(FIRECRAWL_ENDPOINT);
    expect(calls[0].headers.Authorization).toBe("Bearer fc-key");
    expect(calls[0].body).toEqual({
      url: "https://example.com/a",
      formats: ["markdown", "html"],
      onlyMainContent: true,
      parsers: [{ type: "pdf", mode: "auto", maxPages: 200 }],
      timeout: 120000,
    });
  });

  it("accepts nullable metadata fields from Firecrawl", async () => {
    const { impl } = fetchQueue([
      firecrawlOk({
        markdown: "hello",
        metadata: {
          title: null,
          description: null,
          sourceURL: "https://example.com/a",
        },
      }),
    ]);

    const result = await scrapeUrl(impl, "fc-key", "https://example.com/a");

    expect(result.metadata).toEqual({
      title: null,
      description: null,
      sourceURL: "https://example.com/a",
    });
  });

  it("retries once on 429, honoring Retry-After", async () => {
    vi.useFakeTimers();
    const first = rateLimited("7");
    const { impl, calls } = fetchQueue([
      first,
      firecrawlOk({ markdown: "hello", metadata: {} }),
    ]);

    const promise = scrapeUrl(impl, "fc-key", "https://example.com");
    await vi.advanceTimersByTimeAsync(6_999);
    expect(calls).toHaveLength(1); // still sleeping
    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(calls).toHaveLength(2);
    expect(first.bodyUsed).toBe(true);
    expect(result.markdown).toBe("hello");
  });

  it("gives up after the second 429", async () => {
    const { impl, calls } = fetchQueue([rateLimited("0"), rateLimited("0")]);

    await expect(
      scrapeUrl(impl, "fc-key", "https://example.com")
    ).rejects.toThrow(/HTTP 429.*retried once/);
    expect(calls).toHaveLength(2);
  });

  it("does not retry non-429 HTTP errors", async () => {
    const { impl, calls } = fetchQueue([
      new Response("kaboom", { status: 500 }),
    ]);

    await expect(
      scrapeUrl(impl, "fc-key", "https://example.com")
    ).rejects.toThrow(/HTTP 500.*kaboom/);
    expect(calls).toHaveLength(1);
  });

  it("throws the API error message on success: false", async () => {
    const { impl } = fetchQueue([
      jsonResponse({ success: false, error: "URL is not reachable" }),
    ]);

    await expect(
      scrapeUrl(impl, "fc-key", "https://example.com")
    ).rejects.toThrow(/URL is not reachable/);
  });

  it("throws when the response has no data", async () => {
    const { impl } = fetchQueue([jsonResponse({ success: true })]);

    await expect(
      scrapeUrl(impl, "fc-key", "https://example.com")
    ).rejects.toThrow(/no data/);
  });

  it("surfaces the warning when content is empty", async () => {
    const { impl } = fetchQueue([
      firecrawlOk({ metadata: {}, warning: "page requires JavaScript" }),
    ]);

    await expect(
      scrapeUrl(impl, "fc-key", "https://example.com")
    ).rejects.toThrow(/page requires JavaScript/);
  });
});
