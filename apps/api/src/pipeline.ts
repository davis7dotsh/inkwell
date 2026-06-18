// Scrape/parse → normalize → complete (or fail). The Effect program is total:
// every expected failure and defect becomes a failed PipelineOutcome, and a
// best-effort Convex fail write prevents rejected waitUntil promises.

import { firecrawlToArticle } from "@inkwell/content";
import { Cause, Context, Effect, Layer } from "effect";

import { ArticleNormalizationError, errorMessage } from "./errors";
import { ConvexService } from "./convexService";
import { FirecrawlService, type FirecrawlScrape } from "./firecrawl";

export type PipelineOutcome =
  | { status: "ready"; title: string }
  | { status: "failed"; error: string };

type NormalizedArticle = ReturnType<typeof firecrawlToArticle>;

export class ArticleNormalizer extends Context.Service<
  ArticleNormalizer,
  {
    readonly normalize: (
      scraped: FirecrawlScrape,
    ) => Effect.Effect<NormalizedArticle, ArticleNormalizationError>;
  }
>()("inkwell/api/ArticleNormalizer") {}

export const ArticleNormalizerLive = Layer.succeed(
  ArticleNormalizer,
  ArticleNormalizer.of({
    normalize: (scraped) =>
      Effect.try({
        try: () => firecrawlToArticle(scraped),
        catch: (error) =>
          new ArticleNormalizationError({
            message: errorMessage(error),
          }),
      }),
  }),
);

export const runPipelineEffect = (options: {
  readonly articleId: string;
  readonly userId: string;
  readonly fetchContent: Effect.Effect<FirecrawlScrape, unknown>;
  readonly fallbackTitle?: string;
}): Effect.Effect<
  PipelineOutcome,
  never,
  ConvexService | FirecrawlService | ArticleNormalizer
> =>
  Effect.gen(function* () {
    const convex = yield* ConvexService;
    const normalizer = yield* ArticleNormalizer;

    const markFailed = (failure: unknown): Effect.Effect<PipelineOutcome> => {
      const message = errorMessage(failure);
      return convex
        .fail({
          articleId: options.articleId,
          expectedUserId: options.userId,
          error: message,
        })
        .pipe(
          Effect.catchCause((failCause) =>
            Effect.sync(() => {
              console.error(
                `pipeline: could not mark article ${options.articleId} as failed`,
                Cause.squash(failCause),
              );
            }),
          ),
          Effect.as({ status: "failed", error: message } as const),
        );
    };

    const program = Effect.gen(function* () {
      const scraped = yield* options.fetchContent;
      const article = yield* normalizer.normalize(scraped);
      const title =
        article.title === "Untitled" && options.fallbackTitle
          ? options.fallbackTitle
          : article.title;
      yield* convex.complete({
        articleId: options.articleId,
        expectedUserId: options.userId,
        title,
        byline: article.byline,
        siteName: article.siteName,
        excerpt: article.excerpt,
        blocksJson: JSON.stringify(article.blocks),
      });
      return { status: "ready", title } as const;
    });

    return yield* program.pipe(
      Effect.catch(markFailed),
      Effect.catchCause((cause) => {
        const defect = Cause.squash(cause);
        return Effect.sync(() => {
          console.error(
            `pipeline: unexpected defect while processing article ${options.articleId}`,
            defect,
          );
        }).pipe(Effect.andThen(markFailed(defect)));
      }),
    );
  });

export const processArticleEffect = (options: {
  readonly articleId: string;
  readonly userId: string;
  readonly url: string;
}): Effect.Effect<
  PipelineOutcome,
  never,
  ConvexService | FirecrawlService | ArticleNormalizer
> =>
  Effect.gen(function* () {
    const firecrawl = yield* FirecrawlService;
    return yield* runPipelineEffect({
      articleId: options.articleId,
      userId: options.userId,
      fetchContent: firecrawl.scrapeUrl(options.url),
    });
  });

export const processUploadEffect = (options: {
  readonly articleId: string;
  readonly userId: string;
  readonly file: File;
  readonly fallbackTitle: string;
}): Effect.Effect<
  PipelineOutcome,
  never,
  ConvexService | FirecrawlService | ArticleNormalizer
> =>
  Effect.gen(function* () {
    const firecrawl = yield* FirecrawlService;
    return yield* runPipelineEffect({
      articleId: options.articleId,
      userId: options.userId,
      fallbackTitle: options.fallbackTitle,
      fetchContent: firecrawl.parseFile(options.file),
    });
  });
