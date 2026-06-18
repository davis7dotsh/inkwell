import { File } from "expo-file-system";
import * as Effect from "effect/Effect";

import { decodeArticleIdResponse } from "../effect/codecs";
import {
  ConfigurationError,
  DecodeError,
  HttpResponseError,
  unknownErrorMessage,
} from "../effect/errors";
import { MobileConfig, MobileHttp } from "../effect/services";

export type ArticleCommandResult = {
  readonly articleId: string;
};

const apiUrl = Effect.gen(function* () {
  const config = yield* MobileConfig;
  if (!config.apiUrl) {
    return yield* new ConfigurationError({
      key: "EXPO_PUBLIC_API_URL",
      message: "Set EXPO_PUBLIC_API_URL in .env.local to save articles.",
    });
  }
  return config.apiUrl.replace(/\/+$/, "");
});

const responseJson = (
  operation: string,
  response: Response,
): Effect.Effect<unknown, DecodeError> =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: (error) =>
      new DecodeError({
        source: `${operation} response`,
        message: unknownErrorMessage(error),
      }),
  });

const acceptedArticleResponse = (
  operation: string,
  response: Response,
): Effect.Effect<ArticleCommandResult, HttpResponseError | DecodeError> =>
  Effect.gen(function* () {
    if (!response.ok) {
      return yield* new HttpResponseError({
        operation,
        status: response.status,
        message: `The server said ${response.status}.`,
      });
    }
    const body = yield* responseJson(operation, response);
    return yield* decodeArticleIdResponse(body, `${operation} response`);
  });

export const saveArticle = (input: {
  readonly token: string;
  readonly url: string;
}) =>
  Effect.gen(function* () {
    const baseUrl = yield* apiUrl;
    const http = yield* MobileHttp;
    const response = yield* http.request(
      "save article",
      `${baseUrl}/articles`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: input.url }),
      },
    );
    return yield* acceptedArticleResponse("save article", response);
  });

export const retryArticle = (input: {
  readonly token: string;
  readonly articleId: string;
  readonly url: string;
}) =>
  Effect.gen(function* () {
    const baseUrl = yield* apiUrl;
    const http = yield* MobileHttp;
    const response = yield* http.request(
      "retry article",
      `${baseUrl}/articles/${encodeURIComponent(input.articleId)}/retry`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: input.url }),
      },
    );
    return yield* acceptedArticleResponse("retry article", response);
  });

/** Uploads a picked PDF using the Blob-compatible SDK 56 File implementation. */
export const uploadPdf = (input: {
  readonly token: string;
  readonly file: { uri: string; name: string; mimeType?: string };
}) =>
  Effect.gen(function* () {
    const baseUrl = yield* apiUrl;
    const http = yield* MobileHttp;
    const form = new FormData();
    form.append("file", new File(input.file.uri), input.file.name);
    const response = yield* http.request(
      "upload PDF",
      `${baseUrl}/articles/upload`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${input.token}` },
        body: form,
      },
    );
    return yield* acceptedArticleResponse("upload PDF", response);
  });
