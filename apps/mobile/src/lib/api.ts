// Typed Hono RPC client for the inkwell-api worker (save/retry articles),
// plus a plain-fetch helper for multipart PDF uploads (React Native's
// FormData file parts don't fit the RPC client's web File typing).
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

type InkwellApi = Hono<Env, InkwellApiSchema, "/">;

/** Client bound to one base URL + Clerk bearer token (fetch per call site). */
export function apiClient(baseUrl: string, token: string) {
  return hc<InkwellApi>(baseUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Uploads a picked PDF to POST /articles/upload as multipart form data.
 * React Native's fetch accepts `{ uri, name, type }` file descriptors in
 * FormData; the worker receives a standard File.
 */
export async function uploadPdf(
  baseUrl: string,
  token: string,
  file: { uri: string; name: string; mimeType?: string }
): Promise<{ articleId: string }> {
  const form = new FormData();
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType ?? "application/pdf",
  } as unknown as Blob);
  const res = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/articles/upload`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );
  if (!res.ok) throw new Error(`The server said ${res.status}.`);
  return (await res.json()) as { articleId: string };
}
