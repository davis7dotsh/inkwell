// Zod schemas for content values crossing persistence, network, and JSON
// boundaries. The existing plain TypeScript types remain the canonical types
// used by pure rendering and transformation modules.

import { Option } from "effect";
import { z } from "zod";

import type { BlockLayout } from "./blockGeometry";

const finite = z.number().finite();
const positiveFinite = finite.positive();
const nonNegativeInt = z.number().int().nonnegative();

export const SpanSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  code: z.boolean().optional(),
  href: z.string().optional(),
});

export const HeadingBlockSchema = z.object({
  type: z.literal("heading"),
  level: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  spans: z.array(SpanSchema),
});

export const ParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  spans: z.array(SpanSchema),
});

export const QuoteBlockSchema = z.object({
  type: z.literal("quote"),
  spans: z.array(SpanSchema),
});

export const ListBlockSchema = z.object({
  type: z.literal("list"),
  ordered: z.boolean(),
  items: z.array(z.array(SpanSchema)),
});

export const ImageBlockSchema = z.object({
  type: z.literal("image"),
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  width: finite.optional(),
  height: finite.optional(),
});

export const CodeBlockSchema = z.object({
  type: z.literal("code"),
  text: z.string(),
});

export const RuleBlockSchema = z.object({
  type: z.literal("rule"),
});

export const BlockSchema = z.discriminatedUnion("type", [
  HeadingBlockSchema,
  ParagraphBlockSchema,
  QuoteBlockSchema,
  ListBlockSchema,
  ImageBlockSchema,
  CodeBlockSchema,
  RuleBlockSchema,
]);

export const BlocksSchema = z.array(BlockSchema);

export const ArticleContentSchema = z.object({
  title: z.string(),
  byline: z.string().optional(),
  siteName: z.string().optional(),
  excerpt: z.string().optional(),
  blocks: BlocksSchema,
});

export const PointSchema = z.object({
  x: finite,
  y: finite,
});

export const StrokeSchema = z.object({
  id: z.string(),
  tool: z.enum(["pen", "highlighter"]),
  color: z.string(),
  width: finite,
  points: z.array(PointSchema),
});

export const BoxAnnotationSchema = z.object({
  id: z.string(),
  x: finite,
  y: finite,
  w: finite,
  h: finite,
});

export const NoteAnnotationSchema = z.object({
  id: z.string(),
  x: finite,
  y: finite,
  text: z.string(),
});

export const VoiceMemoAnnotationSchema = z.object({
  id: z.string(),
  x: finite,
  y: finite,
  durationMs: finite,
  transcript: z.string(),
  status: z.enum(["local", "uploaded"]),
  createdAt: finite,
});

export const StrokesSchema = z.array(StrokeSchema);
export const BoxAnnotationsSchema = z.array(BoxAnnotationSchema);
export const NoteAnnotationsSchema = z.array(NoteAnnotationSchema);
export const VoiceMemoAnnotationsSchema = z.array(VoiceMemoAnnotationSchema);

export const ContentWidthSchema = positiveFinite;

export const AnnotationsSchema = z.object({
  contentWidth: ContentWidthSchema,
  strokes: StrokesSchema,
  boxes: BoxAnnotationsSchema,
  notes: NoteAnnotationsSchema,
  memos: VoiceMemoAnnotationsSchema,
});

export const BlockLayoutSchema = z.object({
  y: finite,
  height: positiveFinite,
});

export const LayoutSnapshotEntrySchema = z.tuple([
  nonNegativeInt,
  BlockLayoutSchema,
]);

export const LayoutSnapshotSchema = z.object({
  width: positiveFinite,
  layouts: z.array(LayoutSnapshotEntrySchema),
});

export const FirecrawlMetadataSchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  ogTitle: z.string().nullable().optional(),
  ogDescription: z.string().nullable().optional(),
  sourceURL: z.string().nullable().optional(),
});

export const FirecrawlDocumentSchema = z.object({
  html: z.string().nullable().optional(),
  markdown: z.string().nullable().optional(),
  metadata: FirecrawlMetadataSchema.optional(),
});

const fromJsonString = <S extends z.ZodType>(schema: S) =>
  z
    .string()
    .transform((json, context) => {
      try {
        return JSON.parse(json);
      } catch {
        context.addIssue({
          code: "custom",
          message: "Invalid JSON",
        });
        return z.NEVER;
      }
    })
    .pipe(schema);

export const BlocksJsonSchema = fromJsonString(BlocksSchema);
export const ArticleContentJsonSchema = fromJsonString(ArticleContentSchema);
export const AnnotationsJsonSchema = fromJsonString(AnnotationsSchema);
export const LayoutSnapshotJsonSchema = fromJsonString(LayoutSnapshotSchema);
export const FirecrawlDocumentJsonSchema = fromJsonString(
  FirecrawlDocumentSchema,
);

/**
 * Decode a persisted JSON array while preserving legacy annotation behavior:
 * the top-level value must be an array, but malformed individual items are
 * ignored instead of invalidating their well-formed siblings.
 */
export function decodeTolerantJsonArray<T>(
  json: string,
  itemSchema: z.ZodType<T>,
): Option.Option<T[]> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return Option.none();
  }
  if (!Array.isArray(decoded)) return Option.none();

  const items: T[] = [];
  for (const input of decoded) {
    const item = itemSchema.safeParse(input);
    if (item.success) items.push(item.data);
  }
  return Option.some(items);
}

// Layout snapshots are intentionally tolerant: a valid top-level snapshot can
// contain stale or malformed individual layout entries, which are ignored.
const LayoutSnapshotContainerSchema = z.object({
  width: positiveFinite,
  layouts: z.array(z.unknown()),
});

export type ParsedLayoutSnapshot = {
  width: number;
  layouts: Map<number, BlockLayout>;
};

/**
 * Decode persisted layout JSON while preserving legacy tolerant semantics.
 * Missing/malformed top-level data returns null; malformed entries are skipped.
 */
export function decodeLayoutSnapshotJson(
  json: string | undefined | null,
): ParsedLayoutSnapshot | null {
  if (!json) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return null;
  }
  const container = LayoutSnapshotContainerSchema.safeParse(decoded);
  if (!container.success) return null;

  const layouts = new Map<number, BlockLayout>();
  for (const input of container.data.layouts) {
    const entry = LayoutSnapshotEntrySchema.safeParse(input);
    if (entry.success) {
      layouts.set(entry.data[0], entry.data[1]);
    }
  }
  return layouts.size > 0 ? { width: container.data.width, layouts } : null;
}
