// Articles: user-facing queries/mutations plus internal functions called by
// the API worker through its admin-authenticated Convex client.
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

export async function requireUserId(ctx: QueryCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

export async function requireOwnedArticle(
  ctx: QueryCtx,
  id: Id<"articles">
): Promise<Doc<"articles">> {
  const userId = await requireUserId(ctx);
  const article = await ctx.db.get(id);
  if (!article || article.userId !== userId) {
    throw new Error("Article not found");
  }
  return article;
}

// One indexed query for every tag link a user has, grouped by article. The
// library list and reader both attach tag ids this way.
async function tagsByArticle(
  ctx: QueryCtx,
  userId: string
): Promise<Map<string, Id<"tags">[]>> {
  const links = await ctx.db
    .query("articleTags")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const byArticle = new Map<string, Id<"tags">[]>();
  for (const link of links) {
    const arr = byArticle.get(link.articleId) ?? [];
    arr.push(link.tagId);
    byArticle.set(link.articleId, arr);
  }
  return byArticle;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // by_user indexes on userId only, so order newest-first here.
    articles.sort((a, b) => b.savedAt - a.savedAt);
    const byArticle = await tagsByArticle(ctx, userId);
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
  },
});

export const get = query({
  args: { id: v.id("articles") },
  handler: async (ctx, args) => {
    const article = await requireOwnedArticle(ctx, args.id);
    const links = await ctx.db
      .query("articleTags")
      .withIndex("by_article", (q) => q.eq("articleId", article._id))
      .collect();
    return {
      ...article,
      pinned: article.pinned ?? false,
      tags: links.map((link) => link.tagId),
    };
  },
});

export const rename = mutation({
  args: { id: v.id("articles"), title: v.string() },
  handler: async (ctx, args) => {
    await requireOwnedArticle(ctx, args.id);
    const title = args.title.trim();
    if (!title) throw new Error("Title cannot be empty");
    await ctx.db.patch(args.id, { title });
  },
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
  handler: async (ctx, args) => {
    await requireOwnedArticle(ctx, args.id);
    await ctx.db.patch(args.id, { readStatus: args.status });
  },
});

export const setPinned = mutation({
  args: { id: v.id("articles"), pinned: v.boolean() },
  handler: async (ctx, args) => {
    await requireOwnedArticle(ctx, args.id);
    await ctx.db.patch(args.id, { pinned: args.pinned });
  },
});

export const remove = mutation({
  args: { id: v.id("articles") },
  handler: async (ctx, args) => {
    await requireOwnedArticle(ctx, args.id);
    const annotations = await ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", args.id))
      .collect();
    for (const annotation of annotations) {
      await ctx.db.delete(annotation._id);
    }
    // Drop tag links so deleted articles don't leave dangling rows.
    const links = await ctx.db
      .query("articleTags")
      .withIndex("by_article", (q) => q.eq("articleId", args.id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    await ctx.db.delete(args.id);
  },
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
  handler: async (ctx, args) => {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const byArticle = await tagsByArticle(ctx, args.userId);

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
  },
});

export const getForAgent = internalQuery({
  args: {
    userId: v.string(),
    // Arrives from the API worker, so validate the id shape at runtime
    // instead of trusting v.id().
    id: v.string(),
  },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("articles", args.id);
    if (!id) return null;
    const article = await ctx.db.get(id);
    if (!article || article.userId !== args.userId) return null;
    const links = await ctx.db
      .query("articleTags")
      .withIndex("by_article", (q) => q.eq("articleId", id))
      .collect();
    // Same legacy-row normalization as listForAgent.
    return {
      ...article,
      readStatus: article.readStatus ?? "unread",
      pinned: article.pinned ?? false,
      tags: links.map((link) => link.tagId),
    };
  },
});

export const setPinnedForAgent = internalMutation({
  args: { userId: v.string(), id: v.string(), pinned: v.boolean() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("articles", args.id);
    if (!id) throw new Error("Article not found");
    const article = await ctx.db.get(id);
    if (!article || article.userId !== args.userId) {
      throw new Error("Article not found");
    }
    await ctx.db.patch(id, { pinned: args.pinned });
    return { ok: true };
  },
});

export const createPending = internalMutation({
  args: {
    userId: v.string(),
    url: v.string(),
    kind: v.union(v.literal("web"), v.literal("pdf")),
    title: v.string(),
    savedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("articles", {
      ...args,
      status: "pending",
      readStatus: "unread",
    });
  },
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
  handler: async (ctx, args) => {
    const { articleId, expectedUserId, ...fields } = args;
    const id = ctx.db.normalizeId("articles", articleId);
    if (!id) throw new Error("Article not found");
    const article = await ctx.db.get(id);
    if (!article || article.userId !== expectedUserId) {
      throw new Error("Article not found");
    }
    await ctx.db.patch(id, {
      ...fields,
      status: "ready",
      error: undefined,
    });
  },
});

export const fail = internalMutation({
  args: {
    articleId: v.string(),
    expectedUserId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("articles", args.articleId);
    if (!id) throw new Error("Article not found");
    const article = await ctx.db.get(id);
    if (!article || article.userId !== args.expectedUserId) {
      throw new Error("Article not found");
    }
    await ctx.db.patch(id, {
      status: "failed",
      error: args.error,
    });
  },
});
