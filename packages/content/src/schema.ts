// Effect Schema codecs for content values crossing persistence, network, and
// JSON boundaries. The existing plain TypeScript types remain the canonical
// types used by pure rendering and transformation modules.

import { Option, Schema } from "effect";

import type { BlockLayout } from "./blockGeometry";

const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));

const finite = Schema.Finite;
const positiveFinite = Schema.Finite.check(Schema.isGreaterThan(0));
const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const SpanSchema = Schema.Struct({
  text: Schema.String,
  bold: Schema.optional(Schema.Boolean),
  italic: Schema.optional(Schema.Boolean),
  code: Schema.optional(Schema.Boolean),
  href: Schema.optional(Schema.String),
});

export const HeadingBlockSchema = Schema.Struct({
  type: Schema.Literal("heading"),
  level: Schema.Literals([1, 2, 3, 4, 5, 6]),
  spans: mutableArray(SpanSchema),
});

export const ParagraphBlockSchema = Schema.Struct({
  type: Schema.Literal("paragraph"),
  spans: mutableArray(SpanSchema),
});

export const QuoteBlockSchema = Schema.Struct({
  type: Schema.Literal("quote"),
  spans: mutableArray(SpanSchema),
});

export const ListBlockSchema = Schema.Struct({
  type: Schema.Literal("list"),
  ordered: Schema.Boolean,
  items: mutableArray(mutableArray(SpanSchema)),
});

export const ImageBlockSchema = Schema.Struct({
  type: Schema.Literal("image"),
  src: Schema.String,
  alt: Schema.optional(Schema.String),
  caption: Schema.optional(Schema.String),
  width: Schema.optional(finite),
  height: Schema.optional(finite),
});

export const CodeBlockSchema = Schema.Struct({
  type: Schema.Literal("code"),
  text: Schema.String,
});

export const RuleBlockSchema = Schema.Struct({
  type: Schema.Literal("rule"),
});

export const BlockSchema = Schema.Union([
  HeadingBlockSchema,
  ParagraphBlockSchema,
  QuoteBlockSchema,
  ListBlockSchema,
  ImageBlockSchema,
  CodeBlockSchema,
  RuleBlockSchema,
]);

export const BlocksSchema = mutableArray(BlockSchema);

export const ArticleContentSchema = Schema.Struct({
  title: Schema.String,
  byline: Schema.optional(Schema.String),
  siteName: Schema.optional(Schema.String),
  excerpt: Schema.optional(Schema.String),
  blocks: BlocksSchema,
});

export const PointSchema = Schema.Struct({
  x: finite,
  y: finite,
});

export const StrokeSchema = Schema.Struct({
  id: Schema.String,
  tool: Schema.Literals(["pen", "highlighter"]),
  color: Schema.String,
  width: finite,
  points: mutableArray(PointSchema),
});

export const BoxAnnotationSchema = Schema.Struct({
  id: Schema.String,
  x: finite,
  y: finite,
  w: finite,
  h: finite,
});

export const NoteAnnotationSchema = Schema.Struct({
  id: Schema.String,
  x: finite,
  y: finite,
  text: Schema.String,
});

export const VoiceMemoAnnotationSchema = Schema.Struct({
  id: Schema.String,
  x: finite,
  y: finite,
  durationMs: finite,
  transcript: Schema.String,
  status: Schema.Literals(["local", "uploaded"]),
  createdAt: finite,
});

export const StrokesSchema = mutableArray(StrokeSchema);
export const BoxAnnotationsSchema = mutableArray(BoxAnnotationSchema);
export const NoteAnnotationsSchema = mutableArray(NoteAnnotationSchema);
export const VoiceMemoAnnotationsSchema = mutableArray(
  VoiceMemoAnnotationSchema
);

export const ContentWidthSchema = positiveFinite;

export const AnnotationsSchema = Schema.Struct({
  contentWidth: ContentWidthSchema,
  strokes: StrokesSchema,
  boxes: BoxAnnotationsSchema,
  notes: NoteAnnotationsSchema,
  memos: VoiceMemoAnnotationsSchema,
});

export const BlockLayoutSchema = Schema.Struct({
  y: finite,
  height: positiveFinite,
});

export const LayoutSnapshotEntrySchema = Schema.Tuple([
  nonNegativeInt,
  BlockLayoutSchema,
]).pipe(Schema.mutable);

export const LayoutSnapshotSchema = Schema.Struct({
  width: positiveFinite,
  layouts: mutableArray(LayoutSnapshotEntrySchema),
});

export const FirecrawlMetadataSchema = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  ogTitle: Schema.optional(Schema.NullOr(Schema.String)),
  ogDescription: Schema.optional(Schema.NullOr(Schema.String)),
  sourceURL: Schema.optional(Schema.NullOr(Schema.String)),
});

export const FirecrawlDocumentSchema = Schema.Struct({
  html: Schema.optional(Schema.NullOr(Schema.String)),
  markdown: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(FirecrawlMetadataSchema),
});

export const BlocksJsonSchema = Schema.fromJsonString(BlocksSchema);
export const ArticleContentJsonSchema =
  Schema.fromJsonString(ArticleContentSchema);
export const AnnotationsJsonSchema = Schema.fromJsonString(AnnotationsSchema);
export const LayoutSnapshotJsonSchema =
  Schema.fromJsonString(LayoutSnapshotSchema);
export const FirecrawlDocumentJsonSchema =
  Schema.fromJsonString(FirecrawlDocumentSchema);

/**
 * Decode a persisted JSON array while preserving legacy annotation behavior:
 * the top-level value must be an array, but malformed individual items are
 * ignored instead of invalidating their well-formed siblings.
 */
export function decodeTolerantJsonArray<T>(
  json: string,
  itemSchema: Schema.Decoder<T, never>
): Option.Option<T[]> {
  const decoded = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(json);
  if (Option.isNone(decoded) || !Array.isArray(decoded.value)) {
    return Option.none();
  }

  const decodeItem = Schema.decodeUnknownOption(itemSchema);
  const items: T[] = [];
  for (const input of decoded.value) {
    const item = decodeItem(input);
    if (Option.isSome(item)) items.push(item.value);
  }
  return Option.some(items);
}

// Layout snapshots are intentionally tolerant: a valid top-level snapshot can
// contain stale or malformed individual layout entries, which are ignored.
const LayoutSnapshotContainerSchema = Schema.Struct({
  width: positiveFinite,
  layouts: mutableArray(Schema.Unknown),
});
const decodeLayoutSnapshotContainer = Schema.decodeUnknownOption(
  Schema.fromJsonString(LayoutSnapshotContainerSchema)
);
const decodeLayoutSnapshotEntry = Schema.decodeUnknownOption(
  LayoutSnapshotEntrySchema
);

export type ParsedLayoutSnapshot = {
  width: number;
  layouts: Map<number, BlockLayout>;
};

/**
 * Decode persisted layout JSON while preserving legacy tolerant semantics.
 * Missing/malformed top-level data returns null; malformed entries are skipped.
 */
export function decodeLayoutSnapshotJson(
  json: string | undefined | null
): ParsedLayoutSnapshot | null {
  if (!json) return null;
  const container = decodeLayoutSnapshotContainer(json);
  if (Option.isNone(container)) return null;

  const layouts = new Map<number, BlockLayout>();
  for (const input of container.value.layouts) {
    const entry = decodeLayoutSnapshotEntry(input);
    if (Option.isSome(entry)) {
      layouts.set(entry.value[0], entry.value[1]);
    }
  }
  return layouts.size > 0
    ? { width: container.value.width, layouts }
    : null;
}
