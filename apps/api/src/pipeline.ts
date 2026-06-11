// Scrape → normalize → complete (or fail). Runs inside ctx.waitUntil() after
// the route has already returned 202, so it must never throw — every outcome
// lands in Convex as ready (with blocks) or failed (with a readable message).

import { firecrawlToArticle } from "@inkwell/content";

import { complete, fail } from "./convexService";
import { parseFile, scrapeUrl } from "./firecrawl";
import type { FirecrawlScrape } from "./firecrawl";

export type PipelineEnv = {
  FIRECRAWL_API_KEY: string;
  WORKER_SHARED_SECRET: string;
  CONVEX_SITE_URL: string;
};

async function runPipeline(options: {
  fetchImpl: typeof fetch;
  env: PipelineEnv;
  articleId: string;
  userId: string;
  fetchContent: () => Promise<FirecrawlScrape>;
  /** Used when Firecrawl metadata/content yields no usable title. */
  fallbackTitle?: string;
}): Promise<void> {
  const { fetchImpl, env, articleId, userId, fetchContent, fallbackTitle } =
    options;
  try {
    const scraped = await fetchContent();
    const article = firecrawlToArticle(scraped);
    const title =
      article.title === "Untitled" && fallbackTitle
        ? fallbackTitle
        : article.title;
    await complete(fetchImpl, env.CONVEX_SITE_URL, env.WORKER_SHARED_SECRET, {
      articleId,
      expectedUserId: userId,
      title,
      byline: article.byline,
      siteName: article.siteName,
      excerpt: article.excerpt,
      blocksJson: JSON.stringify(article.blocks),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await fail(fetchImpl, env.CONVEX_SITE_URL, env.WORKER_SHARED_SECRET, {
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
  }
}

export async function processArticle(options: {
  fetchImpl: typeof fetch;
  env: PipelineEnv;
  articleId: string;
  userId: string;
  url: string;
}): Promise<void> {
  const { fetchImpl, env, articleId, userId, url } = options;
  await runPipeline({
    fetchImpl,
    env,
    articleId,
    userId,
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
}): Promise<void> {
  const { fetchImpl, env, articleId, userId, file, fallbackTitle } = options;
  await runPipeline({
    fetchImpl,
    env,
    articleId,
    userId,
    fallbackTitle,
    fetchContent: () => parseFile(fetchImpl, env.FIRECRAWL_API_KEY, file),
  });
}
