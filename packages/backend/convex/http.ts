// HTTP actions for the API worker's service traffic: `/ingest/*` writes for
// the scrape pipeline, `/agent/*` reads for MCP tools. These routes live on
// the `.convex.site` origin and are guarded by a shared secret.
import { httpRouter } from "convex/server";
import { Effect } from "effect";
import { z } from "zod";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { HttpResponseError } from "../src/domainErrors";
import { promise, runHttpEffect } from "../src/effect";

function authorized(req: Request) {
  const secret = process.env.WORKER_SHARED_SECRET;
  return Boolean(secret) && req.headers.get("x-inkwell-key") === secret;
}

function httpError(status: number, body: string) {
  return Effect.fail(new HttpResponseError({ status, body }));
}

function authorize(req: Request) {
  return authorized(req) ? Effect.void : httpError(403, "forbidden");
}

function decode<S extends z.ZodType>(schema: S, input: unknown) {
  return Effect.try({
    try: () => schema.parse(input),
    catch: () => new HttpResponseError({ status: 400, body: "invalid request" }),
  });
}

function decodeBody<S extends z.ZodType>(req: Request, schema: S) {
  return Effect.tryPromise({
    try: () => req.json(),
    catch: () => new HttpResponseError({ status: 400, body: "invalid JSON" }),
  }).pipe(
    Effect.flatMap((body) => decode(schema, body))
  );
}

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

const CreatePendingBody = z.strictObject({
  userId: z.string(),
  url: z.string(),
  kind: z.enum(["web", "pdf"]),
  title: z.string(),
  savedAt: z.number(),
});

const CompleteBody = z.strictObject({
  articleId: z.string(),
  expectedUserId: z.string(),
  title: z.string(),
  byline: z.string().optional(),
  siteName: z.string().optional(),
  excerpt: z.string().optional(),
  blocksJson: z.string(),
});

const FailBody = z.strictObject({
  articleId: z.string(),
  expectedUserId: z.string(),
  error: z.string(),
});

const ArticleListQuery = z.strictObject({
  userId: z.string(),
  readStatus: z.enum(READ_STATUSES).optional(),
  status: z.enum(ARTICLE_STATUSES).optional(),
  tagIds: z.array(z.string()).optional(),
  limit: z.number().optional(),
});

const UserIdQuery = z.strictObject({
  userId: z.string(),
});

const ArticleQuery = z.strictObject({
  userId: z.string(),
  id: z.string(),
});

const AnnotationsQuery = z.strictObject({
  userId: z.string(),
  articleId: z.string(),
});

const CreateTagBody = z.strictObject({
  userId: z.string(),
  name: z.string(),
  color: z.string().optional(),
});

const RenameTagBody = z.strictObject({
  userId: z.string(),
  tagId: z.string(),
  name: z.string(),
});

const RemoveTagBody = z.strictObject({
  userId: z.string(),
  tagId: z.string(),
});

const ArticleTagBody = z.strictObject({
  userId: z.string(),
  articleId: z.string(),
  tagId: z.string(),
});

const PinArticleBody = z.strictObject({
  userId: z.string(),
  id: z.string(),
  pinned: z.boolean(),
});

const http = httpRouter();

http.route({
  path: "/ingest/create-pending",
  method: "POST",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const body = yield* decodeBody(req, CreatePendingBody);
        const articleId = yield* promise(() =>
          ctx.runMutation(internal.articles.createPending, body)
        );
        return Response.json({ articleId });
      })
    )
  ),
});

http.route({
  path: "/ingest/complete",
  method: "POST",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const body = yield* decodeBody(req, CompleteBody);
        yield* promise(() => ctx.runMutation(internal.articles.complete, body));
        return Response.json({ ok: true });
      })
    )
  ),
});

http.route({
  path: "/ingest/fail",
  method: "POST",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const body = yield* decodeBody(req, FailBody);
        yield* promise(() => ctx.runMutation(internal.articles.fail, body));
        return Response.json({ ok: true });
      })
    )
  ),
});

