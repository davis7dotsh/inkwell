# Inkwell

Save articles and PDFs from anywhere, read them in a clean serif reader, and
mark them up with your Apple Pencil — ink, highlighter, boxes around key
sections, pinned notes. Your library and annotations sync through the same backend on iPad and web.

Ink-wash palette: deep ink `#0E2E52` · brush blue `#1B4F8A` · stroke blue
`#3D7BC0` · wash `#8FB8DE` · mist `#E4EEF7` · paper `#F7F8F6`.

## Architecture

Native iPad app alongside pnpm workspaces:

| Path               | What it is                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ios`         | Native Swift iPad app built with SwiftUI and Apple frameworks. Checked-in Xcode project; no JavaScript runtime or package dependencies.                        |
| `apps/web`         | React SPA on a Cloudflare Worker (Vite + static assets). Save console, library, and read-only reader showing your iPad markups.                                |
| `apps/api`         | Hono worker. Clerk-authed RPC and MCP; scrapes via Firecrawl v2, normalizes to blocks, and calls internal Convex functions through shared-secret HTTP actions. |
| `packages/content` | TypeScript content model, parsers, normalization, Markdown export, and stroke geometry. Swift mirrors the existing wire formats.                               |
| `packages/backend` | Convex schema and functions for articles, tags, and annotations with Clerk auth.                                                                               |

Save flow: client → `POST /articles` (202 immediately) → worker scrapes in
`waitUntil` → article flips pending→ready in Convex → signed-in devices
refresh their libraries. Annotations save with a debounced Convex mutation and follow
you across devices.

## Develop

The native app requires macOS, Xcode 16 or later, and an iOS 18 or later
simulator or device. Open `apps/ios/Inkwell.xcodeproj` and select the `Inkwell`
scheme, or use the commands below. Xcode builds the checked-in project directly.

```bash
pnpm install
pnpm --filter @inkwell/backend dev   # Convex functions + codegen, when needed
pnpm dev                            # API on localhost:8787 + web on localhost
pnpm mobile                         # build and launch an iPad simulator
pnpm ipad:dev                       # development build on a connected iPad
pnpm ipad                           # release build on a connected iPad
pnpm iphone                         # development build on a connected iPhone
pnpm check:ci                       # TypeScript, tests, formatting, web/API builds
pnpm check:ios                      # Swift build + iPad simulator tests (macOS)
```

The native app runs directly in Simulator or on a device. It does not need a
JavaScript development server. `pnpm dev` starts the API and web development
servers separately; stop them with Ctrl-C.

Secrets: copy root `.env.example` to `.env.local`; API and web development
load it directly. Convex server secrets live in the selected deployment
(`convex env set`), not in a local file.

Native public configuration lives in
`apps/ios/Configuration/Debug.xcconfig` (staging) and `Release.xcconfig`
(production). For a local API, copy `Local.xcconfig.example` to the gitignored
`apps/ios/Configuration/Local.xcconfig` and use
`API_BASE_URL = http:/$()/localhost:8787`. Simulator can reach the Mac's
localhost. A physical iPad needs the Mac's reachable network address instead.
Do not place Clerk secret keys or other server secrets in native configuration.

To select a particular simulator, pass its identifier through
`INKWELL_SIMULATOR_ID`. `pnpm build:ios --release` builds the release
configuration without launching it; `pnpm test:ios` runs the native tests.

## Deploy

```bash
pnpm --filter @inkwell/backend exec convex dev --once   # push functions (dev)
cd apps/api && pnpm exec wrangler deploy                # api worker
cd apps/web && pnpm build && pnpm exec wrangler deploy  # web app
```

## License

MIT — see [LICENSE](LICENSE).
