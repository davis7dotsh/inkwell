# Inkwell

Save articles and PDFs from anywhere, read them in a clean serif reader, and
mark them up with your Apple Pencil — ink, highlighter, boxes around key
sections, pinned notes. Everything syncs live: save a link at your desk and
it's waiting on the iPad before you sit down.

Ink-wash palette: deep ink `#0E2E52` · brush blue `#1B4F8A` · stroke blue
`#3D7BC0` · wash `#8FB8DE` · mist `#E4EEF7` · paper `#F7F8F6`.

## Architecture

pnpm monorepo:

| Package            | What it is                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile`      | Expo app (SDK 56; Expo Go unavailable — use dev-client builds, see apps/mobile/CLAUDE.md). Reader + Apple Pencil annotation, Clerk SSO sign-in, Convex live queries. |
| `apps/web`         | React SPA on a Cloudflare Worker (Vite + static assets). Save console, live library, read-only reader that shows your iPad markups.                                  |
| `apps/api`         | Hono worker. Clerk-authed RPC and MCP; scrapes via Firecrawl v2, normalizes to blocks, and calls internal Convex functions through shared-secret HTTP actions.       |
| `packages/content` | Shared content model: Block types, htmlToBlocks, markdownToBlocks, Firecrawl normalizer, Markdown export, stroke geometry.                                           |
| `packages/backend` | Convex schema + functions (articles, annotations) with Clerk auth.                                                                                                   |

Save flow: client → `POST /articles` (202 immediately) → worker scrapes in
`waitUntil` → article flips pending→ready in Convex → every signed-in device
updates live. Annotations save with a debounced Convex mutation and follow
you across devices.

## Develop

```bash
pnpm install
pnpm --filter @inkwell/backend dev   # convex dev (functions + codegen)
pnpm api                              # wrangler dev, dev bindings + root env
pnpm web                              # vite dev
pnpm mobile                           # expo start (Metro for dev-client builds)
pnpm test && pnpm typecheck           # all gates
```

Secrets: copy the root `.env.example` to `.env.local`; API and web development
load it directly. Mobile public configuration is mode-specific in
`apps/mobile/.env.development` and `.env.production`. Convex server secrets
live in the selected deployment (`convex env set`), not in a local file.

## Deploy

```bash
pnpm --filter @inkwell/backend exec convex dev --once   # push functions (dev)
cd apps/api && pnpm exec wrangler deploy                # api worker
cd apps/web && pnpm build && pnpm exec wrangler deploy  # web app
```

## License

MIT — see [LICENSE](LICENSE).
