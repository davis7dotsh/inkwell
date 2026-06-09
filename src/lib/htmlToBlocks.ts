// Converts Readability-cleaned article HTML into renderable Blocks.
// Pure TypeScript + htmlparser2; safe for React Native (no Node APIs, no DOM).

import { ElementType, parseDocument } from "htmlparser2";

import type { Block, Span } from "./types";

// `domhandler` is not a direct dependency (pnpm strict node_modules), so we
// derive its node types from htmlparser2's `parseDocument` return type.
type AnyNode = ReturnType<typeof parseDocument>["children"][number];
type ElementNode = Extract<AnyNode, { tagName: string }>;
type TextNode = Extract<AnyNode, { nodeType: 3 }>;

type ImageBlock = Extract<Block, { type: "image" }>;
type HeadingLevel = Extract<Block, { type: "heading" }>["level"];

const isElement = (node: AnyNode): node is ElementNode =>
  node.type === ElementType.Tag ||
  node.type === ElementType.Script ||
  node.type === ElementType.Style;

const isText = (node: AnyNode): node is TextNode =>
  node.type === ElementType.Text;

/** Tags whose entire subtree is dropped. */
const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "video",
  "audio",
  "form",
  "button",
  "nav",
  "footer",
  "template",
  "head",
  "title",
  "meta",
  "link",
  "base",
  "object",
  "embed",
  "canvas",
  "input",
  "select",
  "textarea",
]);

/** Tags that start a new block (i.e. interrupt an inline run). */
const BLOCK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "aside",
  "address",
  "blockquote",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "picture",
  "img",
  "pre",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "details",
  "summary",
]);

type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
};

const tagOf = (el: ElementNode): string => el.tagName.toLowerCase();

// ---- Inline span extraction ----

function sameStyle(span: Span, style: InlineStyle): boolean {
  return (
    !!span.bold === !!style.bold &&
    !!span.italic === !!style.italic &&
    !!span.code === !!style.code &&
    span.href === style.href
  );
}

function makeSpan(text: string, style: InlineStyle): Span {
  const span: Span = { text };
  if (style.bold) span.bold = true;
  if (style.italic) span.italic = true;
  if (style.code) span.code = true;
  if (style.href !== undefined) span.href = style.href;
  return span;
}

/**
 * Append text to the span list, collapsing whitespace across span boundaries
 * and merging adjacent runs with identical styling.
 */
function pushText(spans: Span[], text: string, style: InlineStyle): void {
  if (!text) return;
  if (text.startsWith("\n")) {
    // Trailing spaces before an explicit line break are never rendered.
    let tail = spans[spans.length - 1];
    while (tail) {
      tail.text = tail.text.replace(/ +$/, "");
      if (tail.text) break;
      spans.pop();
      tail = spans[spans.length - 1];
    }
  }
  const last = spans[spans.length - 1];
  const prevChar = last ? last.text[last.text.length - 1] : "";
  if (prevChar === "" || prevChar === " " || prevChar === "\n") {
    text = text.replace(/^ +/, "");
    if (!text) return;
  }
  if (last && sameStyle(last, style)) {
    last.text += text;
  } else {
    spans.push(makeSpan(text, style));
  }
}

function collectSpans(
  nodes: AnyNode[],
  style: InlineStyle,
  spans: Span[]
): void {
  for (const node of nodes) {
    if (isText(node)) {
      pushText(spans, node.data.replace(/[ \t\r\n\f]+/g, " "), style);
      continue;
    }
    if (!isElement(node)) continue;
    const tag = tagOf(node);
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === "br") {
      pushText(spans, "\n", style);
      continue;
    }
    const next: InlineStyle = { ...style };
    if (tag === "a") {
      if (node.attribs.href) next.href = node.attribs.href;
    } else if (tag === "strong" || tag === "b") {
      next.bold = true;
    } else if (tag === "em" || tag === "i") {
      next.italic = true;
    } else if (tag === "code") {
      next.code = true;
    }
    // When block-level children get flattened inline (blocks nested in inline
    // wrappers like <font>, list items, quotes, table cells), keep a paragraph
    // boundary between them; callers that split on "\n\n" recover real
    // paragraphs, everywhere else it renders as a line break.
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) pushText(spans, "\n\n", style);
    collectSpans(node.children, next, spans);
    if (isBlock) pushText(spans, "\n\n", style);
  }
}

