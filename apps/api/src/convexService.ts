// Effect service for the shared-secret Convex HTTP actions. Hono authenticates
// callers; this client talks only to the Worker's internal HTTP bridge.

import { Context, Effect, Layer, Schema } from "effect";
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

const ArticleKindSchema = Schema.Literals(["web", "pdf"]);
const ArticleStatusSchema = Schema.Literals(["pending", "ready", "failed"]);
const ReadStatusSchema = Schema.Literals([
  "unread",
  "in_progress",
  "read",
]);

export type ArticleKind = typeof ArticleKindSchema.Type;
export type ArticleStatus = typeof ArticleStatusSchema.Type;
export type ReadStatus = typeof ReadStatusSchema.Type;

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

const TagSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.optional(Schema.String),
  createdAt: Schema.Number,
});

const CreatedTagSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.optional(Schema.String),
});

export type Tag = typeof TagSchema.Type;
export type CreatedTag = typeof CreatedTagSchema.Type;

const ArticleSummarySchema = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  kind: ArticleKindSchema,
  status: ArticleStatusSchema,
  error: Schema.optional(Schema.String),
  title: Schema.String,
  byline: Schema.optional(Schema.String),
  siteName: Schema.optional(Schema.String),
  excerpt: Schema.optional(Schema.String),
  savedAt: Schema.Number,
  readStatus: ReadStatusSchema,
  pinned: Schema.Boolean,
  tags: Schema.Array(Schema.String),
});

const ArticleSchema = Schema.Struct({
  _id: Schema.String,
  url: Schema.String,
  kind: ArticleKindSchema,
  status: ArticleStatusSchema,
  error: Schema.optional(Schema.String),
  title: Schema.String,
  byline: Schema.optional(Schema.String),
  siteName: Schema.optional(Schema.String),
  excerpt: Schema.optional(Schema.String),
  blocksJson: Schema.optional(Schema.String),
  savedAt: Schema.Number,
  readStatus: ReadStatusSchema,
  pinned: Schema.Boolean,
  tags: Schema.Array(Schema.String),
});

const AnnotationsSchema = Schema.Struct({
  articleTitle: Schema.String,
  articleUrl: Schema.String,
  blocksJson: Schema.optional(Schema.String),
  annotations: Schema.NullOr(
    Schema.Struct({
      contentWidth: Schema.Number,
      strokesJson: Schema.String,
      boxesJson: Schema.String,
      notesJson: Schema.String,
      memosJson: Schema.String,
      layoutJson: Schema.optional(Schema.String),
      updatedAt: Schema.Number,
    })
  ),
});

const CreatePendingResponseSchema = Schema.Struct({
  articleId: Schema.String,
});
const OkResponseSchema = Schema.Struct({ ok: Schema.Boolean });
const ArticlesResponseSchema = Schema.Struct({
  articles: Schema.Array(ArticleSummarySchema),
});
const ArticleResponseSchema = Schema.Struct({ article: ArticleSchema });
const TagsResponseSchema = Schema.Struct({ tags: Schema.Array(TagSchema) });
const CreatedTagResponseSchema = Schema.Struct({ tag: CreatedTagSchema });

type ConvexError = ConvexHttpError | ConvexDecodeError;
type ArticleSummary = typeof ArticleSummarySchema.Type;
type Article = typeof ArticleSchema.Type;
type AnnotationResult = typeof AnnotationsSchema.Type;

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

const decodeResponse = <S extends Schema.Top>(
  response: HttpClientResponse.HttpClientResponse,
  schema: S,
  operation: string
): Effect.Effect<
  S["Type"],
  ConvexDecodeError,
  S["DecodingServices"]
> =>
  response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(
      (error) =>
        new ConvexDecodeError({
          operation,
          message: `Convex ${operation} returned an invalid response: ${errorMessage(error)}`,
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

    const post = <S extends Schema.Top>(
      path: string,
      body: unknown,
      schema: S
    ): Effect.Effect<
      S["Type"],
      ConvexError,
      S["DecodingServices"]
    > => {
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
