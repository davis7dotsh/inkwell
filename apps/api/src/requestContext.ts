import { Cause, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { ConvexServiceLive } from "./convexService";
import { WorkerConfigError, errorMessage } from "./errors";
import { FirecrawlServiceLive } from "./firecrawl";
import { MemoBucket, MemoStoreLive } from "./memo";
import { ArticleNormalizerLive } from "./pipeline";
import {
  CurrentUser,
  WorkerConfig,
  WorkerConfigSchema,
} from "./services";

export type WorkerBindings = {
  FIRECRAWL_API_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  WORKER_SHARED_SECRET: string;
  CONVEX_SITE_URL: string;
  MEMOS: R2Bucket;
};

const configLayer = (env: WorkerBindings) =>
  Layer.effect(
    WorkerConfig,
    Effect.try({
      try: () => WorkerConfigSchema.parse(env),
      catch: (error) =>
        new WorkerConfigError({
          message: `Invalid Worker configuration: ${errorMessage(error)}`,
        }),
    })
  );

/**
 * A fresh layer graph per incoming Hono request. It deliberately closes over
 * request bindings only here; callers run it with `local: true`, so Effect
 * never memoizes request state into a process-global runtime.
 */
export const makeRequestLayer = (options: {
  readonly env: WorkerBindings;
  readonly userId: string;
  readonly executionCtx: Pick<ExecutionContext, "waitUntil">;
  readonly fetchImpl?: typeof fetch;
}) => {
  const infrastructure = Layer.mergeAll(
    configLayer(options.env),
    Layer.succeed(CurrentUser, { userId: options.userId }),
    Layer.succeed(MemoBucket, options.env.MEMOS),
    Layer.succeed(FetchHttpClient.Fetch, options.fetchImpl ?? fetch),
    FetchHttpClient.layer
  );
  const operations = Layer.mergeAll(
    ConvexServiceLive,
    FirecrawlServiceLive,
    MemoStoreLive,
    ArticleNormalizerLive
  ).pipe(Layer.provide(infrastructure));
  return Layer.mergeAll(infrastructure, operations);
};

export type RequestLayer = ReturnType<typeof makeRequestLayer>;
export type RequestServices = Layer.Success<RequestLayer>;

export const runRequestEffect = <A, E>(
  effect: Effect.Effect<A, E, RequestServices>,
  layer: RequestLayer
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(effect, layer, { local: true })
  );

export const runRequestEffectTotal = <
  A,
  E,
  A2
>(
  effect: Effect.Effect<A, E, RequestServices>,
  layer: RequestLayer,
  onCause: (
    cause: Cause.Cause<E | WorkerConfigError>
  ) => Effect.Effect<A2>
): Promise<A | A2> =>
  Effect.runPromise(
    Effect.provide(effect, layer, { local: true }).pipe(
      Effect.catchCause(onCause)
    )
  );

export const makeRequestScope = (
  options: Parameters<typeof makeRequestLayer>[0]
) => {
  const layer = makeRequestLayer(options);
  return {
    layer,
    run: <A, E>(
      effect: Effect.Effect<A, E, RequestServices>
    ) =>
      runRequestEffect(effect, layer),
    runTotal: <
      A,
      E,
      A2
    >(
      effect: Effect.Effect<A, E, RequestServices>,
      onCause: (
        cause: Cause.Cause<E | WorkerConfigError>
      ) => Effect.Effect<A2>
    ) => runRequestEffectTotal(effect, layer, onCause),
    waitUntil: (promise: Promise<unknown>) =>
      options.executionCtx.waitUntil(promise),
  };
};

export type RequestScope = ReturnType<typeof makeRequestScope>;
