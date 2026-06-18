// Effect adapters for content boundaries that can throw. Pure parser and
// normalization implementations stay synchronous in their original modules.

import { Data, Effect } from "effect";

import { htmlToBlocks } from "./htmlToBlocks";
import { markdownToBlocks } from "./markdownToBlocks";
import { firecrawlToArticle } from "./normalize";
import {
  decodeLayoutSnapshotJson,
  FirecrawlDocumentSchema,
  type ParsedLayoutSnapshot,
} from "./schema";
import type { ArticleContent, Block } from "./types";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class ContentParserError extends Data.TaggedError("ContentParserError")<{
  readonly parser: "html" | "markdown";
  readonly message: string;
}> {}

export class ContentSchemaError extends Data.TaggedError("ContentSchemaError")<{
  readonly boundary: "firecrawl";
  readonly message: string;
}> {}

export class FirecrawlNormalizationError extends Data.TaggedError(
  "FirecrawlNormalizationError",
)<{
  readonly message: string;
}> {}

export function htmlToBlocksEffect(
  html: string,
): Effect.Effect<Block[], ContentParserError> {
  return Effect.try({
    try: () => htmlToBlocks(html),
    catch: (error) =>
      new ContentParserError({
        parser: "html",
        message: errorMessage(error),
      }),
  });
}

export function markdownToBlocksEffect(
  markdown: string,
): Effect.Effect<Block[], ContentParserError> {
  return Effect.try({
    try: () => markdownToBlocks(markdown),
    catch: (error) =>
      new ContentParserError({
        parser: "markdown",
        message: errorMessage(error),
      }),
  });
}

/**
 * Decode an untrusted Firecrawl normalization input, then run the existing
 * synchronous normalization algorithm with expected failures in the error
 * channel.
 */
export function firecrawlToArticleEffect(
  input: unknown,
): Effect.Effect<
  ArticleContent,
  ContentSchemaError | FirecrawlNormalizationError
> {
  return Effect.try({
    try: () => FirecrawlDocumentSchema.parse(input),
    catch: (error) =>
      new ContentSchemaError({
        boundary: "firecrawl",
        message: errorMessage(error),
      }),
  }).pipe(
    Effect.flatMap((document) =>
      Effect.try({
        try: () => firecrawlToArticle(document),
        catch: (error) =>
          new FirecrawlNormalizationError({
            message: errorMessage(error),
          }),
      }),
    ),
  );
}

/** Effect-shaped equivalent of the intentionally total/tolerant sync parser. */
export function parseLayoutSnapshotEffect(
  json: string | undefined | null,
): Effect.Effect<ParsedLayoutSnapshot | null> {
  return Effect.succeed(decodeLayoutSnapshotJson(json));
}
