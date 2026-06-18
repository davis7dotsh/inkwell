// Firecrawl v2 client built on Effect's Web Fetch adapter. Scrape and parse
// share one decoded envelope and exactly one explicit 429 retry.

import { Context, Effect, Layer, Redacted } from "effect";
import { z } from "zod";
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";

import {
  FirecrawlApiError,
  FirecrawlDecodeError,
  FirecrawlHttpError,
  errorMessage,
} from "./errors";
import { WorkerConfig } from "./services";

const FirecrawlMetadataSchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  ogTitle: z.string().nullable().optional(),
  ogDescription: z.string().nullable().optional(),
  ogImage: z.string().nullable().optional(),
  sourceURL: z.string().nullable().optional(),
  statusCode: z.number().optional(),
  contentType: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export type FirecrawlMetadata = z.infer<typeof FirecrawlMetadataSchema>;

const FirecrawlResponseSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
  data: z
    .object({
      html: z.string().nullable().optional(),
      markdown: z.string().nullable().optional(),
      metadata: FirecrawlMetadataSchema.optional(),
      warning: z.string().optional(),
    })
    .optional(),
});

export type FirecrawlScrape = {
  html?: string;
  markdown?: string;
  metadata?: FirecrawlMetadata;
};

export type FirecrawlError =
  | FirecrawlHttpError
  | FirecrawlDecodeError
  | FirecrawlApiError;

const SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const PARSE_ENDPOINT = "https://api.firecrawl.dev/v2/parse";
const DEFAULT_RETRY_AFTER_MS = 6_000;
const MAX_RETRY_AFTER_MS = 30_000;

const retryAfterMs = (
  response: HttpClientResponse.HttpClientResponse,
): number => {
  const seconds = Number(response.headers["retry-after"]);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
};

const responseDetail = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<string> =>
  response.text.pipe(
    Effect.map((text) => (text ? ` — ${text.slice(0, 200)}` : "")),
    Effect.catch(() => Effect.succeed("")),
  );

const transportError = (
  operation: string,
  retried: boolean,
  error: unknown,
): FirecrawlHttpError =>
  new FirecrawlHttpError({
    operation,
    status:
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof error.response === "object" &&
      error.response !== null &&
      "status" in error.response &&
      typeof error.response.status === "number"
        ? error.response.status
        : 0,
    retried,
    message: errorMessage(error),
  });

const decodePayload = (
  response: HttpClientResponse.HttpClientResponse,
  operation: string,
): Effect.Effect<FirecrawlScrape, FirecrawlDecodeError | FirecrawlApiError> =>
  response.json.pipe(
    Effect.mapError(
      (error) =>
        new FirecrawlDecodeError({
          operation,
          message: `Firecrawl ${operation} returned invalid JSON: ${errorMessage(error)}`,
        }),
    ),
    Effect.flatMap((value) =>
      Effect.try({
        try: () => FirecrawlResponseSchema.parse(value),
        catch: (error) =>
          new FirecrawlDecodeError({
            operation,
            message: `Firecrawl ${operation} returned an invalid response: ${errorMessage(error)}`,
          }),
      }),
    ),
    Effect.flatMap((json) => {
      if (json.success !== true) {
        return new FirecrawlApiError({
          operation,
          message: `Firecrawl ${operation} failed: ${
            json.error ?? "response had success: false"
          }`,
        });
      }
      if (!json.data) {
        return new FirecrawlApiError({
          operation,
          message: `Firecrawl ${operation} failed: response had no data`,
        });
      }

      const html = json.data.html ?? undefined;
      const markdown = json.data.markdown ?? undefined;
      if (!html && !markdown && json.data.warning) {
        return new FirecrawlApiError({
          operation,
          message: `Firecrawl returned no content: ${json.data.warning}`,
        });
      }
      return Effect.succeed({
        html,
        markdown,
        metadata: json.data.metadata,
      });
    }),
  );

export class FirecrawlService extends Context.Service<
  FirecrawlService,
  {
    readonly scrapeUrl: (
      url: string,
    ) => Effect.Effect<FirecrawlScrape, FirecrawlError>;
    readonly parseFile: (
      file: File,
    ) => Effect.Effect<FirecrawlScrape, FirecrawlError>;
  }
>()("inkwell/api/FirecrawlService") {}

export const FirecrawlServiceLive = Layer.effect(
  FirecrawlService,
  Effect.gen(function* () {
    const config = yield* WorkerConfig;
    const client = yield* HttpClient.HttpClient;

    const requestPayload = (
      makeRequest: () => Effect.Effect<
        HttpClientRequest.HttpClientRequest,
        unknown
      >,
      operation: string,
    ): Effect.Effect<FirecrawlScrape, FirecrawlError> =>
      Effect.gen(function* () {
        const execute = (retried: boolean) =>
          makeRequest().pipe(
            Effect.mapError((error) =>
              transportError(operation, retried, error),
            ),
            Effect.flatMap((request) => client.execute(request)),
            Effect.mapError((error) =>
              error instanceof FirecrawlHttpError
                ? error
                : transportError(operation, retried, error),
            ),
          );

        let response = yield* execute(false);
        let retried = false;
        if (response.status === 429) {
          yield* response.text.pipe(Effect.ignore);
          yield* Effect.sleep(retryAfterMs(response));
          response = yield* execute(true);
          retried = true;
        }
        if (response.status < 200 || response.status >= 300) {
          const detail = yield* responseDetail(response);
          return yield* new FirecrawlHttpError({
            operation,
            status: response.status,
            retried,
            message:
              `Firecrawl ${operation} failed: HTTP ${response.status}` +
              `${
                response.status === 429 && retried
                  ? " (rate limited; retried once)"
                  : ""
              }${detail}`,
          });
        }
        return yield* decodePayload(response, operation);
      });

    const token = Redacted.make(config.FIRECRAWL_API_KEY);
    return FirecrawlService.of({
      scrapeUrl: (url) =>
        requestPayload(
          () =>
            HttpClientRequest.bodyJson(
              HttpClientRequest.post(SCRAPE_ENDPOINT).pipe(
                HttpClientRequest.bearerToken(token),
              ),
              {
                url,
                formats: ["markdown", "html"],
                onlyMainContent: true,
                parsers: [{ type: "pdf", mode: "auto", maxPages: 200 }],
                timeout: 120000,
              },
            ),
          "scrape",
        ),
      parseFile: (file) =>
        requestPayload(() => {
          const form = new FormData();
          form.append("file", file, file.name);
          form.append(
            "options",
            JSON.stringify({
              formats: ["markdown"],
              onlyMainContent: true,
              parsers: ["pdf"],
              timeout: 120000,
            }),
          );
          return Effect.succeed(
            HttpClientRequest.post(PARSE_ENDPOINT).pipe(
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.bodyFormData(form),
            ),
          );
        }, "parse"),
    });
  }),
);
