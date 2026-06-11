// Inkwell API — Hono worker on Cloudflare. Authenticates with Clerk, writes a
// pending article row in Convex, returns 202 immediately, then scrapes and
// parses inside ctx.waitUntil() (see pipeline.ts). Clients never poll — the
// pending→ready transition streams to them via Convex live queries.
//
// Routes are chained off one Hono instance (mandatory for RPC type
// inference). Clients import AppType type-only and connect via hcWithType.

import { clerkMiddleware, getAuth } from "@clerk/hono";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { hc } from "hono/client";
import { cors } from "hono/cors";
import { z } from "zod";

import { createPending } from "./convexService";
import { processArticle, processUpload } from "./pipeline";

export type Bindings = {
  FIRECRAWL_API_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  WORKER_SHARED_SECRET: string;
  CONVEX_SITE_URL: string;
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
 * Normalizes a pasted URL: trims, prefixes https:// when no scheme, then
 * requires http(s) and a dotted hostname. Returns null when unsalvageable.
 */
function normalizeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  return url;
}

const kindOf = (url: URL): "web" | "pdf" =>
  url.pathname.toLowerCase().endsWith(".pdf") ? "pdf" : "web";

const app = new Hono<{ Bindings: Bindings }>()
  // Wildcard origin is fine here: bearer-token API, no cookies.
  .use("*", cors())
  // Registered ahead of clerkMiddleware so health checks skip auth.
  .get("/health", (c) => c.json({ ok: true }, 200))
  .use("*", clerkMiddleware())
  .post("/articles", zValidator("json", articleBody), async (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401);

    const url = normalizeUrl(c.req.valid("json").url);
    if (!url) return c.json({ error: "Invalid URL" }, 400);

    const { articleId } = await createPending(
      fetch,
      c.env.CONVEX_SITE_URL,
      c.env.WORKER_SHARED_SECRET,
      {
        userId: auth.userId,
        url: url.toString(),
        kind: kindOf(url),
        title: url.toString(), // placeholder until the scrape completes
        savedAt: Date.now(),
      }
    );
    c.executionCtx.waitUntil(
      processArticle({
        fetchImpl: fetch,
        env: c.env,
        articleId,
        userId: auth.userId,
        url: url.toString(),
      })
    );
    return c.json({ articleId }, 202);
  })
  // Direct PDF upload (no public URL to scrape): the file rides along as
  // multipart form data and goes to Firecrawl /v2/parse inside waitUntil().
  // Uploaded articles get a synthetic `upload://<name>` url — clients use it
  // to hide open-original/retry affordances.
  .post("/articles/upload", zValidator("form", uploadForm), async (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401);

    const { file } = c.req.valid("form");
    if (!isPdf(file)) {
      return c.json({ error: "Only PDF files are supported" }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "PDFs are limited to 50MB" }, 400);
    }

    const fallbackTitle = titleFromFilename(file.name);
    const { articleId } = await createPending(
      fetch,
      c.env.CONVEX_SITE_URL,
      c.env.WORKER_SHARED_SECRET,
      {
        userId: auth.userId,
        url: `upload://${file.name}`,
        kind: "pdf",
        title: fallbackTitle,
        savedAt: Date.now(),
      }
    );
    c.executionCtx.waitUntil(
      processUpload({
        fetchImpl: fetch,
        env: c.env,
        articleId,
        userId: auth.userId,
        file,
        fallbackTitle,
      })
    );
    return c.json({ articleId }, 202);
  })
  // Re-runs the pipeline for an existing (failed) article. createPending is
  // NOT re-run — the pipeline completes/fails the existing row. The worker
  // has no Convex read access (ingest endpoints are write-only), so the
  // client supplies the article's url from its live articles.list data.
  .post("/articles/:id/retry", zValidator("json", articleBody), async (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401);

    const url = normalizeUrl(c.req.valid("json").url);
    if (!url) return c.json({ error: "Invalid URL" }, 400);

    const articleId = c.req.param("id");
    c.executionCtx.waitUntil(
      processArticle({
        fetchImpl: fetch,
        env: c.env,
        articleId,
        userId: auth.userId,
        url: url.toString(),
      })
    );
    return c.json({ articleId }, 202);
  });

export type AppType = typeof app;

// Pre-compiled RPC client: keeps client-side type inference fast and the
// hono version pinned to the server's.
export type Client = ReturnType<typeof hc<AppType>>;
export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args);

export default app;
