import { describe, effect as it, expect, layer } from "@effect/vitest";
import { Effect, Fiber, Layer, Tracer } from "effect";
import { TestClock } from "effect/testing";

import { ConvexService } from "../src/convexService";
import { FirecrawlService } from "../src/firecrawl";
import { ConvexDecodeError, RequestDecodeError } from "../src/errors";
import { makeRequestLayer } from "../src/requestContext";
import { CurrentUser } from "../src/services";
import { TEST_ENV, fetchQueue, firecrawlOk, jsonResponse } from "./helpers";

const requestLayer = (fetchImpl: typeof fetch) =>
  makeRequestLayer({
    env: {
      ...TEST_ENV,
      MEMOS: {} as R2Bucket,
    },
    userId: "user_effect",
    executionCtx: { waitUntil: () => undefined },
    fetchImpl,
  });

describe("Effect API services", () => {
  it("keeps tagged failures in the typed error channel", () =>
    Effect.gen(function* () {
      const message = yield* Effect.fail(
        new RequestDecodeError({ message: "bad input" }),
      ).pipe(
        Effect.catchTag("RequestDecodeError", (error) =>
          Effect.succeed(error.message),
        ),
      );
      expect(message).toBe("bad input");
    }));

  it("decodes Convex responses and exposes a tagged decode error", () =>
    Effect.gen(function* () {
      const { impl } = fetchQueue([
        jsonResponse({
          articles: [
            {
              id: "art1",
              url: "https://example.com",
              kind: "web",
              status: "ready",
              savedAt: 1,
              readStatus: "unread",
              pinned: false,
              tags: [],
              // title intentionally missing
            },
          ],
        }),
      ]);
      const error = yield* Effect.flip(
        Effect.flatMap(ConvexService, (convex) =>
          convex.listArticles({ userId: "user_effect" }),
        ).pipe(Effect.provide(requestLayer(impl), { local: true })),
      );
      expect(error).toBeInstanceOf(ConvexDecodeError);
      expect(error._tag).toBe("ConvexDecodeError");
    }));

  it("redacts the Convex shared secret from HTTP client spans", () =>
    Effect.gen(function* () {
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const { impl } = fetchQueue([jsonResponse({ articleId: "art1" })]);

      yield* Effect.flatMap(ConvexService, (convex) =>
        convex.createPending({
          userId: "user_effect",
          url: "https://example.com",
          kind: "web",
          title: "Example",
          savedAt: 1,
        }),
      ).pipe(
        Effect.provide(requestLayer(impl), { local: true }),
        Effect.withTracer(tracer),
      );

      const requestSpan = spans.find((span) =>
        span.attributes.has("http.request.header.x-inkwell-key"),
      );
      expect(requestSpan).toBeDefined();
      expect(
        requestSpan?.attributes.get("http.request.header.x-inkwell-key"),
      ).toBe("<redacted>");
    }));

  it("redacts the Firecrawl API key from HTTP client spans", () =>
    Effect.gen(function* () {
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const { impl } = fetchQueue([
        firecrawlOk({ markdown: "hello", metadata: {} }),
      ]);

      yield* Effect.flatMap(FirecrawlService, (firecrawl) =>
        firecrawl.scrapeUrl("https://example.com"),
      ).pipe(
        Effect.provide(requestLayer(impl), { local: true }),
        Effect.withTracer(tracer),
      );

      const requestSpan = spans.find((span) =>
        span.attributes.has("http.request.header.authorization"),
      );
      expect(requestSpan).toBeDefined();
      expect(
        requestSpan?.attributes.get("http.request.header.authorization"),
      ).toBe("<redacted>");
    }));

  it("retries Firecrawl exactly once on 429 with the Effect clock", () =>
    Effect.gen(function* () {
      const { impl, calls } = fetchQueue([
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "7" },
        }),
        firecrawlOk({ markdown: "hello", metadata: {} }),
      ]);
      const program = Effect.flatMap(FirecrawlService, (firecrawl) =>
        firecrawl.scrapeUrl("https://example.com"),
      ).pipe(Effect.provide(requestLayer(impl), { local: true }));
      const fiber = yield* Effect.forkChild(program);
      yield* Effect.yieldNow;
      expect(calls).toHaveLength(1);
      yield* TestClock.adjust("7 seconds");
      const result = yield* Fiber.join(fiber);
      expect(calls).toHaveLength(2);
      expect(result.markdown).toBe("hello");
    }));

  it("aborts an in-flight FetchHttpClient request when interrupted", () =>
    Effect.gen(function* () {
      let observedSignal: AbortSignal | undefined;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const impl = ((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          observedSignal =
            (input instanceof Request ? input.signal : init?.signal) ??
            undefined;
          markStarted();
          observedSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("request aborted", "AbortError")),
            { once: true },
          );
        })) as typeof fetch;
      const program = Effect.flatMap(FirecrawlService, (firecrawl) =>
        firecrawl.scrapeUrl("https://example.com/slow"),
      ).pipe(Effect.provide(requestLayer(impl), { local: true }));

      const fiber = yield* Effect.forkChild(program);
      yield* Effect.promise(() => started);
      expect(observedSignal?.aborted).toBe(false);

      yield* Fiber.interrupt(fiber);
      expect(observedSignal?.aborted).toBe(true);
    }));
});

layer(Layer.succeed(CurrentUser, { userId: "layer_user" }))(
  "request layer substitution",
  (it) => {
    it.effect("injects the current user without global state", () =>
      Effect.gen(function* () {
        const current = yield* CurrentUser;
        expect(current.userId).toBe("layer_user");
      }),
    );
  },
);
