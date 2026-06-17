// Tags: user-owned labels for organizing the library, plus the article<->tag
// join. Mirrors articles.ts — user-facing query/mutation for the apps, and
// internal *ForAgent variants the API worker drives over its admin Convex
// client (ctx.auth is empty there, so it passes the resolved userId).
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireUserId } from "./articles";

async function requireOwnedTag(
  ctx: QueryCtx,
  id: Id<"tags">
): Promise<Doc<"tags">> {
  const userId = await requireUserId(ctx);
  const tag = await ctx.db.get(id);
  if (!tag || tag.userId !== userId) throw new Error("Tag not found");
  return tag;
}

// Tags compare case-insensitively for dedupe and rename collisions.
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function findTagByName(
  ctx: QueryCtx,
  userId: string,
  name: string
): Promise<Doc<"tags"> | null> {
  const tags = await ctx.db
    .query("tags")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return tags.find((tag) => sameName(tag.name, name)) ?? null;
}

// Insert a tag, or return the existing one with the same name. Idempotent so
// agents and the apps can "ensure" a tag without racing duplicates.
async function ensureTag(
  ctx: MutationCtx,
  userId: string,
  rawName: string,
  color?: string
): Promise<Id<"tags">> {
  const name = rawName.trim();
  if (!name) throw new Error("Tag name cannot be empty");
  const existing = await findTagByName(ctx, userId, name);
  if (existing) return existing._id;
  return await ctx.db.insert("tags", {
    userId,
    name,
    color: color?.trim() || undefined,
    createdAt: Date.now(),
  });
}

async function deleteTagAndLinks(
  ctx: MutationCtx,
  tagId: Id<"tags">
): Promise<void> {
  const links = await ctx.db
    .query("articleTags")
    .withIndex("by_tag", (q) => q.eq("tagId", tagId))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }
  await ctx.db.delete(tagId);
}

// ---- User-facing (Clerk-authenticated apps) ----

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    tags.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    return tags;
  },
});

export const create = mutation({
  args: { name: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await ensureTag(ctx, userId, args.name, args.color);
  },
});

export const rename = mutation({
  args: { id: v.id("tags"), name: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireOwnedTag(ctx, args.id);
    const name = args.name.trim();
    if (!name) throw new Error("Tag name cannot be empty");
    const clash = await findTagByName(ctx, userId, name);
    if (clash && clash._id !== args.id) {
      throw new Error("A tag with that name already exists");
    }
    await ctx.db.patch(args.id, { name });
  },
});

export const setColor = mutation({
  args: { id: v.id("tags"), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireOwnedTag(ctx, args.id);
    await ctx.db.patch(args.id, { color: args.color?.trim() || undefined });
  },
});

export const remove = mutation({
  args: { id: v.id("tags") },
  handler: async (ctx, args) => {
    await requireOwnedTag(ctx, args.id);
    await deleteTagAndLinks(ctx, args.id);
  },
});

export const addToArticle = mutation({
  args: { articleId: v.id("articles"), tagId: v.id("tags") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const article = await ctx.db.get(args.articleId);
    if (!article || article.userId !== userId) {
      throw new Error("Article not found");
    }
    await requireOwnedTag(ctx, args.tagId);
    const existing = await ctx.db
      .query("articleTags")
      .withIndex("by_article_tag", (q) =>
        q.eq("articleId", args.articleId).eq("tagId", args.tagId)
      )
      .unique();
    if (existing) return; // already attached — no-op
    await ctx.db.insert("articleTags", {
      userId,
      articleId: args.articleId,
      tagId: args.tagId,
    });
  },
});

export const removeFromArticle = mutation({
  args: { articleId: v.id("articles"), tagId: v.id("tags") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const article = await ctx.db.get(args.articleId);
    if (!article || article.userId !== userId) {
      throw new Error("Article not found");
    }
    const existing = await ctx.db
      .query("articleTags")
      .withIndex("by_article_tag", (q) =>
        q.eq("articleId", args.articleId).eq("tagId", args.tagId)
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// ---- Agent (API worker over admin Convex client) ----

export const listForAgent = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    tags.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    return tags.map((tag) => ({
      id: tag._id,
      name: tag.name,
      color: tag.color,
      createdAt: tag.createdAt,
    }));
  },
});

export const createForAgent = internalMutation({
  args: { userId: v.string(), name: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tagId = await ensureTag(ctx, args.userId, args.name, args.color);
    const tag = await ctx.db.get(tagId);
    return { id: tagId, name: tag!.name, color: tag!.color };
  },
});

export const renameForAgent = internalMutation({
  args: { userId: v.string(), tagId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const tagId = ctx.db.normalizeId("tags", args.tagId);
    if (!tagId) throw new Error("Tag not found");
    const tag = await ctx.db.get(tagId);
    if (!tag || tag.userId !== args.userId) throw new Error("Tag not found");
    const name = args.name.trim();
    if (!name) throw new Error("Tag name cannot be empty");
    const clash = await findTagByName(ctx, args.userId, name);
    if (clash && clash._id !== tagId) {
      throw new Error("A tag with that name already exists");
    }
    await ctx.db.patch(tagId, { name });
    return { ok: true };
  },
});

export const removeForAgent = internalMutation({
  args: { userId: v.string(), tagId: v.string() },
  handler: async (ctx, args) => {
    const tagId = ctx.db.normalizeId("tags", args.tagId);
    if (!tagId) throw new Error("Tag not found");
    const tag = await ctx.db.get(tagId);
    if (!tag || tag.userId !== args.userId) throw new Error("Tag not found");
    await deleteTagAndLinks(ctx, tagId);
    return { ok: true };
  },
});

export const addToArticleForAgent = internalMutation({
  args: { userId: v.string(), articleId: v.string(), tagId: v.string() },
  handler: async (ctx, args) => {
    const articleId = ctx.db.normalizeId("articles", args.articleId);
    const tagId = ctx.db.normalizeId("tags", args.tagId);
    if (!articleId || !tagId) throw new Error("Not found");
    const article = await ctx.db.get(articleId);
    if (!article || article.userId !== args.userId) {
      throw new Error("Article not found");
    }
    const tag = await ctx.db.get(tagId);
    if (!tag || tag.userId !== args.userId) throw new Error("Tag not found");
    const existing = await ctx.db
      .query("articleTags")
      .withIndex("by_article_tag", (q) =>
        q.eq("articleId", articleId).eq("tagId", tagId)
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("articleTags", {
        userId: args.userId,
        articleId,
        tagId,
      });
    }
    return { ok: true };
  },
});

export const removeFromArticleForAgent = internalMutation({
  args: { userId: v.string(), articleId: v.string(), tagId: v.string() },
  handler: async (ctx, args) => {
    const articleId = ctx.db.normalizeId("articles", args.articleId);
    const tagId = ctx.db.normalizeId("tags", args.tagId);
    if (!articleId || !tagId) throw new Error("Not found");
    const article = await ctx.db.get(articleId);
    if (!article || article.userId !== args.userId) {
      throw new Error("Article not found");
    }
    const existing = await ctx.db
      .query("articleTags")
      .withIndex("by_article_tag", (q) =>
        q.eq("articleId", articleId).eq("tagId", tagId)
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return { ok: true };
  },
});
