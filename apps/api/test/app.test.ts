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
    expect(ingest["create-pending"][0].headers.Authorization).toBe(
      `Convex ${TEST_ENV.CONVEX_DEPLOY_KEY}`
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
