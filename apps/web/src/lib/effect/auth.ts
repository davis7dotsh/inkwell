import { Effect } from "effect";

import { AuthenticationError } from "./errors";

export type ClerkTokenGetter = () => Promise<string | null>;

export const getAuthToken = (
  getToken: ClerkTokenGetter,
): Effect.Effect<string, AuthenticationError> =>
  Effect.tryPromise({
    try: () => getToken(),
    catch: () =>
      new AuthenticationError({
        message: "Couldn't refresh your sign-in token.",
      }),
  }).pipe(
    Effect.flatMap((token) =>
      token
        ? Effect.succeed(token)
        : Effect.fail(
            new AuthenticationError({
              message: "Sign in again to continue.",
            }),
          ),
    ),
  );
