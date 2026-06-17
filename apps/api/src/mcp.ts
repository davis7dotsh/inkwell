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
  Block,
  BoxAnnotation,
  NoteAnnotation,
  ResolvedAnnotation,
  Stroke,
  VoiceMemoAnnotation,
} from "@inkwell/content";
import { z } from "zod";

import type { ConvexService } from "./convexService";
import { processArticle } from "./pipeline";
import type { PipelineEnv } from "./pipeline";
import { kindOf, normalizeUrl } from "./url";

// Clients truncate tool results (Claude Code around ~25k tokens); cap the
// article body well under that and say so, rather than truncating silently.
const MAX_ARTICLE_CHARS = 80_000;

const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** JSON column → typed array; annotation rows always hold valid JSON, but
 * never let a corrupt row take the whole tool down. */
function parseJsonArray<T>(json: string): T[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

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

/** The slice of ExecutionContext the tools need (structural, fake-able). */
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

export function buildInkwellMcp(
  userId: string,
  env: PipelineEnv,
  executionCtx: WaitUntil,
  convex: ConvexService
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
        "To save a local PDF file (no public URL), POST it as multipart",
        "form data (field name `file`) to /articles/upload on this same",
        "origin with the same Authorization header — that endpoint is plain",
        "HTTP, not an MCP tool, because file bytes don't belong in tool",
        "arguments.",
      ].join(" "),
    }
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
    async ({ url: rawUrl }) => {
      const url = normalizeUrl(rawUrl);
      if (!url) return errorResult(`Not a valid http(s) URL: ${rawUrl}`);

      const { articleId } = await convex.createPending({
        userId,
        url: url.toString(),
        kind: kindOf(url),
        title: url.toString(), // placeholder until the scrape completes
        savedAt: Date.now(),
      });
      const pipeline = processArticle({
        fetchImpl: fetch,
        env,
        articleId,
        userId,
        url: url.toString(),
        convex,
      });
      // Backstop: if the client disconnects mid-save (timeout, ctrl-C), the
      // runtime would cancel this invocation and strand the row in pending —
      // waitUntil keeps the pipeline (and its complete/fail write) running.
      // Note waitUntil only extends ~30s past a disconnect; if that ever
      // bites, the full fix is a stale-pending sweep in Convex.
      executionCtx.waitUntil(pipeline.catch(() => undefined));
      const outcome = await pipeline;

      const structuredContent =
        outcome.status === "ready"
          ? { articleId, status: outcome.status, title: outcome.title }
          : { articleId, status: outcome.status, error: outcome.error };
      const text =
        outcome.status === "ready"
          ? `Saved "${outcome.title}" (article id: ${articleId}).`
          : `Save failed: ${outcome.error} (article id: ${articleId} — ` +
            `retry by saving the same URL again).`;
      return { content: [{ type: "text", text }], structuredContent };
    }
  );

  server.registerTool(
    "list_articles",
    {
      title: "List articles",
      description:
        "List saved articles, newest first. Filter by readStatus " +
        "(unread/in_progress/read) and/or processing status " +
        "(pending/ready/failed). Returns metadata only — use get_article " +
        "for content.",
      inputSchema: {
        readStatus: z
          .enum(["unread", "in_progress", "read"])
          .optional()
          .describe("Only articles with this reading progress"),
        status: z
          .enum(["pending", "ready", "failed"])
          .optional()
          .describe("Only articles in this processing state"),
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
          })
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ readStatus, status, limit }) => {
      const rows = await convex.listArticles({
        userId,
        readStatus,
        status,
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
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ articles }) }],
        structuredContent: { articles },
      };
    }
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
    async ({ articleId, section, offset, limit }) => {
      const article = await convex.getArticle({ userId, id: articleId });
      if (!article) return errorResult(`No article with id ${articleId}.`);
      if (article.status !== "ready" || !article.blocksJson) {
        return errorResult(
          article.status === "failed"
            ? `Article "${article.title}" failed to process: ${article.error ?? "unknown error"}.`
            : `Article "${article.title}" is still processing — try again shortly.`
        );
      }

      // Recover heading semantics (numbered PDFs) so section ids and slicing
      // line up with what the reader renders.
      const blocks = inferDocumentHeadings(
        parseJsonArray<Block>(article.blocksJson)
      );
      const outline = buildDocumentOutline(blocks);
      const header = [
        `# ${article.title}`,
        article.byline ? `By: ${article.byline}` : undefined,
        article.siteName ? `Site: ${article.siteName}` : undefined,
        `Source: ${article.url}`,
        `Saved: ${new Date(article.savedAt).toISOString()}`,
        `Read status: ${article.readStatus}`,
      ]
        .filter(Boolean)
        .join("\n");

      // Section mode: just the requested heading down to the next heading of
      // the same or shallower depth (i.e. the section plus its subsections).
      if (section !== undefined) {
        const index = outline.findIndex((entry) => entry.id === section);
        if (index === -1) {
          const ids = outline.slice(0, 50).map((e) => `- ${e.id}`);
          return errorResult(
            ids.length
              ? `No section "${section}" in "${article.title}". Sections:\n${ids.join("\n")}`
              : `Article "${article.title}" has no addressable sections.`
          );
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
        const sections =
          outline.length > 0
            ? "\n" +
              ["", "## Sections"]
                .concat(
                  outline
                    .slice(0, 100)
                    .map(
                      (e) =>
                        `${"  ".repeat(e.depth)}- ${e.id} — ${truncate(e.title, 80)}`
                    )
                )
                .join("\n")
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
    }
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
    async ({ articleId }) => {
      const result = await convex.getAnnotations({ userId, articleId });
      if (!result) return errorResult(`No article with id ${articleId}.`);

      const row = result.annotations;
      const strokes = row ? parseJsonArray<Stroke>(row.strokesJson) : [];
      const boxes = row ? parseJsonArray<BoxAnnotation>(row.boxesJson) : [];
      const notes = row ? parseJsonArray<NoteAnnotation>(row.notesJson) : [];
      const memos = row
        ? parseJsonArray<VoiceMemoAnnotation>(row.memosJson)
        : [];

      // Resolve pixel anchors to text using the persisted layout snapshot. With
      // no snapshot the resolver still returns geometry + note text (anchored
      // is then false), so the output shape is stable either way.
      const snapshot = row ? parseLayoutSnapshot(row.layoutJson) : null;
      const blocks = result.blocksJson
        ? parseJsonArray<Block>(result.blocksJson)
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
    }
  );

  return server;
}
