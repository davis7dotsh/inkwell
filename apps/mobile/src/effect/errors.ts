import * as Schema from "effect/Schema";

export class ConfigurationError extends Schema.TaggedErrorClass<ConfigurationError>()(
  "ConfigurationError",
  {
    key: Schema.String,
    message: Schema.String,
  }
) {}

export class DecodeError extends Schema.TaggedErrorClass<DecodeError>()(
  "DecodeError",
  {
    source: Schema.String,
    message: Schema.String,
  }
) {}

export class HttpRequestError extends Schema.TaggedErrorClass<HttpRequestError>()(
  "HttpRequestError",
  {
    operation: Schema.String,
    url: Schema.String,
    message: Schema.String,
  }
) {}

export class HttpResponseError extends Schema.TaggedErrorClass<HttpResponseError>()(
  "HttpResponseError",
  {
    operation: Schema.String,
    status: Schema.Number,
    message: Schema.String,
  }
) {}

export class FileOperationError extends Schema.TaggedErrorClass<FileOperationError>()(
  "FileOperationError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String,
  }
) {}

export class StorageOperationError extends Schema.TaggedErrorClass<StorageOperationError>()(
  "StorageOperationError",
  {
    operation: Schema.String,
    key: Schema.String,
    message: Schema.String,
  }
) {}

export class NativeCommandError extends Schema.TaggedErrorClass<NativeCommandError>()(
  "NativeCommandError",
  {
    operation: Schema.String,
    message: Schema.String,
  }
) {}

export class AuthCommandError extends Schema.TaggedErrorClass<AuthCommandError>()(
  "AuthCommandError",
  {
    operation: Schema.String,
    message: Schema.String,
  }
) {}

export class MissingAuthTokenError extends Schema.TaggedErrorClass<MissingAuthTokenError>()(
  "MissingAuthTokenError",
  {
    operation: Schema.String,
    message: Schema.String,
  }
) {}

export class ConvexCommandError extends Schema.TaggedErrorClass<ConvexCommandError>()(
  "ConvexCommandError",
  {
    operation: Schema.String,
    message: Schema.String,
  }
) {}

export class TranscriptionError extends Schema.TaggedErrorClass<TranscriptionError>()(
  "TranscriptionError",
  {
    operation: Schema.String,
    message: Schema.String,
  }
) {}

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
