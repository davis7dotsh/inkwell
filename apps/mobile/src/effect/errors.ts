import * as Data from "effect/Data";

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly key: string;
  readonly message: string;
}> {}

export class DecodeError extends Data.TaggedError("DecodeError")<{
  readonly source: string;
  readonly message: string;
}> {}

export class HttpRequestError extends Data.TaggedError("HttpRequestError")<{
  readonly operation: string;
  readonly url: string;
  readonly message: string;
}> {}

export class HttpResponseError extends Data.TaggedError("HttpResponseError")<{
  readonly operation: string;
  readonly status: number;
  readonly message: string;
}> {}

export class FileOperationError extends Data.TaggedError("FileOperationError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class StorageOperationError extends Data.TaggedError(
  "StorageOperationError",
)<{
  readonly operation: string;
  readonly key: string;
  readonly message: string;
}> {}

export class NativeCommandError extends Data.TaggedError("NativeCommandError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class AuthCommandError extends Data.TaggedError("AuthCommandError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class MissingAuthTokenError extends Data.TaggedError(
  "MissingAuthTokenError",
)<{
  readonly operation: string;
  readonly message: string;
}> {}

export class ConvexCommandError extends Data.TaggedError("ConvexCommandError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class TranscriptionError extends Data.TaggedError("TranscriptionError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export const unknownErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const operationalErrorMessage = (error: unknown): string => {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return unknownErrorMessage(error);
};
