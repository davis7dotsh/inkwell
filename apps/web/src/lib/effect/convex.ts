import { Effect } from "effect";

import { ConvexCommandError } from "./errors";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const convexCommand = <A>(
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, ConvexCommandError> =>
  Effect.tryPromise({
    try: () => run(),
    catch: (error) =>
      new ConvexCommandError({
        operation,
        message: errorMessage(error),
      }),
  });
