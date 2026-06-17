// App-level tests through app.request(). Clerk's middleware would try to
// verify real JWTs, so @clerk/hono is module-mocked: clerkMiddleware becomes
// a pass-through and getAuth reads the per-test authState below. Route
// handlers call the global fetch, which vi.stubGlobal points at fakeNetwork.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "@inkwell/content";

import {
  FIXTURE_HTML,
  TEST_ENV,
  fakeNetwork,
  firecrawlOk,
  type IngestLog,
} from "./helpers";

const authState = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@clerk/hono", () => ({
  clerkMiddleware:
    () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  // Mirrors the real shape for both auth paths the app accepts (session JWT
  // or user-scoped API key): routes narrow on isAuthenticated, then userId.
  getAuth: () => ({
    userId: authState.userId,
    isAuthenticated: authState.userId !== null,
  }),
}));

import app from "../src/index";

function makeExecutionCtx() {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      tasks.push(promise);
    },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, flush: () => Promise.all(tasks) };
}

function postJson(path: string, body: unknown, ctx: ExecutionContext) {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    TEST_ENV,
    ctx
  );
}

/** Installs fakeNetwork as the global fetch the route handlers use. */
function stubNetwork(scrape: () => Response): IngestLog {
  const { impl, ingest } = fakeNetwork(scrape);
  vi.stubGlobal("fetch", impl);
  return ingest;
}

function makeMemoBucket(options?: { fail?: boolean }) {
  const values = new Map<
    string,
    { bytes: Uint8Array; contentType: string }
  >();
  const etag = '"memo-etag"';
  const bucket = {
    put: vi.fn(
      async (
        key: string,
        value: ArrayBuffer,
        putOptions?: R2PutOptions
      ) => {
        if (options?.fail) throw new Error("R2 put failed");
        const contentType =
          putOptions?.httpMetadata &&
          !(putOptions.httpMetadata instanceof Headers)
            ? putOptions.httpMetadata.contentType ?? "application/octet-stream"
            : "application/octet-stream";
        values.set(key, {
          bytes: new Uint8Array(value.slice(0)),
          contentType,
        });
        return {} as R2Object;
      }
    ),
    get: vi.fn(
      async (
        key: string,
        getOptions?: R2GetOptions
      ): Promise<R2ObjectBody | R2Object | null> => {
        if (options?.fail) throw new Error("R2 get failed");
        const stored = values.get(key);
        if (!stored) return null;
        const onlyIf =
          getOptions?.onlyIf instanceof Headers
            ? getOptions.onlyIf
            : new Headers();
        const noBody =
          onlyIf.get("if-none-match") === etag ||
          (onlyIf.has("if-match") &&
            onlyIf.get("if-match") !== etag);
        let bytes = stored.bytes;
        let range: R2Range | undefined;
        const rangeHeader =
          getOptions?.range instanceof Headers
            ? getOptions.range.get("range")
            : null;
        const match = /^bytes=(\d+)-(\d+)?$/.exec(
          rangeHeader ?? ""
        );
        if (match) {
          const offset = Number(match[1]);
          const end = match[2]
            ? Number(match[2])
            : stored.bytes.byteLength - 1;
          range = { offset, length: end - offset + 1 };
          bytes = stored.bytes.slice(offset, end + 1);
        }
        const metadata = {
          key,
          version: "1",
          size: stored.bytes.byteLength,
          etag: "memo-etag",
          httpEtag: etag,
          checksums: {},
          uploaded: new Date(0),
          httpMetadata: { contentType: stored.contentType },
          range,
          storageClass: "Standard",
          writeHttpMetadata(headers: Headers) {
            headers.set("content-type", stored.contentType);
          },
        };
        if (noBody) return metadata as R2Object;
        return {
          ...metadata,
          body: new Blob([bytes]).stream(),
          bodyUsed: false,
          arrayBuffer: async () => bytes.slice().buffer,
          bytes: async () => bytes.slice(),
          text: async () => new TextDecoder().decode(bytes),
          json: async <T>() =>
            JSON.parse(new TextDecoder().decode(bytes)) as T,
          blob: async () =>
            new Blob([bytes], { type: stored.contentType }),
        } as unknown as R2ObjectBody;
      }
    ),
    delete: vi.fn(async (key: string) => {
      if (options?.fail) throw new Error("R2 delete failed");
      values.delete(key);
    }),
  } as unknown as R2Bucket;
  return { bucket, values };
}