http.route({
  path: "/agent/articles",
  method: "GET",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const userId = param(req, "userId");
        if (!userId) {
          return yield* httpError(400, "userId required");
        }

        const limitRaw = param(req, "limit");
        const limit = limitRaw === undefined ? undefined : Number(limitRaw);
        if (
          limit !== undefined &&
          (!Number.isInteger(limit) || limit < 1 || limit > 200)
        ) {
          return yield* httpError(
            400,
            "limit must be an integer from 1 to 200"
          );
        }

        const readStatus = param(req, "readStatus");
        if (!isOneOf(readStatus, READ_STATUSES)) {
          return yield* httpError(
            400,
            `readStatus must be one of: ${READ_STATUSES.join(", ")}`
          );
        }
        const status = param(req, "status");
        if (!isOneOf(status, ARTICLE_STATUSES)) {
          return yield* httpError(
            400,
            `status must be one of: ${ARTICLE_STATUSES.join(", ")}`
          );
        }

        // Comma-separated tag ids; an article matches if it has ANY of them.
        const tagIdsRaw = param(req, "tagIds");
        const tagIds = tagIdsRaw
          ? tagIdsRaw
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean)
          : undefined;

        const input = yield* decode(ArticleListQuery, {
          userId,
          readStatus,
          status,
          tagIds,
          limit,
        });
        const articles = yield* promise(() =>
          ctx.runQuery(internal.articles.listForAgent, {
            ...input,
            tagIds: input.tagIds ? [...input.tagIds] : undefined,
          })
        );
        return Response.json({ articles });
      })
    )
  ),
});

http.route({
  path: "/agent/article",
  method: "GET",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const userId = param(req, "userId");
        const id = param(req, "id");
        if (!userId || !id) {
          return yield* httpError(400, "userId and id required");
        }
        const input = yield* decode(ArticleQuery, { userId, id });
        const article = yield* promise(() =>
          ctx.runQuery(internal.articles.getForAgent, input)
        );
        if (!article) {
          return yield* httpError(404, "not found");
        }
        return Response.json({ article });
      })
    )
  ),
});

http.route({
  path: "/agent/tags",
  method: "GET",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const userId = param(req, "userId");
        if (!userId) {
          return yield* httpError(400, "userId required");
        }
        const input = yield* decode(UserIdQuery, { userId });
        const tags = yield* promise(() =>
          ctx.runQuery(internal.tags.listForAgent, input)
        );
        return Response.json({ tags });
      })
    )
  ),
});

http.route({
  path: "/agent/tags/create",
  method: "POST",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const body = yield* decodeBody(req, CreateTagBody);
        const tag = yield* promise(() =>
          ctx.runMutation(internal.tags.createForAgent, body)
        );
        return Response.json({ tag });
      })
    )
  ),
});

http.route({
  path: "/agent/tags/rename",
  method: "POST",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const body = yield* decodeBody(req, RenameTagBody);
        yield* promise(() =>
          ctx.runMutation(internal.tags.renameForAgent, body)
        );
        return Response.json({ ok: true });
      })
    )
  ),
});

http.route({
  path: "/agent/tags/remove",
  method: "POST",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const body = yield* decodeBody(req, RemoveTagBody);
        yield* promise(() =>
          ctx.runMutation(internal.tags.removeForAgent, body)
        );
        return Response.json({ ok: true });
      })
    )
  ),
});

http.route({
  path: "/agent/article-tags/add",
  method: "POST",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const body = yield* decodeBody(req, ArticleTagBody);
        yield* promise(() =>
          ctx.runMutation(internal.tags.addToArticleForAgent, body)
        );
        return Response.json({ ok: true });
      })
    )
  ),
});

http.route({
  path: "/agent/article-tags/remove",
  method: "POST",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const body = yield* decodeBody(req, ArticleTagBody);
        yield* promise(() =>
          ctx.runMutation(internal.tags.removeFromArticleForAgent, body)
        );
        return Response.json({ ok: true });
      })
    )
  ),
});

http.route({
  path: "/agent/article/pin",
  method: "POST",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const body = yield* decodeBody(req, PinArticleBody);
        yield* promise(() =>
          ctx.runMutation(internal.articles.setPinnedForAgent, body)
        );
        return Response.json({ ok: true });
      })
    )
  ),
});

http.route({
  path: "/agent/annotations",
  method: "GET",
  handler: httpAction((ctx, req) =>
    runHttpEffect(
      Effect.gen(function* () {
        yield* authorize(req);
        const userId = param(req, "userId");
        const articleId = param(req, "articleId");
        if (!userId || !articleId) {
          return yield* httpError(400, "userId and articleId required");
        }
        const input = yield* decode(AnnotationsQuery, { userId, articleId });
        const result = yield* promise(() =>
          ctx.runQuery(internal.annotations.getForAgent, input)
        );
        if (!result) {
          return yield* httpError(404, "not found");
        }
        return Response.json(result);
      })
    )
  ),
});

export default http;
