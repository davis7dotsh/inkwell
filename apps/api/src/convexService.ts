// Tiny service client for the Convex ingest HTTP actions (convex/http.ts in
// @inkwell/backend). They live on the `.convex.site` origin — NOT
// `.convex.cloud` — and are guarded by the x-inkwell-key shared secret, so
// the internal mutations never gain a public client surface.

export type ArticleKind = "web" | "pdf";

export type CreatePendingArgs = {
  userId: string;
  url: string;
  kind: ArticleKind;
  title: string;
  savedAt: number;
};

export type CompleteArgs = {
  articleId: string;
  expectedUserId: string;
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  blocksJson: string;
};

export type FailArgs = {
  articleId: string;
  expectedUserId: string;
  error: string;
};

export async function post(
  fetchImpl: typeof fetch,
  siteUrl: string,
  secret: string,
  path: string,
  body: unknown
): Promise<unknown> {
  const res = await fetchImpl(`${siteUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-inkwell-key": secret,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Convex ${path} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`
    );
  }
  return res.json();
}

export async function createPending(
  fetchImpl: typeof fetch,
  siteUrl: string,
  secret: string,
  args: CreatePendingArgs
): Promise<{ articleId: string }> {
  const result = await post(
    fetchImpl,
    siteUrl,
    secret,
    "/ingest/create-pending",
    args
  );
  return result as { articleId: string };
}

export async function complete(
  fetchImpl: typeof fetch,
  siteUrl: string,
  secret: string,
  args: CompleteArgs
): Promise<void> {
  await post(fetchImpl, siteUrl, secret, "/ingest/complete", args);
}

export async function fail(
  fetchImpl: typeof fetch,
  siteUrl: string,
  secret: string,
  args: FailArgs
): Promise<void> {
  await post(fetchImpl, siteUrl, secret, "/ingest/fail", args);
}
