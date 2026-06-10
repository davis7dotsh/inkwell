# Integration notes (researched 2026-06-09)

Companion to PLAN.md §10. Implementation agents: read the section for your
workstream BEFORE writing code. These were verified against live docs; if
something doesn't compile, check the linked docs rather than guessing.

**Current versions:** hono@4.12.x · @hono/zod-validator@0.8 (zod 4 ok) ·
@clerk/expo@3.3.x (Core 3 — `@clerk/clerk-expo` is DEPRECATED) ·
@clerk/react (renamed from @clerk/clerk-react) · @clerk/hono (official; use
instead of @hono/clerk-auth) · convex@1.40.x · Expo SDK 54 = RN 0.81.

---

## Firecrawl v2 (apps/api)

- Base `https://api.firecrawl.dev`, header `Authorization: Bearer fc-...`.
- **Use plain fetch on Workers** — official SDK (`firecrawl` npm) wants
  Node>=22/axios; not worth compat flags for a 10-line call.
- `POST /v2/scrape` body: `{ url, formats: ["markdown","html"],
  onlyMainContent: true, parsers: [{type:"pdf",mode:"auto",maxPages:200}],
  timeout: 120000, maxAge?: number }`.
  - PDFs auto-detected from URL — same endpoint, returns markdown (1
    credit/PDF page). `mode: fast|auto|ocr`.
  - Response: `{ success, data: { markdown, html, metadata: { title,
    description, ogTitle, ogDescription, ogImage, sourceURL, statusCode,
    contentType, error } , warning } }`. Check `success` AND `data.warning`.
  - markdown/html keep inline image URLs (base64 images stripped from
    markdown by default).
- `POST /v2/parse`: multipart file upload ONLY (future: device PDF upload,
  max 50MB). `POST /v2/map`: site URL listing, 1 credit (future bulk-save).
- Rate limits: free 10 req/min → surface 429 as failed+retry, honor
  Retry-After once.

```ts
const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
  method: "POST",
  headers: { Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
             "Content-Type": "application/json" },
  body: JSON.stringify({ url, formats: ["markdown", "html"],
    onlyMainContent: true,
    parsers: [{ type: "pdf", mode: "auto", maxPages: 200 }],
    timeout: 120000 }),
});
```

## Hono RPC (apps/api + clients)

- Routes MUST be **chained** off one `new Hono()` for type inference;
  `export type AppType = typeof app` (the chained value).
- Return `c.json(body, status)` with explicit status (typed on client);
  never `c.notFound()` on RPC routes.
- Client: `import { hc } from "hono/client"; import type { AppType } from
  "@inkwell/api"` (TYPE-ONLY import). Export a pre-compiled client from the
  api package to keep TS fast:
  ```ts
  export type Client = ReturnType<typeof hc<AppType>>;
  export const hcWithType = (...args: Parameters<typeof hc>): Client =>
    hc<AppType>(...args);
  ```
- `"strict": true` in BOTH server and client tsconfigs or types silently
  degrade. ONE hono version across the workspace (root catalog/dep).
- Validators: `zValidator("json", schema)`; access `c.req.valid("json")`.

## Clerk on Workers (apps/api)

- Use **`@clerk/hono`**: `clerkMiddleware()` + `getAuth(c)`.
  `CLERK_SECRET_KEY` as wrangler secret, `CLERK_PUBLISHABLE_KEY` as var —
  read via hono/adapter `env(c)`, no process.env needed.
- Optionally set `CLERK_JWT_KEY` (instance JWKS public key) for fully
  networkless verification on Workers.
- Mobile/web clients send `Authorization: Bearer ${await getToken()}`.
  No cookies needed for RN.

```ts
const app = new Hono()
  .use("*", clerkMiddleware())
  .post("/articles", zValidator("json", saveSchema), (c) => {
    const auth = getAuth(c);
    if (!auth?.userId) return c.json({ error: "unauthorized" }, 401);
    // ...
  });
```

## Clerk + Expo (apps/mobile)

- Package: **`@clerk/expo`** (v3). `npx expo install @clerk/expo
  expo-secure-store`. Built-in token cache:
  `import { tokenCache } from "@clerk/expo/token-cache"`.
- **Expo Go supports** custom JS flows: email/password, email OTP, magic
  link via `useSignIn`/`useSignUp` (Core 3 hooks: `fetchStatus`,
  `errors.fields`, resource `status`). **Dev build required** for
  `useSSO()`, native Google/Apple sign-in, passkeys, and the native
  prebuilt components (`<AuthView/>` etc.).
