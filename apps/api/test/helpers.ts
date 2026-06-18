// Shared fetch stubs for the worker tests. No network anywhere: Firecrawl
// and the Convex HTTP actions are dispatched on URL.

import type { WorkerBindings } from "../src/requestContext";

export type RecordedCall = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

export const TEST_ENV: Omit<WorkerBindings, "MEMOS"> = {
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
  const headers = init?.headers;
  if (!headers) return {};
  let result: Record<string, string>;
  if (headers instanceof Headers) {
    result = Object.fromEntries(headers.entries());
  } else if (Array.isArray(headers)) {
    result = Object.fromEntries(headers);
  } else {
    result = { ...headers } as Record<string, string>;
  }
  // Effect's header model normalizes names to lowercase. Keep the legacy
  // alias so the original assertions remain unchanged.
  if (result.authorization && !result.Authorization) {
    result.Authorization = result.authorization;
  }
  return result;
}

function parseBody(init?: RequestInit): unknown {
  const body = init?.body;
  if (!body) return undefined;
  // Multipart bodies (FormData) pass through as-is; JSON bodies are parsed.
  if (body instanceof FormData) return body;
  if (typeof body === "string") return JSON.parse(body);
  if (body instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(body));
  }
  if (body instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(body));
  }
  return body;
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

/** Canned values for the MCP's Convex HTTP-action reads. */
export type AgentReads = Partial<
  Record<
    "articles" | "article" | "annotations" | "tags",
    (args: Record<string, unknown>) => unknown
  >
>;

/** Recorded POST calls to the agent write routes (tags, pin), by route. */
export type AgentWriteLog = {
  "tags/create": RecordedCall[];
  "tags/rename": RecordedCall[];
  "tags/remove": RecordedCall[];
  "article-tags/add": RecordedCall[];
  "article-tags/remove": RecordedCall[];
  "article/pin": RecordedCall[];
};

/**
 * URL-dispatching stub: Firecrawl scrape/parse calls get `scrape()`
 * responses; Convex HTTP-action calls are recorded and answered by route.
 */
export function fakeNetwork(
  scrape: () => Response,
  reads: AgentReads = {},
): {
  impl: typeof fetch;
  ingest: IngestLog;
  agentCalls: RecordedCall[];
  agentWrites: AgentWriteLog;
} {
  const ingest: IngestLog = { "create-pending": [], complete: [], fail: [] };
  const agentCalls: RecordedCall[] = [];
  const agentWrites: AgentWriteLog = {
    "tags/create": [],
    "tags/rename": [],
    "tags/remove": [],
    "article-tags/add": [],
    "article-tags/remove": [],
    "article/pin": [],
  };
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === FIRECRAWL_ENDPOINT || url === FIRECRAWL_PARSE_ENDPOINT) {
      return scrape();
    }
    const ingestMatch = /\/ingest\/(create-pending|complete|fail)$/.exec(url);
    if (ingestMatch) {
      const op = ingestMatch[1] as keyof IngestLog;
      ingest[op].push({
        url,
        headers: headersOf(init),
        body: parseBody(init),
      });
      return jsonResponse(
        op === "create-pending" ? { articleId: "art1" } : { ok: true },
      );
    }
    // Agent write routes (tag mutations + pin): record and answer canned. The
    // create route echoes a tag derived from the posted body so callers can
    // assert on the returned shape.
    const writeMatch =
      /\/agent\/(tags\/create|tags\/rename|tags\/remove|article-tags\/add|article-tags\/remove|article\/pin)$/.exec(
        url,
      );
    if (writeMatch) {
      const route = writeMatch[1] as keyof AgentWriteLog;
      const body = parseBody(init);
      agentWrites[route].push({ url, headers: headersOf(init), body });
      if (route === "tags/create") {
        const b = (body ?? {}) as { name?: string; color?: string };
        return jsonResponse({
          tag: { id: "tag1", name: b.name, color: b.color },
        });
      }
      return jsonResponse({ ok: true });
    }
    const agentMatch =
      /\/agent\/(articles|article|annotations|tags)(?:\?|$)/.exec(url);
    if (agentMatch) {
      const route = agentMatch[1] as keyof AgentReads;
      const params = Object.fromEntries(new URL(url).searchParams.entries());
      const args: Record<string, unknown> = { ...params };
      if (typeof args.limit === "string") args.limit = Number(args.limit);
      agentCalls.push({
        url,
        headers: headersOf(init),
        body: args,
      });
      const handler = reads[route];
      if (!handler) throw new Error(`no agent read stub for: ${url}`);
      const value = handler(args);
      if (value === null) return new Response("not found", { status: 404 });
      if (route === "articles") return jsonResponse({ articles: value });
      if (route === "article") return jsonResponse({ article: value });
      if (route === "tags") return jsonResponse({ tags: value });
      return jsonResponse(value);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return { impl, ingest, agentCalls, agentWrites };
}
