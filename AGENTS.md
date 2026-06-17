# Inkwell monorepo

pnpm workspaces:

- `apps/mobile` — Expo app (SDK 54, pinned). **Read apps/mobile/AGENTS.md before touching it.**
- `apps/web` — React SPA on a Cloudflare Worker (Vite + static assets)
- `apps/api` — Hono worker (Firecrawl scraping, Clerk auth, Convex service
  reads/writes, MCP server at `/mcp` for agents via Clerk API keys)
- `packages/content` — shared Block model + parsers (pure TS, RN-free)
- `packages/backend` — Convex schema/functions

Secrets live in root `.env.local` (gitignored); `.env.example` documents
every variable and where it lands per app.

- whenever u are going to make a change to the data model (database schema), ask first
- anytime you install a new package, ask first
- use Zod for runtime, persisted, and wire-data schemas; do not introduce Effect Schema
- use `Data.TaggedError` for typed Effect failures instead of schema-backed error classes