/** Trim leading/trailing whitespace from a span list, dropping emptied spans. */
function trimSpans(spans: Span[]): Span[] {
  while (spans.length > 0) {
    const first = spans[0];
    first.text = first.text.replace(/^[ \n]+/, "");
    if (first.text) break;
    spans.shift();
  }
  while (spans.length > 0) {
    const last = spans[spans.length - 1];
    last.text = last.text.replace(/[ \n]+$/, "");
    if (last.text) break;
    spans.pop();
  }
  return spans;
}

function buildSpans(nodes: AnyNode[], base: InlineStyle = {}): Span[] {
  const spans: Span[] = [];
  collectSpans(nodes, base, spans);
  return trimSpans(spans);
}

const hasVisibleText = (spans: Span[]): boolean =>
  spans.some((span) => /\S/.test(span.text));

const spansToText = (spans: Span[]): string =>
  spans.map((span) => span.text).join("");

// ---- Block extraction ----

/**
 * Split a span run into paragraph groups at double line breaks. Old-school
 * pages (e.g. paulgraham.com) separate paragraphs with <br><br> instead of
 * <p>; without this the whole essay renders as one wall of text.
 */
function splitParagraphGroups(spans: Span[]): Span[][] {
  const groups: Span[][] = [[]];
  for (const span of spans) {
    const parts = span.text.split(/\n{2,}/);
    parts.forEach((part, index) => {
      if (index > 0) groups.push([]);
      if (part) groups[groups.length - 1].push({ ...span, text: part });
    });
  }
  return groups.map(trimSpans).filter(hasVisibleText);
}

/**
 * Walk a container's children: runs of inline content become paragraphs,
 * block-level children are dispatched to their handlers.
 */
function processChildren(nodes: AnyNode[], blocks: Block[]): void {
  let inlineRun: AnyNode[] = [];
  const flushRun = () => {
    if (inlineRun.length === 0) return;
    for (const spans of splitParagraphGroups(buildSpans(inlineRun))) {
      blocks.push({ type: "paragraph", spans });
    }
    inlineRun = [];
  };
  for (const node of nodes) {
    if (isText(node)) {
      inlineRun.push(node);
      continue;
    }
    if (!isElement(node)) continue; // comments, doctypes, CDATA
    const tag = tagOf(node);
    if (SKIP_TAGS.has(tag)) continue;
    if (BLOCK_TAGS.has(tag)) {
      flushRun();
      processBlock(node, tag, blocks);
    } else if (findFirst(node.children, "img")) {
      // Inline wrappers (usually <a>) around images — common in logo grids
      // and linked figures. Surface the image as a block instead of silently
      // dropping it during inline span flattening.
      flushRun();
      processChildren(node.children, blocks);
    } else {
      inlineRun.push(node);
    }
  }
  flushRun();
}