beforeEach(() => {
  authState.userId = "user_1";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /health", () => {
  it("responds without auth", async () => {
    authState.userId = null;
    const { ctx } = makeExecutionCtx();

    const res = await app.request("/health", {}, TEST_ENV, ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /articles", () => {
  it("preserves Hono JSON validation before route authentication", async () => {
    authState.userId = null;
    const { ctx } = makeExecutionCtx();
    const missingUrlFailure = {
      success: false,
      error: {
        name: "ZodError",
        message:
          '[\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": [\n      "url"\n    ],\n    "message": "Invalid input: expected string, received undefined"\n  }\n]',
      },
    };

    const missingType = await app.request(
      "/articles",
      {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com" }),
      },
      TEST_ENV,
      ctx
    );
    expect(missingType.status).toBe(400);
    expect(missingType.headers.get("content-type")).toContain(
      "application/json"
    );
    expect(await missingType.json()).toEqual(missingUrlFailure);

    const malformed = await app.request(
      "/articles",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
      TEST_ENV,
      ctx
    );
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("content-type")).toContain("text/plain");
    expect(await malformed.text()).toBe(
      "Malformed JSON in request body"
    );

    authState.userId = "user_1";
    const wrongContentType = await app.request(
      "/articles",
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ url: "https://example.com" }),
      },
      TEST_ENV,
      ctx
    );
    expect(wrongContentType.status).toBe(400);
    expect(wrongContentType.headers.get("content-type")).toContain(
      "application/json"
    );
    expect(await wrongContentType.json()).toEqual(missingUrlFailure);

    const wrongType = await app.request(
      "/articles",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: 42 }),
      },
      TEST_ENV,
      ctx
    );
    expect(wrongType.status).toBe(400);
    expect(wrongType.headers.get("content-type")).toContain(
      "application/json"
    );
    expect(await wrongType.json()).toEqual({
      success: false,
      error: {
        name: "ZodError",
        message:
          '[\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": [\n      "url"\n    ],\n    "message": "Invalid input: expected string, received number"\n  }\n]',
      },
    });
  });

  it("preserves the legacy plain-text unexpected 500 response", async () => {
    const impl = vi.fn(async () => {
      throw new Error("network unavailable");
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", impl);
    const { ctx } = makeExecutionCtx();

    const res = await postJson(
      "/articles",
      { url: "https://example.com" },
      ctx
    );

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("Internal Server Error");
  });

  it("rejects unauthenticated requests with 401", async () => {
    authState.userId = null;
    const ingest = stubNetwork(() => firecrawlOk({}));
    const { ctx, flush } = makeExecutionCtx();

    const res = await postJson("/articles", { url: "https://example.com" }, ctx);
    await flush();

    expect(res.status).toBe(401);
    expect(ingest["create-pending"]).toHaveLength(0);
  });

  it("rejects unsalvageable URLs with 400", async () => {
    const ingest = stubNetwork(() => firecrawlOk({}));
    const { ctx, flush } = makeExecutionCtx();

    for (const url of ["", "   ", "nodots", "ftp://example.com/file"]) {
      const res = await postJson("/articles", { url }, ctx);
      expect(res.status).toBe(400);
    }
    await flush();
    expect(ingest["create-pending"]).toHaveLength(0);
  });

  it("creates a pending row, returns 202, then completes via waitUntil", async () => {
    const ingest = stubNetwork(() =>
      firecrawlOk({
        html: FIXTURE_HTML,
        metadata: {
          title: "Hello Inkwell",
          sourceURL: "https://example.com/posts/hello",
        },
      })
    );
    const { ctx, flush } = makeExecutionCtx();

    // No scheme on purpose: the worker normalizes to https://.
    const res = await postJson("/articles", { url: "example.com/posts/hello" }, ctx);

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ articleId: "art1" });
    expect(ingest["create-pending"]).toHaveLength(1);
    expect(ingest["create-pending"][0].headers["x-inkwell-key"]).toBe(
      TEST_ENV.WORKER_SHARED_SECRET
    );
    expect(ingest["create-pending"][0].body).toMatchObject({
      userId: "user_1",
      url: "https://example.com/posts/hello",
      kind: "web",
      title: "https://example.com/posts/hello",
      savedAt: expect.any(Number),
    });

    await flush();
    expect(ingest.fail).toHaveLength(0);
    expect(ingest.complete).toHaveLength(1);
    const body = ingest.complete[0].body as {
      articleId: string;
      title: string;
      blocksJson: string;
    };
    expect(body.articleId).toBe("art1");
    expect(body.title).toBe("Hello Inkwell");
    const blocks = JSON.parse(body.blocksJson) as Block[];
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({
      type: "heading",
      spans: [{ text: "Hello Inkwell" }],
    });
  });

  it("detects pdf kind from the URL path and parses markdown", async () => {
    const ingest = stubNetwork(() =>
      firecrawlOk({
        markdown: "# Attention\n\nIs all you need.",
        metadata: {
          title: "Attention",
          sourceURL: "https://example.com/papers/attention.pdf",
        },
      })
    );
    const { ctx, flush } = makeExecutionCtx();

    const res = await postJson(
      "/articles",
      { url: "https://example.com/papers/Attention.PDF?ref=hn" },
      ctx
    );

    expect(res.status).toBe(202);
    expect(ingest["create-pending"][0].body).toMatchObject({ kind: "pdf" });

    await flush();
    expect(ingest.complete).toHaveLength(1);
    const blocks = JSON.parse(
      (ingest.complete[0].body as { blocksJson: string }).blocksJson
    ) as Block[];
    expect(blocks[0]).toMatchObject({
      type: "heading",
      spans: [{ text: "Attention" }],
    });
  });

  it("marks the article failed when the scrape errors", async () => {
    const ingest = stubNetwork(() => new Response("kaboom", { status: 500 }));
    const { ctx, flush } = makeExecutionCtx();

    const res = await postJson("/articles", { url: "https://example.com" }, ctx);
    await flush();

    expect(res.status).toBe(202);
    expect(ingest.complete).toHaveLength(0);
    expect(ingest.fail).toHaveLength(1);
    expect(ingest.fail[0].body).toMatchObject({
      articleId: "art1",
      error: expect.stringMatching(/HTTP 500/),
    });
  });
});

