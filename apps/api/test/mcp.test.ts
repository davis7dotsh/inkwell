// MCP endpoint tests: JSON-RPC over POST /mcp through app.request(), with
// the same Clerk mock and fakeNetwork stubs as app.test.ts. The transport
// runs stateless with JSON responses, so every request stands alone — no
// initialize handshake needed before tools/call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_HTML,
  TEST_ENV,
  fakeNetwork,
  firecrawlOk,
  jsonResponse,
  type AgentReads,
} from "./helpers";

const authState = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@clerk/hono", () => ({
  clerkMiddleware:
    () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  getAuth: () => ({
    userId: authState.userId,
    isAuthenticated: authState.userId !== null,
  }),
}));

import app from "../src/index";

const waitUntilCalls: Promise<unknown>[] = [];

const makeExecutionCtx = () =>
  ({
    waitUntil: (promise: Promise<unknown>) => {
      waitUntilCalls.push(promise);
    },
    passThroughOnException: () => undefined,
  }) as unknown as ExecutionContext;

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, any>;
  error?: { code: number; message: string };
};

let nextId = 1;

async function rpc(
  method: string,
  params: Record<string, unknown>
): Promise<JsonRpcResponse> {
  const res = await app.request(
    "/mcp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    },
    TEST_ENV,
    makeExecutionCtx()
  );
  expect(res.status).toBe(200);
  return res.json();
}

const callTool = (name: string, args: Record<string, unknown>) =>
  rpc("tools/call", { name, arguments: args });

/** Installs fakeNetwork as the global fetch the tool handlers use. */
function stubNetwork(scrape: () => Response, reads: AgentReads = {}) {
  const network = fakeNetwork(scrape, reads);
  vi.stubGlobal("fetch", network.impl);
  return network;
}

const noScrape = () => {
  throw new Error("unexpected Firecrawl call");
};

beforeEach(() => {
  authState.userId = "user_1";
  waitUntilCalls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /mcp auth", () => {
  it("rejects unauthenticated requests with 401 + WWW-Authenticate", async () => {
    authState.userId = null;
    const res = await app.request(
      "/mcp",
      { method: "POST", body: "{}" },
      TEST_ENV,
      makeExecutionCtx()
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("answers non-POST methods with 405, not a hanging SSE stream", async () => {
    // The transport's stateless GET path would open an SSE stream that this
    // per-request server never feeds; the route must 405 first.
    for (const method of ["GET", "DELETE"]) {
      const res = await app.request(
        "/mcp",
        {
          method,
          headers: { Accept: "application/json, text/event-stream" },
        },
        TEST_ENV,
        makeExecutionCtx()
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
    }
  });
});

describe("MCP handshake", () => {
  it("answers initialize with the inkwell server info", async () => {
    stubNetwork(noScrape);
    const response = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    expect(response.result?.serverInfo).toMatchObject({ name: "inkwell" });
    expect(response.result?.instructions).toContain("/articles/upload");
  });

  it("lists the four tools with read-only annotations on reads", async () => {
    stubNetwork(noScrape);
    const response = await rpc("tools/list", {});
    const tools = response.result?.tools as Array<{
      name: string;
      annotations?: { readOnlyHint?: boolean };
    }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_article",
      "get_notes",
      "list_articles",
      "save_article",
    ]);
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(byName.list_articles.annotations?.readOnlyHint).toBe(true);
    expect(byName.get_article.annotations?.readOnlyHint).toBe(true);
    expect(byName.get_notes.annotations?.readOnlyHint).toBe(true);
    expect(byName.save_article.annotations?.readOnlyHint).toBeFalsy();
  });
});

describe("list_articles", () => {
  const rows = [
    {
      id: "art1",
      url: "https://example.com/a",
      kind: "web",
      status: "ready",
      title: "Article A",
      savedAt: 1750000000000,
      readStatus: "unread",
    },
  ];

  it("passes filters and the caller's userId to Convex, returns rows", async () => {
    const { agentCalls } = stubNetwork(noScrape, {
      articles: () => rows,
    });

    const response = await callTool("list_articles", {
      readStatus: "unread",
      limit: 10,
    });

    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0].url).toContain("/agent/articles?");
    expect(agentCalls[0].body).toEqual({
      userId: "user_1",
      readStatus: "unread",
      limit: 10,
    });
    expect(agentCalls[0].headers["x-inkwell-key"]).toBe(
      TEST_ENV.WORKER_SHARED_SECRET
    );

    expect(response.result?.isError).toBeFalsy();
    expect(response.result?.structuredContent.articles).toEqual([
      {
        id: "art1",
        url: "https://example.com/a",
        kind: "web",
        status: "ready",
        title: "Article A",
        savedAt: "2025-06-15T15:06:40.000Z",
        readStatus: "unread",
      },
    ]);
  });
});

