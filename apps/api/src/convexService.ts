// Effect service for the shared-secret Convex HTTP actions. Hono authenticates
// callers; this client talks only to the Worker's internal HTTP bridge.

import { Context, Effect, Layer } from "effect";
import { z } from "zod";
import {
  Headers,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";

import {
  ConvexDecodeError,
  ConvexHttpError,
  errorMessage,
} from "./errors";
import { WorkerConfig } from "./services";

export type ConvexServiceEnv = {
  CONVEX_SITE_URL: string;
  WORKER_SHARED_SECRET: string;
};

const ArticleKindSchema = z.enum(["web", "pdf"]);
const ArticleStatusSchema = z.enum(["pending", "ready", "failed"]);
const ReadStatusSchema = z.enum([
  "unread",
  "in_progress",
  "read",
]);

export type ArticleKind = z.infer<typeof ArticleKindSchema>;
export type ArticleStatus = z.infer<typeof ArticleStatusSchema>;
export type ReadStatus = z.infer<typeof ReadStatusSchema>;

export type CreatePendingArgs = {
  userId: string;
  url: string;
  kind: ArticleKind;
  title: string;
  savedAt: number;
};

export type CompleteArgs = {
  articleId: string;
  expectedUserId: string;
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  blocksJson: string;
};

export type FailArgs = {
  articleId: string;
  expectedUserId: string;
  error: string;
};

const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
  createdAt: z.number(),
});

const CreatedTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
});

export type Tag = z.infer<typeof TagSchema>;
export type CreatedTag = z.infer<typeof CreatedTagSchema>;

const ArticleSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  kind: ArticleKindSchema,
  status: ArticleStatusSchema,
  error: z.string().optional(),
  title: z.string(),
  byline: z.string().optional(),
  siteName: z.string().optional(),
  excerpt: z.string().optional(),
  savedAt: z.number(),
  readStatus: ReadStatusSchema,
  pinned: z.boolean(),
  tags: z.array(z.string()),
});

const ArticleSchema = z.object({
  _id: z.string(),
  url: z.string(),
  kind: ArticleKindSchema,
  status: ArticleStatusSchema,
  error: z.string().optional(),
  title: z.string(),
  byline: z.string().optional(),
  siteName: z.string().optional(),
  excerpt: z.string().optional(),
  blocksJson: z.string().optional(),
  savedAt: z.number(),
  readStatus: ReadStatusSchema,
  pinned: z.boolean(),
  tags: z.array(z.string()),
});

const AnnotationsSchema = z.object({
  articleTitle: z.string(),
  articleUrl: z.string(),
  blocksJson: z.string().optional(),
  annotations: z
    .object({
      contentWidth: z.number(),
      strokesJson: z.string(),
      boxesJson: z.string(),
      notesJson: z.string(),
      memosJson: z.string(),
      layoutJson: z.string().optional(),
      updatedAt: z.number(),
    })
    .nullable(),
});

const CreatePendingResponseSchema = z.object({
  articleId: z.string(),
});
const OkResponseSchema = z.object({ ok: z.boolean() });
const ArticlesResponseSchema = z.object({
  articles: z.array(ArticleSummarySchema),
});
const ArticleResponseSchema = z.object({ article: ArticleSchema });
const TagsResponseSchema = z.object({ tags: z.array(TagSchema) });
const CreatedTagResponseSchema = z.object({ tag: CreatedTagSchema });

type ConvexError = ConvexHttpError | ConvexDecodeError;
type ArticleSummary = z.infer<typeof ArticleSummarySchema>;
type Article = z.infer<typeof ArticleSchema>;
type AnnotationResult = z.infer<typeof AnnotationsSchema>;

export type ConvexServiceShape = {
  readonly createPending: (
    args: CreatePendingArgs
  ) => Effect.Effect<{ readonly articleId: string }, ConvexError>;
  readonly complete: (
    args: CompleteArgs
  ) => Effect.Effect<void, ConvexError>;
  readonly fail: (args: FailArgs) => Effect.Effect<void, ConvexError>;
  readonly listArticles: (args: {
    userId: string;
    readStatus?: ReadStatus;
    status?: ArticleStatus;
    tagIds?: string[];
    limit?: number;
  }) => Effect.Effect<ReadonlyArray<ArticleSummary>, ConvexError>;
  readonly getArticle: (args: {
    userId: string;
    id: string;
  }) => Effect.Effect<Article | null, ConvexError>;
  readonly getAnnotations: (args: {
    userId: string;
    articleId: string;
  }) => Effect.Effect<AnnotationResult | null, ConvexError>;
  readonly listTags: (args: {
    userId: string;
  }) => Effect.Effect<ReadonlyArray<Tag>, ConvexError>;
  readonly createTag: (args: {
    userId: string;
    name: string;
    color?: string;
  }) => Effect.Effect<CreatedTag, ConvexError>;
  readonly renameTag: (args: {
    userId: string;
    tagId: string;
    name: string;
  }) => Effect.Effect<void, ConvexError>;
  readonly removeTag: (args: {
    userId: string;
    tagId: string;
  }) => Effect.Effect<void, ConvexError>;
  readonly addTagToArticle: (args: {
    userId: string;
    articleId: string;
    tagId: string;
  }) => Effect.Effect<void, ConvexError>;
  readonly removeTagFromArticle: (args: {
    userId: string;
    articleId: string;
    tagId: string;
  }) => Effect.Effect<void, ConvexError>;
  readonly setArticlePinned: (args: {
    userId: string;
    id: string;
    pinned: boolean;
  }) => Effect.Effect<void, ConvexError>;
};

export class ConvexService extends Context.Service<
  ConvexService,
  ConvexServiceShape
>()("inkwell/api/ConvexService") {}

