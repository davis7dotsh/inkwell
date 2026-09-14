# Inkwell monorepo

Native app and pnpm workspaces:

- `apps/ios` — native Swift iPad app. Open `Inkwell.xcodeproj`, scheme `Inkwell`.
- `apps/web` — React SPA on a Cloudflare Worker (Vite + static assets)
- `apps/api` — Hono worker (Firecrawl scraping, Clerk auth, Convex service
  reads/writes, MCP server at `/mcp` for agents via Clerk API keys)
- `packages/content` — shared Block model + parsers (pure TypeScript)
- `packages/backend` — Convex schema/functions

Secrets live in root `.env.local` (gitignored); `.env.example` documents
every variable and where it lands per app.

`pnpm dev` starts the API and web servers. `pnpm mobile` builds and launches
the iPad simulator; `pnpm ipad:dev` targets a connected iPad in development, and `pnpm ipad`
builds the release configuration. Native code uses
Apple frameworks and the existing backend contracts; it is not a pnpm package.
Run `pnpm check:ci` for TypeScript workspaces and `pnpm check:ios` on macOS for
the Swift build and simulator tests. Keep `Inkwell.xcodeproj` checked in.

- whenever u are going to make a change to the data model (database schema), ask first
- anytime you install a new package, ask first
- use Zod for runtime, persisted, and wire-data schemas; do not introduce Effect Schema
- use `Data.TaggedError` for typed Effect failures instead of schema-backed error classes