describe("save_article", () => {
  it("saves, awaits the pipeline, and reports ready with the real title", async () => {
    const { ingest } = stubNetwork(() =>
      firecrawlOk({
        html: FIXTURE_HTML,
        metadata: { title: "Hello Inkwell", sourceURL: "https://example.com" },
      })
    );

    const response = await callTool("save_article", {
      url: "example.com/posts/hello",
    });

    expect(ingest["create-pending"]).toHaveLength(1);
    expect(ingest["create-pending"][0].body).toMatchObject({
      userId: "user_1",
      url: "https://example.com/posts/hello",
      kind: "web",
    });
    expect(ingest.complete).toHaveLength(1);
    expect(response.result?.isError).toBeFalsy();
    expect(response.result?.structuredContent).toEqual({
      articleId: "art1",
      status: "ready",
      title: "Hello Inkwell",
    });
    // The pipeline promise must also be registered with waitUntil so a
    // client disconnect mid-save can't strand the row in pending.
    expect(waitUntilCalls).toHaveLength(1);
  });

  it("reports failed when the scrape errors", async () => {
    const { ingest } = stubNetwork(() =>
      jsonResponse({ success: false, error: "blocked by robots.txt" })
    );

    const response = await callTool("save_article", {
      url: "https://example.com/blocked",
    });

    expect(ingest.fail).toHaveLength(1);
    expect(response.result?.structuredContent).toMatchObject({
      articleId: "art1",
      status: "failed",
      error: expect.stringContaining("robots"),
    });
  });

  it("rejects invalid URLs as a tool error without touching Convex", async () => {
    const { ingest } = stubNetwork(noScrape);

    const response = await callTool("save_article", { url: "nodots" });

    expect(response.result?.isError).toBe(true);
    expect(ingest["create-pending"]).toHaveLength(0);
  });
});

describe("get_article", () => {
  const readyArticle = {
    _id: "art1",
    url: "https://example.com/a",
    kind: "web",
    status: "ready",
    title: "Article A",
    byline: "Jane Doe",
    savedAt: 1750000000000,
    readStatus: "in_progress",
    blocksJson: JSON.stringify([
      { type: "heading", level: 1, spans: [{ text: "Hello" }] },
      { type: "paragraph", spans: [{ text: "Body text." }] },
    ]),
  };

  it("renders the article as markdown with metadata", async () => {
    const { agentCalls } = stubNetwork(noScrape, {
      article: () => readyArticle,
    });

    const response = await callTool("get_article", { articleId: "art1" });

    expect(agentCalls[0].url).toContain("/agent/article?");
    expect(agentCalls[0].body).toEqual({
      userId: "user_1",
      id: "art1",
    });
    const text = response.result?.content?.[0]?.text as string;
    expect(text).toContain("# Article A");
    expect(text).toContain("By: Jane Doe");
    expect(text).toContain("Read status: in_progress");
    expect(text).toContain("# Hello\n\nBody text.");
  });

  const sectionedArticle = {
    ...readyArticle,
    title: "Sectioned",
    blocksJson: JSON.stringify([
      { type: "heading", level: 1, spans: [{ text: "Alpha" }] },
      { type: "paragraph", spans: [{ text: "Alpha body." }] },
      { type: "heading", level: 1, spans: [{ text: "Beta" }] },
      { type: "paragraph", spans: [{ text: "Beta body." }] },
    ]),
  };

  it("lists section ids on the first page", async () => {
    stubNetwork(noScrape, { article: () => sectionedArticle });

    const response = await callTool("get_article", { articleId: "art1" });
    const text = response.result?.content?.[0]?.text as string;
    expect(text).toContain("## Sections");
    expect(text).toContain("section-1-alpha");
    expect(text).toContain("section-3-beta");
  });

  it("returns a single section by id", async () => {
    stubNetwork(noScrape, { article: () => sectionedArticle });

    const response = await callTool("get_article", {
      articleId: "art1",
      section: "section-3-beta",
    });
    const text = response.result?.content?.[0]?.text as string;
    expect(text).toContain("Section: Beta");
    expect(text).toContain("# Beta\n\nBeta body.");
    expect(text).not.toContain("Alpha body.");
  });

  it("lists available sections when the requested id is unknown", async () => {
    stubNetwork(noScrape, { article: () => sectionedArticle });

    const response = await callTool("get_article", {
      articleId: "art1",
      section: "nope",
    });
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toContain("section-1-alpha");
  });

  it("paginates the body with offset and a continue hint", async () => {
    stubNetwork(noScrape, { article: () => sectionedArticle });

    const first = await callTool("get_article", { articleId: "art1", limit: 5 });
    const firstText = first.result?.content?.[0]?.text as string;
    expect(firstText).toContain("Continue with offset=");

    const second = await callTool("get_article", {
      articleId: "art1",
      offset: 12,
    });
    const secondText = second.result?.content?.[0]?.text as string;
    expect(secondText).toContain("continued, characters 12");
  });

  it("rejects mixing section with offset/limit", async () => {
    stubNetwork(noScrape, { article: () => sectionedArticle });

    const response = await callTool("get_article", {
      articleId: "art1",
      section: "section-1-alpha",
      offset: 5,
    });
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toContain("not both");
  });

  it("returns a tool error for unknown ids", async () => {
    stubNetwork(noScrape, {
      article: () => null,
    });

    const response = await callTool("get_article", { articleId: "nope" });
    expect(response.result?.isError).toBe(true);
  });

  it("explains pending articles instead of dumping nothing", async () => {
    const { blocksJson: _blocksJson, ...pendingArticle } = readyArticle;
    stubNetwork(noScrape, {
      article: () => ({
        ...pendingArticle,
        status: "pending",
      }),
    });

    const response = await callTool("get_article", { articleId: "art1" });
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toContain("still processing");
  });
});

