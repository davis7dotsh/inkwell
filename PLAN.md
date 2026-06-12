# Inkwell v2 — Cloud Sync Platform

Plan for evolving Inkwell from a standalone iPad app into a synced system:
save a link from anywhere (web console or iPad), the backend crawls and parses
it with Firecrawl (web pages **and PDFs**), and it's waiting in the reader on
every device in real time.

This document is written to be executed by a swarm of implementation agents.
Each workstream has explicit file boundaries, interfaces, and acceptance
criteria.

---

## 1. Locked decisions

| Concern | Decision |
|---|---|
| Repo shape | This repo becomes a **pnpm-workspace monorepo** (same git repo/remote) |
| Mobile | Existing Expo app, moved to `apps/mobile` (SDK 54 pin stands — see AGENTS.md) |
| Web | **React SPA (Vite + TS)** served by a Cloudflare Worker via static assets — `apps/web` |
| Backend | **Separate Hono worker** on Cloudflare — `apps/api` |
| App↔API contract | **Hono RPC** (`hc<AppType>` typed client; zod-validated routes) |
| Auth | **Clerk Core 3** (web: `@clerk/react`; mobile: `@clerk/expo`; api: `@clerk/hono` middleware — note the March 2026 package renames, the old `@clerk/clerk-*` names are deprecated) |
| Data + realtime sync | **Convex** (`packages/backend`) — live queries on web + mobile |
| Scraping | **Firecrawl v2 REST via plain `fetch`** from the api worker (SDK is axios/Node-flavored; not worth it on Workers) |
| PDFs | Firecrawl `POST /v2/scrape` auto-detects PDF URLs (`parsers: [{type:"pdf"}]`) → markdown → blocks |
| Extraction location | **Backend always** — including saves initiated on the iPad. The on-device WebView/Readability extractor is retired (preserved in git history for a future offline mode) |
| Annotations | **Sync through Convex** (one doc per user+article; optimistic local updates) |
| Web v1 scope | Save box + live library + **read-only reader** that renders blocks and displays iPad markups |
| Secrets | Davis configures Clerk/Convex dashboards from the checklist in §8; agents build against `.env.example` placeholders. Wrangler is already authenticated on this machine |

## 2. Architecture

```
                       ┌─────────────────────┐
   paste URL           │  apps/api (Hono CF  │   POST /v2/scrape
  ┌──────────┐  RPC    │  worker)            │ ─────────────────►  Firecrawl
  │ apps/web │ ───────►│  - Clerk JWT auth   │ ◄─────────────────  (html+md+meta,
  └──────────┘         │  - create pending   │                      PDFs too)
  ┌──────────┐  RPC    │  - scrape+parse in  │
  │  mobile  │ ───────►│    waitUntil()      │   blocks JSON
  └──────────┘         │  - htmlToBlocks /   │ ─────────────────►  Convex
       ▲               │    markdownToBlocks │   (service auth)   (packages/
       │  live queries └─────────────────────┘                     backend)
       └────────────────────────────────────────────────────────────┘
         articles + annotations stream to all signed-in devices
```

Save flow: client calls `api.articles.$post({ url })` → worker authenticates
(Clerk), writes a `pending` article row in Convex, returns `202` immediately,
then scrapes/parses inside `ctx.waitUntil()` and flips the row to
`ready` (with blocks) or `failed` (with error). Clients never poll — the
pending→ready transition arrives via Convex live queries, which is the whole
"sitting there waiting for me on the iPad" experience.

Annotation flow: reader edits update local state instantly (as today), then a
debounced Convex mutation persists; other devices receive the update live.

## 3. Monorepo layout

```
inkwell/
├── apps/
│   ├── mobile/            # existing Expo app (git mv of current root app)
│   ├── web/               # Vite React SPA + wrangler worker (static assets)
│   └── api/               # Hono worker
├── packages/
│   ├── content/           # shared Block model, parsers, export, stroke paths
│   └── backend/           # Convex: schema, functions, auth config
├── pnpm-workspace.yaml    # packages: ["apps/*", "packages/*"]
├── package.json           # root scripts (dev/build/test fan-out), pnpm pin
├── PLAN.md                # this file
└── README.md              # updated for monorepo
```

