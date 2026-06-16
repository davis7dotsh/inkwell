// Direct Convex service client for the API worker. The deployment key grants
// access to internal functions, so no public query or HTTP-action bridge is
// needed. Create this client per request/work item: ConvexHttpClient stores
// authentication state and must not be shared across Worker requests.

import { ConvexHttpClient } from "convex/browser";
import {
  getFunctionName,
  makeFunctionReference,
  type DefaultFunctionArgs,
  type FunctionReference,
  type FunctionType,
} from "convex/server";

import { internal } from "../../../packages/backend/convex/_generated/api";

export type ConvexServiceEnv = {
  CONVEX_URL: string;
  CONVEX_DEPLOY_KEY: string;
};

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

type AdminAuthenticatedClient = ConvexHttpClient & {
  setAdminAuth(token: string): void;
};

function supportsAdminAuth(
  client: ConvexHttpClient
): client is AdminAuthenticatedClient {
  return (
    "setAdminAuth" in client &&
    typeof client.setAdminAuth === "function"
  );
}

// ConvexHttpClient's public methods intentionally accept public references.
// Admin auth can execute internal functions, so preserve the generated
// argument/return types while recreating the same runtime function name.
function adminReference<
  Type extends FunctionType,
  Args extends DefaultFunctionArgs,
  Return,
>(reference: FunctionReference<Type, "internal", Args, Return>) {
  return makeFunctionReference<Type, Args, Return>(getFunctionName(reference));
}

export function createConvexService(
  fetchImpl: typeof fetch,
  env: ConvexServiceEnv
) {
  const client = new ConvexHttpClient(env.CONVEX_URL, {
    fetch: fetchImpl,
    logger: false,
  });
  if (!supportsAdminAuth(client)) {
    throw new Error("Installed Convex client does not support admin auth");
  }
  client.setAdminAuth(env.CONVEX_DEPLOY_KEY);

  return {
    async createPending(args: CreatePendingArgs) {
      const articleId = await client.mutation(
        adminReference(internal.articles.createPending),
        args
      );
      return { articleId };
    },

    async complete(args: CompleteArgs) {
      await client.mutation(
        adminReference(internal.articles.complete),
        args
      );
    },

    async fail(args: FailArgs) {
      await client.mutation(adminReference(internal.articles.fail), args);
    },

    listArticles(args: {
      userId: string;
      readStatus?: ReadStatus;
      status?: ArticleStatus;
      limit?: number;
    }) {
      return client.query(
        adminReference(internal.articles.listForAgent),
        args
      );
    },

    getArticle(args: { userId: string; id: string }) {
      return client.query(
        adminReference(internal.articles.getForAgent),
        args
      );
    },

    getAnnotations(args: { userId: string; articleId: string }) {
      return client.query(
        adminReference(internal.annotations.getForAgent),
        args
      );
    },
  };
}

export type ConvexService = ReturnType<typeof createConvexService>;
