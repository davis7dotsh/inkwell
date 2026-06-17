// Inkwell API — Hono worker on Cloudflare. Authenticates with Clerk, writes a
// pending article row in Convex, returns 202 immediately, then scrapes and
// parses inside ctx.waitUntil() (see pipeline.ts). Clients never poll — the
// pending→ready transition streams to them via Convex live queries.
//
// Agents get the same data through /mcp (see mcp.ts): every route accepts a
// user-scoped Clerk API key (Authorization: Bearer ak_...) as well as a
// session JWT, so scripts can also drive the REST routes directly.
//
// Routes are chained off one Hono instance (mandatory for RPC type
// inference). Clients import AppType type-only and connect via hcWithType.

import { clerkMiddleware, getAuth } from "@clerk/hono";
import { zValidator } from "@hono/zod-validator";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { hc } from "hono/client";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { z } from "zod";

import { createConvexService } from "./convexService";
import { buildInkwellMcp } from "./mcp";
import { processArticle, processUpload } from "./pipeline";
import { kindOf, normalizeUrl } from "./url";

export type Bindings = {
  FIRECRAWL_API_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  WORKER_SHARED_SECRET: string;
  CONVEX_SITE_URL: string;
  MEMOS: R2Bucket;
};

const articleBody = z.object({ url: z.string() });

// Firecrawl /v2/parse caps uploads at 50MB.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const uploadForm = z.object({
  file: z.custom<File>((value) => value instanceof File, {
    message: "file must be a file upload",
  }),
});

const isPdf = (file: File): boolean =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** Display title for an uploaded file: the name without its extension. */
function titleFromFilename(name: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, "").trim();
  return stem || "Uploaded PDF";
}

/**
 * Caller's Clerk user id — from a session JWT (apps) or a user-scoped API
 * key (agents). Org-scoped keys have no userId and are rejected by the
 * routes' null checks.
 */
const userIdOf = (c: Context): string | null => {
  const auth = getAuth(c, { acceptsToken: ["session_token", "api_key"] });
  if (!auth?.isAuthenticated) return null;
  return auth.userId ?? null;
};

// ---- voice memo audio (R2) ----
// Memo recordings are small m4a files (~0.5MB/min, 10-minute cap on the
// recorder); 25MB leaves generous headroom while keeping buffering safe.
const MAX_MEMO_BYTES = 25 * 1024 * 1024;