- v1 call: custom email-code sign-in UI in Expo Go; OAuth later w/ dev build.

## Convex + Clerk (packages/backend + both clients)

- Clerk Dashboard has a **Convex integration** that activates the `convex`
  JWT template. Copy the Frontend API URL (issuer), set
  `CLERK_JWT_ISSUER_DOMAIN` env var on the Convex deployment.
- `convex/auth.config.ts`:
  ```ts
  export default { providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }] };
  ```
- Providers (web `@clerk/react`, mobile `@clerk/expo` — same Convex side):
  ```tsx
  <ClerkProvider ...>
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
  ```
  Pass the `useAuth` hook itself. RN client needs
  `new ConvexReactClient(url, { unsavedChangesWarning: false })`.
- Gate UI with `useConvexAuth()` / `<Authenticated>`, NOT Clerk's
  `isSignedIn` (Clerk authenticates before Convex validates).
- In functions: `const identity = await ctx.auth.getUserIdentity()`;
  `identity.subject` = Clerk user id.

## Worker → Convex service writes (apps/api + packages/backend)

**Chosen pattern: Convex HTTP action + shared secret** (keeps mutations
`internal*`, zero public surface):

```ts
// packages/backend/convex/http.ts — served at https://<deployment>.convex.site/...
http.route({ path: "/ingest/complete", method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (req.headers.get("x-inkwell-key") !== process.env.WORKER_SHARED_SECRET)
      return new Response("forbidden", { status: 403 });
    await ctx.runMutation(internal.articles.complete, await req.json());
    return Response.json({ ok: true });
  }) });
```
- NOTE the domain: HTTP actions live on **`.convex.site`**, not `.convex.cloud`.
- Secret set both sides: `npx convex env set WORKER_SHARED_SECRET ...` and
  `wrangler secret put` in apps/api. Batch related writes into ONE mutation
  per call (each runMutation is its own transaction).
- Routes needed: `/ingest/create-pending`, `/ingest/complete`,
  `/ingest/fail` (or one route with an `op` field — implementer's choice,
  document it in the api package README).

## Convex schema/function syntax

`defineSchema`/`defineTable` from "convex/server", `v` from "convex/values";
indexes `.index("by_user", ["userId"])`; system fields `_id`,
`_creationTime` automatic. `query`/`mutation`/`internalMutation` from
`./_generated/server`; internal fns invoked via `internal.*` from
`./_generated/api`. `npx convex codegen` generates types without deploying.

## Web worker (apps/web)

- **Use `@cloudflare/vite-plugin`** (`vite.config.ts`: `plugins: [react(),
  cloudflare()]`) — reads wrangler.jsonc, integrated dev (workerd in `vite
  dev`), `vite build` emits assets, `wrangler deploy` ships.
- wrangler.jsonc: `{ name: "inkwell-web", compatibility_date: <today>,
  assets: { directory: "./dist", not_found_handling:
  "single-page-application" } }`. No `main` needed (pure SPA; API is the
  separate inkwell-api worker).

## Expo in the pnpm monorepo (apps/mobile)

- Expo SDK 54 auto-configures Metro for workspaces (watchFolders +
  nodeModulesPaths). Keep `metro.config.js` to just
  `getDefaultConfig(__dirname)` unless something breaks.
- Shared package consumed as TS SOURCE: `@inkwell/content` package.json →
  `{ "main": "./src/index.ts", "types": "./src/index.ts" }`. No build step;
  Metro/Vite/Workers bundlers all handle TS source.
- In shared packages, `react`/`react-native` (if ever needed) must be
  peerDependencies — exactly one copy in the app. `@inkwell/content` must
  stay dependency-light and RN-free (htmlparser2 + marked only).
- pnpm isolated linker is supported; escape hatch if native issues:
  `nodeLinker: hoisted` in pnpm-workspace.yaml.
- After workspace/dep changes: `npx expo start --clear`.

## Known edge cases

- convex-js issue #156: Expo + ConvexProviderWithClerk can stay
  unauthenticated after Clerk session replacement — keep `convex` current.
- Don't share a ConvexHttpClient across requests if calling setAuth (n/a
  with the HTTP-action pattern).
- With `run_worker_first: ["/api/*"]`, unknown /api paths 404 from the
  worker instead of serving the SPA (correct behavior; only relevant if
  workers are ever merged).
