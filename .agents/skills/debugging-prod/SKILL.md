---
name: debugging-prod
description: Debug Inkwell production by checking Depot deploys, Cloudflare Workers and R2 status, Convex logs, and public health endpoints. Use for prod logs, outages, failed deploys, stale production, or resource health checks.
---

# Debugging Prod

Use this skill only for the Inkwell checkout at
`/Users/davis/Developer/highmatter/inkwell`.

## Production Map

- Depot organization: `kfmrjsn0w2` (`davis7dotsh`)
- Depot repository: `davis7dotsh/inkwell`
- Production workflow: `.depot/workflows/deploy-production.yml`
- Cloudflare API Worker: `inkwell-api`
- Cloudflare web Worker: `inkwell-web`
- Cloudflare R2 bucket: `inkwell-memos`
- Convex production deployment: `judicious-mastiff-652`
- Web origin: `https://inkwellapp.net`
- API origin: `https://api.inkwellapp.net`
- Convex HTTP actions origin: `https://judicious-mastiff-652.convex.site`

Treat the repo configs and the latest Depot run as the source of truth if any
identifier above changes.

## Guardrails

- Default to read-only inspection.
- Never deploy, rerun, retry, cancel, or mutate production unless the user asks.
- Never print secret values or run `convex env list/get` during routine checks.
- Do not run local `dev` or `build` commands for production diagnosis.
- Wrangler and Convex log tails stream indefinitely. Stop them with Ctrl-C once
  enough evidence has been collected.

## Fast Production Check

Start at the repo root.

### 1. Compare Git and the latest production deploy

```bash
git status --short --branch
git fetch --quiet origin main
git rev-parse HEAD
git rev-parse origin/main

depot ci workflow list \
  --org kfmrjsn0w2 \
  --repo davis7dotsh/inkwell \
  --name "Deploy Production" \
  -n 5 \
  --output json
```

For the newest production workflow, verify:

- `head_sha` matches the intended `origin/main` commit.
- `status` is `finished`.
- `job_counts.failed` and `job_counts.cancelled` are both zero.

Then inspect the selected run:

```bash
depot ci status <run-id> --org kfmrjsn0w2 --output json
```

### 2. Check Cloudflare production resources

```bash
pnpm --filter @inkwell/api exec wrangler deployments status \
  --name inkwell-api --json

pnpm --filter inkwell-web exec wrangler deployments status \
  --name inkwell-web --json

pnpm --filter @inkwell/api exec wrangler r2 bucket info inkwell-memos
```

Use `deployments list` when recent history is useful:

```bash
pnpm --filter @inkwell/api exec wrangler deployments list \
  --name inkwell-api --json

pnpm --filter inkwell-web exec wrangler deployments list \
  --name inkwell-web --json
```

Compare Worker deployment timestamps and version IDs with the final deploy
lines in Depot.

### 3. Check Convex production

Resolve and confirm the production deployment:

```bash
pnpm --filter @inkwell/backend exec convex dashboard --prod --no-open
```

Read recent function logs, then stop the stream:

```bash
pnpm --filter @inkwell/backend exec convex logs \
  --prod --history 100 --jsonl
```

Add `--success` only when successful executions are needed; it can be noisy.
The production Convex dashboard is:
`https://dashboard.convex.dev/d/judicious-mastiff-652`.

### 4. Probe production endpoints

```bash
curl -fsS --max-time 10 https://api.inkwellapp.net/health

curl -sS -o /dev/null -w 'web %{http_code}\n' \
  --max-time 10 https://inkwellapp.net/

curl -sS -o /dev/null -w 'convex-site %{http_code}\n' \
  --max-time 10 -X POST \
  https://judicious-mastiff-652.convex.site/ingest/create-pending
```

Expected results:

- API health returns `{"ok":true}`.
- Web returns HTTP `200`.
- The unauthenticated Convex action returns HTTP `403`. That is healthy: the
  endpoint is reachable and its shared-secret guard is active.

## Logs

### Depot deployment logs

Depot logs are historical and finite:

```bash
depot ci logs <run-id> \
  --org kfmrjsn0w2 \
  --job deploy \
  --workflow deploy-production.yml \
  --timestamps
```

For a failed run, get the bounded failure summary first:

```bash
depot ci diagnose --run <run-id> --org kfmrjsn0w2
```

The production workflow deploy order is:

1. Convex functions and schema
2. `inkwell-api`
3. `inkwell-web`

Use that order to locate the first failed or stale layer.

### Cloudflare API logs

Wrangler tail is live, not historical:

```bash
pnpm --filter @inkwell/api exec wrangler tail inkwell-api \
  --format pretty
```

Useful filters:

```bash
# Errors only
pnpm --filter @inkwell/api exec wrangler tail inkwell-api \
  --status error --format pretty

# Search console output
pnpm --filter @inkwell/api exec wrangler tail inkwell-api \
  --search "<term>" --format pretty

# Machine-readable events
pnpm --filter @inkwell/api exec wrangler tail inkwell-api \
  --format json
```

The web Worker is assets-only, so API and Convex logs usually contain the
actionable application failures.

### Convex function logs

```bash
# Recent history followed by live events
pnpm --filter @inkwell/backend exec convex logs \
  --prod --history 100

# Machine-readable logs
pnpm --filter @inkwell/backend exec convex logs \
  --prod --history 100 --jsonl
```

Look for failures in `articles:*`, `annotations:*`, and HTTP action executions.

## Reporting

Report:

- Overall production status.
- Latest deployed commit and whether it matches `origin/main`.
- Depot run result and first failing step, if any.
- Current Cloudflare Worker deployment timestamps/version IDs.
- Convex deployment identity and relevant errors.
- API, web, Convex endpoint probe results.
- R2 bucket availability.

Use exact UTC timestamps and commit SHAs. Separate confirmed evidence from
inference, and mention when a live tail observed no traffic rather than saying
there were no errors.
