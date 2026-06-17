import { Effect } from "effect";

import type { DomainError, HttpResponseError } from "./domainErrors";

export function promise<A>(evaluate: () => PromiseLike<A>): Effect.Effect<A> {
  return Effect.promise(() => evaluate());
}

export async function runConvexEffect<A>(
  program: Effect.Effect<A, DomainError>
): Promise<A> {
  const result = await Effect.runPromise(
    Effect.match(program, {
      onFailure: (error) => ({ ok: false as const, error }),
      onSuccess: (value) => ({ ok: true as const, value }),
    })
  );
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

export function runHttpEffect(
  program: Effect.Effect<Response, HttpResponseError>
): Promise<Response> {
  return Effect.runPromise(
    Effect.match(program, {
      onFailure: (error) =>
        new Response(error.body, { status: error.status }),
      onSuccess: (response) => response,
    })
  );
}
