// Shared fetch stubs for the worker tests. No network anywhere: Firecrawl
// and the Convex ingest endpoints are dispatched on URL.

import type { PipelineEnv } from "../src/pipeline";

export type RecordedCall = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

export const TEST_ENV: PipelineEnv & {
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
} = {
  FIRECRAWL_API_KEY: "fc-test-key",
  CLERK_SECRET_KEY: "sk_test",
  CLERK_PUBLISHABLE_KEY: "pk_test",
  WORKER_SHARED_SECRET: "shh-shared",
  CONVEX_SITE_URL: "https://deployment.convex.site",
};

export const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
export const FIRECRAWL_PARSE_ENDPOINT = "https://api.firecrawl.dev/v2/parse";

// Tiny real HTML fixture, parsed by the real @inkwell/content pipeline in
// the happy-path tests: one h1 + two paragraphs.
export const FIXTURE_HTML =
  "<article><h1>Hello Inkwell</h1>" +
  "<p>First <strong>bold</strong> paragraph.</p>" +
  "<p>Second paragraph.</p></article>";

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const firecrawlOk = (data: unknown): Response =>
  jsonResponse({ success: true, data });

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = init?.headers;
  if (headers && !Array.isArray(headers) && !(headers instanceof Headers)) {
    for (const [key, value] of Object.entries(headers)) out[key] = value;
  }
  return out;
}

function parseBody(init?: RequestInit): unknown {
  const body = init?.body;
  if (!body) return undefined;
  // Multipart bodies (FormData) pass through as-is; JSON bodies are parsed.
  if (typeof body !== "string") return body;
  return JSON.parse(body);
}

/** Sequential stub: returns canned responses in order, recording each call. */
export function fetchQueue(responses: Response[]): {
  impl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: headersOf(init),
      body: parseBody(init),
    });
    const next = queue.shift();
    if (!next) throw new Error(`fetch stub exhausted at ${String(input)}`);
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

export type IngestLog = {
  "create-pending": RecordedCall[];
  complete: RecordedCall[];
  fail: RecordedCall[];
};

/** Canned responses for the /agent/* Convex read actions, keyed by route. */
export type AgentReads = Partial<
  Record<
    "articles" | "article" | "annotations",
    (params: URLSearchParams) => Response
  >
>;

/**
 * URL-dispatching stub: Firecrawl scrape/parse calls get `scrape()`
 * responses; Convex ingest calls are recorded and acknowledged
 * (create-pending → articleId); /agent reads are recorded and answered by
 * the matching `reads` handler.
 */
export function fakeNetwork(
  scrape: () => Response,
  reads: AgentReads = {}
): {
  impl: typeof fetch;
  ingest: IngestLog;
  agentCalls: RecordedCall[];
} {
  const ingest: IngestLog = { "create-pending": [], complete: [], fail: [] };
  const agentCalls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === FIRECRAWL_ENDPOINT || url === FIRECRAWL_PARSE_ENDPOINT) {
      return scrape();
    }
    const match = /\/ingest\/(create-pending|complete|fail)$/.exec(url);
    if (match) {
      const op = match[1] as keyof IngestLog;
      ingest[op].push({
        url,
        headers: headersOf(init),
        body: parseBody(init),
      });
      return jsonResponse(
        op === "create-pending" ? { articleId: "art1" } : { ok: true }
      );
    }
    const agentMatch = /\/agent\/(articles|article|annotations)(?:\?|$)/.exec(
      url
    );
    if (agentMatch) {
      agentCalls.push({ url, headers: headersOf(init), body: undefined });
      const handler = reads[agentMatch[1] as keyof AgentReads];
      if (!handler) throw new Error(`no agent read stub for: ${url}`);
      return handler(new URL(url).searchParams);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return { impl, ingest, agentCalls };
}
