// Core shared types for Marginalia.

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

/** A saved, reader-ready article. */
export type Article = {
  id: string;
  url: string;
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  /** ISO 8601 timestamp of when the article was saved. */
  savedAt: string;
  blocks: Block[];
};

/** Lightweight index entry shown in the library list. */
export type ArticleSummary = {
  id: string;
  url: string;
  title: string;
  siteName?: string;
  excerpt?: string;
  savedAt: string;
};

/** Raw result posted back from the extraction WebView. */
export type ExtractionResult = {
  url: string;
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  /** Readability's cleaned article HTML (absolute URLs). */
  contentHtml: string;
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

export type Annotations = {
  articleId: string;
  /** Content column width (px) when these annotations were made. */
  contentWidth: number;
  strokes: Stroke[];
  boxes: BoxAnnotation[];
  notes: NoteAnnotation[];
};

export const emptyAnnotations = (
  articleId: string,
  contentWidth: number
): Annotations => ({
  articleId,
  contentWidth,
  strokes: [],
  boxes: [],
  notes: [],
});
