// HTTP actions for the API worker's service traffic: `/ingest/*` writes for
// the scrape pipeline, `/agent/*` reads for MCP tools. These routes live on
// the `.convex.site` origin and are guarded by a shared secret.
import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

function authorized(req: Request) {
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

function param(req: Request, name: string) {
  return new URL(req.url).searchParams.get(name) ?? undefined;
}

const READ_STATUSES = ["unread", "in_progress", "read"] as const;
const ARTICLE_STATUSES = ["pending", "ready", "failed"] as const;

const isOneOf = <T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): value is T | undefined =>
  value === undefined || (allowed as readonly string[]).includes(value);

http.route({
  path: "/agent/articles",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!authorized(req)) return new Response("forbidden", { status: 403 });
    const userId = param(req, "userId");
    if (!userId) return new Response("userId required", { status: 400 });

    const limitRaw = param(req, "limit");
    const limit = limitRaw === undefined ? undefined : Number(limitRaw);
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > 200)
    ) {
      return new Response("limit must be an integer from 1 to 200", {
        status: 400,
      });
    }

    const readStatus = param(req, "readStatus");
    if (!isOneOf(readStatus, READ_STATUSES)) {
      return new Response(
        `readStatus must be one of: ${READ_STATUSES.join(", ")}`,
        { status: 400 }
      );
    }
    const status = param(req, "status");
    if (!isOneOf(status, ARTICLE_STATUSES)) {
      return new Response(
        `status must be one of: ${ARTICLE_STATUSES.join(", ")}`,
        { status: 400 }
      );
    }

    const articles = await ctx.runQuery(internal.articles.listForAgent, {
      userId,
      readStatus,
      status,
      limit,
    });
    return Response.json({ articles });
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
