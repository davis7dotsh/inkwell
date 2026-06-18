// Tags: user-owned labels for organizing the library, plus the article<->tag
// join. Mirrors articles.ts — user-facing query/mutation for the apps, and
// internal *ForAgent variants the API worker drives over its admin Convex
// client (ctx.auth is empty there, so it passes the resolved userId).
import { v } from "convex/values";
import { Effect } from "effect";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireUserId } from "./articles";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  OwnershipError,
  ValidationError,
} from "../src/domainErrors";
import { promise, runConvexEffect } from "../src/effect";

function requireOwnedTag(
  ctx: QueryCtx,
  id: Id<"tags">,
): Effect.Effect<
  Doc<"tags">,
  AuthenticationError | NotFoundError | OwnershipError
> {
  return Effect.gen(function* () {
    const userId = yield* requireUserId(ctx);
    const tag = yield* promise(() => ctx.db.get(id));
    if (!tag) {
      return yield* new NotFoundError({ message: "Tag not found" });
    }
    if (tag.userId !== userId) {
      return yield* new OwnershipError({ message: "Tag not found" });
    }
    return tag;
  });
}

// Tags compare case-insensitively for dedupe and rename collisions.
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function findTagByName(
  ctx: QueryCtx,
  userId: string,
  name: string,
): Effect.Effect<Doc<"tags"> | null> {
  return Effect.gen(function* () {
    const tags = yield* promise(() =>
      ctx.db
        .query("tags")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );
    return tags.find((tag) => sameName(tag.name, name)) ?? null;
  });
}

// Insert a tag, or return the existing one with the same name. Idempotent so
// agents and the apps can "ensure" a tag without racing duplicates.
function ensureTag(
  ctx: MutationCtx,
  userId: string,
  rawName: string,
  color?: string,
): Effect.Effect<Id<"tags">, ValidationError> {
  return Effect.gen(function* () {
    const name = rawName.trim();
    if (!name) {
      return yield* new ValidationError({
        message: "Tag name cannot be empty",
      });
    }
    const existing = yield* findTagByName(ctx, userId, name);
    if (existing) return existing._id;
    return yield* promise(() =>
      ctx.db.insert("tags", {
        userId,
        name,
        color: color?.trim() || undefined,
        createdAt: Date.now(),
      }),
    );
  });
}

function deleteTagAndLinks(
  ctx: MutationCtx,
  tagId: Id<"tags">,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const links = yield* promise(() =>
      ctx.db
        .query("articleTags")
        .withIndex("by_tag", (q) => q.eq("tagId", tagId))
        .collect(),
    );
    for (const link of links) {
      yield* promise(() => ctx.db.delete(link._id));
    }
    yield* promise(() => ctx.db.delete(tagId));
  });
}

// ---- User-facing (Clerk-authenticated apps) ----

export const list = query({
  args: {},
  handler: (ctx) =>
    runConvexEffect(
      Effect.gen(function* () {
        const userId = yield* requireUserId(ctx);
        const tags = yield* promise(() =>
          ctx.db
            .query("tags")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect(),
        );
        tags.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );
        return tags;
      }),
    ),
});

export const create = mutation({
  args: { name: v.string(), color: v.optional(v.string()) },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const userId = yield* requireUserId(ctx);
        return yield* ensureTag(ctx, userId, args.name, args.color);
      }),
    ),
});

export const rename = mutation({
  args: { id: v.id("tags"), name: v.string() },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const userId = yield* requireUserId(ctx);
        yield* requireOwnedTag(ctx, args.id);
        const name = args.name.trim();
        if (!name) {
          return yield* new ValidationError({
            message: "Tag name cannot be empty",
          });
        }
        const clash = yield* findTagByName(ctx, userId, name);
        if (clash && clash._id !== args.id) {
          return yield* new ConflictError({
            message: "A tag with that name already exists",
          });
        }
        yield* promise(() => ctx.db.patch(args.id, { name }));
      }),
    ),
});

export const setColor = mutation({
  args: { id: v.id("tags"), color: v.optional(v.string()) },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        yield* requireOwnedTag(ctx, args.id);
        yield* promise(() =>
          ctx.db.patch(args.id, {
            color: args.color?.trim() || undefined,
          }),
        );
      }),
    ),
});

export const remove = mutation({
  args: { id: v.id("tags") },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        yield* requireOwnedTag(ctx, args.id);
        yield* deleteTagAndLinks(ctx, args.id);
      }),
    ),
});

export const addToArticle = mutation({
  args: { articleId: v.id("articles"), tagId: v.id("tags") },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const userId = yield* requireUserId(ctx);
        const article = yield* promise(() => ctx.db.get(args.articleId));
        if (!article) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        if (article.userId !== userId) {
          return yield* new OwnershipError({ message: "Article not found" });
        }
        yield* requireOwnedTag(ctx, args.tagId);
        const existing = yield* promise(() =>
          ctx.db
            .query("articleTags")
            .withIndex("by_article_tag", (q) =>
              q.eq("articleId", args.articleId).eq("tagId", args.tagId),
            )
            .unique(),
        );
        if (existing) return; // already attached — no-op
        yield* promise(() =>
          ctx.db.insert("articleTags", {
            userId,
            articleId: args.articleId,
            tagId: args.tagId,
          }),
        );
      }),
    ),
});

