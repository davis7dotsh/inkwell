import * as Effect from "effect/Effect";

import { MobileIds } from "../effect/services";

/** Unique opaque id for client-created annotations. */
export const newId = Effect.gen(function* () {
  const ids = yield* MobileIds;
  return yield* ids.make;
});