function processBlock(el: ElementNode, tag: string, blocks: Block[]): void {
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Math.min(
        6,
        Math.max(1, Number(tag.charAt(1)))
      ) as HeadingLevel;
      const spans = buildSpans(el.children);
      if (hasVisibleText(spans)) blocks.push({ type: "heading", level, spans });
      return;
    }
    case "blockquote": {
      const spans = quoteSpans(el);
      if (hasVisibleText(spans)) blocks.push({ type: "quote", spans });
      return;
    }
    case "ul":
    case "ol": {
      const items: Span[][] = [];
      collectListItems(el, items, 0);
      if (items.length > 0) {
        blocks.push({ type: "list", ordered: tag === "ol", items });
      }
      return;
    }
    case "img": {
      const image = imageBlock(el);
      if (image) blocks.push(image);
      return;
    }
    case "figure":
      processFigure(el, blocks);
      return;
    case "pre": {
      // Preserve whitespace exactly, minus a single leading/trailing newline.
      const text = rawText(el.children)
        .replace(/^\r?\n/, "")
        .replace(/\r?\n$/, "");
      if (text.trim()) blocks.push({ type: "code", text });
      return;
    }
    case "hr":
      blocks.push({ type: "rule" });
      return;
    case "table":
      processTable(el, blocks);
      return;
    default:
      // p and generic containers (div, section, article, main, figure-less
      // wrappers, etc.): recurse, letting inline runs become paragraphs.
      processChildren(el.children, blocks);
  }
}

/** Flatten a blockquote's paragraphs into spans separated by "\n\n". */
function quoteSpans(el: ElementNode): Span[] {
  const groups: Span[][] = [];
  let run: AnyNode[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    const spans = buildSpans(run);
    if (hasVisibleText(spans)) groups.push(spans);
    run = [];
  };
  for (const child of el.children) {
    if (isElement(child)) {
      const tag = tagOf(child);
      if (SKIP_TAGS.has(tag)) continue;
      if (BLOCK_TAGS.has(tag)) {
        flushRun();
        const spans =
          tag === "blockquote" ? quoteSpans(child) : buildSpans(child.children);
        if (hasVisibleText(spans)) groups.push(spans);
        continue;
      }
    }
    run.push(child);
  }
  flushRun();
  const spans: Span[] = [];
  groups.forEach((group, index) => {
    if (index > 0) spans.push({ text: "\n\n" });
    spans.push(...group);
  });
  return spans;
}

function collectListItems(
  listEl: ElementNode,
  items: Span[][],
  depth: number
): void {
  for (const child of listEl.children) {
    if (!isElement(child)) continue;
    const tag = tagOf(child);
    if (tag === "li") {
      collectListItem(child, items, depth);
    } else if (tag === "ul" || tag === "ol") {
      collectListItems(child, items, depth + 1);
    }
  }
}

function collectListItem(
  li: ElementNode,
  items: Span[][],
  depth: number
): void {
  // Separate nested lists from the item's own content so they can be
  // flattened into sibling items below it.
  const own: AnyNode[] = [];
  const nestedLists: ElementNode[] = [];
  for (const child of li.children) {
    if (isElement(child)) {
      const tag = tagOf(child);
      if (tag === "ul" || tag === "ol") {
        nestedLists.push(child);
        continue;
      }
    }
    own.push(child);
  }
  const spans = buildSpans(own);
  if (hasVisibleText(spans)) {
    const prefix = "– ".repeat(depth);
    if (prefix) {
      const first = spans[0];
      if (first && sameStyle(first, {})) first.text = prefix + first.text;
      else spans.unshift({ text: prefix });
    }
    items.push(spans);
  }
  for (const list of nestedLists) collectListItems(list, items, depth + 1);
}

const isTinyDimension = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const size = Number.parseFloat(value);
  return Number.isFinite(size) && size <= 2;
};

function firstSrcsetUrl(srcset: string): string | undefined {
  return srcset.split(",")[0]?.trim().split(/\s+/)[0] || undefined;
}

function parseDimension(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const size = Number.parseFloat(value);
  return Number.isFinite(size) && size > 0 ? Math.round(size) : undefined;
}