export const removeFromArticle = mutation({
  args: { articleId: v.id("articles"), tagId: v.id("tags") },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const userId = yield* requireUserId(ctx);
        const article = yield* promise(() => ctx.db.get(args.articleId));
        if (!article) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        if (article.userId !== userId) {
          return yield* new OwnershipError({ message: "Article not found" });
        }
        const existing = yield* promise(() =>
          ctx.db
            .query("articleTags")
            .withIndex("by_article_tag", (q) =>
              q.eq("articleId", args.articleId).eq("tagId", args.tagId),
            )
            .unique(),
        );
        if (existing) {
          yield* promise(() => ctx.db.delete(existing._id));
        }
      }),
    ),
});

// ---- Agent (API worker over admin Convex client) ----

export const listForAgent = internalQuery({
  args: { userId: v.string() },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const tags = yield* promise(() =>
          ctx.db
            .query("tags")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .collect(),
        );
        tags.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );
        return tags.map((tag) => ({
          id: tag._id,
          name: tag.name,
          color: tag.color,
          createdAt: tag.createdAt,
        }));
      }),
    ),
});

export const createForAgent = internalMutation({
  args: { userId: v.string(), name: v.string(), color: v.optional(v.string()) },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const tagId = yield* ensureTag(ctx, args.userId, args.name, args.color);
        const tag = yield* promise(() => ctx.db.get(tagId));
        return { id: tagId, name: tag!.name, color: tag!.color };
      }),
    ),
});

export const renameForAgent = internalMutation({
  args: { userId: v.string(), tagId: v.string(), name: v.string() },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const tagId = ctx.db.normalizeId("tags", args.tagId);
        if (!tagId) {
          return yield* new NotFoundError({ message: "Tag not found" });
        }
        const tag = yield* promise(() => ctx.db.get(tagId));
        if (!tag) {
          return yield* new NotFoundError({ message: "Tag not found" });
        }
        if (tag.userId !== args.userId) {
          return yield* new OwnershipError({ message: "Tag not found" });
        }
        const name = args.name.trim();
        if (!name) {
          return yield* new ValidationError({
            message: "Tag name cannot be empty",
          });
        }
        const clash = yield* findTagByName(ctx, args.userId, name);
        if (clash && clash._id !== tagId) {
          return yield* new ConflictError({
            message: "A tag with that name already exists",
          });
        }
        yield* promise(() => ctx.db.patch(tagId, { name }));
        return { ok: true };
      }),
    ),
});

export const removeForAgent = internalMutation({
  args: { userId: v.string(), tagId: v.string() },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const tagId = ctx.db.normalizeId("tags", args.tagId);
        if (!tagId) {
          return yield* new NotFoundError({ message: "Tag not found" });
        }
        const tag = yield* promise(() => ctx.db.get(tagId));
        if (!tag) {
          return yield* new NotFoundError({ message: "Tag not found" });
        }
        if (tag.userId !== args.userId) {
          return yield* new OwnershipError({ message: "Tag not found" });
        }
        yield* deleteTagAndLinks(ctx, tagId);
        return { ok: true };
      }),
    ),
});

export const addToArticleForAgent = internalMutation({
  args: { userId: v.string(), articleId: v.string(), tagId: v.string() },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const articleId = ctx.db.normalizeId("articles", args.articleId);
        const tagId = ctx.db.normalizeId("tags", args.tagId);
        if (!articleId || !tagId) {
          return yield* new NotFoundError({ message: "Not found" });
        }
        const article = yield* promise(() => ctx.db.get(articleId));
        if (!article) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        if (article.userId !== args.userId) {
          return yield* new OwnershipError({ message: "Article not found" });
        }
        const tag = yield* promise(() => ctx.db.get(tagId));
        if (!tag) {
          return yield* new NotFoundError({ message: "Tag not found" });
        }
        if (tag.userId !== args.userId) {
          return yield* new OwnershipError({ message: "Tag not found" });
        }
        const existing = yield* promise(() =>
          ctx.db
            .query("articleTags")
            .withIndex("by_article_tag", (q) =>
              q.eq("articleId", articleId).eq("tagId", tagId),
            )
            .unique(),
        );
        if (!existing) {
          yield* promise(() =>
            ctx.db.insert("articleTags", {
              userId: args.userId,
              articleId,
              tagId,
            }),
          );
        }
        return { ok: true };
      }),
    ),
});

export const removeFromArticleForAgent = internalMutation({
  args: { userId: v.string(), articleId: v.string(), tagId: v.string() },
  handler: (ctx, args) =>
    runConvexEffect(
      Effect.gen(function* () {
        const articleId = ctx.db.normalizeId("articles", args.articleId);
        const tagId = ctx.db.normalizeId("tags", args.tagId);
        if (!articleId || !tagId) {
          return yield* new NotFoundError({ message: "Not found" });
        }
        const article = yield* promise(() => ctx.db.get(articleId));
        if (!article) {
          return yield* new NotFoundError({ message: "Article not found" });
        }
        if (article.userId !== args.userId) {
          return yield* new OwnershipError({ message: "Article not found" });
        }
        const existing = yield* promise(() =>
          ctx.db
            .query("articleTags")
            .withIndex("by_article_tag", (q) =>
              q.eq("articleId", articleId).eq("tagId", tagId),
            )
            .unique(),
        );
        if (existing) {
          yield* promise(() => ctx.db.delete(existing._id));
        }
        return { ok: true };
      }),
    ),
});
