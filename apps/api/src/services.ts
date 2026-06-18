import { Context } from "effect";
import { z } from "zod";

export const WorkerConfigSchema = z.object({
  FIRECRAWL_API_KEY: z.string(),
  WORKER_SHARED_SECRET: z.string(),
  CONVEX_SITE_URL: z.string(),
});

export type WorkerConfigValue = z.infer<typeof WorkerConfigSchema>;

export class WorkerConfig extends Context.Service<
  WorkerConfig,
  WorkerConfigValue
>()("inkwell/api/WorkerConfig") {}

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly userId: string }
>()("inkwell/api/CurrentUser") {}