describe("POST /articles/upload", () => {
  function uploadRequest(
    ctx: ExecutionContext,
    file: File | string,
    field = "file"
  ) {
    const form = new FormData();
    form.append(field, file);
    return app.request(
      "/articles/upload",
      { method: "POST", body: form },
      TEST_ENV,
      ctx
    );
  }

  const pdfFile = (name = "My Paper.pdf") =>
    new File(["%PDF-1.4 fake bytes"], name, { type: "application/pdf" });

  it("rejects unauthenticated requests with 401", async () => {
    authState.userId = null;
    const ingest = stubNetwork(() => firecrawlOk({}));
    const { ctx, flush } = makeExecutionCtx();

    const res = await uploadRequest(ctx, pdfFile());
    await flush();

    expect(res.status).toBe(401);
    expect(ingest["create-pending"]).toHaveLength(0);
  });

  it("rejects non-PDF uploads with 400", async () => {
    const ingest = stubNetwork(() => firecrawlOk({}));
    const { ctx, flush } = makeExecutionCtx();

    const res = await uploadRequest(
      ctx,
      new File(["hello"], "notes.txt", { type: "text/plain" })
    );
    await flush();

    expect(res.status).toBe(400);
    expect(ingest["create-pending"]).toHaveLength(0);
  });

  it("rejects a missing file field with 400", async () => {
    stubNetwork(() => firecrawlOk({}));
    const { ctx } = makeExecutionCtx();

    const res = await uploadRequest(ctx, "not-a-file");

    expect(res.status).toBe(400);
  });

  it("creates a pending pdf row, parses via /v2/parse, and completes", async () => {
    const ingest = stubNetwork(() =>
      firecrawlOk({
        markdown: "# Attention\n\nIs all you need.",
        metadata: { title: "Attention Is All You Need" },
      })
    );
    const { ctx, flush } = makeExecutionCtx();

    const res = await uploadRequest(ctx, pdfFile("attention.pdf"));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ articleId: "art1" });
    expect(ingest["create-pending"][0].body).toMatchObject({
      userId: "user_1",
      url: "upload://attention.pdf",
      kind: "pdf",
      title: "attention",
    });

    await flush();
    expect(ingest.fail).toHaveLength(0);
    expect(ingest.complete).toHaveLength(1);
    const body = ingest.complete[0].body as {
      title: string;
      blocksJson: string;
    };
    expect(body.title).toBe("Attention Is All You Need");
    const blocks = JSON.parse(body.blocksJson) as Block[];
    expect(blocks[0]).toMatchObject({
      type: "heading",
      spans: [{ text: "Attention" }],
    });
  });

  it("falls back to the filename title when metadata and headings are empty", async () => {
    const ingest = stubNetwork(() =>
      firecrawlOk({ markdown: "Just one plain paragraph.", metadata: {} })
    );
    const { ctx, flush } = makeExecutionCtx();

    const res = await uploadRequest(ctx, pdfFile("Quarterly Report.pdf"));
    await flush();

    expect(res.status).toBe(202);
    expect(ingest.complete).toHaveLength(1);
    expect(ingest.complete[0].body).toMatchObject({
      title: "Quarterly Report",
    });
  });

  it("marks the article failed when the parse errors", async () => {
    const ingest = stubNetwork(() => new Response("kaboom", { status: 500 }));
    const { ctx, flush } = makeExecutionCtx();

    const res = await uploadRequest(ctx, pdfFile());
    await flush();

    expect(res.status).toBe(202);
    expect(ingest.complete).toHaveLength(0);
    expect(ingest.fail).toHaveLength(1);
    expect(ingest.fail[0].body).toMatchObject({
      articleId: "art1",
      error: expect.stringMatching(/HTTP 500/),
    });
  });
});

