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
      v.literal("failed")
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
      v.union(
        v.literal("unread"),
        v.literal("in_progress"),
        v.literal("read")
      )
    ),
  }).index("by_user", ["userId"]),

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
    updatedAt: v.number(),
  }).index("by_article", ["articleId"]),
});
