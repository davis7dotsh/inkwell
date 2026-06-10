// Scrape → normalize → complete (or fail). Runs inside ctx.waitUntil() after
// the route has already returned 202, so it must never throw — every outcome
// lands in Convex as ready (with blocks) or failed (with a readable message).

import { firecrawlToArticle } from "@inkwell/content";

import { complete, fail } from "./convexService";
import { scrapeUrl } from "./firecrawl";

export type PipelineEnv = {
  FIRECRAWL_API_KEY: string;
  WORKER_SHARED_SECRET: string;
  CONVEX_SITE_URL: string;
};

export async function processArticle(options: {
  fetchImpl: typeof fetch;
  env: PipelineEnv;
  articleId: string;
  userId: string;
  url: string;
}): Promise<void> {
  const { fetchImpl, env, articleId, userId, url } = options;
  try {
    const scraped = await scrapeUrl(fetchImpl, env.FIRECRAWL_API_KEY, url);
    const article = firecrawlToArticle(scraped);
    await complete(fetchImpl, env.CONVEX_SITE_URL, env.WORKER_SHARED_SECRET, {
      articleId,
      expectedUserId: userId,
      title: article.title,
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
        `processArticle: could not mark article ${articleId} as failed`,
        failError
      );
    }
  }
}
