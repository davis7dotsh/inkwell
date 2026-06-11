// Typed Hono RPC client for the inkwell-api worker.
//
// PLAN §6 has clients consume `hcWithType` from @inkwell/api so route types
// flow from the server's AppType. That package isn't linked into inkwell-web
// yet (no workspace dep installed), so the same export is declared here as a
// mirror of apps/api/src/index.ts's actual routes. Once @inkwell/api is
// linked, delete ApiSchema/ApiType and re-export `hcWithType`/`Client` from
// "@inkwell/api" instead — call sites don't change.
import type { Env, Hono } from "hono";
import { hc } from "hono/client";

/** Mirror of the apps/api routes the web console calls (happy paths). */
type ApiSchema = {
  "/articles": {
    $post: {
      input: { json: { url: string } };
      output: { articleId: string };
      outputFormat: "json";
      status: 202;
    };
  };
  // Direct PDF upload: multipart form with the file bytes; the worker
  // parses it through Firecrawl /v2/parse.
  "/articles/upload": {
    $post: {
      input: { form: { file: File } };
      output: { articleId: string };
      outputFormat: "json";
      status: 202;
    };
  };
  // Retry needs the article's url in the body: the worker's Convex access is
  // write-only (ingest endpoints), so the client supplies it from its live
  // articles.list data.
  "/articles/:id/retry": {
    $post: {
      input: { param: { id: string }; json: { url: string } };
      output: { articleId: string };
      outputFormat: "json";
      status: 202;
    };
  };
};

type ApiType = Hono<Env, ApiSchema, "/">;

export type Client = ReturnType<typeof hc<ApiType>>;

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<ApiType>(...args);
