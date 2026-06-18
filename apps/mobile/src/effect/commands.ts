import * as Effect from "effect/Effect";

import {
  AuthCommandError,
  ConvexCommandError,
  MissingAuthTokenError,
  unknownErrorMessage,
} from "./errors";

type GetToken = () => Promise<string | null>;

export const authToken = (
  operation: string,
  getToken: GetToken,
): Effect.Effect<string, AuthCommandError | MissingAuthTokenError> =>
  Effect.tryPromise({
    try: () => getToken(),
    catch: (error) =>
      new AuthCommandError({
        operation,
        message: unknownErrorMessage(error),
      }),
  }).pipe(
    Effect.flatMap((token) =>
      token
        ? Effect.succeed(token)
        : Effect.fail(
            new MissingAuthTokenError({
              operation,
              message: "You're not signed in.",
            }),
          ),
    ),
  );

export const authCommand = <A>(
  operation: string,
  command: () => Promise<A>,
): Effect.Effect<A, AuthCommandError> =>
  Effect.tryPromise({
    try: command,
    catch: (error) =>
      new AuthCommandError({
        operation,
        message: unknownErrorMessage(error),
      }),
  });

export const convexCommand = <A>(
  operation: string,
  command: () => Promise<A>,
): Effect.Effect<A, ConvexCommandError> =>
  Effect.tryPromise({
    try: command,
    catch: (error) =>
      new ConvexCommandError({
        operation,
        message: unknownErrorMessage(error),
      }),
  });
