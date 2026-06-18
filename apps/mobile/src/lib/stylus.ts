import * as Effect from "effect/Effect";

import { MobileKeyValueStore } from "../effect/services";

const KEY = "stylus-seen";

export const loadStylusSeen = Effect.gen(function* () {
  const storage = yield* MobileKeyValueStore;
  return (yield* storage.get(KEY)) === "1";
});

export const persistStylusSeen = Effect.gen(function* () {
  const storage = yield* MobileKeyValueStore;
  yield* storage.set(KEY, "1");
});
