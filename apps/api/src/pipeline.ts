// Scrape → normalize → complete (or fail). Runs inside ctx.waitUntil() after
// the route has already returned 202, so it must never throw — every outcome
// lands in Convex as ready (with blocks) or failed (with a readable message).

import { firecrawlToArticle } from "@inkwell/content";

import type { ConvexService } from "./convexService";
import { parseFile, scrapeUrl } from "./firecrawl";
import type { FirecrawlScrape } from "./firecrawl";

export type PipelineEnv = {
  FIRECRAWL_API_KEY: string;
};

/**
 * Where the article landed. The REST routes run the pipeline in waitUntil()
 * and drop this (clients watch the row via Convex live queries); the MCP
 * save_article tool awaits it to answer the agent synchronously.
 */
export type PipelineOutcome =
  | { status: "ready"; title: string }
  | { status: "failed"; error: string };

async function runPipeline(options: {
  articleId: string;
  userId: string;
  convex: ConvexService;
  fetchContent: () => Promise<FirecrawlScrape>;
  /** Used when Firecrawl metadata/content yields no usable title. */
  fallbackTitle?: string;
}): Promise<PipelineOutcome> {
  const { articleId, userId, fetchContent, fallbackTitle, convex } = options;
  try {
    const scraped = await fetchContent();
    const article = firecrawlToArticle(scraped);
    const title =
      article.title === "Untitled" && fallbackTitle
        ? fallbackTitle
        : article.title;
    await convex.complete({
      articleId,
      expectedUserId: userId,
      title,
      byline: article.byline,
      siteName: article.siteName,
      excerpt: article.excerpt,
      blocksJson: JSON.stringify(article.blocks),
    });
    return { status: "ready", title };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await convex.fail({
        articleId,
        expectedUserId: userId,
        error: message,
      });
    } catch (failError) {
      // Last resort: surface in worker logs; the row stays pending.
      console.error(
        `pipeline: could not mark article ${articleId} as failed`,
        failError
      );
    }
    return { status: "failed", error: message };
  }
}

export async function processArticle(options: {
  fetchImpl: typeof fetch;
  env: PipelineEnv;
  articleId: string;
  userId: string;
  url: string;
  convex: ConvexService;
}): Promise<PipelineOutcome> {
  const { fetchImpl, env, articleId, userId, url, convex } = options;
  return runPipeline({
    articleId,
    userId,
    convex,
    fetchContent: () => scrapeUrl(fetchImpl, env.FIRECRAWL_API_KEY, url),
  });
}

/** Upload variant: the PDF bytes travel with the request, so the content
 * step is a Firecrawl /v2/parse call instead of a scrape. */
export async function processUpload(options: {
  fetchImpl: typeof fetch;
  env: PipelineEnv;
  articleId: string;
  userId: string;
  file: File;
  fallbackTitle: string;
  convex: ConvexService;
}): Promise<PipelineOutcome> {
  const {
    fetchImpl,
    env,
    articleId,
    userId,
    file,
    fallbackTitle,
    convex,
  } = options;
  return runPipeline({
    articleId,
    userId,
    convex,
    fallbackTitle,
    fetchContent: () => parseFile(fetchImpl, env.FIRECRAWL_API_KEY, file),
  });
}
