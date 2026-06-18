import { Data } from "effect";

export class WorkerConfigError extends Data.TaggedError("WorkerConfigError")<{
  readonly message: string;
}> {}

export class RequestDecodeError extends Data.TaggedError("RequestDecodeError")<{
  readonly message: string;
}> {}

export class ConvexHttpError extends Data.TaggedError("ConvexHttpError")<{
  readonly operation: string;
  readonly status: number;
  readonly message: string;
}> {}

export class ConvexDecodeError extends Data.TaggedError("ConvexDecodeError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class FirecrawlHttpError extends Data.TaggedError("FirecrawlHttpError")<{
  readonly operation: string;
  readonly status: number;
  readonly retried: boolean;
  readonly message: string;
}> {}

export class FirecrawlDecodeError extends Data.TaggedError(
  "FirecrawlDecodeError",
)<{
  readonly operation: string;
  readonly message: string;
}> {}

export class FirecrawlApiError extends Data.TaggedError("FirecrawlApiError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class ArticleNormalizationError extends Data.TaggedError(
  "ArticleNormalizationError",
)<{
  readonly message: string;
}> {}

export class MemoStorageError extends Data.TaggedError("MemoStorageError")<{
  readonly operation: "put" | "get" | "delete";
  readonly message: string;
}> {}

export class ToolOperationError extends Data.TaggedError("ToolOperationError")<{
  readonly message: string;
}> {}

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
