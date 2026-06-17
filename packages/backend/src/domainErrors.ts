import { Data } from "effect";

type MessageFields = {
  readonly message: string;
};

export class AuthenticationError extends Data.TaggedError(
  "AuthenticationError"
)<MessageFields> {}

export class OwnershipError extends Data.TaggedError(
  "OwnershipError"
)<MessageFields> {}

export class NotFoundError extends Data.TaggedError(
  "NotFoundError"
)<MessageFields> {}

export class ValidationError extends Data.TaggedError(
  "ValidationError"
)<MessageFields> {}

export class ConflictError extends Data.TaggedError(
  "ConflictError"
)<MessageFields> {}

export type DomainError =
  | AuthenticationError
  | OwnershipError
  | NotFoundError
  | ValidationError
  | ConflictError;

export class HttpResponseError extends Data.TaggedError("HttpResponseError")<{
  readonly status: number;
  readonly body: string;
}> {}
