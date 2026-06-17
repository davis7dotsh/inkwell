import { Schema } from "effect";

const MessageField = {
  message: Schema.String,
};

export class AuthenticationError extends Schema.TaggedErrorClass<AuthenticationError>()(
  "AuthenticationError",
  MessageField
) {}

export class OwnershipError extends Schema.TaggedErrorClass<OwnershipError>()(
  "OwnershipError",
  MessageField
) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  MessageField
) {}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "ValidationError",
  MessageField
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()(
  "ConflictError",
  MessageField
) {}

export type DomainError =
  | AuthenticationError
  | OwnershipError
  | NotFoundError
  | ValidationError
  | ConflictError;

export class HttpResponseError extends Schema.TaggedErrorClass<HttpResponseError>()(
  "HttpResponseError",
  {
    status: Schema.Number,
    body: Schema.String,
  }
) {}
