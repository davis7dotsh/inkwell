import { Context, Layer } from "effect";

export class BrowserConfig extends Context.Service<
  BrowserConfig,
  {
    readonly apiUrl: string;
  }
>()("inkwell/web/BrowserConfig") {}

const apiUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export const BrowserConfigLive = Layer.succeed(BrowserConfig, { apiUrl });
