// Resolve pixel-anchored annotations into the text they target, so an agent
// reading notes through the API learns *what* each note is about — not just its
// coordinates. Annotations store content-space pixels (x/y/w/h); this maps them
// back onto the measured per-block layout the reader persisted alongside them.
//
// Offsets are block-derived: they index into the article's plain text (blocks
// joined by blank lines), at block granularity — the start of the first covered
// block to the end of the last. They locate a passage, not an exact character
// span, because annotations were never character-anchored.
import type { BlockLayout } from "./blockGeometry";
import {
  blockText,
  blocksInRange,
  nearestBlock,
  truncate,
} from "./blockGeometry";
import { inferDocumentHeadings } from "./documentOutline";
import type { Annotations, Block } from "./types";

export type AnnotationKind =
  | "typed_note"
  | "highlight"
  | "box"
  | "pen"
  | "voice";

export type BoundingBox = { x: number; y: number; w: number; h: number };

export type ResolvedAnnotation = {
  id: string;
  type: AnnotationKind;
  /** Typed note text or voice memo transcript. */
  note?: string;
  /** Article text intersected by a highlight, box, or pen mark. */
  selectedText?: string;
  /** Nearest passage to a point-anchored typed note or voice memo. */
  nearbyText?: string;
  /** Nearest preceding heading (inferred for numbered PDFs). */
  sectionHeading?: string;
  /** Block-derived char offsets into the article's plain text. */
  startOffset?: number;
  endOffset?: number;
  /** Geometry in content space (px at the annotations' contentWidth). */
  boundingBox?: BoundingBox;
};

const SELECTED_TEXT_MAX = 4000;
const NEARBY_TEXT_MAX = 400;

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const num = (value: unknown, fallback = 0): number =>
  isFiniteNumber(value) ? value : fallback;

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Join the given block indices into one quoted passage, capped in length. */
function joinBlocks(blocks: Block[], indices: number[]): string | undefined {
  const text = indices
    .map((i) => blocks[i])
    .filter((block): block is Block => Boolean(block))
    .map(blockText)
    .filter((t) => t.trim().length > 0)
    .join("\n\n");
  if (!text) return undefined;
  return text.length <= SELECTED_TEXT_MAX
    ? text
    : text.slice(0, SELECTED_TEXT_MAX - 1).trimEnd() + "…";
}

/**
 * @param scale converts annotation coordinates into the persisted layout space
 *   (layoutWidth / annotations.contentWidth); 1 when both were the same width.
 */