// Client-generated ids (Date.now base36 + random) and Convex ids are both
// URL-safe alphanumerics; rejecting anything else keeps R2 keys tidy.
const memoParams = z.object({
  articleId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  memoId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

/** Ownership by construction: keys are always prefixed by the caller's id. */
const memoKey = (userId: string, articleId: string, memoId: string) =>
  `${userId}/${articleId}/${memoId}.m4a`;

const app = new Hono<{ Bindings: Bindings }>()
  // Wildcard origin is fine here: bearer-token API, no cookies.
  .use("*", cors())
  // Registered ahead of clerkMiddleware so health checks skip auth.
  .get("/health", (c) => c.json({ ok: true }, 200))
  .use("*", clerkMiddleware())
  .post("/articles", zValidator("json", articleBody), async (c) => {
    const userId = userIdOf(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const url = normalizeUrl(c.req.valid("json").url);
    if (!url) return c.json({ error: "Invalid URL" }, 400);

    const convex = createConvexService(fetch, c.env);
    const { articleId } = await convex.createPending({
      userId,
      url: url.toString(),
      kind: kindOf(url),
      title: url.toString(), // placeholder until the scrape completes
      savedAt: Date.now(),
    });
    c.executionCtx.waitUntil(
      processArticle({
        fetchImpl: fetch,
        env: c.env,
        articleId,
        userId,
        url: url.toString(),
        convex,
      })
    );
    return c.json({ articleId }, 202);
  })
  // Direct PDF upload (no public URL to scrape): the file rides along as
  // multipart form data and goes to Firecrawl /v2/parse inside waitUntil().
  // Uploaded articles get a synthetic `upload://<name>` url — clients use it
  // to hide open-original/retry affordances.
  .post("/articles/upload", zValidator("form", uploadForm), async (c) => {
    const userId = userIdOf(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const { file } = c.req.valid("form");
    if (!isPdf(file)) {
      return c.json({ error: "Only PDF files are supported" }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "PDFs are limited to 50MB" }, 400);
    }

    const fallbackTitle = titleFromFilename(file.name);
    const convex = createConvexService(fetch, c.env);
    const { articleId } = await convex.createPending({
      userId,
      url: `upload://${file.name}`,
      kind: "pdf",
      title: fallbackTitle,
      savedAt: Date.now(),
    });
    c.executionCtx.waitUntil(
      processUpload({
        fetchImpl: fetch,
        env: c.env,
        articleId,
        userId,
        file,
        fallbackTitle,
        convex,
      })
    );
    return c.json({ articleId }, 202);
  })
  // Re-runs the pipeline for an existing (failed) article. createPending is
  // NOT re-run — the pipeline completes/fails the existing row. The client
  // supplies the article's url from its live articles.list data.
  .post("/articles/:id/retry", zValidator("json", articleBody), async (c) => {
    const userId = userIdOf(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const url = normalizeUrl(c.req.valid("json").url);
    if (!url) return c.json({ error: "Invalid URL" }, 400);

    const articleId = c.req.param("id");
    const convex = createConvexService(fetch, c.env);
    c.executionCtx.waitUntil(
      processArticle({
        fetchImpl: fetch,
        env: c.env,
        articleId,
        userId,
        url: url.toString(),
        convex,
      })
    );
    return c.json({ articleId }, 202);
  })
  // Voice memo audio. The annotation itself (placement, transcript, upload
  // status) syncs through Convex; only the m4a bytes land here.
  .put("/memos/:articleId/:memoId", zValidator("param", memoParams), async (c) => {
    const userId = userIdOf(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const contentType = c.req.header("content-type") ?? "";
    if (!/^audio\//.test(contentType)) {
      return c.json({ error: "Expected an audio/* body" }, 415);
    }
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > MAX_MEMO_BYTES) {
      return c.json({ error: "Audio too large" }, 413);
    }
    // Buffered, not streamed: R2 needs a known length, and chunked uploads
    // (expo/fetch File bodies) don't carry one. Memos are ≤25MB by contract.
    const audio = await c.req.arrayBuffer();
    if (audio.byteLength === 0) return c.json({ error: "Empty body" }, 400);
    if (audio.byteLength > MAX_MEMO_BYTES) {
      return c.json({ error: "Audio too large" }, 413);
    }

    const { articleId, memoId } = c.req.valid("param");
    await c.env.MEMOS.put(memoKey(userId, articleId, memoId), audio, {
      httpMetadata: { contentType: "audio/mp4" },
    });
    return c.json({ size: audio.byteLength }, 200);
  })
  .get("/memos/:articleId/:memoId", zValidator("param", memoParams), async (c) => {
    const userId = userIdOf(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const { articleId, memoId } = c.req.valid("param");
    const object = await c.env.MEMOS.get(
      memoKey(userId, articleId, memoId),
      { range: c.req.raw.headers, onlyIf: c.req.raw.headers }
    );
    if (!object) return c.json({ error: "Not found" }, 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");

    // The binding parses the Range header but leaves status/Content-Range to
    // us (AVPlayer seeking needs correct 206s).
    let status = 200;
    let length = object.size;
    if (object.range) {
      const offset =
        "suffix" in object.range
          ? object.size - object.range.suffix
          : (object.range.offset ?? 0);
      length =
        "suffix" in object.range
          ? object.range.suffix
          : (object.range.length ?? object.size - offset);
      headers.set(
        "content-range",
        `bytes ${offset}-${offset + length - 1}/${object.size}`
      );
      status = 206;
    }
    headers.set("content-length", String(length));

    // No body when onlyIf preconditions fail: failed If-None-Match reads
    // are 304, failed If-Match/If-Unmodified-Since writes-style checks 412.
    if (!("body" in object) || !object.body) {
      const failedWritePrecondition =
        c.req.header("if-match") !== undefined ||
        c.req.header("if-unmodified-since") !== undefined;
      return new Response(null, {
        status: failedWritePrecondition ? 412 : 304,
        headers,
      });
    }
    return new Response(object.body, { status, headers });
  })
  .delete("/memos/:articleId/:memoId", zValidator("param", memoParams), async (c) => {
    const userId = userIdOf(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const { articleId, memoId } = c.req.valid("param");
    await c.env.MEMOS.delete(memoKey(userId, articleId, memoId));
    return c.json({ ok: true }, 200);
  })
  // MCP endpoint for agents (Claude Code, scripts — anything that can send
  // an Authorization header; see mcp.ts). Stateless streamable HTTP: fresh
  // server + transport per request. Takes .all so non-POST methods land
  // here and get the 405 below instead of the SPA-less worker's 404.
  .all("/mcp", async (c) => {
    const userId = userIdOf(c);
    if (!userId) {
      // A real 401 + WWW-Authenticate is what MCP clients key off; OAuth
      // discovery metadata can be layered on later without reshaping this.
      return c.json({ error: "Unauthorized" }, 401, {
        "WWW-Authenticate": 'Bearer error="invalid_token"',
      });
    }
    // Per spec, a server offering no server-initiated stream answers GET
    // (and DELETE — no sessions to terminate) with 405. The transport can't
    // do this itself: its stateless GET path opens an SSE stream that a
    // discarded per-request server would never feed, hanging the client.
    if (c.req.method !== "POST") {
      return c.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        },
        405,
        { Allow: "POST" }
      );
    }
    const server = buildInkwellMcp(
      userId,
      c.env,
      c.executionCtx,
      createConvexService(fetch, c.env)
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      // Plain JSON responses (no SSE framing): simplest for scripts, and
      // clients are required to support both. Revisit if a tool ever wants
      // to stream progress notifications mid-call.
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

export type AppType = typeof app;

// Pre-compiled RPC client: keeps client-side type inference fast and the
// hono version pinned to the server's.
export type Client = ReturnType<typeof hc<AppType>>;
export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args);

export default app;
