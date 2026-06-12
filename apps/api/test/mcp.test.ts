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

const makeExecutionCtx = () =>
  ({
    waitUntil: () => undefined,
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
      articles: () => jsonResponse({ articles: rows }),
    });

    const response = await callTool("list_articles", {
      readStatus: "unread",
      limit: 10,
    });

    expect(agentCalls).toHaveLength(1);
    const call = new URL(agentCalls[0].url);
    expect(call.pathname).toBe("/agent/articles");
    expect(call.searchParams.get("userId")).toBe("user_1");
    expect(call.searchParams.get("readStatus")).toBe("unread");
    expect(call.searchParams.get("limit")).toBe("10");
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
      article: () => jsonResponse({ article: readyArticle }),
    });

    const response = await callTool("get_article", { articleId: "art1" });

    expect(new URL(agentCalls[0].url).searchParams.get("id")).toBe("art1");
    const text = response.result?.content?.[0]?.text as string;
    expect(text).toContain("# Article A");
    expect(text).toContain("By: Jane Doe");
    expect(text).toContain("Read status: in_progress");
    expect(text).toContain("# Hello\n\nBody text.");
  });

  it("returns a tool error for unknown ids", async () => {
    stubNetwork(noScrape, {
      article: () => new Response("not found", { status: 404 }),
    });

    const response = await callTool("get_article", { articleId: "nope" });
    expect(response.result?.isError).toBe(true);
  });

  it("explains pending articles instead of dumping nothing", async () => {
    stubNetwork(noScrape, {
      article: () =>
        jsonResponse({
          article: { ...readyArticle, status: "pending", blocksJson: undefined },
        }),
    });

    const response = await callTool("get_article", { articleId: "art1" });
    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toContain("still processing");
  });
});

describe("get_notes", () => {
  it("returns notes and transcripts in reading order plus ink counts", async () => {
    stubNetwork(noScrape, {
      annotations: () =>
        jsonResponse({
          articleTitle: "Article A",
          articleUrl: "https://example.com/a",
          annotations: {
            contentWidth: 800,
            notesJson: JSON.stringify([
              { id: "n2", x: 0, y: 500, text: "Second note" },
              { id: "n1", x: 0, y: 10, text: "First note" },
            ]),
            memosJson: JSON.stringify([
              {
                id: "m1",
                x: 0,
                y: 50,
                durationMs: 1000,
                transcript: "Spoken thought",
                status: "uploaded",
                createdAt: 1,
              },
              {
                id: "m2",
                x: 0,
                y: 60,
                durationMs: 1000,
                transcript: "   ",
                status: "local",
                createdAt: 2,
              },
            ]),
            strokesJson: JSON.stringify([
              { id: "s1", tool: "highlighter", color: "x", width: 1, points: [] },
              { id: "s2", tool: "pen", color: "x", width: 1, points: [] },
              { id: "s3", tool: "pen", color: "x", width: 1, points: [] },
            ]),
            boxesJson: JSON.stringify([{ id: "b1", x: 0, y: 0, w: 1, h: 1 }]),
            updatedAt: 1750000000000,
          },
        }),
    });

    const response = await callTool("get_notes", { articleId: "art1" });

    expect(response.result?.isError).toBeFalsy();
    expect(response.result?.structuredContent).toEqual({
      articleTitle: "Article A",
      articleUrl: "https://example.com/a",
      notes: ["First note", "Second note"],
      voiceMemoTranscripts: ["Spoken thought"],
      boxCount: 1,
      highlightStrokeCount: 1,
      penStrokeCount: 2,
      updatedAt: "2025-06-15T15:06:40.000Z",
    });
    const text = response.result?.content?.[0]?.text as string;
    expect(text.indexOf("First note")).toBeLessThan(
      text.indexOf("Second note")
    );
  });

  it("handles articles with no annotations yet", async () => {
    stubNetwork(noScrape, {
      annotations: () =>
        jsonResponse({
          articleTitle: "Article A",
          articleUrl: "https://example.com/a",
          annotations: null,
        }),
    });

    const response = await callTool("get_notes", { articleId: "art1" });
    expect(response.result?.isError).toBeFalsy();
    expect(response.result?.structuredContent).toMatchObject({
      notes: [],
      voiceMemoTranscripts: [],
      boxCount: 0,
    });
    expect(response.result?.content?.[0]?.text).toContain("No annotations yet");
  });

  it("returns a tool error for unknown ids", async () => {
    stubNetwork(noScrape, {
      annotations: () => new Response("not found", { status: 404 }),
    });

    const response = await callTool("get_notes", { articleId: "nope" });
    expect(response.result?.isError).toBe(true);
  });
});
