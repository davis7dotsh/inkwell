import { Cause, Effect, Exit, Option } from "effect";

import { getAuthToken, type ClerkTokenGetter } from "./auth";
import { InkwellApi } from "./api";
import type { AuthenticationError } from "./errors";
import { browserRuntime } from "./runtime";

export const runBrowserEffect = <A, E>(
  effect: Effect.Effect<A, E, InkwellApi>,
  options?: Effect.RunOptions,
) => browserRuntime.runPromiseExit(effect, options);

export const runBrowserSyncEffect = <A, E>(
  effect: Effect.Effect<A, E>,
): Exit.Exit<A, E> => browserRuntime.runSyncExit(effect);

export const runAuthedEffect = <A, E>(
  effect: (token: string) => Effect.Effect<A, E, InkwellApi>,
  getToken: ClerkTokenGetter,
  options?: Effect.RunOptions,
): Promise<Exit.Exit<A, E | AuthenticationError>> =>
  browserRuntime.runPromiseExit(
    getAuthToken(getToken).pipe(Effect.flatMap(effect)),
    options,
  );

export const exitFailureMessage = <A, E>(
  exit: Exit.Exit<A, E>,
  fallback: string,
): string => {
  const error = Exit.findErrorOption(exit);
  if (Option.isSome(error)) {
    const value = error.value;
    if (
      typeof value === "object" &&
      value !== null &&
      "message" in value &&
      typeof value.message === "string"
    ) {
      return value.message;
    }
  }
  if (Exit.isFailure(exit)) {
    console.error("Unexpected Effect failure", Cause.pretty(exit.cause));
  }
  return fallback;
};
