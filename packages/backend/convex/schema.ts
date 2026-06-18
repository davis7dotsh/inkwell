import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  articles: defineTable({
    userId: v.string(), // Clerk user id (identity.subject)
    url: v.string(),
    kind: v.union(v.literal("web"), v.literal("pdf")),
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    title: v.string(), // url until scrape completes
    byline: v.optional(v.string()),
    siteName: v.optional(v.string()),
    excerpt: v.optional(v.string()),
    blocksJson: v.optional(v.string()), // JSON.stringify(Block[]) — string to dodge deep validators; Convex doc limit ~1MB, fine for articles
    savedAt: v.number(), // Date.now() at save
    // Reading progress. Optional: rows written before this field existed are
    // treated as "unread" by clients.
    readStatus: v.optional(
      v.union(v.literal("unread"), v.literal("in_progress"), v.literal("read")),
    ),
    // Pin to the top of the library. Optional: legacy rows are treated as
    // not pinned.
    pinned: v.optional(v.boolean()),
  }).index("by_user", ["userId"]),

  // User-owned tags for organizing the library. One row per (user, tag name).
  tags: defineTable({
    userId: v.string(), // Clerk user id (identity.subject)
    name: v.string(),
    color: v.optional(v.string()), // hex like "#3b82f6"; absent => client default
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Join table: which tags are attached to which article. Carries userId so the
  // library list can fetch every link for a user in one indexed query.
  articleTags: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    tagId: v.id("tags"),
  })
    .index("by_user", ["userId"])
    .index("by_article", ["articleId"])
    .index("by_tag", ["tagId"])
    .index("by_article_tag", ["articleId", "tagId"]),

  annotations: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    contentWidth: v.number(),
    strokesJson: v.string(), // JSON-encoded arrays (ink can be large)
    boxesJson: v.string(),
    notesJson: v.string(),
    // Optional: rows written before voice memos existed lack it; clients
    // treat undefined as "[]". Audio lives in R2 keyed by (user, article,
    // memo id) — this carries only placement + transcript + upload status.
    memosJson: v.optional(v.string()),
    // Optional snapshot of the per-block layout the reader measured when these
    // annotations were saved: `{ width, layouts: [[blockIndex, {y, height}]] }`.
    // Lets the agent API map pixel-anchored annotations back onto article text.
    // Absent on legacy rows and older clients.
    layoutJson: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_article", ["articleId"]),
});
