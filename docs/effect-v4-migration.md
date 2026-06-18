# Effect v4 migration plan

Status: implementation plan for `codex/effect-v4-port`

Pinned cohort:

- `effect@4.0.0-beta.84`
- `@effect/vitest@4.0.0-beta.84`
- `@effect/language-service@0.86.2`
- `typescript@5.9.3`

Effect v4 is still prerelease. Keep the Effect packages pinned to one exact
cohort and upgrade them deliberately.

## Migration rules

1. Effect owns asynchronous orchestration, resource access, cancellation,
   retries, logging, and expected operational failures.
2. Pure deterministic transformations remain ordinary TypeScript.
3. React owns rendering, hooks, local UI state, DOM/native lifecycles, Convex
   subscriptions, Expo hook-owned resources, and Reanimated worklets.
4. Convex keeps its validators, transaction boundaries, database access model,
   and retry semantics.
5. Hono remains the API Worker's routing and Clerk adapter. Effect HTTP is used
   for outbound HTTP; the unstable Effect server stack does not replace Hono in
   this migration.
6. Services use Effect v4 `Context.Service`, explicit `Layer` composition, and
   `Data.TaggedError` for typed failures.
7. Zod is the single runtime schema system. External and persisted data is
   decoded with Zod. Expected failures are not represented by `Error`,
   unchecked casts, or swallowed promises.
8. Application entry points are the only places that run Effects. Internal
   modules return Effects and do not call `Effect.run*` inside other Effects.
9. No Node platform packages or `nodejs_compat` are introduced for Cloudflare.
10. No database schema, index, stored representation, generated Convex file, or
    public wire shape changes are part of this migration.

## Tooling and CI

- Add a shared TypeScript config with the Effect language-service plugin.
- Add a root solution config referencing every TypeScript workspace.
- Add mobile to root typechecking.
- Add `check:effect` using the language-service diagnostics CLI.
- Make root `check` run TypeScript, Effect diagnostics, tests, web build,
  Cloudflare dry-run bundling, mobile export/lint, and the conditional Convex
  codegen drift gate.
- Add GitHub Actions CI with Node 24.16 and pnpm 11.5.2.
- Keep `skipLibCheck` while Effect v4 beta declarations require TypeScript 6
  library features upstream.
- Run Effect diagnostics in strict mode while filtering informational messages,
  so warnings fail verification without adding non-actionable output.
- Run `pnpm --filter @inkwell/backend codegen:check` with
  `CONVEX_DEPLOY_KEY` to regenerate `convex/_generated` and fail on drift. The
  gate prints an explicit skip when the key is unavailable, which keeps fork
  pull requests usable without weakening verification on trusted CI.

## Shared content package

- Add structural Zod schemas for blocks, annotations, layout snapshots, and
  Firecrawl content without replacing the existing plain TypeScript types.
- Expose schemas through an explicit package subpath so mobile can avoid pulling
  schema code into pure rendering modules unnecessarily.
- Add tagged normalization/parser errors and Effect adapters around throwing
  parser boundaries.
- Preserve all parser, markdown, geometry, outline, and rendering algorithms as
  pure functions.
- Preserve tolerant legacy annotation parsing where malformed individual items
  are intentionally ignored.
- Extend tests with schema success/failure cases and sync/Effect equivalence.

## API Worker

- Keep Hono, Clerk middleware, CORS, R2 response streaming, and MCP transport at
  the adapter boundary.
- Add request-scoped services for Worker configuration, current user,
  `waitUntil`, and the memo bucket. Never capture request bindings in a global
  runtime.
- Build Effect services for Convex HTTP actions, Firecrawl, article
  normalization, article processing, and memo storage.
- Use `FetchHttpClient` for outbound HTTP and Zod for every external response.
- Preserve exactly one 429 retry for Firecrawl and do not add retries to
  non-idempotent article creation.
- Keep the existing Hono Zod validators as transport adapters where their
  validation order and error payloads are part of the public REST contract.
  Reuse Zod for service configuration, outbound responses, persisted data, and
  MCP tool inputs instead of maintaining a second schema system.
