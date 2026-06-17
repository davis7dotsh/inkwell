import * as ManagedRuntime from "effect/ManagedRuntime";

import { MobileLive } from "./services";

export const mobileRuntime = ManagedRuntime.make(MobileLive);

export type MobileServices = ManagedRuntime.ManagedRuntime.Services<
  typeof mobileRuntime
>;
