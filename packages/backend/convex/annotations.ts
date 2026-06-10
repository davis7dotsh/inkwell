// Annotations: one row per user+article, upserted by save. Strokes/boxes/
// notes travel as JSON strings (ink can be large; dodge deep validators).
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
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

export const save = mutation({
  args: {
    articleId: v.id("articles"),
    contentWidth: v.number(),
    strokesJson: v.string(),
    boxesJson: v.string(),
    notesJson: v.string(),
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
        updatedAt,
      });
    }
  },
});
