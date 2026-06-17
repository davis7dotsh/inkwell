import clerkExpoPackage from "@clerk/expo/package.json";
import * as Effect from "effect/Effect";

import { decodeClerkEnvironmentResponse } from "../effect/codecs";
import { DecodeError, unknownErrorMessage } from "../effect/errors";
import { MobileHttp } from "../effect/services";

const CLERK_FRONTEND_API_URL = "https://clerk.inkwellapp.net";

export const probeClerkEnvironment = Effect.gen(function* () {
  const http = yield* MobileHttp;
  const response = yield* http.request(
    "probe Clerk environment",
    `${CLERK_FRONTEND_API_URL}/v1/environment?_is_native=1`,
    {
      // Mirror @clerk/expo's own native request signature so the probe sees the
      // same environment response the real client would. Clerk's
      // createClerkInstance (__internal_onBeforeRequest) appends `_is_native=1`
      // and sets `x-mobile: 1` plus `x-expo-sdk-version` to its OWN package
      // version (not the Expo SDK version), so we match that deliberately.
      headers: {
        "x-mobile": "1",
        "x-expo-sdk-version": clerkExpoPackage.version,
      },
    }
  );
  const value = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (error) =>
      new DecodeError({
        source: "Clerk environment response",
        message: unknownErrorMessage(error),
      }),
  });
  const payload = yield* decodeClerkEnvironmentResponse(value);
  return payload.errors?.[0]?.code ?? `HTTP ${response.status}`;
});
