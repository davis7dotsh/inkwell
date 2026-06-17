// MCP server for agent access (Claude Code, scripts, anything speaking
// streamable HTTP). Stateless by design: index.ts builds a fresh server +
// transport per request — required since SDK 1.26, and the natural place to
// close every tool over the authenticated Clerk userId.
//
// Reads and writes call Convex internal functions through an admin-authenticated
// service client; saves reuse the REST pipeline but await it inline so
// the agent learns ready/failed (plus the real title) in one tool call.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  blocksToMarkdown,
  buildDocumentOutline,
  inferDocumentHeadings,
  parseLayoutSnapshot,
  resolveAnnotations,
  truncate,
} from "@inkwell/content";
import type {
  Annotations,
  ResolvedAnnotation,
} from "@inkwell/content";
import {
  BlockSchema,
  BoxAnnotationSchema,
  NoteAnnotationSchema,
  StrokeSchema,
  VoiceMemoAnnotationSchema,
  decodeTolerantJsonArray,
} from "@inkwell/content/schema";
import { Cause, Effect, Option } from "effect";
import { z } from "zod";

import { ConvexService } from "./convexService";
import { ToolOperationError, errorMessage } from "./errors";
import { processArticleEffect } from "./pipeline";
import {
  runRequestEffectTotal,
  type RequestLayer,
  type RequestServices,
} from "./requestContext";
import { CurrentUser } from "./services";
import { kindOf, normalizeUrl } from "./url";

// Clients truncate tool results (Claude Code around ~25k tokens); cap the
// article body well under that and say so, rather than truncating silently.
const MAX_ARTICLE_CHARS = 80_000;

const parseJsonArray = <T>(
  json: string,
  itemSchema: z.ZodType<T>
): T[] =>
  Option.getOrElse(
    decodeTolerantJsonArray(json, itemSchema),
    () => []
  );

const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const KIND_LABEL: Record<ResolvedAnnotation["type"], string> = {
  typed_note: "📝 note",
  voice: "🎤 voice memo",
  highlight: "🖍️ highlight",
  box: "▢ boxed section",
  pen: "✒️ pen mark",
};

/** Human-readable rendering of the resolved annotations, in reading order. */
function renderNotesText(
  title: string,
  url: string,
  annotations: ResolvedAnnotation[],
  anchored: boolean
): string {
  const lines = [`Annotations on "${title}" (${url}):`];
  if (annotations.length === 0) {
    lines.push("", "No annotations yet.");
    return lines.join("\n");
  }
  lines.push("");
  for (const a of annotations) {
    const parts = [`- ${KIND_LABEL[a.type]}`];
    if (a.sectionHeading) parts.push(` [§ ${truncate(a.sectionHeading, 80)}]`);
    if (a.note) parts.push(`: "${truncate(a.note, 200)}"`);
    else if (a.type === "voice") parts.push(": (no transcript)");
    if (a.selectedText) parts.push(` → "${truncate(a.selectedText, 200)}"`);
    else if (a.nearbyText) parts.push(` — near: "${truncate(a.nearbyText, 160)}"`);
    lines.push(parts.join(""));
  }
  if (!anchored) {
    lines.push(
      "",
      "(Anchor text unavailable — these annotations predate layout capture. " +
        "Open the article in the reader and re-save to anchor them to text.)"
    );
  }
  return lines.join("\n");
}

export type McpRequestScope = {
  readonly layer: RequestLayer;
  readonly waitUntil: (promise: Promise<unknown>) => void;
};

