import { Schema } from "effect";

export class AuthenticationError extends Schema.TaggedErrorClass<AuthenticationError>()(
  "AuthenticationError",
  {
    message: Schema.String,
  },
) {}

export class ApiTransportError extends Schema.TaggedErrorClass<ApiTransportError>()(
  "ApiTransportError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export class ApiResponseError extends Schema.TaggedErrorClass<ApiResponseError>()(
  "ApiResponseError",
  {
    operation: Schema.String,
    status: Schema.Number,
    message: Schema.String,
  },
) {}

export class ApiDecodeError extends Schema.TaggedErrorClass<ApiDecodeError>()(
  "ApiDecodeError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export class PersistedContentError extends Schema.TaggedErrorClass<PersistedContentError>()(
  "PersistedContentError",
  {
    source: Schema.String,
    message: Schema.String,
  },
) {}

export class ConvexCommandError extends Schema.TaggedErrorClass<ConvexCommandError>()(
  "ConvexCommandError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export type InkwellApiError =
  | AuthenticationError
  | ApiTransportError
  | ApiResponseError
  | ApiDecodeError;
