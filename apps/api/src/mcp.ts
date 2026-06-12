// MCP server for agent access (Claude Code, scripts, anything speaking
// streamable HTTP). Stateless by design: index.ts builds a fresh server +
// transport per request — required since SDK 1.26, and the natural place to
// close every tool over the authenticated Clerk userId.
//
// Reads go through the /agent/* Convex HTTP actions (convexService.ts);
// saves reuse the same pipeline as the REST routes but await it inline so
// the agent learns ready/failed (plus the real title) in one tool call.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { blocksToMarkdown } from "@inkwell/content";
import type {
  Block,
  BoxAnnotation,
  NoteAnnotation,
  Stroke,
  VoiceMemoAnnotation,
} from "@inkwell/content";
import { z } from "zod";

import { createPending, getAnnotations, getArticle, listArticles } from "./convexService";
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

const byReadingOrder = (a: { y: number }, b: { y: number }) => a.y - b.y;

/** The slice of ExecutionContext the tools need (structural, fake-able). */
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

export function buildInkwellMcp(
  userId: string,
  env: PipelineEnv,
  executionCtx: WaitUntil
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

      const { articleId } = await createPending(
        fetch,
        env.CONVEX_SITE_URL,
        env.WORKER_SHARED_SECRET,
        {
          userId,
          url: url.toString(),
          kind: kindOf(url),
          title: url.toString(), // placeholder until the scrape completes
          savedAt: Date.now(),
        }
      );
      const pipeline = processArticle({
        fetchImpl: fetch,
        env,
        articleId,
        userId,
        url: url.toString(),
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
      const rows = await listArticles(
        fetch,
        env.CONVEX_SITE_URL,
        env.WORKER_SHARED_SECRET,
        { userId, readStatus, status, limit }
      );
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
        "metadata. Use the id from list_articles or save_article.",
      inputSchema: {
        articleId: z.string().describe("Article id from list_articles"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ articleId }) => {
      const article = await getArticle(
        fetch,
        env.CONVEX_SITE_URL,
        env.WORKER_SHARED_SECRET,
        { userId, id: articleId }
      );
      if (!article) return errorResult(`No article with id ${articleId}.`);
      if (article.status !== "ready" || !article.blocksJson) {
        return errorResult(
          article.status === "failed"
            ? `Article "${article.title}" failed to process: ${article.error ?? "unknown error"}.`
            : `Article "${article.title}" is still processing — try again shortly.`
        );
      }

      let markdown = blocksToMarkdown(
        parseJsonArray<Block>(article.blocksJson)
      );
      if (markdown.length > MAX_ARTICLE_CHARS) {
        markdown =
          markdown.slice(0, MAX_ARTICLE_CHARS) +
          `\n\n[Truncated — ${markdown.length} characters total.]`;
      }
      const header = [
        `# ${article.title}`,
        article.byline ? `By: ${article.byline}` : undefined,
        article.siteName ? `Site: ${article.siteName}` : undefined,
        `Source: ${article.url}`,
        `Saved: ${new Date(article.savedAt).toISOString()}`,
        `Read status: ${article.readStatus ?? "unread"}`,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: [{ type: "text", text: `${header}\n\n---\n\n${markdown}` }],
      };
    }
  );

  server.registerTool(
    "get_notes",
    {
      title: "Get notes",
      description:
        "Fetch the owner's annotations on an article: typed notes and voice " +
        "memo transcripts in reading order, plus counts of ink markup " +
        "(boxes, highlights, pen strokes) that only render visually.",
      inputSchema: {
        articleId: z.string().describe("Article id from list_articles"),
      },
      outputSchema: {
        articleTitle: z.string(),
        articleUrl: z.string(),
        notes: z.array(z.string()),
        voiceMemoTranscripts: z.array(z.string()),
        boxCount: z.number(),
        highlightStrokeCount: z.number(),
        penStrokeCount: z.number(),
        updatedAt: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ articleId }) => {
      const result = await getAnnotations(
        fetch,
        env.CONVEX_SITE_URL,
        env.WORKER_SHARED_SECRET,
        { userId, articleId }
      );
      if (!result) return errorResult(`No article with id ${articleId}.`);

      const row = result.annotations;
      const notes = row
        ? parseJsonArray<NoteAnnotation>(row.notesJson)
            .sort(byReadingOrder)
            .map((note) => note.text.trim())
            .filter(Boolean)
        : [];
      const voiceMemoTranscripts = row
        ? parseJsonArray<VoiceMemoAnnotation>(row.memosJson)
            .sort(byReadingOrder)
            .map((memo) => memo.transcript.trim())
            .filter(Boolean)
        : [];
      const strokes = row ? parseJsonArray<Stroke>(row.strokesJson) : [];
      const boxCount = row
        ? parseJsonArray<BoxAnnotation>(row.boxesJson).length
        : 0;
      const highlightStrokeCount = strokes.filter(
        (stroke) => stroke.tool === "highlighter"
      ).length;
      const penStrokeCount = strokes.length - highlightStrokeCount;

      const structuredContent = {
        articleTitle: result.articleTitle,
        articleUrl: result.articleUrl,
        notes,
        voiceMemoTranscripts,
        boxCount,
        highlightStrokeCount,
        penStrokeCount,
        updatedAt: row ? new Date(row.updatedAt).toISOString() : undefined,
      };

      const lines = [`Annotations on "${result.articleTitle}" (${result.articleUrl}):`];
      if (notes.length > 0) {
        lines.push("", "Typed notes (reading order):");
        lines.push(...notes.map((text) => `- "${text}"`));
      }
      if (voiceMemoTranscripts.length > 0) {
        lines.push("", "Voice memo transcripts (reading order):");
        lines.push(...voiceMemoTranscripts.map((text) => `- 🎤 "${text}"`));
      }
      if (boxCount + strokes.length > 0) {
        lines.push(
          "",
          `Visual markup: ${boxCount} boxed section(s), ` +
            `${highlightStrokeCount} highlighter stroke(s), ` +
            `${penStrokeCount} pen stroke(s) — geometry only, view in the reader.`
        );
      }
      if (lines.length === 1) lines.push("", "No annotations yet.");

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent,
      };
    }
  );

  return server;
}