Notes:
- Workspace protocol deps (`"@inkwell/content": "workspace:*"`).
- Package names: `@inkwell/content`, `@inkwell/backend`, `@inkwell/api`,
  `inkwell-web`, `inkwell-mobile`.
- Keep `allowBuilds` from the current `pnpm-workspace.yaml` (Skia etc.).
- Expo + pnpm monorepo: modern Expo auto-detects monorepos via
  `@expo/metro-config`; verify Metro resolves workspace packages, add minimal
  `metro.config.js` (watchFolders → repo root) only if needed.

## 4. `packages/content` — shared content model

Moves from `apps/mobile/src/lib` (these are already pure TS, no RN imports):
- `types.ts` → `src/types.ts`: `Block`, `Span`, plus annotation geometry types
  (`Stroke`, `BoxAnnotation`, `NoteAnnotation`, `Point`). The `Article` type
  is redefined here as the *content payload* (title/byline/excerpt/blocks);
  persistence-level fields (ids, status, userId) live in the Convex schema.
- `htmlToBlocks.ts` (with the layout-table/`<br><br>`/image upgrades)
- `exportMarkdown.ts`
- `strokePath.ts` (shared so the web reader can render ink as SVG)

New:
- `markdownToBlocks.ts`: `markdown → HTML → htmlToBlocks`. Use `marked`
  (zero-dep, fast). This is the PDF path: Firecrawl returns markdown for PDFs.
- `normalize.ts`: one entry point the api worker calls:
  `firecrawlToArticle({ html?, markdown?, metadata }) → { title, byline?, siteName?, excerpt?, blocks }`
  Prefers `html` (better fidelity through htmlToBlocks; keeps
  images/captions); falls back to `markdownToBlocks` when only markdown
  exists (PDFs).

Tests: port `scripts/test-parser.ts` into the package (`pnpm -F
@inkwell/content test`, still tsx + node:assert; add markdownToBlocks
fixtures incl. a PDF-ish markdown sample with headings/images).

Mobile keeps RN-specific things: `theme.ts`, `sampleArticle.ts` (or drops the
sample — see W5), components.

## 5. `packages/backend` — Convex

```
packages/backend/
├── convex/
│   ├── schema.ts
│   ├── articles.ts        # queries/mutations + internal mutations
│   ├── annotations.ts
│   └── auth.config.ts     # Clerk issuer (CLERK_JWT_ISSUER_DOMAIN env)
└── package.json
```

Schema (concrete — implement exactly; `v` from `convex/values`):

```ts
articles: defineTable({
  userId: v.string(),                  // Clerk user id (identity.subject)
  url: v.string(),
  kind: v.union(v.literal("web"), v.literal("pdf")),
  status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
  error: v.optional(v.string()),
  title: v.string(),                   // url until scrape completes
  byline: v.optional(v.string()),
  siteName: v.optional(v.string()),
  excerpt: v.optional(v.string()),
  blocksJson: v.optional(v.string()),  // JSON.stringify(Block[]) — string to dodge deep validators; Convex doc limit ~1MB, fine for articles
  savedAt: v.number(),                 // Date.now() at save
}).index("by_user", ["userId"]),

annotations: defineTable({
  userId: v.string(),
  articleId: v.id("articles"),
  contentWidth: v.number(),
  strokesJson: v.string(),             // JSON-encoded arrays (ink can be large)
  boxesJson: v.string(),
  notesJson: v.string(),
  updatedAt: v.number(),
}).index("by_article", ["articleId"]),
```

Functions (all user-facing ones require `ctx.auth.getUserIdentity()` and
scope by `userId`; throw on cross-user access):
- `articles.list` (query): user's articles, newest first, *without*
  `blocksJson` (keep the live list light).
- `articles.get` (query): one article incl. blocks.
- `articles.remove` (mutation): also deletes its annotations row.
- `annotations.get` (query, by articleId) / `annotations.save` (mutation,
  upsert by articleId).
- Service-side (called by the api worker): `internalMutation`s
  `articles.createPending`, `articles.complete` (title/meta/blocks),
  `articles.fail`, exposed via **Convex HTTP actions + shared secret header**
  in `convex/http.ts` (served on `https://<deployment>.convex.site/...` —
  note `.site`, not `.cloud`). See PLAN-integration-notes.md for the exact
  pattern. Internal mutations stay invisible to clients.
