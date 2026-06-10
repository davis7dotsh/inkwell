// HTTP actions for the api worker's service writes. Served on the
// `.convex.site` origin (NOT `.convex.cloud`), guarded by a shared secret
// header so the internal mutations never gain a public client surface.
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

export default http;
