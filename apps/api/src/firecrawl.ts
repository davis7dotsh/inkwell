// Firecrawl v2 scrape client over plain fetch (the official SDK wants
// Node >= 22 + axios; not worth compat flags on Workers). PDFs go through
// the same endpoint — auto-detected, parsed via the pdf parser config.
// Retries once on 429, honoring Retry-After.

export type FirecrawlMetadata = {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  sourceURL?: string;
  statusCode?: number;
  contentType?: string;
  error?: string;
};

export type FirecrawlScrape = {
  html?: string;
  markdown?: string;
  metadata?: FirecrawlMetadata;
};

type ScrapeResponseBody = {
  success?: boolean;
  error?: string;
  data?: {
    html?: string | null;
    markdown?: string | null;
    metadata?: FirecrawlMetadata;
    warning?: string;
  };
};

const SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
// Free tier is 10 req/min; if Retry-After is missing or unparsable, wait a
// conservative slice of that window. Cap so we never blow the waitUntil
// budget on a hostile header.
const DEFAULT_RETRY_AFTER_MS = 6_000;
const MAX_RETRY_AFTER_MS = 30_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get("Retry-After"));
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text ? ` — ${text.slice(0, 200)}` : "";
}

export async function scrapeUrl(
  fetchImpl: typeof fetch,
  apiKey: string,
  url: string
): Promise<FirecrawlScrape> {
  const request = () =>
    fetchImpl(SCRAPE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        onlyMainContent: true,
        parsers: [{ type: "pdf", mode: "auto", maxPages: 200 }],
        timeout: 120000,
      }),
    });

  let res = await request();
  if (res.status === 429) {
    await sleep(retryAfterMs(res));
    res = await request();
  }
  if (!res.ok) {
    const retried = res.status === 429 ? " (rate limited; retried once)" : "";
    throw new Error(
      `Firecrawl scrape failed: HTTP ${res.status}${retried}${await errorDetail(res)}`
    );
  }

  const json = (await res.json()) as ScrapeResponseBody;
  if (json.success !== true) {
    throw new Error(
      `Firecrawl scrape failed: ${json.error ?? "response had success: false"}`
    );
  }
  if (!json.data) {
    throw new Error("Firecrawl scrape failed: response had no data");
  }

  const html = json.data.html ?? undefined;
  const markdown = json.data.markdown ?? undefined;
  if (!html && !markdown && json.data.warning) {
    throw new Error(`Firecrawl returned no content: ${json.data.warning}`);
  }
  return { html, markdown, metadata: json.data.metadata };
}