export function buildInkwellMcp(
  scope: McpRequestScope
): McpServer {
  const server = new McpServer(
    { name: "inkwell", version: "0.1.0" },
    {
      instructions: [
        "Inkwell is the owner's personal read-later library. Articles are",
        "scraped and parsed server-side; annotations (typed notes, voice",
        "memos, ink) are made in the reader apps.",
        "Use list_articles to find articles and their ids; get_article and",
        "get_notes take those ids. save_article accepts any http(s) URL,",
        "including direct links to PDF files.",
        "Articles carry tags and a pinned flag. Use list_tags to see the",
        "owner's tags; create_tag, rename_tag, and delete_tag manage them;",
        "add_tag_to_article and remove_tag_from_article attach or detach a",
        "tag; list_articles can filter by tagIds. set_article_pinned pins or",
        "unpins an article to the top of the library.",
        "To save a local PDF file (no public URL), POST it as multipart",
        "form data (field name `file`) to /articles/upload on this same",
        "origin with the same Authorization header — that endpoint is plain",
        "HTTP, not an MCP tool, because file bytes don't belong in tool",
        "arguments.",
      ].join(" "),
    }
  );

  const runTool = <A, E>(
    program: Effect.Effect<A, E, RequestServices>
  ): Promise<A | CallToolResult> =>
    runRequestEffectTotal(
      program,
      scope.layer,
      (cause) =>
        Effect.succeed(
          errorResult(errorMessage(Cause.squash(cause)))
        )
    );

  server.registerTool(
    "save_article",
    {
      title: "Save article",
      description:
        "Save a web article or PDF by URL. Scrapes, parses, and stores it, " +
        "then reports whether it landed as ready or failed. Takes up to a " +
        "couple of minutes for slow sites or large PDFs.",
      inputSchema: {
        url: z.string().describe("http(s) URL of the article or PDF to save"),
      },
      outputSchema: {
        articleId: z.string(),
        status: z.enum(["ready", "failed"]),
        title: z.string().optional(),
        error: z.string().optional(),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    ({ url: rawUrl }) => {
      const program = Effect.gen(function* () {
        const url = normalizeUrl(rawUrl);
        if (!url) {
          return yield* new ToolOperationError({
            message: `Not a valid http(s) URL: ${rawUrl}`,
          });
        }
        const { userId } = yield* CurrentUser;
        const convex = yield* ConvexService;
        const { articleId } = yield* convex.createPending({
          userId,
          url: url.toString(),
          kind: kindOf(url),
          title: url.toString(),
          savedAt: Date.now(),
        });
        const outcome = yield* processArticleEffect({
          articleId,
          userId,
          url: url.toString(),
        });

        const structuredContent =
          outcome.status === "ready"
            ? {
                articleId,
                status: outcome.status,
                title: outcome.title,
              }
            : {
                articleId,
                status: outcome.status,
                error: outcome.error,
              };
        const text =
          outcome.status === "ready"
            ? `Saved "${outcome.title}" (article id: ${articleId}).`
            : `Save failed: ${outcome.error} (article id: ${articleId} — ` +
              `retry by saving the same URL again).`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent,
        };
      });
      // Register the exact same, total Promise that the MCP adapter awaits.
      // There is one Effect execution and waitUntil can never observe a
      // rejection because runTool maps every cause to a tool error result.
      // This remains best-effort: Cloudflare's post-disconnect window can be
      // shorter than Firecrawl's timeout, and durable execution would require
      // a separately approved Queue or Workflow.
      const promise = runTool(program);
      scope.waitUntil(promise);
      return promise;
    }
  );

  server.registerTool(
    "list_articles",
    {
      title: "List articles",
      description:
        "List saved articles, newest first. Filter by readStatus " +
        "(unread/in_progress/read), processing status " +
        "(pending/ready/failed), and/or tagIds (article matches if it has " +
        "ANY of the given tag ids — get ids from list_tags). Each article " +
        "reports its tag ids and whether it is pinned. Returns metadata " +
        "only — use get_article for content.",
      inputSchema: {
        readStatus: z
          .enum(["unread", "in_progress", "read"])
          .optional()
          .describe("Only articles with this reading progress"),
        status: z
          .enum(["pending", "ready", "failed"])
          .optional()
          .describe("Only articles in this processing state"),
        tagIds: z
          .array(z.string())
          .optional()
          .describe(
            "Only articles tagged with ANY of these tag ids (from list_tags)"
          ),
        limit: z.number().int().min(1).max(200).optional(),
      },
      outputSchema: {
        articles: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            url: z.string(),
            kind: z.enum(["web", "pdf"]),
            status: z.enum(["pending", "ready", "failed"]),
            error: z.string().optional(),
            readStatus: z.enum(["unread", "in_progress", "read"]),
            byline: z.string().optional(),
            siteName: z.string().optional(),
            excerpt: z.string().optional(),
            savedAt: z.string(),
            pinned: z.boolean(),
            tags: z.array(z.string()),
          })
        ),
      },
      annotations: { readOnlyHint: true },
    },
    ({ readStatus, status, tagIds, limit }) =>
      runTool(
        Effect.gen(function* () {
          const { userId } = yield* CurrentUser;
          const convex = yield* ConvexService;
          const rows = yield* convex.listArticles({
            userId,
            readStatus,
            status,
            tagIds,
            limit,
          });
          const articles = rows.map((row) => ({
            id: row.id,
            title: row.title,
            url: row.url,
            kind: row.kind,
            status: row.status,
            error: row.error,
            readStatus: row.readStatus,
            byline: row.byline,
            siteName: row.siteName,
            excerpt: row.excerpt,
            savedAt: new Date(row.savedAt).toISOString(),
            pinned: row.pinned,
            tags: Array.from(row.tags),
          }));
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ articles }),
              },
            ],
            structuredContent: { articles },
          };
        })
      )
  );

  server.registerTool(
    "get_article",
    {
      title: "Get article content",
      description:
        "Fetch one article's content as Markdown, with title/byline/source " +
        "metadata. Long articles paginate: the first page lists section ids " +
        "and the character offset to continue from. Pass `section` to fetch " +
        "just one section (with its subsections), or `offset`/`limit` to page " +
        "through the body. Use the id from list_articles or save_article.",
      inputSchema: {
        articleId: z.string().describe("Article id from list_articles"),
        section: z
          .string()
          .optional()
          .describe(
            "Section id from a previous get_article response; returns just " +
              "that section and its subsections."
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Character offset into the body to start from (default 0)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_ARTICLE_CHARS)
          .optional()
          .describe(
            `Max characters to return (default and ceiling ${MAX_ARTICLE_CHARS}).`
          ),
      },
      annotations: { readOnlyHint: true },
    },
    ({ articleId, section, offset, limit }) =>
      runTool(Effect.gen(function* () {
      // Section mode and char paging are alternative retrieval modes; mixing
      // them silently drops the paging args, so reject it outright.
      if (section !== undefined && (offset !== undefined || limit !== undefined)) {
        return yield* new ToolOperationError({
          message: "Pass either `section` or `offset`/`limit`, not both.",
        });
      }
      const { userId } = yield* CurrentUser;
      const convex = yield* ConvexService;
      const article = yield* convex.getArticle({ userId, id: articleId });
      if (!article) {
        return yield* new ToolOperationError({
          message: `No article with id ${articleId}.`,
        });
      }
      if (article.status !== "ready" || !article.blocksJson) {
        return yield* new ToolOperationError({
          message:
            article.status === "failed"
            ? `Article "${article.title}" failed to process: ${article.error ?? "unknown error"}.`
            : `Article "${article.title}" is still processing — try again shortly.`,
        });
      }

      // Recover heading semantics (numbered PDFs) so section ids and slicing
      // line up with what the reader renders.
      const blocks = inferDocumentHeadings(
        parseJsonArray(article.blocksJson, BlockSchema)
      );
      const outline = buildDocumentOutline(blocks);
      const header = [
        `# ${article.title}`,
        article.byline ? `By: ${article.byline}` : undefined,
        article.siteName ? `Site: ${article.siteName}` : undefined,
        `Source: ${article.url}`,
        `Saved: ${new Date(article.savedAt).toISOString()}`,
        `Read status: ${article.readStatus}`,
        `Pinned: ${article.pinned ? "yes" : "no"}`,
        article.tags.length > 0
          ? `Tags: ${article.tags.join(", ")}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n");

      // Section mode: just the requested heading down to the next heading of
      // the same or shallower depth (i.e. the section plus its subsections).
      if (section !== undefined) {
        const index = outline.findIndex((entry) => entry.id === section);
        if (index === -1) {
          const ids = outline.slice(0, 50).map((e) => `- ${e.id}`);
          return yield* new ToolOperationError({
            message:
              ids.length
              ? `No section "${section}" in "${article.title}". Sections:\n${ids.join("\n")}`
              : `Article "${article.title}" has no addressable sections.`,
          });
        }
        const entry = outline[index];
        const next = outline
          .slice(index + 1)
          .find((e) => e.depth <= entry.depth);
        const end = next ? next.blockIndex : blocks.length;
        let body = blocksToMarkdown(blocks.slice(entry.blockIndex, end));
        let note = "";
        if (body.length > MAX_ARTICLE_CHARS) {
          body = body.slice(0, MAX_ARTICLE_CHARS);
          note = `\n\n[Section truncated at ${MAX_ARTICLE_CHARS} characters.]`;
        }
        return {
          content: [
            {
              type: "text",
              text: `${header}\nSection: ${entry.title}\n\n---\n\n${body}${note}`,
            },
          ],
        };
      }

      const markdown = blocksToMarkdown(blocks);
      const cap = limit ?? MAX_ARTICLE_CHARS;
      const start = offset ?? 0;
      const slice = markdown.slice(start, start + cap);
      const end = start + slice.length;
      const footer =
        end < markdown.length
          ? `\n\n[${markdown.length} characters total; returned ${start}–${end}. ` +
            `Continue with offset=${end}, or pass section="<id>" to jump.]`
          : "";

      // First page carries the metadata header and the section map; later
      // pages stay lean so the agent isn't re-billed for navigation chrome.
      if (start === 0) {
        const SHOWN_SECTIONS = 100;
        const sectionLines = outline
          .slice(0, SHOWN_SECTIONS)
          .map((e) => `${"  ".repeat(e.depth)}- ${e.id} — ${truncate(e.title, 80)}`);
        if (outline.length > SHOWN_SECTIONS) {
          sectionLines.push(
            `- … ${outline.length - SHOWN_SECTIONS} more sections not shown`
          );
        }
        const sections =
          outline.length > 0
            ? "\n" + ["", "## Sections", ...sectionLines].join("\n")
            : "";
        return {
          content: [
            { type: "text", text: `${header}${sections}\n\n---\n\n${slice}${footer}` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text:
              `# ${article.title} (continued, characters ${start}–${end})` +
              `\n\n---\n\n${slice}${footer}`,
          },
        ],
      };
      }))
  );

  server.registerTool(
    "get_notes",
    {
      title: "Get notes",
      description:
        "Fetch the owner's annotations on an article, each anchored to the " +
        "text it targets, in reading order: typed notes and voice memos with " +
        "their nearby passage; highlights, boxes, and pen marks with the text " +
        "they cover; plus the section heading and block-derived character " +
        "offsets. `anchored` is false when the annotations predate layout " +
        "capture (geometry only — no anchor text).",
      inputSchema: {
        articleId: z.string().describe("Article id from list_articles"),
      },
      outputSchema: {
        articleTitle: z.string(),
        articleUrl: z.string(),
        anchored: z
          .boolean()
          .describe("Whether anchor text could be resolved for this article."),
        annotations: z.array(
          z.object({
            id: z.string(),
            type: z.enum(["typed_note", "highlight", "box", "pen", "voice"]),
            note: z.string().optional(),
            selectedText: z.string().optional(),
            nearbyText: z.string().optional(),
            sectionHeading: z.string().optional(),
            startOffset: z.number().optional(),
            endOffset: z.number().optional(),
            boundingBox: z
              .object({
                x: z.number(),
                y: z.number(),
                w: z.number(),
                h: z.number(),
              })
              .optional(),
          })
        ),
        summary: z.object({
          typedNotes: z.number(),
          voiceMemos: z.number(),
          boxes: z.number(),
          highlightStrokes: z.number(),
          penStrokes: z.number(),
        }),
        updatedAt: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ articleId }) =>
      runTool(Effect.gen(function* () {
      const { userId } = yield* CurrentUser;
      const convex = yield* ConvexService;
      const result = yield* convex.getAnnotations({ userId, articleId });
      if (!result) {
        return yield* new ToolOperationError({
          message: `No article with id ${articleId}.`,
        });
      }

      const row = result.annotations;
      const strokes = row
        ? parseJsonArray(row.strokesJson, StrokeSchema)
        : [];
      const boxes = row
        ? parseJsonArray(
            row.boxesJson,
            BoxAnnotationSchema
          )
        : [];
      const notes = row
        ? parseJsonArray(
            row.notesJson,
            NoteAnnotationSchema
          )
        : [];
      const memos = row
        ? parseJsonArray(
            row.memosJson,
            VoiceMemoAnnotationSchema
          )
        : [];

      // Resolve pixel anchors to text using the persisted layout snapshot. With
      // no snapshot the resolver still returns geometry + note text (anchored
      // is then false), so the output shape is stable either way.
      const snapshot = row ? parseLayoutSnapshot(row.layoutJson) : null;
      const blocks = result.blocksJson
        ? parseJsonArray(result.blocksJson, BlockSchema)
        : [];
      const anchored = Boolean(snapshot && blocks.length > 0);

      let annotations: ResolvedAnnotation[] = [];
      if (row) {
        const set: Annotations = {
          contentWidth: row.contentWidth,
          strokes,
          boxes,
          notes,
          memos,
        };
        const scale =
          snapshot && row.contentWidth > 0
            ? snapshot.width / row.contentWidth
            : 1;
        annotations = resolveAnnotations(
          blocks,
          set,
          snapshot?.layouts ?? new Map(),
          scale
        );
      }

      // Summary mirrors what's returned, so counts and the array never diverge.
      const countOf = (type: ResolvedAnnotation["type"]) =>
        annotations.filter((a) => a.type === type).length;
      const structuredContent = {
        articleTitle: result.articleTitle,
        articleUrl: result.articleUrl,
        anchored,
        annotations,
        summary: {
          typedNotes: countOf("typed_note"),
          voiceMemos: countOf("voice"),
          boxes: countOf("box"),
          highlightStrokes: countOf("highlight"),
          penStrokes: countOf("pen"),
        },
        updatedAt: row ? new Date(row.updatedAt).toISOString() : undefined,
      };

      return {
        content: [
          {
            type: "text",
            text: renderNotesText(
              result.articleTitle,
              result.articleUrl,
              annotations,
              anchored
            ),
          },
        ],
        structuredContent,
      };
      }))
  );

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description:
        "List the owner's tags. Use the returned ids with " +
        "add_tag_to_article, remove_tag_from_article, and the tagIds filter " +
        "on list_articles.",
      inputSchema: {},
      outputSchema: {
        tags: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            color: z.string().optional(),
            createdAt: z.string(),
          })
        ),
      },
      annotations: { readOnlyHint: true },
    },
    () =>
      runTool(
        Effect.gen(function* () {
          const { userId } = yield* CurrentUser;
          const convex = yield* ConvexService;
          const rows = yield* convex.listTags({ userId });
          const tags = rows.map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            createdAt: new Date(tag.createdAt).toISOString(),
          }));
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ tags }),
              },
            ],
            structuredContent: { tags },
          };
        })
      )
  );

  server.registerTool(
    "create_tag",
    {
      title: "Create tag",
      description:
        "Create a tag by name (optionally with a color). Idempotent: if a " +
        "tag with that name already exists (case-insensitive), the existing " +
        "tag is returned instead of creating a duplicate.",
      inputSchema: {
        name: z.string().min(1).describe("Tag name"),
        color: z
          .string()
          .optional()
          .describe("Optional color (e.g. a hex string) for the tag"),
      },
      outputSchema: {
        id: z.string(),
        name: z.string(),
        color: z.string().optional(),
      },
      annotations: { destructiveHint: false },
    },
    ({ name, color }) =>
      runTool(
        Effect.gen(function* () {
          const { userId } = yield* CurrentUser;
          const convex = yield* ConvexService;
          const tag = yield* convex.createTag({ userId, name, color });
          const structuredContent = {
            id: tag.id,
            name: tag.name,
            color: tag.color,
          };
          return {
            content: [
              {
                type: "text" as const,
                text: `Tag "${tag.name}" (id: ${tag.id}).`,
              },
            ],
            structuredContent,
          };
        })
      )
  );

  server.registerTool(
    "rename_tag",
    {
      title: "Rename tag",
      description: "Rename an existing tag. Use the id from list_tags.",
      inputSchema: {
        tagId: z.string().describe("Tag id from list_tags"),
        name: z.string().min(1).describe("New tag name"),
      },
      outputSchema: { ok: z.boolean() },
      annotations: { destructiveHint: false },
    },
    ({ tagId, name }) =>
      runTool(
        Effect.gen(function* () {
          const { userId } = yield* CurrentUser;
          const convex = yield* ConvexService;
          yield* convex.renameTag({ userId, tagId, name });
          return {
            content: [
              {
                type: "text" as const,
                text: `Renamed tag ${tagId} to "${name}".`,
              },
            ],
            structuredContent: { ok: true },
          };
        })
      )
  );

  server.registerTool(
    "delete_tag",
    {
      title: "Delete tag",
      description:
        "Delete a tag. This also detaches it from every article it is on. " +
        "Use the id from list_tags.",
      inputSchema: {
        tagId: z.string().describe("Tag id from list_tags"),
      },
      outputSchema: { ok: z.boolean() },
      annotations: { destructiveHint: true },
    },
    ({ tagId }) =>
      runTool(
        Effect.gen(function* () {
          const { userId } = yield* CurrentUser;
          const convex = yield* ConvexService;
          yield* convex.removeTag({ userId, tagId });
          return {
            content: [
              {
                type: "text" as const,
                text: `Deleted tag ${tagId}.`,
              },
            ],
            structuredContent: { ok: true },
          };
        })
      )
  );

  server.registerTool(
    "add_tag_to_article",
    {
      title: "Add tag to article",
      description:
        "Attach a tag to an article. Idempotent: re-adding a tag the " +
        "article already has is a no-op. Use ids from list_articles and " +
        "list_tags.",
      inputSchema: {
        articleId: z.string().describe("Article id from list_articles"),
        tagId: z.string().describe("Tag id from list_tags"),
      },
      outputSchema: { ok: z.boolean() },
      annotations: { destructiveHint: false },
    },
    ({ articleId, tagId }) =>
      runTool(
        Effect.gen(function* () {
          const { userId } = yield* CurrentUser;
          const convex = yield* ConvexService;
          yield* convex.addTagToArticle({ userId, articleId, tagId });
          return {
            content: [
              {
                type: "text" as const,
                text: `Added tag ${tagId} to article ${articleId}.`,
              },
            ],
            structuredContent: { ok: true },
          };
        })
      )
  );

  server.registerTool(
    "remove_tag_from_article",
    {
      title: "Remove tag from article",
      description:
        "Detach a tag from an article. Use ids from list_articles and " +
        "list_tags.",
      inputSchema: {
        articleId: z.string().describe("Article id from list_articles"),
        tagId: z.string().describe("Tag id from list_tags"),
      },
      outputSchema: { ok: z.boolean() },
      annotations: { destructiveHint: true },
    },
    ({ articleId, tagId }) =>
      runTool(
        Effect.gen(function* () {
          const { userId } = yield* CurrentUser;
          const convex = yield* ConvexService;
          yield* convex.removeTagFromArticle({
            userId,
            articleId,
            tagId,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Removed tag ${tagId} from article ${articleId}.`,
              },
            ],
            structuredContent: { ok: true },
          };
        })
      )
  );

  server.registerTool(
    "set_article_pinned",
    {
      title: "Pin or unpin article",
      description:
        "Pin or unpin an article. Pinned articles sort to the top of the " +
        "library. Use the id from list_articles.",
      inputSchema: {
        articleId: z.string().describe("Article id from list_articles"),
        pinned: z
          .boolean()
          .describe("true to pin to the top, false to unpin"),
      },
      outputSchema: { ok: z.boolean() },
      annotations: { destructiveHint: false },
    },
    ({ articleId, pinned }) =>
      runTool(
        Effect.gen(function* () {
          const { userId } = yield* CurrentUser;
          const convex = yield* ConvexService;
          yield* convex.setArticlePinned({
            userId,
            id: articleId,
            pinned,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `${
                  pinned ? "Pinned" : "Unpinned"
                } article ${articleId}.`,
              },
            ],
            structuredContent: { ok: true },
          };
        })
      )
  );

  return server;
}
