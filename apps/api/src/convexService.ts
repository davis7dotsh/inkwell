// Service client for the shared-secret Convex HTTP actions. The worker
// authenticates the caller, then these routes call internal Convex functions
// without exposing them through the public query or mutation API.
import { z } from "zod";

export type ConvexServiceEnv = {
  CONVEX_SITE_URL: string;
  WORKER_SHARED_SECRET: string;
};

const articleKindSchema = z.enum(["web", "pdf"]);
const articleStatusSchema = z.enum(["pending", "ready", "failed"]);
const readStatusSchema = z.enum(["unread", "in_progress", "read"]);

export type ArticleKind = z.infer<typeof articleKindSchema>;
export type ArticleStatus = z.infer<typeof articleStatusSchema>;
export type ReadStatus = z.infer<typeof readStatusSchema>;

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

const articleSummarySchema = z.object({
  id: z.string(),
  url: z.string(),
  kind: articleKindSchema,
  status: articleStatusSchema,
  error: z.string().optional(),
  title: z.string(),
  byline: z.string().optional(),
  siteName: z.string().optional(),
  excerpt: z.string().optional(),
  savedAt: z.number(),
  readStatus: readStatusSchema,
});

const articleSchema = z.object({
  _id: z.string(),
  url: z.string(),
  kind: articleKindSchema,
  status: articleStatusSchema,
  error: z.string().optional(),
  title: z.string(),
  byline: z.string().optional(),
  siteName: z.string().optional(),
  excerpt: z.string().optional(),
  blocksJson: z.string().optional(),
  savedAt: z.number(),
  readStatus: readStatusSchema,
});

const annotationsSchema = z.object({
  articleTitle: z.string(),
  articleUrl: z.string(),
  // Article blocks ride along so the notes tool can resolve anchor text.
  blocksJson: z.string().optional(),
  annotations: z
    .object({
      contentWidth: z.number(),
      strokesJson: z.string(),
      boxesJson: z.string(),
      notesJson: z.string(),
      memosJson: z.string(),
      // Layout snapshot for anchor resolution; absent on legacy/older clients.
      layoutJson: z.string().optional(),
      updatedAt: z.number(),
    })
    .nullable(),
});

async function responseJson(res: Response) {
  const value: unknown = await res.json();
  return value;
}

async function request(
  fetchImpl: typeof fetch,
  url: URL,
  secret: string,
  init?: RequestInit,
  allowedStatuses: readonly number[] = []
) {
  const headers = new Headers(init?.headers);
  headers.set("x-inkwell-key", secret);
  const res = await fetchImpl(url, { ...init, headers });
  if (!res.ok && !allowedStatuses.includes(res.status)) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Convex ${url.pathname} failed: HTTP ${res.status}${
        text ? ` — ${text.slice(0, 200)}` : ""
      }`
    );
  }
  return res;
}

export function createConvexService(
  fetchImpl: typeof fetch,
  env: ConvexServiceEnv
) {
  const baseUrl = env.CONVEX_SITE_URL.replace(/\/+$/, "");

  async function post(path: string, body: unknown) {
    const res = await request(
      fetchImpl,
      new URL(path, `${baseUrl}/`),
      env.WORKER_SHARED_SECRET,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    return responseJson(res);
  }

  async function get(
    path: string,
    params: Record<string, string | number | undefined>,
    allowedStatuses?: readonly number[]
  ) {
    const url = new URL(path, `${baseUrl}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return request(
      fetchImpl,
      url,
      env.WORKER_SHARED_SECRET,
      undefined,
      allowedStatuses
    );
  }

  return {
    async createPending(args: CreatePendingArgs) {
      const result = await post("/ingest/create-pending", args);
      return z.object({ articleId: z.string() }).parse(result);
    },

    async complete(args: CompleteArgs) {
      await post("/ingest/complete", args);
    },

    async fail(args: FailArgs) {
      await post("/ingest/fail", args);
    },

    async listArticles(args: {
      userId: string;
      readStatus?: ReadStatus;
      status?: ArticleStatus;
      limit?: number;
    }) {
      const res = await get("/agent/articles", args);
      const result = await responseJson(res);
      return z.object({ articles: z.array(articleSummarySchema) }).parse(result)
        .articles;
    },

    async getArticle(args: { userId: string; id: string }) {
      const res = await get("/agent/article", args, [404]);
      if (res.status === 404) return null;
      const result = await responseJson(res);
      return z.object({ article: articleSchema }).parse(result).article;
    },

    async getAnnotations(args: { userId: string; articleId: string }) {
      const res = await get("/agent/annotations", args, [404]);
      if (res.status === 404) return null;
      return annotationsSchema.parse(await responseJson(res));
    },
  };
}

export type ConvexService = ReturnType<typeof createConvexService>;
