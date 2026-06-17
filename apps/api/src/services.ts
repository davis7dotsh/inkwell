import { Context, Schema } from "effect";

export const WorkerConfigSchema = Schema.Struct({
  FIRECRAWL_API_KEY: Schema.String,
  WORKER_SHARED_SECRET: Schema.String,
  CONVEX_SITE_URL: Schema.String,
});

export type WorkerConfigValue = typeof WorkerConfigSchema.Type;

export class WorkerConfig extends Context.Service<
  WorkerConfig,
  WorkerConfigValue
>()("inkwell/api/WorkerConfig") {}

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly userId: string }
>()("inkwell/api/CurrentUser") {}
