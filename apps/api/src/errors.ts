import { Schema } from "effect";

export class WorkerConfigError extends Schema.TaggedErrorClass<WorkerConfigError>()(
  "WorkerConfigError",
  {
    message: Schema.String,
  }
) {}

export class RequestDecodeError extends Schema.TaggedErrorClass<RequestDecodeError>()(
  "RequestDecodeError",
  {
    message: Schema.String,
  }
) {}

export class ConvexHttpError extends Schema.TaggedErrorClass<ConvexHttpError>()(
  "ConvexHttpError",
  {
    operation: Schema.String,
    status: Schema.Number,
    message: Schema.String,
  }
) {}

export class ConvexDecodeError extends Schema.TaggedErrorClass<ConvexDecodeError>()(
  "ConvexDecodeError",
  {
    operation: Schema.String,
    message: Schema.String,
  }
) {}

export class FirecrawlHttpError extends Schema.TaggedErrorClass<FirecrawlHttpError>()(
  "FirecrawlHttpError",
  {
    operation: Schema.String,
    status: Schema.Number,
    retried: Schema.Boolean,
    message: Schema.String,
  }
) {}

export class FirecrawlDecodeError extends Schema.TaggedErrorClass<FirecrawlDecodeError>()(
  "FirecrawlDecodeError",
  {
    operation: Schema.String,
    message: Schema.String,
  }
) {}

export class FirecrawlApiError extends Schema.TaggedErrorClass<FirecrawlApiError>()(
  "FirecrawlApiError",
  {
    operation: Schema.String,
    message: Schema.String,
  }
) {}

export class ArticleNormalizationError extends Schema.TaggedErrorClass<ArticleNormalizationError>()(
  "ArticleNormalizationError",
  {
    message: Schema.String,
  }
) {}

export class MemoStorageError extends Schema.TaggedErrorClass<MemoStorageError>()(
  "MemoStorageError",
  {
    operation: Schema.Literals(["put", "get", "delete"]),
    message: Schema.String,
  }
) {}

export class ToolOperationError extends Schema.TaggedErrorClass<ToolOperationError>()(
  "ToolOperationError",
  {
    message: Schema.String,
  }
) {}

const nestedCause = (value: unknown): unknown => {
  if (
    typeof value === "object" &&
    value !== null &&
    "reason" in value &&
    typeof value.reason === "object" &&
    value.reason !== null &&
    "cause" in value.reason
  ) {
    return value.reason.cause;
  }
  return value;
};

export const errorMessage = (error: unknown): string => {
  const cause = nestedCause(error);
  if (cause instanceof Error) return cause.message;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return String(cause);
};

export type ApiOperationalError =
  | WorkerConfigError
  | RequestDecodeError
  | ConvexHttpError
  | ConvexDecodeError
  | FirecrawlHttpError
  | FirecrawlDecodeError
  | FirecrawlApiError
  | ArticleNormalizationError
  | MemoStorageError
  | ToolOperationError;
