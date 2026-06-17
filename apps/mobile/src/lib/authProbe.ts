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
      headers: {
        "x-mobile": "1",
        "x-expo-sdk-version": "3.3.1",
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