function imageBlock(el: ElementNode, caption?: string): ImageBlock | null {
  const attribs = el.attribs;
  // data-inkwell-src is the browser-resolved URL stamped by the extraction
  // script (it already reflects srcset / <picture> / lazy-load resolution).
  const src =
    attribs["data-inkwell-src"] ||
    attribs.src ||
    attribs["data-src"] ||
    (attribs.srcset ? firstSrcsetUrl(attribs.srcset) : undefined);
  if (!src || src.startsWith("data:")) return null;
  // Tracking pixels.
  if (isTinyDimension(attribs.width) || isTinyDimension(attribs.height)) {
    return null;
  }
  // On-screen size stamped at extraction time; intrinsic size as fallback.
  const width =
    parseDimension(attribs["data-inkwell-cssw"]) ??
    parseDimension(attribs["data-inkwell-w"]);
  const height =
    parseDimension(attribs["data-inkwell-cssh"]) ??
    parseDimension(attribs["data-inkwell-h"]);
  // Icon-sized images (favicons, emoji glyphs, UI chrome) aren't content.
  if (
    width !== undefined &&
    height !== undefined &&
    (width < 24 || height < 24)
  ) {
    return null;
  }
  const block: ImageBlock = { type: "image", src };
  const alt = attribs.alt?.trim();
  if (alt) block.alt = alt;
  if (caption) block.caption = caption;
  if (width !== undefined) block.width = width;
  if (height !== undefined) block.height = height;
  return block;
}

function findFirst(nodes: AnyNode[], tag: string): ElementNode | null {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (tagOf(node) === tag) return node;
    const found = findFirst(node.children, tag);
    if (found) return found;
  }
  return null;
}

function processFigure(el: ElementNode, blocks: Block[]): void {
  const img = findFirst(el.children, "img");
  if (!img) {
    // Figures can wrap pre/blockquote/etc.; treat as a generic container.
    processChildren(el.children, blocks);
    return;
  }
  const figcaption = findFirst(el.children, "figcaption");
  const caption = figcaption
    ? spansToText(buildSpans(figcaption.children))
    : undefined;
  const image = imageBlock(img, caption || undefined);
  if (image) blocks.push(image);
}

function collectRows(nodes: AnyNode[], rows: ElementNode[]): void {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    const tag = tagOf(node);
    if (tag === "tr") rows.push(node);
    else if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
      collectRows(node.children, rows);
    }
  }
}

/**
 * Tables come in two flavors. Layout tables (single row or single column —
 * how pre-CSS sites like paulgraham.com wrap entire articles) are treated as
 * plain containers so their content keeps real paragraph structure. Data
 * tables are flattened one row per paragraph, cells joined with " · ".
 */
function processTable(el: ElementNode, blocks: Block[]): void {
  const rows: ElementNode[] = [];
  collectRows(el.children, rows);
  const rowCells = rows.map((row) =>
    row.children.filter(
      (cell): cell is ElementNode =>
        isElement(cell) && (tagOf(cell) === "td" || tagOf(cell) === "th")
    )
  );
  const isLayoutTable =
    rows.length <= 1 || rowCells.every((cells) => cells.length <= 1);
  if (isLayoutTable) {
    for (const cells of rowCells) {
      for (const cell of cells) processChildren(cell.children, blocks);
    }
    return;
  }
  for (const cells of rowCells) {
    const spans: Span[] = [];
    for (const cell of cells) {
      const cellSpans = buildSpans(
        cell.children,
        tagOf(cell) === "th" ? { bold: true } : {}
      );
      if (!hasVisibleText(cellSpans)) continue;
      if (spans.length > 0) spans.push({ text: " · " });
      spans.push(...cellSpans);
    }
    if (hasVisibleText(spans)) blocks.push({ type: "paragraph", spans });
  }
}

/** Raw text content with whitespace preserved (used for <pre>). */
function rawText(nodes: AnyNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (isText(node)) text += node.data;
    else if (isElement(node) && !SKIP_TAGS.has(tagOf(node))) {
      text += rawText(node.children);
    }
  }
  return text;
}

export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  processChildren(parseDocument(html).children, blocks);
  return blocks;
}