- Service-side reads (for the worker's MCP tools): `internalQuery`s
  `articles.listForAgent` / `articles.getForAgent` /
  `annotations.getForAgent`, exposed as GET HTTP actions `/agent/articles`,
  `/agent/article`, `/agent/annotations` behind the same shared secret. The
  worker authenticates the caller (Clerk session or API key) and asserts
  `userId` explicitly — same trust model as the ingest writes.

## 6. `apps/api` — Hono worker

```
apps/api/
├── src/
│   ├── index.ts           # Hono app; export type AppType
│   ├── auth.ts            # Clerk middleware → c.var.userId
│   ├── firecrawl.ts       # plain-fetch client (scrape; PDF parsers opt)
│   └── convex.ts          # service client for internal mutations
├── wrangler.jsonc         # name: inkwell-api
├── vitest.config.ts
└── test/                  # mocked-fetch unit tests
```

Routes (zod-validated via `@hono/zod-validator`):
- `POST /articles` `{ url: string }` → normalize/validate URL → detect
  `kind` (pdf if path ends `.pdf`, else web; worker may upgrade kind after
  seeing Firecrawl `metadata.contentType`) → `createPending` → **202**
  `{ articleId }` → `ctx.executionCtx.waitUntil(processArticle(...))`.
- `POST /articles/:id/retry` → re-run pipeline for a `failed` article (must
  belong to caller).
- `GET /health` → `{ ok: true }` (no auth).
- `ALL /mcp` → stateless MCP server (`src/mcp.ts`) with tools
  `save_article` / `list_articles` / `get_article` / `get_notes`. Every
  route accepts a user-scoped Clerk API key (`Authorization: Bearer ak_...`)
  as well as a session JWT (`getAuth(c, { acceptsToken: ["session_token",
  "api_key"] })`), so agents can also hit the REST routes (e.g.
  `/articles/upload` for local PDFs — file bytes don't belong in MCP tool
  args).

`processArticle`:
1. `POST https://api.firecrawl.dev/v2/scrape` with
   `{ url, formats: ["html", "markdown"], onlyMainContent: true, parsers: [{ type: "pdf", mode: "auto", maxPages: 200 }], timeout: 120000 }`
   and `Authorization: Bearer ${FIRECRAWL_API_KEY}`.
2. On success → `firecrawlToArticle(...)` from `@inkwell/content` → `articles.complete`.
3. On failure (HTTP error, `success:false`, 429, empty content) →
   `articles.fail` with a human-readable message. Honor `Retry-After` once on 429.

RPC: `export type AppType = typeof app`. Clients import **type-only** from
`@inkwell/api` and call via `hc<AppType>(API_URL, { headers: { Authorization: Bearer <clerk token> } })`.

Auth middleware: `@clerk/hono` (`clerkMiddleware()` + `getAuth(c)`); set
`CLERK_JWT_KEY` for networkless verification.

Secrets (wrangler): `FIRECRAWL_API_KEY`, `CLERK_SECRET_KEY`,
`WORKER_SHARED_SECRET`; vars: `CLERK_PUBLISHABLE_KEY`, `CONVEX_SITE_URL`
(the `.convex.site` HTTP-actions origin). CORS: allow the web app origin;
mobile sends Bearer tokens (no cookies/CORS concerns for RN).

Tests (vitest, no network): URL validation; pipeline state transitions with
mocked Firecrawl/Convex (success, Firecrawl failure, PDF branch); authz
(reject missing/invalid token).

## 7. `apps/web` — React SPA on a Worker

- Vite + React + TS. `@clerk/clerk-react`, `convex/react`
  (`ConvexProviderWithClerk`), Hono RPC client.
- Screens:
  - **Sign-in** (Clerk component).
  - **Library**: prominent save box (paste URL → RPC → optimistic "pending"
    card appears via Convex live query), article cards with status chips
    (pending spinner / failed + retry), delete, open reader. This is the
    capture console — it should be *fast to paste into*.
  - **Reader**: renders `Block[]` (web `BlockRenderer` — port of the RN one
    to semantic HTML with the same ink-wash palette), and **displays**
    annotations read-only: strokes via `strokeToSvgPath` → `<svg><path>`,
    boxes/notes as positioned divs, scaled by `contentWidth` exactly like
    mobile.
- Worker config (`wrangler.jsonc`, name `inkwell-web`):
  `{ assets: { directory: "./dist", not_found_handling: "single-page-application" } }`,
  current `compatibility_date` (≥ 2025-04-01 for navigation-request
  optimization). No `main` needed in v1 (pure SPA; API is the other worker).
  Build with `@cloudflare/vite-plugin` (integrated `vite dev` + deploy).
- Env (Vite): `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CONVEX_URL`, `VITE_API_URL`.

## 8. `apps/mobile` — Expo app changes

Add: `@clerk/expo` (+ `expo-secure-store`; token cache ships built-in at
`@clerk/expo/token-cache`), `convex` (`convex/react` works in RN — construct
the client with `unsavedChangesWarning: false`), Hono RPC client.

- **Auth**: ClerkProvider at root; signed-out → custom email-code sign-in
  screen (`useSignIn`/`useSignUp` — **works in Expo Go**; native
  Google/Apple OAuth needs a dev build, deferred to Phase 3). Gate UI with
  `useConvexAuth()`, not Clerk's `isSignedIn`.
- **Library**: `useQuery(api.articles.list)` replaces local index; cards show
  status (pending = subtle shimmer/spinner card that resolves in place —
  this is the magic moment, make it feel good). Save box → RPC `POST /articles`.
- **Reader**: article via `useQuery(api.articles.get)`; annotations load from
  Convex, save path swaps `storage.saveAnnotations` for a debounced Convex
  mutation (same 600ms debounce; optimistic local state unchanged).
- **Remove**: `ExtractorWebView`, `extractScript.ts`, `readabilitySource.ts`,
  vendor script, the extraction flow in `add.tsx` (route deleted; saving is
  inline in the library), `htmlToBlocks` import switches to
  `@inkwell/content`. Local kv-store storage shrinks to a read cache
  (optional stretch: persist last-opened articles for offline reading).
- **Sample article**: drop the Convex seed; keep a signed-out marketing-ish
  empty state instead. (The annotated sample made sense for a local demo,
  less so for accounts.)
- Env: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CONVEX_URL`,
  `EXPO_PUBLIC_API_URL`.

## 9. Davis's setup checklist (dashboards — before Phase 2)

1. **Clerk** (dashboard.clerk.com): create application "Inkwell". Enable
   Email (verification code) + Google/Apple as desired. Turn on the
   **Convex integration** (it activates the `convex` JWT template for you).
   Collect: publishable key, secret key, and the **Frontend API URL /
   issuer domain** (looks like `https://xxx.clerk.accounts.dev`).
2. **Convex** (`npx convex dev` inside `packages/backend`): create project
   "inkwell". Set deployment env vars `CLERK_JWT_ISSUER_DOMAIN` (from step
   1) and `WORKER_SHARED_SECRET` (generate: `openssl rand -hex 32`).
   Collect: deployment URL (`https://xxx.convex.cloud`) and the HTTP
   actions origin (`https://xxx.convex.site`).
3. **Wrangler secrets** (I can run these with you):
   `wrangler secret put FIRECRAWL_API_KEY|CLERK_SECRET_KEY|...` in `apps/api`.
4. Fill the per-app `.env.local` files from each `.env.example`. Existing
   root `.env.local` (Firecrawl key) moves to `apps/api/.dev.vars` for local
   `wrangler dev`.

## 10. Integration crib notes (validated against current docs)

> Agents: prefer these patterns; verify against live docs if something
> doesn't compile. Key versions/APIs researched 2026-06-09.

- **Firecrawl v2**: base `https://api.firecrawl.dev`, `POST /v2/scrape`,
  bearer auth. Articles: `formats: ["html","markdown"]`, `onlyMainContent:
  true` (default). PDFs: same endpoint auto-detects; `parsers:
  [{type:"pdf",mode:"auto",maxPages:N}]`; 1 credit/PDF page; raise `timeout`.
  Response: `{ success, data: { markdown, html, metadata: { title,
  description, ogImage, sourceURL, statusCode, contentType } } }`.
  `POST /v2/parse` is multipart file-upload only (future: upload PDFs from
  device). `POST /v2/map` = fast URL listing for a site (future "save all of
  X"). Use plain fetch on Workers — the official SDK wants Node ≥22/axios.
- **Workers static assets**: `assets.directory` + `not_found_handling:
  "single-page-application"`; same worker can also have `main` + 
  `run_worker_first: ["/api/*"]` if we ever fold workers together.
- **Hono RPC / Clerk-on-Workers / Convex auth + service writes / Expo
  monorepo metro**: see `PLAN-integration-notes.md` (companion file generated
  from the stack research) — agents must read it before implementing W2/W3/W5.

## 11. Execution plan (ultracode workstreams)

**Phase 0 — restructure (sequential, one agent or main loop):**
`git mv` the Expo app into `apps/mobile` (everything except PLAN*, README,
LICENSE, .git*, root env files), write root `pnpm-workspace.yaml` +
`package.json`, scaffold empty `apps/api`, `apps/web`, `packages/content`,
`packages/backend` with package.json + tsconfig, `pnpm install`, **verify
the mobile app still boots in the simulator** before anything else lands.
Acceptance: `pnpm -F inkwell-mobile exec tsc --noEmit` clean; Expo boots;
commit.

**Phase 1 — parallel workstreams (after Phase 0 merges):**

| W | Scope (files) | Acceptance |
|---|---|---|
| W1 | `packages/content` move + `markdownToBlocks` + `firecrawlToArticle` + tests | package tests pass; `@inkwell/content` builds; mobile compiles against it |
| W2 | `packages/backend` Convex schema/functions/auth config | `npx convex codegen` + `tsc` clean; functions follow §5 exactly |
| W3 | `apps/api` Hono worker + firecrawl + convex service client + RPC export | vitest green (mocked); `tsc` clean; `wrangler deploy --dry-run` succeeds |
| W4 | `apps/web` SPA (sign-in, library, reader) + worker config | `pnpm build` + `tsc` clean; renders signed-out state in dev |
| W5 | `apps/mobile` Clerk + Convex + RPC swap + extraction removal | `tsc` clean; boots to sign-in screen in Expo Go (placeholder keys) |

W1 blocks W3 (imports `firecrawlToArticle`) — W3 starts against the §4
interface signature and links up when W1 lands. W2's generated API types are
needed by W3/W4/W5 for Convex calls — same approach: implement against §5
names. Dependencies are interface-stable by design; agents must not invent
schema/route changes without updating this file.

**Phase 2 — integration (with Davis, after §9 setup):** real keys in, convex
deploy, `wrangler deploy` both workers, E2E: (1) save article on web → lands
on iPad signed into same account, live; (2) save a PDF URL → readable on
both; (3) annotate on iPad → markups visible on web reader; (4) failed URL →
failed card + retry works.

**Phase 3 — polish/stretch:** offline read cache on mobile, PDF file upload
(`/v2/parse`), "save all of site" via map, web annotation editing, share
extension on iOS.

## 12. Risks & mitigations

- **Convex 1MB/doc**: blocksJson for huge pages or strokesJson for very heavy
  ink could approach it. Mitigate: strokes are already point-sampled; if a
  write fails on size, split annotations into per-kind docs (schema change is
  additive) or chunk blocks. Don't pre-engineer.
- **Clerk + Expo Go**: if current clerk-expo requires a dev build, mobile
  testing moves to `expo run:ios` (works on this machine; slower loop).
- **Firecrawl free-tier rate limits** (10 req/min): fine for personal use;
  the worker surfaces 429s as `failed` + retry rather than queueing. Add a
  Queue later if it ever matters.
- **Expo SDK 54 pin**: applies to `apps/mobile` only; web/api/packages run on
  current Node/Vite toolchains. Don't let an agent "helpfully" upgrade the
  Expo SDK (see AGENTS.md).
- **Two extraction engines drift**: avoided by retiring on-device extraction
  (decision above); `@inkwell/content` is the single content pipeline.

## 13. Definition of done (v2)

Davis can: sign into web + iPad with the same account; paste a URL (article
or PDF) into either; watch it flip pending→ready everywhere without
refreshing; read + Pencil-annotate on iPad; see those markups on the web
reader; export Markdown from the iPad as before. All repos/workers deploy
from this monorepo with documented commands.
