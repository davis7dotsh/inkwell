// Shared fetch stubs for the worker tests. No network anywhere: Firecrawl
// and native Convex API calls are dispatched on URL.

import { convexToJson, jsonToConvex } from "convex/values";
import type { JSONValue, Value } from "convex/values";

import type { ConvexServiceEnv } from "../src/convexService";
import type { PipelineEnv } from "../src/pipeline";

export type RecordedCall = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  functionName?: string;
};

export const TEST_ENV: PipelineEnv &
  ConvexServiceEnv & {
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
} = {
  FIRECRAWL_API_KEY: "fc-test-key",
  CLERK_SECRET_KEY: "sk_test",
  CLERK_PUBLISHABLE_KEY: "pk_test",
  CONVEX_DEPLOY_KEY: "prod:deployment|test-key",
  CONVEX_URL: "https://deployment.convex.cloud",
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

export const convexResponse = (value: Value): Response =>
  jsonResponse({
    status: "success",
    value: convexToJson(value),
    logLines: [],
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

/** Canned responses for the MCP's internal Convex reads. */
export type AgentReads = Partial<
  Record<
    "articles" | "article" | "annotations",
    (args: Record<string, unknown>) => Value
  >
>;

/**
 * URL-dispatching stub: Firecrawl scrape/parse calls get `scrape()`
 * responses; native Convex query/mutation calls are recorded and answered
 * according to their internal function name.
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
    if (
      url === `${TEST_ENV.CONVEX_URL}/api/mutation` ||
      url === `${TEST_ENV.CONVEX_URL}/api/query`
    ) {
      const request = parseBody(init) as {
        path: string;
        args: JSONValue[];
      };
      const args = jsonToConvex(request.args[0]) as Record<string, unknown>;
      const call = {
        url,
        headers: headersOf(init),
        body: args,
        functionName: request.path,
      };
      const opByPath = {
        "articles:createPending": "create-pending",
        "articles:complete": "complete",
        "articles:fail": "fail",
      } as const;
      const op = opByPath[request.path as keyof typeof opByPath];
      if (op) {
        ingest[op].push(call);
        return convexResponse(op === "create-pending" ? "art1" : null);
      }

      const readByPath = {
        "articles:listForAgent": "articles",
        "articles:getForAgent": "article",
        "annotations:getForAgent": "annotations",
      } as const;
      const read = readByPath[request.path as keyof typeof readByPath];
      if (!read) throw new Error(`unexpected Convex function: ${request.path}`);
      agentCalls.push(call);
      const handler = reads[read];
      if (!handler) {
        throw new Error(`no agent read stub for: ${request.path}`);
      }
      return convexResponse(handler(args));
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return { impl, ingest, agentCalls };
}