describe("get_notes", () => {
  // Four blocks: two headings and two paragraphs, with a layout snapshot that
  // places each block so annotation coordinates resolve to specific text.
  const ANCHORED_BLOCKS = [
    { type: "heading", level: 1, spans: [{ text: "Intro" }] },
    { type: "paragraph", spans: [{ text: "The quick brown fox." }] },
    { type: "heading", level: 2, spans: [{ text: "Details" }] },
    { type: "paragraph", spans: [{ text: "Jumps over the lazy dog." }] },
  ];
  const ANCHORED_LAYOUT = {
    width: 800,
    layouts: [
      [0, { y: 0, height: 40 }],
      [1, { y: 40, height: 60 }],
      [2, { y: 100, height: 40 }],
      [3, { y: 140, height: 60 }],
    ],
  };

  it("anchors each annotation to its text, in reading order", async () => {
    stubNetwork(noScrape, {
      annotations: () => ({
        articleTitle: "Article A",
        articleUrl: "https://example.com/a",
        blocksJson: JSON.stringify(ANCHORED_BLOCKS),
        annotations: {
          contentWidth: 800,
          notesJson: JSON.stringify([
            { id: "n1", x: 5, y: 70, text: "Important point" },
          ]),
          memosJson: JSON.stringify([
            {
              id: "m1",
              x: 5,
              y: 160,
              durationMs: 1000,
              transcript: "My thoughts",
              status: "uploaded",
              createdAt: 1,
            },
          ]),
          strokesJson: JSON.stringify([
            {
              id: "s1",
              tool: "highlighter",
              color: "x",
              width: 1,
              points: [
                { x: 10, y: 150 },
                { x: 200, y: 155 },
              ],
            },
          ]),
          boxesJson: JSON.stringify([{ id: "b1", x: 0, y: 45, w: 780, h: 50 }]),
          layoutJson: JSON.stringify(ANCHORED_LAYOUT),
          updatedAt: 1750000000000,
        },
      }),
    });

    const response = await callTool("get_notes", { articleId: "art1" });

    expect(response.result?.isError).toBeFalsy();
    expect(response.result?.structuredContent).toEqual({
      articleTitle: "Article A",
      articleUrl: "https://example.com/a",
      anchored: true,
      annotations: [
        {
          id: "b1",
          type: "box",
          selectedText: "The quick brown fox.",
          sectionHeading: "Intro",
          startOffset: 7,
          endOffset: 27,
          boundingBox: { x: 0, y: 45, w: 780, h: 50 },
        },
        {
          id: "n1",
          type: "typed_note",
          note: "Important point",
          nearbyText: "The quick brown fox.",
          sectionHeading: "Intro",
          startOffset: 7,
          endOffset: 27,
          boundingBox: { x: 5, y: 70, w: 0, h: 0 },
        },
        {
          id: "s1",
          type: "highlight",
          selectedText: "Jumps over the lazy dog.",
          sectionHeading: "Details",
          startOffset: 38,
          endOffset: 62,
          boundingBox: { x: 10, y: 150, w: 190, h: 5 },
        },
        {
          id: "m1",
          type: "voice",
          note: "My thoughts",
          nearbyText: "Jumps over the lazy dog.",
          sectionHeading: "Details",
          startOffset: 38,
          endOffset: 62,
          boundingBox: { x: 5, y: 160, w: 0, h: 0 },
        },
      ],
      summary: {
        typedNotes: 1,
        voiceMemos: 1,
        boxes: 1,
        highlightStrokes: 1,
        penStrokes: 0,
      },
      updatedAt: "2025-06-15T15:06:40.000Z",
    });
  });

  it("returns geometry only (anchored false) without a layout snapshot", async () => {
    stubNetwork(noScrape, {
      annotations: () => ({
        articleTitle: "Article A",
        articleUrl: "https://example.com/a",
        annotations: {
          contentWidth: 800,
          notesJson: JSON.stringify([
            { id: "n1", x: 5, y: 70, text: "Loose note" },
          ]),
          memosJson: "[]",
          strokesJson: "[]",
          boxesJson: JSON.stringify([{ id: "b1", x: 0, y: 10, w: 100, h: 50 }]),
          updatedAt: 1750000000000,
        },
      }),
    });

    const response = await callTool("get_notes", { articleId: "art1" });

    expect(response.result?.isError).toBeFalsy();
    expect(response.result?.structuredContent).toEqual({
      articleTitle: "Article A",
      articleUrl: "https://example.com/a",
      anchored: false,
      annotations: [
        { id: "b1", type: "box", boundingBox: { x: 0, y: 10, w: 100, h: 50 } },
        {
          id: "n1",
          type: "typed_note",
          note: "Loose note",
          boundingBox: { x: 5, y: 70, w: 0, h: 0 },
        },
      ],
      summary: {
        typedNotes: 1,
        voiceMemos: 0,
        boxes: 1,
        highlightStrokes: 0,
        penStrokes: 0,
      },
      updatedAt: "2025-06-15T15:06:40.000Z",
    });
  });

  it("handles articles with no annotations yet", async () => {
    stubNetwork(noScrape, {
      annotations: () => ({
        articleTitle: "Article A",
        articleUrl: "https://example.com/a",
        annotations: null,
      }),
    });

    const response = await callTool("get_notes", { articleId: "art1" });
    expect(response.result?.isError).toBeFalsy();
    expect(response.result?.structuredContent).toMatchObject({
      anchored: false,
      annotations: [],
      summary: {
        typedNotes: 0,
        voiceMemos: 0,
        boxes: 0,
        highlightStrokes: 0,
        penStrokes: 0,
      },
    });
    expect(response.result?.content?.[0]?.text).toContain("No annotations yet");
  });

  it("ignores malformed note and transcript entries", async () => {
    stubNetwork(noScrape, {
      annotations: () => ({
        articleTitle: "Article A",
        articleUrl: "https://example.com/a",
        annotations: {
          contentWidth: 800,
          notesJson: JSON.stringify([
            null,
            { y: 10 },
            { y: 20, text: 42 },
            { id: "n1", x: 0, y: 30, text: "Valid note" },
          ]),
          memosJson: JSON.stringify([
            false,
            { y: 10, transcript: null },
            {
              id: "m1",
              x: 0,
              y: 20,
              durationMs: 1,
              transcript: "Valid transcript",
              status: "local",
              createdAt: 1,
            },
          ]),
          strokesJson: "[]",
          boxesJson: "[]",
          updatedAt: 1750000000000,
        },
      }),
    });

    const response = await callTool("get_notes", { articleId: "art1" });

    expect(response.result?.isError).toBeFalsy();
    expect(response.result?.structuredContent).toMatchObject({
      annotations: [
        {
          id: "m1",
          type: "voice",
          note: "Valid transcript",
          boundingBox: { x: 0, y: 20, w: 0, h: 0 },
        },
        {
          id: "n1",
          type: "typed_note",
          note: "Valid note",
          boundingBox: { x: 0, y: 30, w: 0, h: 0 },
        },
      ],
      summary: { typedNotes: 1, voiceMemos: 1 },
    });
  });

  it("returns a tool error for unknown ids", async () => {
    stubNetwork(noScrape, {
      annotations: () => null,
    });

    const response = await callTool("get_notes", { articleId: "nope" });
    expect(response.result?.isError).toBe(true);
  });
});
