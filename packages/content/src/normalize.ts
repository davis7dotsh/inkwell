// Normalizes a Firecrawl v2 scrape payload into reader-ready ArticleContent.
// One entry point for the api worker: prefer html (best fidelity through
// htmlToBlocks — keeps images/captions), fall back to markdown (PDFs).

import { htmlToBlocks } from "./htmlToBlocks";
import { markdownToBlocks } from "./markdownToBlocks";
import type { ArticleContent, Block } from "./types";

/** The slice of Firecrawl v2 `data.metadata` that normalization consumes. */
export type FirecrawlMetadata = {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  sourceURL?: string;
};

/** The slice of a Firecrawl v2 `data` payload that normalization consumes. */
export type FirecrawlDocument = {
  html?: string | null;
  markdown?: string | null;
  metadata?: FirecrawlMetadata;
};

/** Trimmed string, or undefined when missing/blank. */
const clean = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Hostname of an absolute URL. Hand-rolled instead of `new URL` because this
 * package runs on React Native too, where WHATWG URL support is incomplete.
 */
function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url);
  return match ? match[1].toLowerCase() : undefined;
}

function firstHeadingText(blocks: Block[]): string | undefined {
  for (const block of blocks) {
    if (block.type !== "heading") continue;
    const text = block.spans
      .map((span) => span.text)
      .join("")
      .trim();
    if (text) return text;
  }
  return undefined;
}

export function firecrawlToArticle(input: FirecrawlDocument): ArticleContent {
  const html = clean(input.html);
  const markdown = clean(input.markdown);
  const metadata = input.metadata ?? {};
  const sourceURL = clean(metadata.sourceURL);
  const subject = sourceURL ? ` for ${sourceURL}` : "";

  if (!html && !markdown) {
    throw new Error(
      `Firecrawl returned no content${subject}: both html and markdown are empty`
    );
  }

  let blocks: Block[] = html ? htmlToBlocks(html) : [];
  if (blocks.length === 0 && markdown) blocks = markdownToBlocks(markdown);
  if (blocks.length === 0) {
    const sizeOf = (value: string | undefined) =>
      value ? `${value.length} chars` : "absent";
    throw new Error(
      `Firecrawl content produced zero readable blocks${subject} ` +
        `(html: ${sizeOf(html)}, markdown: ${sizeOf(markdown)})`
    );
  }

  const title =
    clean(metadata.title) ??
    clean(metadata.ogTitle) ??
    firstHeadingText(blocks) ??
    sourceURL ??
    "Untitled";
  const excerpt = clean(metadata.description) ?? clean(metadata.ogDescription);
  const siteName = hostnameOf(sourceURL);

  const article: ArticleContent = { title, blocks };
  if (siteName) article.siteName = siteName;
  if (excerpt) article.excerpt = excerpt;
  return article;
}
