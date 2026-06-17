// Articles: user-facing queries/mutations plus internal functions called by
// the API worker through its admin-authenticated Convex client.
import { v } from "convex/values";
import { Effect } from "effect";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import {
  AuthenticationError,
  NotFoundError,
  OwnershipError,
  ValidationError,
} from "../src/domainErrors";
import { promise, runConvexEffect } from "../src/effect";

export function requireUserId(
  ctx: QueryCtx
): Effect.Effect<string, AuthenticationError> {
  return Effect.gen(function* () {
    const identity = yield* promise(() => ctx.auth.getUserIdentity());
    if (!identity) {
      return yield* new AuthenticationError({ message: "Not authenticated" });
    }
    return identity.subject;
  });
}

export function requireOwnedArticle(
  ctx: QueryCtx,
  id: Id<"articles">
): Effect.Effect<
  Doc<"articles">,
  AuthenticationError | NotFoundError | OwnershipError
> {
  return Effect.gen(function* () {
    const userId = yield* requireUserId(ctx);
    const article = yield* promise(() => ctx.db.get(id));
    if (!article) {
      return yield* new NotFoundError({ message: "Article not found" });
    }
    if (article.userId !== userId) {
      return yield* new OwnershipError({ message: "Article not found" });
    }
    return article;
  });
}

// One indexed query for every tag link a user has, grouped by article. The
// library list and reader both attach tag ids this way.
function tagsByArticle(
  ctx: QueryCtx,
  userId: string
): Effect.Effect<Map<string, Id<"tags">[]>> {
  return Effect.gen(function* () {
    const links = yield* promise(() =>
      ctx.db
        .query("articleTags")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    );
    const byArticle = new Map<string, Id<"tags">[]>();
    for (const link of links) {
      const arr = byArticle.get(link.articleId) ?? [];
      arr.push(link.tagId);
      byArticle.set(link.articleId, arr);
    }
    return byArticle;
  });
}

export const list = query({
  args: {},
  handler: (ctx) =>
    runConvexEffect(
      Effect.gen(function* () {
        const userId = yield* requireUserId(ctx);
        const articles = yield* promise(() =>
          ctx.db
            .query("articles")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect()
        );
        // by_user indexes on userId only, so order newest-first here.
        articles.sort((a, b) => b.savedAt - a.savedAt);
        const byArticle = yield* tagsByArticle(ctx, userId);
        // Explicit fields: keep blocksJson out of the live list.
        return articles.map((article) => ({
          _id: article._id,
          _creationTime: article._creationTime,
          userId: article.userId,
          url: article.url,
          kind: article.kind,
          status: article.status,
          error: article.error,
          title: article.title,
          byline: article.byline,
          siteName: article.siteName,
          excerpt: article.excerpt,
          savedAt: article.savedAt,
          readStatus: article.readStatus,
          pinned: article.pinned ?? false,
          tags: byArticle.get(article._id) ?? [],
        }));
      })
    ),
});

export const get = query({
  args: { id: v.id("articles") },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const article = yield* requireOwnedArticle(ctx, args.id);
        const links = yield* promise(() =>
          ctx.db
            .query("articleTags")
            .withIndex("by_article", (q) => q.eq("articleId", article._id))
            .collect()
        );
        return {
          ...article,
          pinned: article.pinned ?? false,
          tags: links.map((link) => link.tagId),
        };
      })
    ),
});

export const rename = mutation({
  args: { id: v.id("articles"), title: v.string() },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        yield* requireOwnedArticle(ctx, args.id);
        const title = args.title.trim();
        if (!title) {
          return yield* new ValidationError({
            message: "Title cannot be empty",
          });
        }
        yield* promise(() => ctx.db.patch(args.id, { title }));
      })
    ),
});

export const setReadStatus = mutation({
  args: {
    id: v.id("articles"),
    status: v.union(
      v.literal("unread"),
      v.literal("in_progress"),
      v.literal("read")
    ),
  },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        yield* requireOwnedArticle(ctx, args.id);
        yield* promise(() =>
          ctx.db.patch(args.id, { readStatus: args.status })
        );
      })
    ),
});

export const setPinned = mutation({
  args: { id: v.id("articles"), pinned: v.boolean() },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        yield* requireOwnedArticle(ctx, args.id);
        yield* promise(() => ctx.db.patch(args.id, { pinned: args.pinned }));
      })
    ),
});

export const remove = mutation({
  args: { id: v.id("articles") },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        yield* requireOwnedArticle(ctx, args.id);
        const annotations = yield* promise(() =>
          ctx.db
            .query("annotations")
            .withIndex("by_article", (q) => q.eq("articleId", args.id))
            .collect()
        );
        for (const annotation of annotations) {
          yield* promise(() => ctx.db.delete(annotation._id));
        }
        // Drop tag links so deleted articles don't leave dangling rows.
        const links = yield* promise(() =>
          ctx.db
            .query("articleTags")
            .withIndex("by_article", (q) => q.eq("articleId", args.id))
            .collect()
        );
        for (const link of links) {
          yield* promise(() => ctx.db.delete(link._id));
        }
        yield* promise(() => ctx.db.delete(args.id));
      })
    ),
});

