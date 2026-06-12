// Articles: user-facing queries/mutations plus the internal mutations the
// api worker drives through convex/http.ts (pending → ready/failed).
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
    }));
  },
});

export const get = query({
  args: { id: v.id("articles") },
  handler: async (ctx, args) => {
    return requireOwnedArticle(ctx, args.id);
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
    await ctx.db.delete(args.id);
  },
});

// ---- Agent reads ----
// Driven by the api worker through convex/http.ts (shared-secret guard).
// ctx.auth is empty on that path, so the worker asserts the userId it
// resolved from the caller's Clerk API key — same trust model as the
// expectedUserId checks on the ingest mutations.

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
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return articles
      // Rows written before readStatus existed count as "unread".
      .filter(
        (article) =>
          !args.readStatus ||
          (article.readStatus ?? "unread") === args.readStatus
      )
      .filter((article) => !args.status || article.status === args.status)
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
      }));
  },
});

export const getForAgent = internalQuery({
  args: {
    userId: v.string(),
    // Arrives over HTTP from outside Convex, so validate the id shape at
    // runtime instead of trusting v.id().
    id: v.string(),
  },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("articles", args.id);
    if (!id) return null;
    const article = await ctx.db.get(id);
    if (!article || article.userId !== args.userId) return null;
    // Same legacy-row normalization as listForAgent.
    return { ...article, readStatus: article.readStatus ?? "unread" };
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
    articleId: v.id("articles"),
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
    const article = await ctx.db.get(articleId);
    if (!article || article.userId !== expectedUserId) {
      throw new Error("Article not found");
    }
    await ctx.db.patch(articleId, {
      ...fields,
      status: "ready",
      error: undefined,
    });
  },
});

export const fail = internalMutation({
  args: {
    articleId: v.id("articles"),
    expectedUserId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article || article.userId !== args.expectedUserId) {
      throw new Error("Article not found");
    }
    await ctx.db.patch(args.articleId, {
      status: "failed",
      error: args.error,
    });
  },
});
