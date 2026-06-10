// Core shared types for Inkwell: article content blocks and annotation
// geometry. Pure TypeScript — safe for React Native, Workers, and the web.

/** An inline run of text with optional styling. */
export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Absolute URL if this span is a link. */
  href?: string;
};

/** A top-level content block of a parsed article. */
export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; spans: Span[] }
  | { type: "paragraph"; spans: Span[] }
  | { type: "quote"; spans: Span[] }
  | { type: "list"; ordered: boolean; items: Span[][] }
  | {
      type: "image";
      src: string;
      alt?: string;
      caption?: string;
      /** Display dimensions (CSS px) captured at extraction time, if known. */
      width?: number;
      height?: number;
    }
  | { type: "code"; text: string }
  | { type: "rule" };

/**
 * Reader-ready article content payload. Persistence-level fields (ids, url,
 * status, userId, savedAt) live in the Convex schema, not here.
 */
export type ArticleContent = {
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  blocks: Block[];
};

// ---- Annotations ----
// All coordinates are in "content space": pixels relative to the top-left of
// the article content column, at the contentWidth recorded on the annotation
// set. Rendering scales by (currentContentWidth / contentWidth) so notes stay
// anchored if the layout width changes.

export type Point = { x: number; y: number };

export type Stroke = {
  id: string;
  tool: "pen" | "highlighter";
  color: string;
  width: number;
  points: Point[];
};

/** A box drawn around a section to mark it as key/critical. */
export type BoxAnnotation = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** A typed text note pinned to a location in the article. */
export type NoteAnnotation = {
  id: string;
  x: number;
  y: number;
  text: string;
};

/**
 * One annotation set for one article. Which article it belongs to is the
 * persistence layer's concern (Convex row / storage key), not part of the
 * content payload.
 */
export type Annotations = {
  /** Content column width (px) when these annotations were made. */
  contentWidth: number;
  strokes: Stroke[];
  boxes: BoxAnnotation[];
  notes: NoteAnnotation[];
};

export const emptyAnnotations = (contentWidth: number): Annotations => ({
  contentWidth,
  strokes: [],
  boxes: [],
  notes: [],
});
