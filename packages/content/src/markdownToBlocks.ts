// Converts Markdown into renderable Blocks by rendering it to HTML with
// `marked` and feeding the result through htmlToBlocks. This is the PDF path:
// Firecrawl returns markdown (headings/lists/images/tables) for PDFs.

import { Marked } from "marked";

import { htmlToBlocks } from "./htmlToBlocks";
import type { Block } from "./types";

// Instance instead of the `marked()` singleton so configuration can never
// leak into other consumers of the library.
const markdownParser = new Marked();

export function markdownToBlocks(markdown: string): Block[] {
  const html = markdownParser.parse(markdown, { gfm: true, async: false });
  return htmlToBlocks(html);
}
