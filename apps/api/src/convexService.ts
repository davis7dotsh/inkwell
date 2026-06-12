// Tiny service client for the Convex HTTP actions (convex/http.ts in
// @inkwell/backend): `/ingest/*` writes for the scrape pipeline, `/agent/*`
// reads for the MCP tools. They live on the `.convex.site` origin — NOT
// `.convex.cloud` — and are guarded by the x-inkwell-key shared secret, so
// the internal functions never gain a public client surface.

export type ArticleKind = "web" | "pdf";
export type ArticleStatus = "pending" | "ready" | "failed";
export type ReadStatus = "unread" | "in_progress" | "read";

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

// ---- Agent reads ----

export type AgentArticleSummary = {
  id: string;
  url: string;
  kind: ArticleKind;
  status: ArticleStatus;
  error?: string;
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  savedAt: number;
  readStatus: ReadStatus;
};

export type AgentArticle = {
  _id: string;
  url: string;
  kind: ArticleKind;
  status: ArticleStatus;
  error?: string;
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  blocksJson?: string;
  savedAt: number;
  readStatus: ReadStatus; // legacy rows normalized to "unread" server-side
};

export type AgentAnnotations = {
  articleTitle: string;
  articleUrl: string;
  annotations: {
    contentWidth: number;
    strokesJson: string;
    boxesJson: string;
    notesJson: string;
    memosJson: string;
    updatedAt: number;
  } | null;
};

/** GET helper; returns null on 404 so callers can express "not found". */
async function get(
  fetchImpl: typeof fetch,
  siteUrl: string,
  secret: string,
  path: string,
  params: Record<string, string | number | undefined>
): Promise<unknown | null> {
  const url = new URL(`${siteUrl.replace(/\/+$/, "")}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetchImpl(url.toString(), {
    headers: { "x-inkwell-key": secret },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Convex ${path} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`
    );
  }
  return res.json();
}

export async function listArticles(
  fetchImpl: typeof fetch,
  siteUrl: string,
  secret: string,
  args: {
    userId: string;
    readStatus?: ReadStatus;
    status?: ArticleStatus;
    limit?: number;
  }
): Promise<AgentArticleSummary[]> {
  const result = (await get(fetchImpl, siteUrl, secret, "/agent/articles", {
    userId: args.userId,
    readStatus: args.readStatus,
    status: args.status,
    limit: args.limit,
  })) as { articles: AgentArticleSummary[] } | null;
  if (result === null) {
    // Unlike the by-id reads, this route never 404s — a 404 means the
    // deployment doesn't have the /agent routes yet.
    throw new Error(
      "Convex /agent/articles returned 404 — is @inkwell/backend deployed with the agent read routes?"
    );
  }
  return result.articles;
}

export async function getArticle(
  fetchImpl: typeof fetch,
  siteUrl: string,
  secret: string,
  args: { userId: string; id: string }
): Promise<AgentArticle | null> {
  const result = (await get(fetchImpl, siteUrl, secret, "/agent/article", {
    userId: args.userId,
    id: args.id,
  })) as { article: AgentArticle } | null;
  return result?.article ?? null;
}

export async function getAnnotations(
  fetchImpl: typeof fetch,
  siteUrl: string,
  secret: string,
  args: { userId: string; articleId: string }
): Promise<AgentAnnotations | null> {
  return (await get(fetchImpl, siteUrl, secret, "/agent/annotations", {
    userId: args.userId,
    articleId: args.articleId,
  })) as AgentAnnotations | null;
}
