import { Context, Effect, Layer } from "effect";

export class BrowserConfig extends Context.Service<
  BrowserConfig,
  {
    readonly apiUrl: string;
  }
>()("inkwell/web/BrowserConfig") {}

export const BrowserConfigLive = Layer.effect(
  BrowserConfig,
  Effect.sync(() => {
    const apiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");
    if (!apiUrl) {
      throw new Error("VITE_API_URL must be set before the API runtime is used");
    }
    return { apiUrl };
  }),
);
