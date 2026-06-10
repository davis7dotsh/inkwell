# Inkwell monorepo

pnpm workspaces:
- `apps/mobile` — Expo app (SDK 54, pinned). **Read apps/mobile/AGENTS.md before touching it.**
- `apps/web` — React SPA on a Cloudflare Worker (Vite + static assets)
- `apps/api` — Hono worker (Firecrawl scraping, Clerk auth, writes to Convex)
- `packages/content` — shared Block model + parsers (pure TS, RN-free)
- `packages/backend` — Convex schema/functions

Architecture + workstream plan: `PLAN.md`. Version-critical API patterns
(Clerk Core 3 names, Hono RPC rules, Convex HTTP actions, Firecrawl v2):
`PLAN-integration-notes.md`. Read both before significant work.

Secrets live in root `.env.local` (gitignored); `.env.example` documents
every variable and where it lands per app.
