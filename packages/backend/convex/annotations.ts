// Annotations: one row per user+article, upserted by save. Strokes/boxes/
// notes travel as JSON strings (ink can be large; dodge deep validators).
import { v } from "convex/values";

import { internalQuery, mutation, query } from "./_generated/server";
import { requireOwnedArticle } from "./articles";

export const get = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, args) => {
    await requireOwnedArticle(ctx, args.articleId);
    return await ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .unique();
  },
});

// Agent read (api worker via convex/http.ts; userId asserted by the worker —
// see articles.listForAgent). Bundles the article title so the notes tool is
// one round trip.
export const getForAgent = internalQuery({
  args: {
    userId: v.string(),
    // External id over HTTP; validate the shape at runtime.
    articleId: v.string(),
  },
  handler: async (ctx, args) => {
    const articleId = ctx.db.normalizeId("articles", args.articleId);
    if (!articleId) return null;
    const article = await ctx.db.get(articleId);
    if (!article || article.userId !== args.userId) return null;
    const annotations = await ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .unique();
    return {
      articleTitle: article.title,
      articleUrl: article.url,
      annotations: annotations
        ? {
            contentWidth: annotations.contentWidth,
            strokesJson: annotations.strokesJson,
            boxesJson: annotations.boxesJson,
            notesJson: annotations.notesJson,
            memosJson: annotations.memosJson ?? "[]",
            updatedAt: annotations.updatedAt,
          }
        : null,
    };
  },
});

export const save = mutation({
  args: {
    articleId: v.id("articles"),
    contentWidth: v.number(),
    strokesJson: v.string(),
    boxesJson: v.string(),
    notesJson: v.string(),
    memosJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const article = await requireOwnedArticle(ctx, args.articleId);
    const existing = await ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .unique();
    const updatedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        contentWidth: args.contentWidth,
        strokesJson: args.strokesJson,
        boxesJson: args.boxesJson,
        notesJson: args.notesJson,
        // A save without memosJson (e.g. an older client) must not wipe
        // memos that are already stored.
        memosJson: args.memosJson ?? existing.memosJson ?? "[]",
        updatedAt,
      });
    } else {
      await ctx.db.insert("annotations", {
        userId: article.userId,
        articleId: args.articleId,
        contentWidth: args.contentWidth,
        strokesJson: args.strokesJson,
        boxesJson: args.boxesJson,
        notesJson: args.notesJson,
        memosJson: args.memosJson ?? "[]",
        updatedAt,
      });
    }
  },
});
