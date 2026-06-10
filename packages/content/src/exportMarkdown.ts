// Turns an annotated article into Markdown suitable for pasting into an LLM:
// boxed sections become quoted excerpts, notes keep their nearby context,
// highlighter strokes quote the lines they cover.
import type { Annotations, ArticleContent, Block } from "./types";

/**
 * What the export needs beyond the content payload: the source URL and saved
 * timestamp (ISO 8601 string or epoch ms) from the persistence layer.
 */
export type ExportArticle = ArticleContent & {
  url: string;
  savedAt: string | number;
};

/** Layout of each top-level block, measured by the reader (current render px). */
export type BlockLayout = { y: number; height: number };

function blockText(block: Block): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
      return block.spans.map((s) => s.text).join("");
    case "list":
      return block.items
        .map((item) => "• " + item.map((s) => s.text).join(""))
        .join("\n");
    case "code":
      return block.text;
    case "image":
      return `![${block.caption || block.alt || "image"}](${block.src})`;
    case "rule":
      return "";
  }
}

function truncate(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + "…";
}

function blocksInRange(
  layouts: Map<number, BlockLayout>,
  top: number,
  bottom: number
): number[] {
  const hits: number[] = [];
  for (const [index, layout] of layouts) {
    if (layout.y + layout.height >= top && layout.y <= bottom) hits.push(index);
  }
  return hits.sort((a, b) => a - b);
}

function nearestBlock(
  layouts: Map<number, BlockLayout>,
  y: number
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const [index, layout] of layouts) {
    const distance =
      y < layout.y
        ? layout.y - y
        : y > layout.y + layout.height
          ? y - (layout.y + layout.height)
          : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/**
 * @param scale converts annotation coordinates into the measured layout space
 *   (currentContentWidth / annotations.contentWidth).
 */
export function buildExportMarkdown(
  article: ExportArticle,
  annotations: Annotations,
  layouts: Map<number, BlockLayout>,
  scale: number
): string {
  const lines: string[] = [];
  lines.push(`# ${article.title}`);
  lines.push("");
  lines.push(`Source: ${article.url}`);
  if (article.byline) lines.push(`By: ${article.byline}`);
  lines.push(`Saved: ${new Date(article.savedAt).toLocaleDateString()}`);
  lines.push("");

  const quoteBlocks = (indices: number[]) =>
    indices
      .map((i) => blockText(article.blocks[i]))
      .filter((t) => t.trim().length > 0)
      .map((t) => t.split("\n").map((l) => `> ${l}`).join("\n"));

  if (annotations.boxes.length > 0) {
    lines.push(`## Key sections (boxed by me)`);
    lines.push("");
    for (const box of annotations.boxes) {
      const indices = blocksInRange(
        layouts,
        box.y * scale,
        (box.y + box.h) * scale
      );
      const quotes = quoteBlocks(indices);
      if (quotes.length === 0) continue;
      lines.push(quotes.join("\n>\n"));
      lines.push("");
    }
  }

  const highlights = annotations.strokes.filter(
    (s) => s.tool === "highlighter"
  );
  if (highlights.length > 0) {
    lines.push(`## Highlighted passages`);
    lines.push("");
    const seen = new Set<number>();
    for (const stroke of highlights) {
      const ys = stroke.points.map((p) => p.y * scale);
      const indices = blocksInRange(
        layouts,
        Math.min(...ys),
        Math.max(...ys)
      ).filter((i) => !seen.has(i));
      indices.forEach((i) => seen.add(i));
      const quotes = quoteBlocks(indices);
      if (quotes.length > 0) {
        lines.push(quotes.join("\n>\n"));
        lines.push("");
      }
    }
  }

  if (annotations.notes.length > 0) {
    lines.push(`## My notes`);
    lines.push("");
    for (const note of [...annotations.notes].sort((a, b) => a.y - b.y)) {
      const near = nearestBlock(layouts, note.y * scale);
      const context =
        near != null ? ` — near: "${truncate(blockText(article.blocks[near]))}"` : "";
      lines.push(`- "${note.text.trim()}"${context}`);
    }
    lines.push("");
  }

  const penStrokes = annotations.strokes.filter((s) => s.tool === "pen");
  if (penStrokes.length > 0) {
    lines.push(`## Handwritten marks`);
    lines.push("");
    const marked = new Set<number>();
    for (const stroke of penStrokes) {
      const ys = stroke.points.map((p) => p.y * scale);
      blocksInRange(layouts, Math.min(...ys), Math.max(...ys)).forEach((i) =>
        marked.add(i)
      );
    }
    lines.push(
      `${penStrokes.length} pen stroke${penStrokes.length === 1 ? "" : "s"} over:`
    );
    for (const index of [...marked].sort((a, b) => a - b)) {
      const text = truncate(blockText(article.blocks[index]));
      if (text) lines.push(`- "${text}"`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("Exported from Inkwell.");
  return lines.join("\n");
}
