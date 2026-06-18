// Annotations: one row per user+article, upserted by save. Strokes/boxes/
// notes travel as JSON strings (ink can be large; dodge deep validators).
import { v } from "convex/values";
import { Effect } from "effect";

import { internalQuery, mutation, query } from "./_generated/server";
import { requireOwnedArticle } from "./articles";
import { promise, runConvexEffect } from "../src/effect";

export const get = query({
  args: { articleId: v.id("articles") },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        yield* requireOwnedArticle(ctx, args.articleId);
        return yield* promise(() =>
          ctx.db
            .query("annotations")
            .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
            .unique(),
        );
      }),
    ),
});

// Agent read through the API worker's admin-authenticated Convex client.
// Bundles the article title so the notes tool is one round trip.
export const getForAgent = internalQuery({
  args: {
    userId: v.string(),
    // External id from the API worker; validate the shape at runtime.
    articleId: v.string(),
  },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const articleId = ctx.db.normalizeId("articles", args.articleId);
        if (!articleId) return null;
        const article = yield* promise(() => ctx.db.get(articleId));
        if (!article || article.userId !== args.userId) return null;
        const annotations = yield* promise(() =>
          ctx.db
            .query("annotations")
            .withIndex("by_article", (q) => q.eq("articleId", articleId))
            .unique(),
        );
        return {
          articleTitle: article.title,
          articleUrl: article.url,
          // Article blocks travel with the annotations so the MCP can resolve
          // anchor text (selected/nearby passages) in one round trip.
          blocksJson: article.blocksJson,
          annotations: annotations
            ? {
                contentWidth: annotations.contentWidth,
                strokesJson: annotations.strokesJson,
                boxesJson: annotations.boxesJson,
                notesJson: annotations.notesJson,
                memosJson: annotations.memosJson ?? "[]",
                layoutJson: annotations.layoutJson,
                updatedAt: annotations.updatedAt,
              }
            : null,
        };
      }),
    ),
});

export const save = mutation({
  args: {
    articleId: v.id("articles"),
    contentWidth: v.number(),
    strokesJson: v.string(),
    boxesJson: v.string(),
    notesJson: v.string(),
    memosJson: v.optional(v.string()),
    layoutJson: v.optional(v.string()),
  },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const article = yield* requireOwnedArticle(ctx, args.articleId);
        const existing = yield* promise(() =>
          ctx.db
            .query("annotations")
            .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
            .unique(),
        );
        const updatedAt = Date.now();
        if (existing) {
          yield* promise(() =>
            ctx.db.patch(existing._id, {
              contentWidth: args.contentWidth,
              strokesJson: args.strokesJson,
              boxesJson: args.boxesJson,
              notesJson: args.notesJson,
              // A save without memosJson (e.g. an older client) must not wipe
              // memos that are already stored.
              memosJson: args.memosJson ?? existing.memosJson ?? "[]",
              // Likewise keep the last layout snapshot if this client didn't send one.
              layoutJson: args.layoutJson ?? existing.layoutJson,
              updatedAt,
            }),
          );
        } else {
          yield* promise(() =>
            ctx.db.insert("annotations", {
              userId: article.userId,
              articleId: args.articleId,
              contentWidth: args.contentWidth,
              strokesJson: args.strokesJson,
              boxesJson: args.boxesJson,
              notesJson: args.notesJson,
              memosJson: args.memosJson ?? "[]",
              layoutJson: args.layoutJson,
              updatedAt,
            }),
          );
        }
      }),
    ),
});