// ---- Agent reads ----
// Driven by the API worker through an admin-authenticated Convex client.
// ctx.auth is empty on that path, so the worker passes the userId it resolved
// from the caller's Clerk API key.

export const listForAgent = internalQuery({
  args: {
    userId: v.string(),
    readStatus: v.optional(
      v.union(
        v.literal("unread"),
        v.literal("in_progress"),
        v.literal("read")
      )
    ),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))
    ),
    // Tag ids arrive as strings from the API worker; normalized below. An
    // article matches if it carries ANY of these tags (OR), mirroring the
    // home-screen filter.
    tagIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const articles = yield* promise(() =>
          ctx.db
            .query("articles")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .collect()
        );
        const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
        const byArticle = yield* tagsByArticle(ctx, args.userId);

        // Normalize requested tag ids; unknown ones are dropped. An empty-but-
        // present filter matches nothing.
        const wanted = args.tagIds
          ? new Set(
              args.tagIds
                .map((id) => ctx.db.normalizeId("tags", id))
                .filter((id): id is Id<"tags"> => id !== null)
            )
          : null;

        return articles
          // Rows written before readStatus existed count as "unread".
          .filter(
            (article) =>
              !args.readStatus ||
              (article.readStatus ?? "unread") === args.readStatus
          )
          .filter((article) => !args.status || article.status === args.status)
          .filter((article) => {
            if (!wanted) return true;
            const tags = byArticle.get(article._id) ?? [];
            return tags.some((tagId) => wanted.has(tagId));
          })
          .sort((a, b) => b.savedAt - a.savedAt)
          .slice(0, limit)
          .map((article) => ({
            id: article._id,
            url: article.url,
            kind: article.kind,
            status: article.status,
            error: article.error,
            title: article.title,
            byline: article.byline,
            siteName: article.siteName,
            excerpt: article.excerpt,
            savedAt: article.savedAt,
            readStatus: article.readStatus ?? "unread",
            pinned: article.pinned ?? false,
            tags: byArticle.get(article._id) ?? [],
          }));
      })
    ),
});

export const getForAgent = internalQuery({
  args: {
    userId: v.string(),
    // Arrives from the API worker, so validate the id shape at runtime
    // instead of trusting v.id().
    id: v.string(),
  },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const id = ctx.db.normalizeId("articles", args.id);
        if (!id) return null;
        const article = yield* promise(() => ctx.db.get(id));
        if (!article || article.userId !== args.userId) return null;
        const links = yield* promise(() =>
          ctx.db
            .query("articleTags")
            .withIndex("by_article", (q) => q.eq("articleId", id))
            .collect()
        );
        // Same legacy-row normalization as listForAgent.
        return {
          ...article,
          readStatus: article.readStatus ?? "unread",
          pinned: article.pinned ?? false,
          tags: links.map((link) => link.tagId),
        };
      })
    ),
});

export const setPinnedForAgent = internalMutation({
  args: { userId: v.string(), id: v.string(), pinned: v.boolean() },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const id = ctx.db.normalizeId("articles", args.id);
        if (!id) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        const article = yield* promise(() => ctx.db.get(id));
        if (!article) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        if (article.userId !== args.userId) {
          return yield* new OwnershipError({ message: "Article not found" });
        }
        yield* promise(() => ctx.db.patch(id, { pinned: args.pinned }));
        return { ok: true };
      })
    ),
});

export const createPending = internalMutation({
  args: {
    userId: v.string(),
    url: v.string(),
    kind: v.union(v.literal("web"), v.literal("pdf")),
    title: v.string(),
    savedAt: v.number(),
  },
  handler: (ctx, args) =>
    runConvexEffect(
      promise(() =>
        ctx.db.insert("articles", {
          ...args,
          status: "pending",
          readStatus: "unread",
        })
      )
    ),
});

export const complete = internalMutation({
  args: {
    articleId: v.string(),
    // The api worker passes the requesting user's id so a retry can never
    // rewrite somebody else's article.
    expectedUserId: v.string(),
    title: v.string(),
    byline: v.optional(v.string()),
    siteName: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    blocksJson: v.string(),
  },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const { articleId, expectedUserId, ...fields } = args;
        const id = ctx.db.normalizeId("articles", articleId);
        if (!id) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        const article = yield* promise(() => ctx.db.get(id));
        if (!article) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        if (article.userId !== expectedUserId) {
          return yield* new OwnershipError({ message: "Article not found" });
        }
        yield* promise(() =>
          ctx.db.patch(id, {
            ...fields,
            status: "ready",
            error: undefined,
          })
        );
      })
    ),
});

export const fail = internalMutation({
  args: {
    articleId: v.string(),
    expectedUserId: v.string(),
    error: v.string(),
  },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const id = ctx.db.normalizeId("articles", args.articleId);
        if (!id) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        const article = yield* promise(() => ctx.db.get(id));
        if (!article) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        if (article.userId !== args.expectedUserId) {
          return yield* new OwnershipError({ message: "Article not found" });
        }
        yield* promise(() =>
          ctx.db.patch(id, {
            status: "failed",
            error: args.error,
          })
        );
      })
    ),
});
