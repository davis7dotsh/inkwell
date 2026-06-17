// Inkwell API — Hono remains the Cloudflare/Clerk/MCP adapter. Request-local
// Effect layers own outbound HTTP, decoding, R2 access, and pipeline control.

import { clerkMiddleware, getAuth } from "@clerk/hono";
import { zValidator } from "@hono/zod-validator";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Cause, Effect, Schema } from "effect";
import { Hono } from "hono";
import { hc } from "hono/client";
import { cors } from "hono/cors";
import type { Context } from "hono";
import { z } from "zod";

import { ConvexService } from "./convexService";
import {
  RequestDecodeError,
  errorMessage,
} from "./errors";
import { buildInkwellMcp } from "./mcp";
import { MemoStore, memoKey } from "./memo";
import {
  processArticleEffect,
  processUploadEffect,
} from "./pipeline";
import {
  makeRequestScope,
  type RequestScope,
  type RequestServices,
  type WorkerBindings,
} from "./requestContext";
import { CurrentUser } from "./services";
import { kindOf, normalizeUrl } from "./url";

export type Bindings = WorkerBindings;

const ArticleBodySchema = Schema.Struct({ url: Schema.String });
const articleBody = z.object({ url: z.string() });
const MemoParamsSchema = Schema.Struct({
  articleId: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/)
  ),
  memoId: Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/)
  ),
});
const memoParams = z.object({
  articleId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  memoId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});
const uploadForm = z.object({
  file: z.custom<File>((value) => value instanceof File, {
    message: "file must be a file upload",
  }),
});

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_MEMO_BYTES = 25 * 1024 * 1024;

const isPdf = (file: File): boolean =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

function titleFromFilename(name: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, "").trim();
  return stem || "Uploaded PDF";
}

const userIdOf = (c: Context): string | null => {
  const auth = getAuth(c, {
    acceptsToken: ["session_token", "api_key"],
  });
  if (!auth?.isAuthenticated) return null;
  return auth.userId ?? null;
};

const scopeOf = (
  c: Context<{ Bindings: Bindings }>,
  userId: string
): RequestScope =>
  makeRequestScope({
    env: c.env,
    userId,
    executionCtx: c.executionCtx,
    fetchImpl: fetch,
  });

const requestDecode = (message: string) =>
  new RequestDecodeError({ message });

const decodeValue = <S extends Schema.Top>(
  value: unknown,
  schema: S
): Effect.Effect<
  S["Type"],
  RequestDecodeError,
  S["DecodingServices"]
> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((error) =>
      requestDecode(errorMessage(error))
    )
  );

const decodeParams = <S extends Schema.Top>(
  schema: S,
  value: unknown
): Effect.Effect<
  S["Type"],
  RequestDecodeError,
  S["DecodingServices"]
> =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((error) =>
      requestDecode(errorMessage(error))
    )
  );

const uploadFile = (
  value: unknown
): Effect.Effect<File, RequestDecodeError> =>
  Schema.decodeUnknownEffect(Schema.File)(value).pipe(
    Effect.mapError(() =>
      requestDecode("file must be a file upload")
    )
  );

const requestArrayBuffer = (
  request: Request
): Effect.Effect<ArrayBuffer, RequestDecodeError> =>
  Effect.tryPromise({
    try: () => request.arrayBuffer(),
    catch: (error) =>
      requestDecode(`Could not read request body: ${errorMessage(error)}`),
  });

const internalError = (
  c: Context<{ Bindings: Bindings }>,
  error: unknown
) => {
  console.error("api request failed", error);
  return c.text("Internal Server Error", 500);
};

const runHttp = async <A, E>(
  c: Context<{ Bindings: Bindings }>,
  scope: RequestScope,
  program: Effect.Effect<A, E, RequestServices>
): Promise<
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: unknown }
> =>
  scope.runTotal(
    program.pipe(
      Effect.map((value) => ({ ok: true as const, value }))
    ),
    (cause) =>
      Effect.succeed({
        ok: false as const,
        error: Cause.squash(cause),
      })
  );

