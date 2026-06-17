// Geometry helpers shared by the Markdown export (reader) and the annotation
// anchor resolver (agent API). Annotations are stored as pixels in content
// space; turning them into text means mapping those pixels back onto the
// measured layout of each top-level block.
import type { Block } from "./types";

/** Layout of each top-level block, measured by the reader (render px). */
export type BlockLayout = { y: number; height: number };

/** Flattened plain text of a block — what a highlight/box/note resolves to. */
export function blockText(block: Block): string {
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

/** Collapse whitespace and cap length, keeping a trailing ellipsis. */
export function truncate(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + "…";
}

/** Block indices whose vertical extent overlaps [top, bottom], in order. */
export function blocksInRange(
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

/** Index of the block nearest a y coordinate (0 distance if inside it). */
export function nearestBlock(
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
