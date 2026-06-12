// HTTP actions for the api worker's service traffic: `/ingest/*` writes for
// the scrape pipeline, `/agent/*` reads for the MCP tools. Served on the
// `.convex.site` origin (NOT `.convex.cloud`), guarded by a shared secret
// header so the internal functions never gain a public client surface.
// The worker authenticates the end user (Clerk session or API key) and
// asserts the userId param; nothing here re-checks identity.
import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

function authorized(req: Request): boolean {
  const secret = process.env.WORKER_SHARED_SECRET;
  return Boolean(secret) && req.headers.get("x-inkwell-key") === secret;
}

const http = httpRouter();

http.route({
  path: "/ingest/create-pending",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorized(req)) return new Response("forbidden", { status: 403 });
    const body = await req.json();
    const articleId = await ctx.runMutation(
      internal.articles.createPending,
      body
    );
    return Response.json({ articleId });
  }),
});

http.route({
  path: "/ingest/complete",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorized(req)) return new Response("forbidden", { status: 403 });
    const body = await req.json();
    await ctx.runMutation(internal.articles.complete, body);
    return Response.json({ ok: true });
  }),
});

http.route({
  path: "/ingest/fail",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorized(req)) return new Response("forbidden", { status: 403 });
    const body = await req.json();
    await ctx.runMutation(internal.articles.fail, body);
    return Response.json({ ok: true });
  }),
});

// ---- Agent reads ----
// GET with query params; userId is required on every route.

function param(req: Request, name: string): string | undefined {
  return new URL(req.url).searchParams.get(name) ?? undefined;
}

http.route({
  path: "/agent/articles",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!authorized(req)) return new Response("forbidden", { status: 403 });
    const userId = param(req, "userId");
    if (!userId) return new Response("userId required", { status: 400 });
    const limitRaw = param(req, "limit");
    const limit = limitRaw === undefined ? undefined : Number(limitRaw);
    if (limit !== undefined && !Number.isFinite(limit)) {
      return new Response("limit must be a number", { status: 400 });
    }
    // Validators on the internalQuery reject bad filter values with a
    // descriptive ArgumentValidationError; surface those as 400s.
    try {
      const articles = await ctx.runQuery(internal.articles.listForAgent, {
        userId,
        readStatus: param(req, "readStatus") as
          | "unread"
          | "in_progress"
          | "read"
          | undefined,
        status: param(req, "status") as
          | "pending"
          | "ready"
          | "failed"
          | undefined,
        limit,
      });
      return Response.json({ articles });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ArgumentValidationError")) {
        return new Response(message, { status: 400 });
      }
      throw error;
    }
  }),
});

http.route({
  path: "/agent/article",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!authorized(req)) return new Response("forbidden", { status: 403 });
    const userId = param(req, "userId");
    const id = param(req, "id");
    if (!userId || !id) {
      return new Response("userId and id required", { status: 400 });
    }
    const article = await ctx.runQuery(internal.articles.getForAgent, {
      userId,
      id,
    });
    if (!article) return new Response("not found", { status: 404 });
    return Response.json({ article });
  }),
});

http.route({
  path: "/agent/annotations",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!authorized(req)) return new Response("forbidden", { status: 403 });
    const userId = param(req, "userId");
    const articleId = param(req, "articleId");
    if (!userId || !articleId) {
      return new Response("userId and articleId required", { status: 400 });
    }
    const result = await ctx.runQuery(internal.annotations.getForAgent, {
      userId,
      articleId,
    });
    if (!result) return new Response("not found", { status: 404 });
    return Response.json(result);
  }),
});

export default http;