- Split MCP tool logic into Effect programs while preserving protocol behavior.
- Supervise background pipelines so their promises never reject and register
  the same single execution with `waitUntil`.
- Preserve all route paths, status codes, response bodies, R2 key formats, and
  upload limits.

## Convex backend

- Do not edit `packages/backend/convex/schema.ts`.
- Add narrow Effect runners and tagged domain errors for authentication,
  ownership, not-found, validation, and conflict cases.
- Build one Effect program per handler invocation and run it exactly once at the
  Convex boundary.
- Do not use Effect retries, timers, background fibers, Clock, Random, or a
  global runtime in queries and mutations.
- Keep Convex validators as the first argument-validation layer.
- Add strict Zod decoding to HTTP actions, where Convex validators are not
  available.
- Return only plain Convex-serializable values and preserve transaction order,
  legacy defaults, error text, and intentionally indistinguishable not-found
  behavior.

## Web app

- Keep Convex `useQuery` and `useMutation` hooks and React UI lifecycles.
- Add a browser runtime and an `InkwellApi` service using `FetchHttpClient`.
- Acquire Clerk tokens per operation so no runtime captures stale auth.
- Replace the success-only Hono client mirror with typed Effect operations and
  decoded success/error bodies.
- Decode persisted article and annotation JSON through shared schemas.
- Wrap Convex mutation promises as typed commands and expose failures that are
  currently discarded.
- Make memo loading interruptible and cancel work on close/unmount.
- Keep DOM measurement, object URL ownership, routing, forms, and local state in
  React.
- Do not automatically retry save, upload, or retry POST operations.

## Mobile app

- Preserve the crash guard as the first import and do not touch generated `ios/`.
- Use narrow Effect subpath imports and avoid unstable Effect modules in Metro.
- Put Expo fetch, filesystem, key-value storage, native UI commands, IDs, memo
  storage, and API access behind mobile-local services.
- Keep Clerk, Convex, audio, and router hooks in React; adapt their imperative
  commands into Effects at component boundaries.
- Decode configuration, API responses, fatal reports, article blocks, and
  annotation JSON with Zod.
- Remove render-time filesystem mutation and replace boolean/empty-string
  failure signaling with tagged errors.
- Interrupt UI-launched fibers on cleanup where cancellation is meaningful.
- Never run Effect inside Reanimated worklets.
- Verify Metro/Hermes with an iOS export and the existing development client.

## Verification and completion gates

The migration is complete only when all of the following are true:

- Root TypeScript and Effect language-service diagnostics pass.
- Existing API and content tests remain green and new Effect tests cover typed
  failures, decoding, retries, cancellation, and layer substitution.
- Web production build succeeds.
- API Worker dry-run bundle succeeds without Node compatibility.
- Mobile TypeScript, Expo export, and relevant lint checks succeed without
  changing `ios/`.
- Convex codegen/typecheck succeeds and `convex/schema.ts` plus generated data
  model definitions show no schema drift.
- Searches find no unreviewed global fetch, timer, Promise constructor,
  unchecked JSON parsing, generic operational `Error`, or discarded async
  command at migrated boundaries.
- Independent workspace reviews find no service leaks, nested runtime calls,
  duplicate Effect versions, unsafe retries, or wire-contract regressions.
- The pull request's CI and automated reviewers are green, or every remaining
  comment is explicitly determined to be non-actionable.

### Isolated local backend verification

Use a Convex deploy key for the same generated-code drift check as trusted CI:

```sh
CONVEX_DEPLOY_KEY='…' pnpm --filter @inkwell/backend codegen:check
pnpm --filter @inkwell/backend typecheck
git diff --exit-code -- packages/backend/convex/schema.ts \
  packages/backend/convex/_generated
```

Without `CONVEX_DEPLOY_KEY`, `codegen:check` deliberately reports that codegen
was skipped; backend typechecking and the protected-file diff can still run
locally. For this migration, codegen was also verified against an anonymous
isolated local Convex backend (`convex dev --once`) with a dummy Clerk issuer.
That pushes functions only to the ephemeral local backend; it does not touch a
cloud deployment or modify the repository's database schema.