const requestFailure = (
  operation: string,
  error: unknown
): ConvexHttpError =>
  new ConvexHttpError({
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
    message: errorMessage(error),
  });

const decodeResponse = <S extends z.ZodType>(
  response: HttpClientResponse.HttpClientResponse,
  schema: S,
  operation: string
): Effect.Effect<z.output<S>, ConvexDecodeError> =>
  response.json.pipe(
    Effect.mapError(
      (error) =>
        new ConvexDecodeError({
          operation,
          message: `Convex ${operation} returned invalid JSON: ${errorMessage(error)}`,
        })
    ),
    Effect.flatMap((value) =>
      Effect.try({
        try: () => schema.parse(value),
        catch: (error) =>
          new ConvexDecodeError({
            operation,
            message: `Convex ${operation} returned an invalid response: ${errorMessage(error)}`,
          }),
      })
    )
  );

const failureDetail = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<string> =>
  response.text.pipe(
    Effect.map((text) => (text ? ` — ${text.slice(0, 200)}` : "")),
    Effect.catch(() => Effect.succeed(""))
  );

export const ConvexServiceLive = Layer.effect(
  ConvexService,
  Effect.gen(function* () {
    const config = yield* WorkerConfig;
    const client = yield* HttpClient.HttpClient;
    const baseUrl = config.CONVEX_SITE_URL.replace(/\/+$/, "");

    const execute = (
      request: HttpClientRequest.HttpClientRequest,
      operation: string,
      allowedStatuses: ReadonlyArray<number> = []
    ): Effect.Effect<
      HttpClientResponse.HttpClientResponse,
      ConvexHttpError
    > =>
      client
        .execute(
          HttpClientRequest.setHeader(
            request,
            "x-inkwell-key",
            config.WORKER_SHARED_SECRET
          )
        )
        .pipe(
          Effect.updateService(
            Headers.CurrentRedactedNames,
            (names) => [...names, "x-inkwell-key"]
          ),
          Effect.mapError((error) =>
            requestFailure(operation, error)
          ),
          Effect.flatMap((response) => {
            if (response.status >= 200 && response.status < 300) {
              return Effect.succeed(response);
            }
            if (allowedStatuses.includes(response.status)) {
              return Effect.succeed(response);
            }
            return failureDetail(response).pipe(
              Effect.flatMap(
                (detail) =>
                  new ConvexHttpError({
                    operation,
                    status: response.status,
                    message: `Convex ${operation} failed: HTTP ${response.status}${detail}`,
                  })
              )
            );
          })
        );

    const post = <S extends z.ZodType>(
      path: string,
      body: unknown,
      schema: S
    ): Effect.Effect<z.output<S>, ConvexError> => {
      const operation = path;
      return HttpClientRequest.bodyJson(
        HttpClientRequest.post(new URL(path, `${baseUrl}/`)),
        body
      ).pipe(
        Effect.mapError((error) => requestFailure(operation, error)),
        Effect.flatMap((request) => execute(request, operation)),
        Effect.flatMap((response) =>
          decodeResponse(response, schema, operation)
        )
      );
    };

    const get = (
      path: string,
      params: Record<string, string | number | undefined>,
      allowedStatuses: ReadonlyArray<number> = []
    ) => {
      const url = new URL(path, `${baseUrl}/`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      return execute(
        HttpClientRequest.get(url),
        path,
        allowedStatuses
      );
    };

    const write = (path: string, body: unknown) =>
      post(path, body, OkResponseSchema).pipe(Effect.asVoid);

    return ConvexService.of({
      createPending: (args) =>
        post(
          "/ingest/create-pending",
          args,
          CreatePendingResponseSchema
        ),
      complete: (args) => write("/ingest/complete", args),
      fail: (args) => write("/ingest/fail", args),
      listArticles: (args) => {
        const { tagIds, ...rest } = args;
        return get("/agent/articles", {
          ...rest,
          tagIds:
            tagIds && tagIds.length > 0
              ? tagIds.join(",")
              : undefined,
        }).pipe(
          Effect.flatMap((response) =>
            decodeResponse(
              response,
              ArticlesResponseSchema,
              "/agent/articles"
            )
          ),
          Effect.map((result) => result.articles)
        );
      },
      getArticle: (args) =>
        get("/agent/article", args, [404]).pipe(
          Effect.flatMap((response) =>
            response.status === 404
              ? response.text.pipe(
                  Effect.ignore,
                  Effect.as(null)
                )
              : decodeResponse(
                  response,
                  ArticleResponseSchema,
                  "/agent/article"
                ).pipe(Effect.map((result) => result.article))
          )
        ),
      getAnnotations: (args) =>
        get("/agent/annotations", args, [404]).pipe(
          Effect.flatMap((response) =>
            response.status === 404
              ? response.text.pipe(
                  Effect.ignore,
                  Effect.as(null)
                )
              : decodeResponse(
                  response,
                  AnnotationsSchema,
                  "/agent/annotations"
                )
          )
        ),
      listTags: (args) =>
        get("/agent/tags", args).pipe(
          Effect.flatMap((response) =>
            decodeResponse(response, TagsResponseSchema, "/agent/tags")
          ),
          Effect.map((result) => result.tags)
        ),
      createTag: (args) =>
        post("/agent/tags/create", args, CreatedTagResponseSchema).pipe(
          Effect.map((result) => result.tag)
        ),
      renameTag: (args) => write("/agent/tags/rename", args),
      removeTag: (args) => write("/agent/tags/remove", args),
      addTagToArticle: (args) =>
        write("/agent/article-tags/add", args),
      removeTagFromArticle: (args) =>
        write("/agent/article-tags/remove", args),
      setArticlePinned: (args) => write("/agent/article/pin", args),
    });
  })
);
