import { Context, Effect, Layer } from "effect";

import { MemoStorageError, errorMessage } from "./errors";

export class MemoBucket extends Context.Service<MemoBucket, R2Bucket>()(
  "inkwell/api/MemoBucket",
) {}

export class MemoStore extends Context.Service<
  MemoStore,
  {
    readonly put: (
      key: string,
      value: ArrayBuffer,
      contentType: string,
    ) => Effect.Effect<void, MemoStorageError>;
    readonly get: (
      key: string,
      headers: Headers,
    ) => Effect.Effect<R2ObjectBody | R2Object | null, MemoStorageError>;
    readonly delete: (key: string) => Effect.Effect<void, MemoStorageError>;
  }
>()("inkwell/api/MemoStore") {}

const storageError =
  (operation: "put" | "get" | "delete") =>
  (error: unknown): MemoStorageError =>
    new MemoStorageError({ operation, message: errorMessage(error) });

export const MemoStoreLive = Layer.effect(
  MemoStore,
  Effect.gen(function* () {
    const bucket = yield* MemoBucket;
    return MemoStore.of({
      put: (key, value, contentType) =>
        Effect.tryPromise({
          try: () =>
            bucket
              .put(key, value, {
                httpMetadata: { contentType },
              })
              .then(() => undefined),
          catch: storageError("put"),
        }),
      get: (key, headers) =>
        Effect.tryPromise({
          try: () =>
            bucket.get(key, {
              range: headers,
              onlyIf: headers,
            }),
          catch: storageError("get"),
        }),
      delete: (key) =>
        Effect.tryPromise({
          try: () => bucket.delete(key),
          catch: storageError("delete"),
        }),
    });
  }),
);

/** Ownership by construction: keys are always prefixed by the caller's id. */
export const memoKey = (
  userId: string,
  articleId: string,
  memoId: string,
): string => `${userId}/${articleId}/${memoId}.m4a`;
