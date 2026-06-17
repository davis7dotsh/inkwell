import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { InkwellApiLive } from "./api";
import { BrowserConfigLive } from "./config";

const BrowserServicesLive = InkwellApiLive.pipe(
  Layer.provideMerge(
    Layer.merge(BrowserConfigLive, FetchHttpClient.layer),
  ),
);

export const browserRuntime = ManagedRuntime.make(BrowserServicesLive);

export const disposeBrowserRuntime = (): Promise<void> =>
  browserRuntime.dispose();
