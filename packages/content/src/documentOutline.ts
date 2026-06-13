import type { Block } from "./types";

export type DocumentOutlineEntry = {
  id: string;
  blockIndex: number;
  title: string;
  level: number;
  depth: number;
};

type HeadingLevel = Extract<Block, { type: "heading" }>["level"];

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

const paragraphText = (
  block: Extract<Block, { type: "paragraph" }>
): string =>
  block.spans
    .map((span) => span.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

const numberedHeading = (text: string) => {
  const match = /^(\d+(?:\.\d+){0,5})\s+(.+)$/.exec(text);
  if (!match) return null;
  return {
    label: match[1],
    parts: match[1].split(".").map(Number),
    title: match[2],
  };
};

const hasEmbeddedSectionNumber = (title: string) =>
  /\s\d+(?:\.\d+)+\s+\S/.test(title);

const isPlausibleNumberedHeading = (
  candidate: NonNullable<ReturnType<typeof numberedHeading>>
) =>
  candidate.title.length <= (candidate.parts.length === 1 ? 80 : 180) &&
  !hasEmbeddedSectionNumber(candidate.title);

function numberedBodyStart(blocks: Block[]): number {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type !== "paragraph") continue;
    const first = numberedHeading(paragraphText(block));
    if (
      !first ||
      first.parts.length !== 1 ||
      first.parts[0] !== 1 ||
      !isPlausibleNumberedHeading(first)
    ) {
      continue;
    }

    let hasNestedSection = false;
    let hasSecondChapter = false;
    const end = Math.min(blocks.length, index + 400);
    for (let nextIndex = index + 1; nextIndex < end; nextIndex += 1) {
      const nextBlock = blocks[nextIndex];
      if (nextBlock.type !== "paragraph") continue;
      const next = numberedHeading(paragraphText(nextBlock));
      if (!next || !isPlausibleNumberedHeading(next)) continue;
      if (next.parts.length > 1 && next.parts[0] === 1) {
        hasNestedSection = true;
      }
      if (next.parts.length === 1 && next.parts[0] === 2) {
        hasSecondChapter = true;
      }
      if (hasNestedSection && hasSecondChapter) return index;
    }
  }
  return -1;
}

/**
 * Some PDF extractors preserve section titles as standalone paragraphs but
 * discard heading semantics. Recover only strongly structured numbered
 * documents, leaving block order and indices unchanged for annotations.
 */
export function inferDocumentHeadings(blocks: Block[]): Block[] {
  if (blocks.some((block) => block.type === "heading")) return blocks;

  const start = numberedBodyStart(blocks);
  if (start === -1) return blocks;

  const inferredLevels = new Map<number, HeadingLevel>();
  const prefaceHeadings = new Set([
    "Abstract",
    "Executive Summary",
    "Introduction",
    "Summary",
  ]);
  for (let index = 0; index < start; index += 1) {
    const block = blocks[index];
    if (
      block.type === "paragraph" &&
      prefaceHeadings.has(paragraphText(block))
    ) {
      inferredLevels.set(index, 1);
    }
  }

  const seenLabels = new Set<string>();
  let currentChapter = 0;
  for (let index = start; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type !== "paragraph") continue;
    const candidate = numberedHeading(paragraphText(block));
    if (
      !candidate ||
      seenLabels.has(candidate.label) ||
      !isPlausibleNumberedHeading(candidate)
    ) {
      continue;
    }

    if (candidate.parts.length === 1) {
      if (candidate.parts[0] !== currentChapter + 1) continue;
      currentChapter = candidate.parts[0];
    } else if (candidate.parts[0] !== currentChapter) {
      continue;
    }

    seenLabels.add(candidate.label);
    inferredLevels.set(
      index,
      Math.min(candidate.parts.length, 6) as HeadingLevel
    );
  }

  if (inferredLevels.size === 0) return blocks;
  return blocks.map((block, index) => {
    const level = inferredLevels.get(index);
    if (!level || block.type !== "paragraph") return block;
    return { type: "heading", level, spans: block.spans };
  });
}

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