describe("voice memo R2 routes", () => {
  const path = "/memos/article_1/memo_1";
  const audio = new Uint8Array([1, 2, 3, 4, 5]);

  it("puts, streams, ranges, conditionally reads, and deletes audio", async () => {
    const { bucket, values } = makeMemoBucket();
    const env = { ...TEST_ENV, MEMOS: bucket };
    const { ctx } = makeExecutionCtx();

    const put = await app.request(
      path,
      {
        method: "PUT",
        headers: { "Content-Type": "audio/mp4" },
        body: audio,
      },
      env,
      ctx
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ size: 5 });
    expect(
      values.get("user_1/article_1/memo_1.m4a")
    ).toMatchObject({ contentType: "audio/mp4" });

    const full = await app.request(path, {}, env, ctx);
    expect(full.status).toBe(200);
    expect(full.headers.get("etag")).toBe('"memo-etag"');
    expect(full.headers.get("content-type")).toBe("audio/mp4");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(audio);

    const ranged = await app.request(
      path,
      { headers: { Range: "bytes=1-3" } },
      env,
      ctx
    );
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(
      new Uint8Array([2, 3, 4])
    );

    const notModified = await app.request(
      path,
      { headers: { "If-None-Match": '"memo-etag"' } },
      env,
      ctx
    );
    expect(notModified.status).toBe(304);

    const preconditionFailed = await app.request(
      path,
      { headers: { "If-Match": '"different"' } },
      env,
      ctx
    );
    expect(preconditionFailed.status).toBe(412);

    const deleted = await app.request(
      path,
      { method: "DELETE" },
      env,
      ctx
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    const missing = await app.request(path, {}, env, ctx);
    expect(missing.status).toBe(404);
  });

  it("preserves media type, size, parameter, and storage failures", async () => {
    const { bucket } = makeMemoBucket();
    const env = { ...TEST_ENV, MEMOS: bucket };
    const { ctx } = makeExecutionCtx();

    const wrongType = await app.request(
      path,
      { method: "PUT", body: audio },
      env,
      ctx
    );
    expect(wrongType.status).toBe(415);

    const tooLarge = await app.request(
      path,
      {
        method: "PUT",
        headers: {
          "Content-Type": "audio/mp4",
          "Content-Length": String(25 * 1024 * 1024 + 1),
        },
        body: audio,
      },
      env,
      ctx
    );
    expect(tooLarge.status).toBe(413);

    const invalidParam = await app.request(
      "/memos/bad%20id/memo_1",
      {},
      env,
      ctx
    );
    expect(invalidParam.status).toBe(400);
    expect(invalidParam.headers.get("content-type")).toContain(
      "application/json"
    );

    const failing = {
      ...TEST_ENV,
      MEMOS: makeMemoBucket({ fail: true }).bucket,
    };
    const storageFailure = await app.request(
      path,
      {
        method: "PUT",
        headers: { "Content-Type": "audio/mp4" },
        body: audio,
      },
      failing,
      ctx
    );
    expect(storageFailure.status).toBe(500);
    expect(await storageFailure.text()).toBe(
      "Internal Server Error"
    );
  });
});

describe("POST /articles/:id/retry", () => {
  it("requires auth", async () => {
    authState.userId = null;
    stubNetwork(() => firecrawlOk({}));
    const { ctx } = makeExecutionCtx();

    const res = await postJson(
      "/articles/art9/retry",
      { url: "https://example.com" },
      ctx
    );

    expect(res.status).toBe(401);
  });

  it("re-runs the pipeline for the existing id without createPending", async () => {
    const ingest = stubNetwork(() =>
      firecrawlOk({
        html: FIXTURE_HTML,
        metadata: { title: "Hello Inkwell" },
      })
    );
    const { ctx, flush } = makeExecutionCtx();

    const res = await postJson(
      "/articles/art9/retry",
      { url: "https://example.com/posts/hello" },
      ctx
    );
    await flush();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ articleId: "art9" });
    expect(ingest["create-pending"]).toHaveLength(0);
    expect(ingest.complete).toHaveLength(1);
    expect(ingest.complete[0].body).toMatchObject({ articleId: "art9" });
  });
});
