import type { Block } from "./types";

export type DocumentOutlineEntry = {
  id: string;
  blockIndex: number;
  title: string;
  level: number;
  depth: number;
};

const headingText = (block: Extract<Block, { type: "heading" }>): string =>
  block.spans
    .map((span) => span.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

// NFKD before lowercasing so compatibility characters that decompose to
// ASCII (the MHz sign becomes "MHz") survive; trim hyphens after the slice
// so truncation can't leave a dangling one.
const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");

/**
 * Builds stable jump targets from the heading blocks already produced by the
 * HTML/Markdown parsers. Depth is normalized to the shallowest heading in the
 * document so PDFs that begin at h2 still get top-level chapters.
 */
export function buildDocumentOutline(blocks: Block[]): DocumentOutlineEntry[] {
  const headings = blocks.flatMap((block, blockIndex) => {
    if (block.type !== "heading") return [];
    const title = headingText(block);
    return title ? [{ blockIndex, title, level: block.level }] : [];
  });
  const rootLevel = Math.min(...headings.map((heading) => heading.level));

  return headings.map((heading) => ({
    ...heading,
    id: `section-${heading.blockIndex + 1}-${slugify(heading.title) || "heading"}`,
    depth: heading.level - rootLevel,
  }));
}
