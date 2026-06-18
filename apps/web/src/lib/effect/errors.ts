import { Data } from "effect";

export class AuthenticationError extends Data.TaggedError(
  "AuthenticationError",
)<{
  readonly message: string;
}> {}

export class ApiTransportError extends Data.TaggedError("ApiTransportError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class ApiResponseError extends Data.TaggedError("ApiResponseError")<{
  readonly operation: string;
  readonly status: number;
  readonly message: string;
}> {}

export class ApiDecodeError extends Data.TaggedError("ApiDecodeError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class PersistedContentError extends Data.TaggedError(
  "PersistedContentError",
)<{
  readonly source: string;
  readonly message: string;
}> {}

export class ConvexCommandError extends Data.TaggedError("ConvexCommandError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export type InkwellApiError =
  | AuthenticationError
  | ApiTransportError
  | ApiResponseError
  | ApiDecodeError;
