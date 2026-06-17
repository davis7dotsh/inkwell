import { Context, Effect, Layer, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import { BrowserConfig } from "./config";
import {
  ApiDecodeError,
  ApiResponseError,
  ApiTransportError,
  type InkwellApiError,
} from "./errors";

const AcceptedResponse = Schema.Struct({
  articleId: Schema.String,
});

const ArticleRequest = Schema.Struct({
  url: Schema.String,
});

const ErrorResponseFromJson = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.String,
  }),
);

export type AcceptedArticle = typeof AcceptedResponse.Type;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const responseFailure = (
  operation: string,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, ApiResponseError> =>
  response.text.pipe(
    Effect.catch(() => Effect.succeed("")),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(ErrorResponseFromJson)(body).pipe(
        Effect.map((decoded) => decoded.error),
        Effect.catch(() =>
          Effect.succeed(
            body.trim().slice(0, 240) || `Request failed (HTTP ${response.status}).`,
          ),
        ),
      ),
    ),
    Effect.flatMap((message) =>
      Effect.fail(
        new ApiResponseError({
          operation,
          status: response.status,
          message,
        }),
      ),
    ),
  );

const decodeAccepted = (
  operation: string,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<AcceptedArticle, ApiResponseError | ApiDecodeError> => {
  if (response.status !== 202) {
    return responseFailure(operation, response);
  }
  return HttpClientResponse.schemaBodyJson(AcceptedResponse)(response).pipe(
    Effect.mapError(
      (error) =>
        new ApiDecodeError({
          operation,
          message: errorMessage(error),
        }),
    ),
  );
};

const ensureSuccess = (
  operation: string,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<HttpClientResponse.HttpClientResponse, ApiResponseError> =>
  response.status >= 200 && response.status < 300
    ? Effect.succeed(response)
    : responseFailure(operation, response);

export class InkwellApi extends Context.Service<
  InkwellApi,
  {
    readonly saveArticle: (
      url: string,
      token: string,
    ) => Effect.Effect<AcceptedArticle, InkwellApiError>;
    readonly uploadPdf: (
      file: File,
      token: string,
    ) => Effect.Effect<AcceptedArticle, InkwellApiError>;
    readonly retryArticle: (
      articleId: string,
      url: string,
      token: string,
    ) => Effect.Effect<AcceptedArticle, InkwellApiError>;
    readonly loadMemo: (
      articleId: string,
      memoId: string,
      token: string,
    ) => Effect.Effect<Blob, InkwellApiError>;
  }
>()("inkwell/web/InkwellApi") {}

export const InkwellApiLive = Layer.effect(
  InkwellApi,
  Effect.gen(function* () {
    const { apiUrl } = yield* BrowserConfig;
    const client = yield* HttpClient.HttpClient;

    const execute = (
      operation: string,
      token: string,
      request: HttpClientRequest.HttpClientRequest,
    ) =>
      client.execute(HttpClientRequest.bearerToken(request, token)).pipe(
        Effect.mapError(
          (error) =>
            new ApiTransportError({
              operation,
              message: errorMessage(error),
            }),
        ),
      );

    const postJson = (
      operation: string,
      path: string,
      body: typeof ArticleRequest.Type,
      token: string,
    ): Effect.Effect<AcceptedArticle, InkwellApiError> =>
      HttpClientRequest.schemaBodyJson(ArticleRequest)(
        HttpClientRequest.post(`${apiUrl}${path}`),
        body,
      ).pipe(
        Effect.mapError(
          (error) =>
            new ApiDecodeError({
              operation,
              message: errorMessage(error),
            }),
        ),
        Effect.flatMap((request) => execute(operation, token, request)),
        Effect.flatMap((response) => decodeAccepted(operation, response)),
      );

    return {
      saveArticle: (url, token) =>
        postJson("save article", "/articles", { url }, token),
      uploadPdf: (file, token) => {
        const operation = "upload PDF";
        const form = new FormData();
        form.append("file", file);
        return execute(
          operation,
          token,
          HttpClientRequest.post(`${apiUrl}/articles/upload`).pipe(
            HttpClientRequest.bodyFormData(form),
          ),
        ).pipe(
          Effect.flatMap((response) => decodeAccepted(operation, response)),
        );
      },
      retryArticle: (articleId, url, token) =>
        postJson(
          "retry article",
          `/articles/${encodeURIComponent(articleId)}/retry`,
          { url },
          token,
        ),
      loadMemo: (articleId, memoId, token) => {
        const operation = "load voice memo";
        return execute(
          operation,
          token,
          HttpClientRequest.get(
            `${apiUrl}/memos/${encodeURIComponent(articleId)}/${encodeURIComponent(memoId)}`,
          ),
        ).pipe(
          Effect.flatMap((response) => ensureSuccess(operation, response)),
          Effect.flatMap((response) =>
            response.arrayBuffer.pipe(
              Effect.mapError(
                (error) =>
                  new ApiTransportError({
                    operation,
                    message: errorMessage(error),
                  }),
              ),
              Effect.map(
                (bytes) =>
                  new Blob([bytes], {
                    type: response.headers["content-type"] ?? "audio/mp4",
                  }),
              ),
            ),
          ),
        );
      },
    };
  }),
);

export const saveArticle = (url: string, token: string) =>
  Effect.flatMap(InkwellApi, (api) => api.saveArticle(url, token));

export const uploadPdf = (file: File, token: string) =>
  Effect.flatMap(InkwellApi, (api) => api.uploadPdf(file, token));

export const retryArticle = (articleId: string, url: string, token: string) =>
  Effect.flatMap(InkwellApi, (api) => api.retryArticle(articleId, url, token));

export const loadMemo = (
  articleId: string,
  memoId: string,
  token: string,
) => Effect.flatMap(InkwellApi, (api) => api.loadMemo(articleId, memoId, token));
