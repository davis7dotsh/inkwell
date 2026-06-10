// Typed Hono RPC client for the inkwell-api worker (save/retry articles).
//
// INTERIM: the canonical contract is `@inkwell/api`'s exported `AppType` +
// `hcWithType` (PLAN-integration-notes.md "Hono RPC"). That package's source
// had not landed when this was written, so the schema below hand-mirrors
// PLAN.md §6. Once `@inkwell/api` is linked into this app, replace
// `InkwellApi` with the type-only import and delete the schema:
//   import { hcWithType } from "@inkwell/api";
import type { Env, Hono } from "hono";
import { hc } from "hono/client";

type InkwellApiSchema = {
  "/articles": {
    $post: {
      input: { json: { url: string } };
      output: { articleId: string };
      outputFormat: "json";
      status: 202;
    };
  };
  "/articles/:id/retry": {
    $post: {
      input: { param: { id: string } };
      output: { articleId: string };
      outputFormat: "json";
      status: 202;
    };
  };
};

type InkwellApi = Hono<Env, InkwellApiSchema, "/">;

/** Client bound to one base URL + Clerk bearer token (fetch per call site). */
export function apiClient(baseUrl: string, token: string) {
  return hc<InkwellApi>(baseUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