export function resolveAnnotations(
  blocks: Block[],
  annotations: Annotations,
  layouts: Map<number, BlockLayout>,
  scale: number,
): ResolvedAnnotation[] {
  // Recover heading semantics for numbered PDFs; indices stay aligned with the
  // layout map and annotation coordinates.
  const headed = inferDocumentHeadings(blocks);

  // Cumulative plain-text offset of each block, and the nearest preceding
  // heading, in one pass.
  const startOffsets: number[] = new Array(headed.length);
  const lengths: number[] = new Array(headed.length);
  const headingAt: (string | undefined)[] = new Array(headed.length);
  let cursor = 0;
  let currentHeading: string | undefined;
  for (let i = 0; i < headed.length; i += 1) {
    const block = headed[i];
    if (block.type === "heading") currentHeading = collapse(blockText(block));
    const text = blockText(block);
    startOffsets[i] = cursor;
    lengths[i] = text.length;
    headingAt[i] = currentHeading;
    cursor += text.length + 2; // blocks joined by a blank line
  }

  const offsetsFor = (indices: number[]) => {
    if (indices.length === 0) return {};
    const first = indices[0];
    const last = indices[indices.length - 1];
    const start = startOffsets[first];
    const lastStart = startOffsets[last];
    const lastLen = lengths[last];
    if (
      !isFiniteNumber(start) ||
      !isFiniteNumber(lastStart) ||
      !isFiniteNumber(lastLen)
    ) {
      return {};
    }
    return { startOffset: start, endOffset: lastStart + lastLen };
  };

  const nearbyTextOf = (near: number | null) =>
    near != null && headed[near]
      ? truncate(blockText(headed[near]), NEARBY_TEXT_MAX)
      : undefined;

  const resolved: { y: number; annotation: ResolvedAnnotation }[] = [];

  for (const box of annotations.boxes) {
    if (!box || !isFiniteNumber(box.y) || !isFiniteNumber(box.h)) continue;
    const indices = blocksInRange(
      layouts,
      box.y * scale,
      (box.y + box.h) * scale,
    );
    resolved.push({
      y: box.y,
      annotation: {
        id: str(box.id),
        type: "box",
        selectedText: joinBlocks(headed, indices),
        sectionHeading: headingAt[indices[0]],
        ...offsetsFor(indices),
        boundingBox: { x: num(box.x), y: box.y, w: num(box.w), h: box.h },
      },
    });
  }

  for (const stroke of annotations.strokes) {
    if (!stroke) continue;
    const points = Array.isArray(stroke.points) ? stroke.points : [];
    const ys = points.map((p) => p?.y).filter(isFiniteNumber);
    const xs = points.map((p) => p?.x).filter(isFiniteNumber);
    if (ys.length === 0) continue;
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const left = xs.length ? Math.min(...xs) : 0;
    const right = xs.length ? Math.max(...xs) : 0;
    // Don't coerce an unknown tool into "pen" — skip it rather than mislabel.
    const type: "highlight" | "pen" | null =
      stroke.tool === "highlighter"
        ? "highlight"
        : stroke.tool === "pen"
          ? "pen"
          : null;
    if (!type) continue;
    const indices = blocksInRange(layouts, top * scale, bottom * scale);
    resolved.push({
      y: top,
      annotation: {
        id: str(stroke.id),
        type,
        selectedText: joinBlocks(headed, indices),
        sectionHeading: headingAt[indices[0]],
        ...offsetsFor(indices),
        boundingBox: { x: left, y: top, w: right - left, h: bottom - top },
      },
    });
  }

  for (const note of annotations.notes) {
    if (!note || !isFiniteNumber(note.y)) continue;
    // A typed note with no text conveys nothing — skip it.
    const text = str(note.text).trim();
    if (!text) continue;
    const near = nearestBlock(layouts, note.y * scale);
    resolved.push({
      y: note.y,
      annotation: {
        id: str(note.id),
        type: "typed_note",
        note: text,
        nearbyText: nearbyTextOf(near),
        sectionHeading: near != null ? headingAt[near] : undefined,
        ...(near != null ? offsetsFor([near]) : {}),
        boundingBox: { x: num(note.x), y: note.y, w: 0, h: 0 },
      },
    });
  }

  for (const memo of annotations.memos) {
    // A placed voice memo counts even with an empty transcript, but a
    // non-string transcript is malformed data — skip it.
    if (
      !memo ||
      !isFiniteNumber(memo.y) ||
      typeof memo.transcript !== "string"
    ) {
      continue;
    }
    const near = nearestBlock(layouts, memo.y * scale);
    resolved.push({
      y: memo.y,
      annotation: {
        id: str(memo.id),
        type: "voice",
        note: memo.transcript.trim(),
        nearbyText: nearbyTextOf(near),
        sectionHeading: near != null ? headingAt[near] : undefined,
        ...(near != null ? offsetsFor([near]) : {}),
        boundingBox: { x: num(memo.x), y: memo.y, w: 0, h: 0 },
      },
    });
  }

  return resolved.sort((a, b) => a.y - b.y).map((entry) => entry.annotation);
}

/**
 * Parse a persisted layout snapshot — `{ width, layouts: [[index, {y, height}]] }`
 * — into the width it was measured at and a block-index → layout map. Returns
 * null for a missing or malformed snapshot (legacy rows have none).
 */
export function parseLayoutSnapshot(
  json: string | undefined | null,
): { width: number; layouts: Map<number, BlockLayout> } | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { width, layouts } = parsed as {
    width?: unknown;
    layouts?: unknown;
  };
  if (!isFiniteNumber(width) || width <= 0 || !Array.isArray(layouts)) {
    return null;
  }
  const map = new Map<number, BlockLayout>();
  for (const entry of layouts) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [index, layout] = entry as [unknown, unknown];
    if (
      !isFiniteNumber(index) ||
      !Number.isInteger(index) ||
      index < 0 ||
      typeof layout !== "object" ||
      layout === null
    ) {
      continue;
    }
    const { y, height } = layout as { y?: unknown; height?: unknown };
    if (isFiniteNumber(y) && isFiniteNumber(height) && height > 0) {
      map.set(index, { y, height });
    }
  }
  return map.size > 0 ? { width, layouts: map } : null;
}