const app = new Hono<{ Bindings: Bindings }>()
  .use("*", cors())
  .get("/health", (c) => c.json({ ok: true }, 200))
  .use("*", clerkMiddleware())
  .post("/articles", zValidator("json", articleBody), async (c) => {
    const userId = userIdOf(c);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const scope = scopeOf(c, userId);
    const result = await runHttp(
      c,
      scope,
      Effect.gen(function* () {
        const body = yield* decodeValue(
          c.req.valid("json"),
          ArticleBodySchema
        );
        const url = normalizeUrl(body.url);
        if (!url) {
          return yield* requestDecode("Invalid URL");
        }
        const current = yield* CurrentUser;
        const convex = yield* ConvexService;
        const { articleId } = yield* convex.createPending({
          userId: current.userId,
          url: url.toString(),
          kind: kindOf(url),
          title: url.toString(),
          savedAt: Date.now(),
        });
        return { articleId, url: url.toString() };
      })
    );
    if (!result.ok) {
      if (result.error instanceof RequestDecodeError) {
        return c.json(
          {
            error:
              result.error.message === "Invalid URL"
                ? "Invalid URL"
                : "Invalid request",
          },
          400
        );
      }
      return internalError(c, result.error);
    }

    const pipeline = scope.runTotal(
      processArticleEffect({
        articleId: result.value.articleId,
        userId,
        url: result.value.url,
      }),
      (cause) =>
        Effect.sync(() => {
          console.error(
            "article pipeline defect",
            Cause.squash(cause)
          );
        })
    );
    // Cloudflare waitUntil is best-effort background execution, not a
    // durable queue. A scrape can exceed the post-response execution window;
    // durable recovery requires a separate infrastructure decision.
    scope.waitUntil(pipeline);
    return c.json({ articleId: result.value.articleId }, 202);
  })
  .post(
    "/articles/upload",
    zValidator("form", uploadForm),
    async (c) => {
      const userId = userIdOf(c);
      if (!userId) return c.json({ error: "Unauthorized" }, 401);
      const scope = scopeOf(c, userId);
      const result = await runHttp(
        c,
        scope,
        Effect.gen(function* () {
          const file = yield* uploadFile(c.req.valid("form").file);
          if (!isPdf(file)) {
            return yield* requestDecode(
              "Only PDF files are supported"
            );
          }
          if (file.size > MAX_UPLOAD_BYTES) {
            return yield* requestDecode(
              "PDFs are limited to 50MB"
            );
          }
          const fallbackTitle = titleFromFilename(file.name);
          const current = yield* CurrentUser;
          const convex = yield* ConvexService;
          const { articleId } = yield* convex.createPending({
            userId: current.userId,
            url: `upload://${file.name}`,
            kind: "pdf",
            title: fallbackTitle,
            savedAt: Date.now(),
          });
          return { articleId, file, fallbackTitle };
        })
      );
      if (!result.ok) {
        if (result.error instanceof RequestDecodeError) {
          return c.json({ error: result.error.message }, 400);
        }
        return internalError(c, result.error);
      }

      const pipeline = scope.runTotal(
        processUploadEffect({
          articleId: result.value.articleId,
          userId,
          file: result.value.file,
          fallbackTitle: result.value.fallbackTitle,
        }),
        (cause) =>
          Effect.sync(() => {
            console.error(
              "upload pipeline defect",
              Cause.squash(cause)
            );
          })
      );
      scope.waitUntil(pipeline);
      return c.json({ articleId: result.value.articleId }, 202);
    }
  )
  .post(
    "/articles/:id/retry",
    zValidator("json", articleBody),
    async (c) => {
      const userId = userIdOf(c);
      if (!userId) return c.json({ error: "Unauthorized" }, 401);
      const scope = scopeOf(c, userId);
      const result = await runHttp(
        c,
        scope,
        Effect.gen(function* () {
          const body = yield* decodeValue(
            c.req.valid("json"),
            ArticleBodySchema
          );
          const url = normalizeUrl(body.url);
          if (!url) return yield* requestDecode("Invalid URL");
          return url.toString();
        })
      );
      if (!result.ok) {
        if (result.error instanceof RequestDecodeError) {
          return c.json(
            {
              error:
                result.error.message === "Invalid URL"
                  ? "Invalid URL"
                  : "Invalid request",
            },
            400
          );
        }
        return internalError(c, result.error);
      }

      const articleId = c.req.param("id");
      const pipeline = scope.runTotal(
        processArticleEffect({
          articleId,
          userId,
          url: result.value,
        }),
        (cause) =>
          Effect.sync(() => {
            console.error(
              "retry pipeline defect",
              Cause.squash(cause)
            );
          })
      );
      scope.waitUntil(pipeline);
      return c.json({ articleId }, 202);
    }
  )
  .put(
    "/memos/:articleId/:memoId",
    zValidator("param", memoParams),
    async (c) => {
      const userId = userIdOf(c);
      if (!userId) return c.json({ error: "Unauthorized" }, 401);

      const contentType = c.req.header("content-type") ?? "";
      if (!/^audio\//.test(contentType)) {
        return c.json({ error: "Expected an audio/* body" }, 415);
      }
      const declared = Number(c.req.header("content-length") ?? "0");
      if (declared > MAX_MEMO_BYTES) {
        return c.json({ error: "Audio too large" }, 413);
      }

      const scope = scopeOf(c, userId);
      const result = await runHttp(
        c,
        scope,
        Effect.gen(function* () {
          const params = yield* decodeParams(MemoParamsSchema, {
            ...c.req.valid("param"),
          });
          const audio = yield* requestArrayBuffer(c.req.raw);
          if (audio.byteLength === 0) {
            return yield* requestDecode("Empty body");
          }
          if (audio.byteLength > MAX_MEMO_BYTES) {
            return yield* requestDecode("Audio too large");
          }
          const current = yield* CurrentUser;
          const memos = yield* MemoStore;
          yield* memos.put(
            memoKey(
              current.userId,
              params.articleId,
              params.memoId
            ),
            audio,
            "audio/mp4"
          );
          return audio.byteLength;
        })
      );
      if (!result.ok) {
        if (result.error instanceof RequestDecodeError) {
          if (result.error.message === "Audio too large") {
            return c.json({ error: "Audio too large" }, 413);
          }
          return c.json({ error: result.error.message }, 400);
        }
        return internalError(c, result.error);
      }
      return c.json({ size: result.value }, 200);
    }
  )
  .get(
    "/memos/:articleId/:memoId",
    zValidator("param", memoParams),
    async (c) => {
      const userId = userIdOf(c);
      if (!userId) return c.json({ error: "Unauthorized" }, 401);
      const scope = scopeOf(c, userId);
      const result = await runHttp(
        c,
        scope,
        Effect.gen(function* () {
          const params = yield* decodeParams(MemoParamsSchema, {
            ...c.req.valid("param"),
          });
          const current = yield* CurrentUser;
          const memos = yield* MemoStore;
          return yield* memos.get(
            memoKey(
              current.userId,
              params.articleId,
              params.memoId
            ),
            c.req.raw.headers
          );
        })
      );
      if (!result.ok) {
        if (result.error instanceof RequestDecodeError) {
          return c.json({ error: "Invalid request" }, 400);
        }
        return internalError(c, result.error);
      }
      const object = result.value;
      if (!object) return c.json({ error: "Not found" }, 404);

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("accept-ranges", "bytes");

      let status = 200;
      let length = object.size;
      if (object.range) {
        const offset =
          "suffix" in object.range
            ? object.size - object.range.suffix
            : (object.range.offset ?? 0);
        length =
          "suffix" in object.range
            ? object.range.suffix
            : (object.range.length ?? object.size - offset);
        headers.set(
          "content-range",
          `bytes ${offset}-${offset + length - 1}/${object.size}`
        );
        status = 206;
      }
      headers.set("content-length", String(length));

      if (!("body" in object) || !object.body) {
        const failedWritePrecondition =
          c.req.header("if-match") !== undefined ||
          c.req.header("if-unmodified-since") !== undefined;
        return new Response(null, {
          status: failedWritePrecondition ? 412 : 304,
          headers,
        });
      }
      return new Response(object.body, { status, headers });
    }
  )
  .delete(
    "/memos/:articleId/:memoId",
    zValidator("param", memoParams),
    async (c) => {
      const userId = userIdOf(c);
      if (!userId) return c.json({ error: "Unauthorized" }, 401);
      const scope = scopeOf(c, userId);
      const result = await runHttp(
        c,
        scope,
        Effect.gen(function* () {
          const params = yield* decodeParams(MemoParamsSchema, {
            ...c.req.valid("param"),
          });
          const current = yield* CurrentUser;
          const memos = yield* MemoStore;
          yield* memos.delete(
            memoKey(
              current.userId,
              params.articleId,
              params.memoId
            )
          );
        })
      );
      if (!result.ok) {
        if (result.error instanceof RequestDecodeError) {
          return c.json({ error: "Invalid request" }, 400);
        }
        return internalError(c, result.error);
      }
      return c.json({ ok: true }, 200);
    }
  )
  .all("/mcp", async (c) => {
    const userId = userIdOf(c);
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401, {
        "WWW-Authenticate": 'Bearer error="invalid_token"',
      });
    }
    if (c.req.method !== "POST") {
      return c.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        },
        405,
        { Allow: "POST" }
      );
    }

    const scope = scopeOf(c, userId);
    const server = buildInkwellMcp({
      layer: scope.layer,
      waitUntil: scope.waitUntil,
    });
    const transport =
      new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

export type AppType = typeof app;

export type Client = ReturnType<typeof hc<AppType>>;
export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args);

export default app;
