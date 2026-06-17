// Tests for @inkwell/content. Run with: pnpm --filter @inkwell/content test

// @ts-ignore -- @types/node is not installed in this package; tsx provides
// the real implementation at runtime.
import nodeAssert from "node:assert/strict";
import { Effect, Option } from "effect";

import { blocksToMarkdown } from "../src/blocksToMarkdown";
import {
  buildDocumentOutline,
  inferDocumentHeadings,
} from "../src/documentOutline";
import {
  firecrawlToArticleEffect,
  htmlToBlocksEffect,
  markdownToBlocksEffect,
  parseLayoutSnapshotEffect,
} from "../src/effect";
import { buildExportMarkdown } from "../src/exportMarkdown";
import {
  parseLayoutSnapshot,
  resolveAnnotations,
} from "../src/resolveAnnotations";
import { htmlToBlocks } from "../src/htmlToBlocks";
import { markdownToBlocks } from "../src/markdownToBlocks";
import { firecrawlToArticle } from "../src/normalize";
import {
  AnnotationsJsonSchema,
  ArticleContentJsonSchema,
  BlockSchema,
  BoxAnnotationSchema,
  FirecrawlDocumentJsonSchema,
  LayoutSnapshotJsonSchema,
  NoteAnnotationSchema,
  decodeTolerantJsonArray,
} from "../src/schema";
import { emptyAnnotations, type Block, type Span } from "../src/types";

type Assert = {
  (value: unknown, message?: string): void;
  equal(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  ok(value: unknown, message?: string): void;
  throws(fn: () => unknown, expected?: RegExp, message?: string): void;
};
const assert = nodeAssert as Assert;

// The package tsconfig has no DOM/node libs (it must stay RN/Workers-safe),
// so declare the one runtime global this test script uses.
declare const console: { log(...args: unknown[]): void };

// Fixture: resembles Mozilla Readability output for a tech blog post.
// Deliberately messy: stray indentation/newlines between tags, entities,
// a tracking pixel, a data: URI image, and a <script> that must be skipped.
const html = `
<div id="readability-page-1" class="page">
  <h1>
    Building a   Faster Parser
  </h1>

  <p>
    Parsing HTML on a phone is <strong><em><a href="https://example.com/hard">surprisingly
    hard</a></em></strong> &mdash; most libraries assume a DOM &amp; &quot;browser&quot; environment.
  </p>

  <p>We use <code>htmlparser2</code> instead, because it&#39;s fast &amp; portable.</p>

  <figure>
    <img src="https://example.com/diagram.png" alt="Parser pipeline" />
    <figcaption>Figure 1: the parsing pipeline</figcaption>
  </figure>

  <ul>
    <li>Streaming <strong>tokenizer</strong></li>
    <li>
      No DOM globals
      <ul>
        <li>works in <em>React Native</em></li>
      </ul>
    </li>
  </ul>

  <ol>
    <li>Parse</li>
    <li>Walk &amp; collect</li>
  </ol>

  <blockquote>
    <p>Any sufficiently complicated parser contains an ad hoc HTML spec.</p>
    <p>&mdash; someone, probably</p>
  </blockquote>

  <pre><code>
const doc = parseDocument(html);
const blocks = walk(doc);
return blocks;
</code></pre>

  <hr />

  Some stray inline text with <em>emphasis</em>, right in the div.

  <table>
    <thead><tr><th>Engine</th><th>Speed</th></tr></thead>
    <tbody>
      <tr><td>htmlparser2</td><td>fast</td></tr>
      <tr><td>regex</td><td>cursed</td></tr>
    </tbody>
  </table>

  <img data-src="https://example.com/lazy.jpg" alt="Lazy loaded" />
  <img srcset="https://example.com/s-400.jpg 400w, https://example.com/s-800.jpg 800w" />

  <img src="https://tracker.example.com/p.gif" width="1" height="1" />
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
  <script>document.write("<p>fake paragraph</p>");</script>

  <p>That&#x2019;s a &quot;wrap&quot; &amp; we&#39;re done.</p>
  <p>Ship it<br />then iterate.</p>
</div>
`;

const blocks = htmlToBlocks(html);

const spanText = (spans: Span[]): string => spans.map((s) => s.text).join("");
const blockText = (block: Block): string => {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
      return spanText(block.spans);
    case "list":
      return block.items.map(spanText).join(" | ");
    case "image":
      return `${block.src}${block.caption ? ` (${block.caption})` : ""}`;
    case "code":
      return block.text;
    case "rule":
      return "";
  }
};

// ---- Block count and types in order ----
assert.deepEqual(
  blocks.map((b) => b.type),
  [
    "heading", // h1
    "paragraph", // intro
    "paragraph", // "We use htmlparser2..."
    "image", // figure
    "list", // ul (with flattened nested ul)
    "list", // ol
    "quote", // blockquote
    "code", // pre
    "rule", // hr
    "paragraph", // stray inline text directly in the div
    "paragraph", // table header row
    "paragraph", // table body row 1
    "paragraph", // table body row 2
    "image", // data-src fallback
    "image", // srcset fallback
    "paragraph", // entities
    "paragraph", // <br>
  ],
  "block types in order"
);

// ---- Heading ----
const heading = blocks[0] as Extract<Block, { type: "heading" }>;
assert.equal(heading.level, 1);
assert.equal(spanText(heading.spans), "Building a Faster Parser");

// ---- Intro paragraph: nested strong>em>a, whitespace, entities ----
const intro = blocks[1] as Extract<Block, { type: "paragraph" }>;
assert.equal(
  spanText(intro.spans),
  'Parsing HTML on a phone is surprisingly hard — most libraries assume a DOM & "browser" environment.'
);
const link = intro.spans.find((s) => s.href !== undefined);
assert.ok(link, "bold-italic-link span exists");
assert.equal(link!.text, "surprisingly hard");
assert.equal(link!.bold, true);
assert.equal(link!.italic, true);
assert.equal(link!.href, "https://example.com/hard");
assert.equal(intro.spans[0].text, "Parsing HTML on a phone is ");
assert.equal(intro.spans[0].bold, undefined);

// ---- Inline code + apostrophe entity ----
const codePara = blocks[2] as Extract<Block, { type: "paragraph" }>;
assert.equal(
  spanText(codePara.spans),
  "We use htmlparser2 instead, because it's fast & portable."
);
const inlineCode = codePara.spans.find((s) => s.code === true);
assert.ok(inlineCode, "inline code span exists");
assert.equal(inlineCode!.text, "htmlparser2");
assert.equal(inlineCode!.href, undefined);

// ---- Figure image with caption ----
const figureImage = blocks[3] as Extract<Block, { type: "image" }>;
assert.equal(figureImage.src, "https://example.com/diagram.png");
assert.equal(figureImage.alt, "Parser pipeline");
assert.equal(figureImage.caption, "Figure 1: the parsing pipeline");

// ---- Unordered list with flattened nested list ----
const ul = blocks[4] as Extract<Block, { type: "list" }>;
assert.equal(ul.ordered, false);
assert.deepEqual(ul.items.map(spanText), [
  "Streaming tokenizer",
  "No DOM globals",
  "– works in React Native",
]);
assert.deepEqual(ul.items[0][1], { text: "tokenizer", bold: true });
const nestedItalic = ul.items[2].find((s) => s.italic === true);
assert.ok(nestedItalic, "nested item keeps italic styling");
assert.equal(nestedItalic!.text, "React Native");

// ---- Ordered list ----
const ol = blocks[5] as Extract<Block, { type: "list" }>;
assert.equal(ol.ordered, true);
assert.deepEqual(ol.items.map(spanText), ["Parse", "Walk & collect"]);

// ---- Blockquote: two paragraphs flattened with "\n\n" separator ----
const quote = blocks[6] as Extract<Block, { type: "quote" }>;
assert.equal(
  spanText(quote.spans),
  "Any sufficiently complicated parser contains an ad hoc HTML spec.\n\n— someone, probably"
);
assert.ok(
  quote.spans.some((s) => s.text === "\n\n"),
  "quote paragraphs separated by a \\n\\n span"
);

// ---- Code block: newlines preserved, single outer newlines stripped ----
const codeBlock = blocks[7] as Extract<Block, { type: "code" }>;
assert.equal(
  codeBlock.text,
  "const doc = parseDocument(html);\nconst blocks = walk(doc);\nreturn blocks;"
);
assert.equal(codeBlock.text.split("\n").length, 3);

// ---- Rule ----
assert.equal(blocks[8].type, "rule");

// ---- Stray inline content directly inside the div ----
const stray = blocks[9] as Extract<Block, { type: "paragraph" }>;
assert.equal(
  spanText(stray.spans),
  "Some stray inline text with emphasis, right in the div."
);
assert.equal(stray.spans.find((s) => s.italic)?.text, "emphasis");

// ---- Table flattened to paragraphs, th cells bold ----
const headerRow = blocks[10] as Extract<Block, { type: "paragraph" }>;
assert.equal(spanText(headerRow.spans), "Engine · Speed");
assert.deepEqual(headerRow.spans[0], { text: "Engine", bold: true });
assert.deepEqual(headerRow.spans[2], { text: "Speed", bold: true });
assert.equal(spanText((blocks[11] as typeof headerRow).spans), "htmlparser2 · fast");
assert.equal(spanText((blocks[12] as typeof headerRow).spans), "regex · cursed");

// ---- Image src fallbacks ----
const lazyImage = blocks[13] as Extract<Block, { type: "image" }>;
assert.equal(lazyImage.src, "https://example.com/lazy.jpg");
assert.equal(lazyImage.alt, "Lazy loaded");
const srcsetImage = blocks[14] as Extract<Block, { type: "image" }>;
assert.equal(srcsetImage.src, "https://example.com/s-400.jpg");

// ---- Tracking pixel, data: URI, and script dropped ----
for (const block of blocks) {
  if (block.type === "image") {
    assert.ok(!block.src.includes("tracker"), "tracking pixel dropped");
    assert.ok(!block.src.startsWith("data:"), "data: URI dropped");
  }
}
assert.ok(
  !blocks.some((b) => blockText(b).includes("fake paragraph")),
  "script content skipped"
);

// ---- Entities decoded ----
const entities = blocks[15] as Extract<Block, { type: "paragraph" }>;
assert.equal(spanText(entities.spans), 'That’s a "wrap" & we\'re done.');

// ---- <br> becomes \n ----
const brPara = blocks[16] as Extract<Block, { type: "paragraph" }>;
assert.equal(spanText(brPara.spans), "Ship it\nthen iterate.");

// ---- Global whitespace hygiene ----
for (const block of blocks) {
  if (block.type === "code" || block.type === "rule" || block.type === "image")
    continue;
  const texts =
    block.type === "list"
      ? block.items.map(spanText)
      : [spanText(block.spans)];
  for (const text of texts) {
    assert.ok(!text.includes("  "), `no double spaces in: ${JSON.stringify(text)}`);
    assert.equal(text, text.trim(), `no leading/trailing whitespace in: ${JSON.stringify(text)}`);
  }
}

// ---- Summary ----
console.log(`Parsed ${blocks.length} blocks:\n`);
for (const [i, block] of blocks.entries()) {
  const label =
    block.type === "heading"
      ? `heading(h${block.level})`
      : block.type === "list"
        ? `list(${block.ordered ? "ordered" : "unordered"})`
        : block.type;
  const preview = blockText(block).replace(/\n/g, "\\n");
  console.log(
    `  ${String(i + 1).padStart(2)}. ${label.padEnd(16)} ${
      preview.length > 72 ? `${preview.slice(0, 72)}…` : preview
    }`
  );
}
// ---- Old-school layout: <br><br> paragraphs inside a layout table ----
// (paulgraham.com-style: whole essay in one table cell, paragraphs as <br><br>)
const pgStyle = htmlToBlocks(`
  <table border="0" cellspacing="0">
    <tr><td>
      <font face="verdana" size="2">
        July 2023<br><br>
        If you collected <i>lists</i> of techniques, what would the
        intersection look like?<br><br>
        The first step is to decide what to work on.<br>
        (A single break is just a line break.)
      </font>
    </td></tr>
  </table>
`);
assert.equal(pgStyle.length, 3, "layout table splits into 3 paragraphs");
assert.ok(
  pgStyle.every((b) => b.type === "paragraph"),
  "layout-table content is all paragraphs"
);
assert.equal(blockText(pgStyle[0]), "July 2023");
assert.ok(
  blockText(pgStyle[1]).startsWith("If you collected lists"),
  "second paragraph splits at <br><br>"
);
assert.ok(
  blockText(pgStyle[2]).includes("\n(A single break"),
  "single <br> stays an in-paragraph line break"
);

// Double-br splitting also applies outside tables (plain containers).
const divBr = htmlToBlocks(`<div>First para.<br><br>Second para.</div>`);
assert.equal(divBr.length, 2, "div with <br><br> splits into 2 paragraphs");
assert.equal(blockText(divBr[0]), "First para.");
assert.equal(blockText(divBr[1]), "Second para.");

// Real data tables (multi-column) still flatten one row per paragraph.
const dataTable = htmlToBlocks(`
  <table>
    <tr><th>Model</th><th>Score</th></tr>
    <tr><td>Fable 5</td><td>98</td></tr>
  </table>
`);
assert.equal(dataTable.length, 2, "data table keeps row-per-paragraph");
assert.equal(blockText(dataTable[0]), "Model · Score");
assert.equal(blockText(dataTable[1]), "Fable 5 · 98");

console.log("PG-style <br><br>/layout-table tests passed");

// ---- Image extraction upgrades ----
// Linked images (logo grids): <a> wrapping an <img> must surface the image.
const linkedImg = htmlToBlocks(`
  <div>
    <a href="https://sponsor.example.com">
      <img src="https://cdn.example.com/logo.png" alt="Acme"
           data-inkwell-src="https://cdn.example.com/logo@2x.png"
           data-inkwell-cssw="180" data-inkwell-cssh="60"
           data-inkwell-w="360" data-inkwell-h="120" />
    </a>
    <p>Acme sponsors the newsletter.</p>
  </div>
`);
assert.equal(linkedImg.length, 2, "a-wrapped img surfaces as a block");
assert.equal(linkedImg[0].type, "image");
const linked = linkedImg[0] as Extract<Block, { type: "image" }>;
assert.equal(
  linked.src,
  "https://cdn.example.com/logo@2x.png",
  "data-inkwell-src wins over src"
);
assert.equal(linked.width, 180, "display width from data-inkwell-cssw");
assert.equal(linked.height, 60, "display height from data-inkwell-cssh");

// Icon-sized images are dropped; unknown-size images are kept.
const icons = htmlToBlocks(`
  <div>
    <img src="https://e.com/emoji.png" data-inkwell-cssw="20" data-inkwell-cssh="20" />
    <img src="https://e.com/unknown-size.jpg" />
    <p>text</p>
  </div>
`);
assert.equal(
  icons.filter((b) => b.type === "image").length,
  1,
  "icon-sized image dropped, unknown-size image kept"
);

console.log("image extraction tests passed");
console.log("\nPARSER TESTS PASSED");

// ============================================================
// markdownToBlocks
// ============================================================

const markdownFixture = [
  "# Title One",
  "",
  "Some intro with [a link](https://example.com/doc) and **bold** plus *italic* and `inline code`.",
  "",
  "## Section Two",
  "",
  "- alpha",
  "- bravo with **bold**",
  "- charlie",
  "",
  "1. first",
  "2. second",
  "",
  "![Diagram of the system](https://example.com/diagram.png)",
  "",
  "```js",
  "const x = 1;",
  "console.log(x);",
  "```",
  "",
  "> Quoted wisdom.",
  "",
  "---",
  "",
  "GFM strikes ~~struck~~ through.",
  "",
  "| Model | Score |",
  "| --- | --- |",
  "| Fable 5 | 98 |",
].join("\n");

const mdBlocks = markdownToBlocks(markdownFixture);

assert.deepEqual(
  mdBlocks.map((b) => b.type),
  [
    "heading", // h1
    "paragraph", // intro with link/bold/italic/code
    "heading", // h2
    "list", // unordered
    "list", // ordered
    "image", // markdown image
    "code", // fenced code block
    "quote", // blockquote
    "rule", // ---
    "paragraph", // strikethrough (gfm)
    "paragraph", // gfm table header row
    "paragraph", // gfm table body row
  ],
  "markdown block types in order"
);

// ---- Headings ----
const mdH1 = mdBlocks[0] as Extract<Block, { type: "heading" }>;
assert.equal(mdH1.level, 1);
assert.equal(spanText(mdH1.spans), "Title One");
const mdH2 = mdBlocks[2] as Extract<Block, { type: "heading" }>;
assert.equal(mdH2.level, 2);
assert.equal(spanText(mdH2.spans), "Section Two");

// ---- Inline styling: link, bold, italic, code ----
const mdIntro = mdBlocks[1] as Extract<Block, { type: "paragraph" }>;
assert.equal(
  spanText(mdIntro.spans),
  "Some intro with a link and bold plus italic and inline code."
);
const mdLink = mdIntro.spans.find((s) => s.href !== undefined);
assert.ok(mdLink, "markdown link span exists");
assert.equal(mdLink!.text, "a link");
assert.equal(mdLink!.href, "https://example.com/doc");
assert.deepEqual(
  mdIntro.spans.find((s) => s.bold),
  { text: "bold", bold: true }
);
assert.deepEqual(
  mdIntro.spans.find((s) => s.italic),
  { text: "italic", italic: true }
);
assert.deepEqual(
  mdIntro.spans.find((s) => s.code),
  { text: "inline code", code: true }
);

// ---- Lists ----
const mdUl = mdBlocks[3] as Extract<Block, { type: "list" }>;
assert.equal(mdUl.ordered, false);
assert.deepEqual(mdUl.items.map(spanText), [
  "alpha",
  "bravo with bold",
  "charlie",
]);
assert.deepEqual(mdUl.items[1][1], { text: "bold", bold: true });
const mdOl = mdBlocks[4] as Extract<Block, { type: "list" }>;
assert.equal(mdOl.ordered, true);
assert.deepEqual(mdOl.items.map(spanText), ["first", "second"]);

// ---- Markdown image comes through as an image block ----
const mdImage = mdBlocks[5] as Extract<Block, { type: "image" }>;
assert.equal(mdImage.src, "https://example.com/diagram.png");
assert.equal(mdImage.alt, "Diagram of the system");

// ---- Code fence preserved verbatim ----
const mdCode = mdBlocks[6] as Extract<Block, { type: "code" }>;
assert.equal(mdCode.text, "const x = 1;\nconsole.log(x);");

// ---- Quote / rule ----
const mdQuote = mdBlocks[7] as Extract<Block, { type: "quote" }>;
assert.equal(spanText(mdQuote.spans), "Quoted wisdom.");
assert.equal(mdBlocks[8].type, "rule");

// ---- GFM: strikethrough tokenized (tildes gone), tables flattened ----
const mdStruck = mdBlocks[9] as Extract<Block, { type: "paragraph" }>;
assert.equal(spanText(mdStruck.spans), "GFM strikes struck through.");
const mdTableHeader = mdBlocks[10] as Extract<Block, { type: "paragraph" }>;
assert.equal(spanText(mdTableHeader.spans), "Model · Score");
assert.deepEqual(mdTableHeader.spans[0], { text: "Model", bold: true });
assert.equal(
  spanText((mdBlocks[11] as typeof mdTableHeader).spans),
  "Fable 5 · 98"
);

console.log("markdownToBlocks tests passed");

// ============================================================
// firecrawlToArticle
// ============================================================

// ---- html preferred over markdown when both are present ----
const fromHtml = firecrawlToArticle({
  html: "<h1>HTML Title</h1><p>From the html branch.</p>",
  markdown: "# MD Title\n\nFrom the markdown branch.",
  metadata: { sourceURL: "https://blog.example.com/post" },
});
assert.deepEqual(
  fromHtml.blocks.map((b) => b.type),
  ["heading", "paragraph"]
);
assert.equal(
  blockText(fromHtml.blocks[1]),
  "From the html branch.",
  "html wins over markdown"
);
assert.equal(fromHtml.title, "HTML Title", "title from first heading block");
assert.equal(fromHtml.siteName, "blog.example.com", "siteName from sourceURL");
assert.equal(fromHtml.excerpt, undefined);

// ---- markdown-only PDF-ish input (Firecrawl returns no html for PDFs) ----
const fromPdf = firecrawlToArticle({
  html: null,
  markdown: [
    "# Attention Is All You Need",
    "",
    "## Abstract",
    "",
    "The dominant sequence transduction models are based on complex",
    "recurrent or convolutional neural networks.",
    "",
    "![Figure 1: The Transformer](https://arxiv.org/fig1.png)",
    "",
    "- encoder",
    "- decoder",
  ].join("\n"),
  metadata: {
    title: "1706.03762v7.pdf",
    sourceURL: "https://arxiv.org/pdf/1706.03762",
  },
});
assert.equal(fromPdf.title, "1706.03762v7.pdf", "metadata.title wins");
assert.equal(fromPdf.siteName, "arxiv.org");
assert.deepEqual(
  fromPdf.blocks.map((b) => b.type),
  ["heading", "heading", "paragraph", "image", "list"]
);
const pdfImage = fromPdf.blocks[3] as Extract<Block, { type: "image" }>;
assert.equal(pdfImage.src, "https://arxiv.org/fig1.png");

// ---- html that produces zero blocks falls back to markdown ----
const rescued = firecrawlToArticle({
  html: "<div><script>nope();</script></div>",
  markdown: "# Rescue\n\nBody text.",
});
assert.equal(rescued.title, "Rescue");
assert.deepEqual(
  rescued.blocks.map((b) => b.type),
  ["heading", "paragraph"]
);

// ---- Title derivation chain ----
assert.equal(
  firecrawlToArticle({
    html: "<h1>Heading Title</h1><p>x</p>",
    metadata: { title: "Meta Title", ogTitle: "OG Title" },
  }).title,
  "Meta Title",
  "metadata.title wins over ogTitle and heading"
);
assert.equal(
  firecrawlToArticle({
    html: "<h1>Heading Title</h1><p>x</p>",
    metadata: { ogTitle: "OG Title" },
  }).title,
  "OG Title",
  "ogTitle wins over heading"
);
assert.equal(
  firecrawlToArticle({
    html: "<p>no headings here</p>",
    metadata: { sourceURL: "https://example.com/x" },
  }).title,
  "https://example.com/x",
  "sourceURL when no metadata title and no heading"
);
assert.equal(
  firecrawlToArticle({ markdown: "Just a paragraph." }).title,
  "Untitled",
  "last-resort title"
);
assert.equal(
  firecrawlToArticle({
    html: "<p>blank title treated as missing</p>",
    metadata: { title: "   ", ogTitle: "OG Title" },
  }).title,
  "OG Title",
  "whitespace-only metadata.title ignored"
);

// ---- Excerpt: description preferred over ogDescription ----
assert.equal(
  firecrawlToArticle({
    html: "<p>x</p>",
    metadata: { description: "Desc", ogDescription: "OG Desc" },
  }).excerpt,
  "Desc"
);
assert.equal(
  firecrawlToArticle({
    html: "<p>x</p>",
    metadata: { ogDescription: "OG Desc" },
  }).excerpt,
  "OG Desc"
);

// ---- siteName derivation ----
assert.equal(
  firecrawlToArticle({
    html: "<p>x</p>",
    metadata: { sourceURL: "https://WWW.Example.com:8080/path?q=1" },
  }).siteName,
  "www.example.com",
  "hostname lowercased, port/path stripped"
);
assert.equal(
  firecrawlToArticle({ html: "<p>x</p>" }).siteName,
  undefined,
  "no siteName without sourceURL"
);

// ---- Throws on empty / unparseable content ----
assert.throws(() => firecrawlToArticle({}), /both html and markdown are empty/);
assert.throws(
  () => firecrawlToArticle({ html: "", markdown: "   " }),
  /both html and markdown are empty/
);
assert.throws(
  () => firecrawlToArticle({ html: null, markdown: null }),
  /both html and markdown are empty/
);
assert.throws(
  () =>
    firecrawlToArticle({
      html: "<script>x()</script>",
      metadata: { sourceURL: "https://example.com/empty" },
    }),
  /zero readable blocks.*https:\/\/example\.com\/empty/,
  "zero-block html with no markdown fallback throws"
);

console.log("firecrawlToArticle tests passed");

// ============================================================
// buildDocumentOutline
// ============================================================

const outline = buildDocumentOutline([
  { type: "paragraph", spans: [{ text: "Preface" }] },
  {
    type: "heading",
    level: 2,
    spans: [{ text: "1 " }, { text: "Introduction", bold: true }],
  },
  { type: "paragraph", spans: [{ text: "Body" }] },
  {
    type: "heading",
    level: 4,
    spans: [{ text: "  1.1   Training data  " }],
  },
  { type: "heading", level: 3, spans: [{ text: "Risk & safety" }] },
  { type: "heading", level: 3, spans: [{ text: "Risk & safety" }] },
]);

assert.deepEqual(outline, [
  {
    id: "section-2-1-introduction",
    blockIndex: 1,
    title: "1 Introduction",
    level: 2,
    depth: 0,
  },
  {
    id: "section-4-1-1-training-data",
    blockIndex: 3,
    title: "1.1 Training data",
    level: 4,
    depth: 2,
  },
  {
    id: "section-5-risk-safety",
    blockIndex: 4,
    title: "Risk & safety",
    level: 3,
    depth: 1,
  },
  {
    id: "section-6-risk-safety",
    blockIndex: 5,
    title: "Risk & safety",
    level: 3,
    depth: 1,
  },
]);
assert.deepEqual(
  buildDocumentOutline([
    { type: "heading", level: 1, spans: [{ text: "   " }] },
  ]),
  [],
  "blank headings are omitted"
);
assert.deepEqual(
  buildDocumentOutline([
    { type: "heading", level: 4, spans: [{ text: "Abstract" }] },
    { type: "heading", level: 2, spans: [{ text: "Chapter one" }] },
  ]).map((entry) => entry.depth),
  [2, 0],
  "depth normalizes to the shallowest heading even when it isn't first"
);
assert.equal(
  buildDocumentOutline([
    { type: "heading", level: 2, spans: [{ text: "5 ㎒ explained" }] },
  ])[0].id,
  "section-1-5-mhz-explained",
  "NFKD decomposition runs before lowercasing"
);
const longSlugId = buildDocumentOutline([
  {
    type: "heading",
    level: 2,
    spans: [
      {
        text: "How we built the new document outline for very long PDF chapter abc",
      },
    ],
  },
])[0].id;
assert.ok(
  !longSlugId.endsWith("-"),
  `truncated slugs drop the dangling hyphen (got ${longSlugId})`
);

console.log("buildDocumentOutline tests passed");

// ============================================================
// inferDocumentHeadings
// ============================================================

const paragraph = (text: string): Block => ({
  type: "paragraph",
  spans: [{ text }],
});
const inferred = inferDocumentHeadings([
  paragraph("System card title"),
  paragraph("Executive Summary"),
  paragraph("Contents"),
  paragraph("2.3.4 External testing 45 2.4 Alignment risk update 55"),
  paragraph("1 Introduction"),
  paragraph("Opening body."),
  paragraph("1.1 Training data and process"),
  paragraph("Training body."),
  paragraph("1 Note that:"),
  paragraph("2 RSP evaluations"),
  paragraph("2.1 Risk assessment process"),
  paragraph(
    "3 We re-run this evaluation upon finding a bug. See section 2.3.7.1 for details."
  ),
  paragraph("3 Cyber"),
  paragraph("3.1 Introduction"),
  paragraph(
    "3.1.1 Capabilities This paragraph was merged into the heading and is intentionally much too long to promote because treating the whole body as a heading would damage the reader. It continues with enough ordinary prose to exceed the conservative heading-length limit."
  ),
  paragraph("4.8 and Opus 4.7 performed similarly in this evaluation."),
  paragraph("4 Safeguards and harmlessness"),
]);

assert.deepEqual(
  inferred
    .map((block, index) =>
      block.type === "heading"
        ? { index, level: block.level, text: spanText(block.spans) }
        : null
    )
    .filter(Boolean),
  [
    { index: 1, level: 1, text: "Executive Summary" },
    { index: 4, level: 1, text: "1 Introduction" },
    { index: 6, level: 2, text: "1.1 Training data and process" },
    { index: 9, level: 1, text: "2 RSP evaluations" },
    { index: 10, level: 2, text: "2.1 Risk assessment process" },
    { index: 12, level: 1, text: "3 Cyber" },
    { index: 13, level: 2, text: "3.1 Introduction" },
    { index: 16, level: 1, text: "4 Safeguards and harmlessness" },
  ],
  "paragraph-only PDF sections become headings without promoting TOC fragments, footnotes, or merged body text"
);
const nativeHeadingBlocks: Block[] = [
  { type: "heading", level: 2, spans: [{ text: "Native heading" }] },
  paragraph("Body"),
];
assert.equal(
  inferDocumentHeadings(nativeHeadingBlocks),
  nativeHeadingBlocks,
  "documents with native headings remain unchanged"
);

console.log("inferDocumentHeadings tests passed");

// ════════════════════════════════════════════════════════════════════
// buildExportMarkdown — voice memos
// ════════════════════════════════════════════════════════════════════
{
  const memoArticle = {
    title: "Memo Article",
    url: "https://example.com/memo",
    savedAt: 1750000000000,
    blocks: [
      { type: "paragraph", spans: [{ text: "First paragraph." }] },
      { type: "paragraph", spans: [{ text: "Second paragraph." }] },
    ] as Block[],
  };
  const layouts = new Map([
    [0, { y: 0, height: 100 }],
    [1, { y: 120, height: 100 }],
  ]);
  const annotations = {
    ...emptyAnnotations(800),
    memos: [
      {
        id: "m2",
        x: 10,
        y: 150,
        durationMs: 12000,
        transcript: "Check this claim against the appendix.",
        status: "uploaded" as const,
        createdAt: 1750000001000,
      },
      {
        id: "m1",
        x: 10,
        y: 10,
        durationMs: 4000,
        transcript: "   ",
        status: "local" as const,
        createdAt: 1750000002000,
      },
    ],
  };
  const markdown = buildExportMarkdown(memoArticle, annotations, layouts, 1);
  assert.ok(markdown.includes("## Voice memos"), "memo section present");
  assert.ok(
    markdown.includes(
      `- 🎤 "Check this claim against the appendix." — near: "Second paragraph."`
    ),
    "memo transcript exported with nearby block context"
  );
  assert.equal(
    markdown.match(/- 🎤/g)?.length,
    1,
    "empty-transcript memos are skipped"
  );
  const noMemos = buildExportMarkdown(
    memoArticle,
    emptyAnnotations(800),
    layouts,
    1
  );
  assert.ok(
    !noMemos.includes("## Voice memos"),
    "no memo section without memos"
  );
  console.log("buildExportMarkdown memo tests passed");
}

// ---- blocksToMarkdown ----
{
  const blocks: Block[] = [
    { type: "heading", level: 2, spans: [{ text: "Results" }] },
    {
      type: "paragraph",
      spans: [
        { text: "Parsing is " },
        { text: "fast", bold: true },
        { text: " — see " },
        { text: "the docs", href: "https://example.com/docs" },
        { text: "." },
      ],
    },
    { type: "quote", spans: [{ text: "First line\nSecond line" }] },
    {
      type: "list",
      ordered: true,
      items: [[{ text: "one" }], [{ text: "two", italic: true }]],
    },
    { type: "list", ordered: false, items: [[{ text: "bullet" }]] },
    { type: "code", text: "const x = 1;" },
    {
      type: "image",
      src: "https://example.com/a.png",
      alt: "chart",
      caption: "Fig 1",
    },
    { type: "rule" },
    { type: "paragraph", spans: [{ text: "inline " }, { text: "code", code: true }] },
  ];
  const markdown = blocksToMarkdown(blocks);
  const expected = [
    "## Results",
    "Parsing is **fast** — see [the docs](https://example.com/docs).",
    "> First line\n> Second line",
    "1. one\n2. *two*",
    "- bullet",
    "```\nconst x = 1;\n```",
    "![chart](https://example.com/a.png)\n*Fig 1*",
    "---",
    "inline `code`",
  ].join("\n\n");
  assert.equal(markdown, expected, "blocksToMarkdown serializes every block type");

  // Round-trip sanity: markdown → blocks → markdown is stable for plain content.
  const roundTrip = blocksToMarkdown(
    markdownToBlocks("# Title\n\nA *styled* paragraph.")
  );
  assert.equal(
    roundTrip,
    "# Title\n\nA *styled* paragraph.",
    "round-trips through markdownToBlocks"
  );

  // Blocks that serialize to nothing are dropped, not left as blank gaps.
  assert.equal(
    blocksToMarkdown([{ type: "paragraph", spans: [] }, { type: "rule" }]),
    "---",
    "empty blocks are dropped"
  );

  // Code containing fence runs must not terminate the wrapping fence early.
  assert.equal(
    blocksToMarkdown([
      { type: "code", text: "```js\nlet a = 1;\n```" },
      { type: "paragraph", spans: [{ text: "after" }] },
    ]),
    "````\n```js\nlet a = 1;\n```\n````\n\nafter",
    "fence outruns embedded backtick runs"
  );

  // Inline code spans: delimiter outruns interior backticks; content
  // touching a backtick at either end gets space padding (CommonMark).
  assert.equal(
    blocksToMarkdown([
      {
        type: "paragraph",
        spans: [
          { text: "foo`bar", code: true },
          { text: " and " },
          { text: "`lead", code: true },
        ],
      },
    ]),
    "``foo`bar`` and `` `lead ``",
    "inline code handles interior and edge backticks"
  );
  console.log("blocksToMarkdown tests passed");
}

// ════════════════════════════════════════════════════════════════════
// resolveAnnotations + parseLayoutSnapshot
// ════════════════════════════════════════════════════════════════════
{
  const anchorBlocks: Block[] = [
    { type: "heading", level: 1, spans: [{ text: "Intro" }] },
    { type: "paragraph", spans: [{ text: "The quick brown fox." }] },
    { type: "heading", level: 2, spans: [{ text: "Details" }] },
    { type: "paragraph", spans: [{ text: "Jumps over the lazy dog." }] },
  ];
  const snapshot = parseLayoutSnapshot(
    JSON.stringify({
      width: 800,
      layouts: [
        [0, { y: 0, height: 40 }],
        [1, { y: 40, height: 60 }],
        [2, { y: 100, height: 40 }],
        [3, { y: 140, height: 60 }],
      ],
    })
  );
  assert.ok(snapshot, "layout snapshot parses");
  const resolved = resolveAnnotations(
    anchorBlocks,
    {
      ...emptyAnnotations(800),
      boxes: [{ id: "b1", x: 0, y: 45, w: 780, h: 50 }],
      notes: [{ id: "n1", x: 5, y: 70, text: "Important point" }],
    },
    snapshot!.layouts,
    snapshot!.width / 800
  );
  assert.deepEqual(resolved, [
    {
      id: "b1",
      type: "box",
      selectedText: "The quick brown fox.",
      sectionHeading: "Intro",
      startOffset: 7,
      endOffset: 27,
      boundingBox: { x: 0, y: 45, w: 780, h: 50 },
    },
    {
      id: "n1",
      type: "typed_note",
      note: "Important point",
      nearbyText: "The quick brown fox.",
      sectionHeading: "Intro",
      startOffset: 7,
      endOffset: 27,
      boundingBox: { x: 5, y: 70, w: 0, h: 0 },
    },
  ]);

  // A box farther down resolves to the second section's text + heading.
  const inSection = resolveAnnotations(
    anchorBlocks,
    { ...emptyAnnotations(800), boxes: [{ id: "b2", x: 0, y: 145, w: 780, h: 50 }] },
    snapshot!.layouts,
    1
  );
  assert.equal(inSection[0].selectedText, "Jumps over the lazy dog.");
  assert.equal(inSection[0].sectionHeading, "Details");
  assert.equal(inSection[0].startOffset, 38);
  assert.equal(inSection[0].endOffset, 62);

  // Malformed / missing snapshots return null.
  assert.equal(parseLayoutSnapshot(undefined), null, "undefined snapshot");
  assert.equal(parseLayoutSnapshot("not json"), null, "non-JSON snapshot");
  assert.equal(
    parseLayoutSnapshot(JSON.stringify({ width: 0, layouts: [] })),
    null,
    "empty snapshot"
  );

  // With no layout map, geometry and note text still resolve; anchor fields
  // are absent (the MCP reports anchored:false in this case).
  const geomOnly = resolveAnnotations(
    anchorBlocks,
    { ...emptyAnnotations(800), notes: [{ id: "n1", x: 5, y: 70, text: "Loose" }] },
    new Map(),
    1
  );
  assert.deepEqual(geomOnly, [
    {
      id: "n1",
      type: "typed_note",
      note: "Loose",
      nearbyText: undefined,
      sectionHeading: undefined,
      boundingBox: { x: 5, y: 70, w: 0, h: 0 },
    },
  ]);

  // Malformed entries are skipped without throwing.
  const robust = resolveAnnotations(
    anchorBlocks,
    {
      ...emptyAnnotations(800),
      notes: [null, { y: 10 }, { id: "ok", x: 0, y: 70, text: "Kept" }] as never,
    },
    snapshot!.layouts,
    1
  );
  assert.equal(robust.length, 1, "only the well-formed note survives");
  assert.equal(robust[0].note, "Kept");
  console.log("resolveAnnotations tests passed");
}

// ════════════════════════════════════════════════════════════════════
// Zod schemas/codecs + throwing-boundary adapters
// ════════════════════════════════════════════════════════════════════
{
  const everyBlockVariant: Block[] = [
    {
      type: "heading",
      level: 6,
      spans: [
        {
          text: "Heading",
          bold: true,
          italic: true,
          code: true,
          href: "https://example.com",
        },
      ],
    },
    { type: "paragraph", spans: [{ text: "Paragraph" }] },
    { type: "quote", spans: [{ text: "Quote" }] },
    {
      type: "list",
      ordered: true,
      items: [[{ text: "One" }], [{ text: "Two", italic: true }]],
    },
    {
      type: "image",
      src: "https://example.com/image.png",
      alt: "Alt",
      caption: "Caption",
      width: 640,
      height: 480,
    },
    { type: "code", text: "const value = 1;" },
    { type: "rule" },
  ];

  for (const block of everyBlockVariant) {
    assert.ok(
      BlockSchema.safeParse(block).success,
      `${block.type} block satisfies BlockSchema`
    );
  }
  assert.ok(
    !BlockSchema.safeParse({
      type: "heading",
      level: 7,
      spans: [{ text: "bad" }],
    }).success,
    "invalid heading level fails BlockSchema"
  );
  assert.ok(
    !BlockSchema.safeParse({ type: "unknown" }).success,
    "unknown block variant fails BlockSchema"
  );
  assert.ok(
    !BlockSchema.safeParse({
      type: "image",
      src: "https://example.com/non-finite.png",
      width: Number.POSITIVE_INFINITY,
    }).success,
    "non-finite block dimensions fail BlockSchema"
  );

  const article = {
    title: "All variants",
    byline: "Inkwell",
    siteName: "example.com",
    excerpt: "Schema fixture",
    blocks: everyBlockVariant,
  };
  assert.deepEqual(
    ArticleContentJsonSchema.parse(JSON.stringify(article)),
    article,
    "article JSON codec decodes all block variants"
  );
  assert.throws(
    () =>
      ArticleContentJsonSchema.parse(
        JSON.stringify({
          ...article,
          blocks: [{ type: "heading", level: 0, spans: [] }],
        })
      ),
    /heading|level|literal/i,
    "invalid block JSON fails the article codec"
  );
  assert.throws(
    () => ArticleContentJsonSchema.parse("{not json"),
    /json/i,
    "malformed article JSON fails the codec"
  );

  const annotations = {
    contentWidth: 800,
    strokes: [
      {
        id: "s1",
        tool: "highlighter",
        color: "#ff0",
        width: 12,
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
      },
    ],
    boxes: [{ id: "b1", x: 1, y: 2, w: 3, h: 4 }],
    notes: [{ id: "n1", x: 5, y: 6, text: "Remember this" }],
    memos: [
      {
        id: "m1",
        x: 7,
        y: 8,
        durationMs: 9000,
        transcript: "",
        status: "local",
        createdAt: 1750000000000,
      },
    ],
  };
  assert.deepEqual(
    AnnotationsJsonSchema.parse(JSON.stringify(annotations)),
    annotations,
    "annotations JSON codec covers strokes, boxes, notes, and voice memos"
  );
  assert.throws(
    () =>
      AnnotationsJsonSchema.parse(
        JSON.stringify({
          ...annotations,
          strokes: [{ ...annotations.strokes[0], tool: "pencil" }],
        })
      ),
    /tool|literal/i,
    "invalid annotation variants fail decoding"
  );
  assert.throws(
    () => AnnotationsJsonSchema.parse("[]"),
    /object|struct/i,
    "wrong annotations JSON shape fails decoding"
  );
  assert.ok(
    !BoxAnnotationSchema.safeParse({
      id: "infinite",
      x: Number.POSITIVE_INFINITY,
      y: 1,
      w: 2,
      h: 3,
    }).success,
    "non-finite annotation coordinates fail shared schemas"
  );
  assert.throws(
    () =>
      AnnotationsJsonSchema.parse(
        JSON.stringify({ ...annotations, contentWidth: 0 })
      ),
    /contentWidth|greater than/i,
    "non-positive annotation widths fail shared schemas"
  );

  const tolerantNotes = decodeTolerantJsonArray(
    JSON.stringify([
      { id: "n1", x: 1, y: 2, text: "First" },
      { id: "bad", x: "nope", y: 3, text: "Skipped" },
      null,
      { id: "n2", x: 4, y: 5, text: "Second" },
    ]),
    NoteAnnotationSchema
  );
  assert.ok(
    Option.isSome(tolerantNotes),
    "valid annotation array survives malformed individual items"
  );
  assert.deepEqual(
    Option.getOrElse(tolerantNotes, () => []),
    [
      { id: "n1", x: 1, y: 2, text: "First" },
      { id: "n2", x: 4, y: 5, text: "Second" },
    ],
    "tolerant annotation decoder skips malformed siblings"
  );
  assert.ok(
    Option.isNone(decodeTolerantJsonArray("{}", NoteAnnotationSchema)),
    "tolerant annotation decoder still rejects a non-array top level"
  );
  assert.ok(
    Option.isNone(decodeTolerantJsonArray("not json", NoteAnnotationSchema)),
    "tolerant annotation decoder still rejects malformed JSON"
  );

  const strictLayoutJson = JSON.stringify({
    width: 800,
    layouts: [
      [0, { y: 0, height: 20 }],
      [1, { y: 20, height: 30 }],
    ],
  });
  assert.deepEqual(
    LayoutSnapshotJsonSchema.parse(strictLayoutJson),
    {
      width: 800,
      layouts: [
        [0, { y: 0, height: 20 }],
        [1, { y: 20, height: 30 }],
      ],
    },
    "strict layout JSON codec accepts a complete snapshot"
  );
  assert.throws(
    () =>
      LayoutSnapshotJsonSchema.parse(
        JSON.stringify({
          width: 800,
          layouts: [[0, { y: 0, height: 0 }]],
        })
      ),
    /height|greater than/i,
    "strict layout codec rejects invalid entries"
  );

  const tolerantLayout = parseLayoutSnapshot(
    JSON.stringify({
      width: 800,
      layouts: [
        ["bad", { y: 0, height: 20 }],
        [0, { y: 0, height: 20 }],
        [1, { y: "bad", height: 30 }],
        [2, { y: 40, height: -1 }],
      ],
    })
  );
  assert.ok(tolerantLayout, "valid layout entries survive malformed siblings");
  assert.deepEqual(
    [...tolerantLayout!.layouts],
    [[0, { y: 0, height: 20 }]],
    "malformed individual layout entries are ignored"
  );
  assert.equal(
    parseLayoutSnapshot(
      JSON.stringify({
        width: 800,
        layouts: [["bad", { y: 0, height: 20 }]],
      })
    ),
    null,
    "snapshot with no valid entries remains null"
  );
  assert.equal(
    parseLayoutSnapshot(
      JSON.stringify({
        width: "800",
        layouts: [[0, { y: 0, height: 20 }]],
      })
    ),
    null,
    "invalid top-level layout shape remains null"
  );

  assert.deepEqual(
    FirecrawlDocumentJsonSchema.parse(
      JSON.stringify({
        html: null,
        markdown: "# Valid",
        metadata: {
          title: "Valid",
          description: null,
          ogTitle: null,
          ogDescription: null,
          sourceURL: "https://example.com/doc",
        },
      })
    ),
    {
      html: null,
      markdown: "# Valid",
      metadata: {
        title: "Valid",
        description: null,
        ogTitle: null,
        ogDescription: null,
        sourceURL: "https://example.com/doc",
      },
    },
    "Firecrawl input JSON codec accepts the consumed payload slice"
  );
  assert.throws(
    () =>
      FirecrawlDocumentJsonSchema.parse(JSON.stringify({ html: 42 })),
    /html|string/i,
    "Firecrawl input codec rejects invalid content fields"
  );
  assert.throws(
    () => FirecrawlDocumentJsonSchema.parse("not json"),
    /json/i,
    "malformed Firecrawl JSON fails decoding"
  );

  const parityHtml = "<h2>Parity</h2><p>Same output.</p>";
  assert.deepEqual(
    Effect.runSync(htmlToBlocksEffect(parityHtml)),
    htmlToBlocks(parityHtml),
    "HTML sync and Effect adapters are equivalent"
  );
  const parityMarkdown = "## Parity\n\nSame output.";
  assert.deepEqual(
    Effect.runSync(markdownToBlocksEffect(parityMarkdown)),
    markdownToBlocks(parityMarkdown),
    "Markdown sync and Effect adapters are equivalent"
  );
  const parityFirecrawl = {
    html: "<h1>Effect parity</h1><p>Body.</p>",
    markdown: "# Ignored",
    metadata: {
      description: "Description",
      sourceURL: "https://example.com/parity",
    },
  };
  assert.deepEqual(
    Effect.runSync(firecrawlToArticleEffect(parityFirecrawl)),
    firecrawlToArticle(parityFirecrawl),
    "Firecrawl sync and Effect normalization are equivalent"
  );
  const explicitUndefinedFirecrawl = {
    html: undefined,
    markdown: "# Explicit undefined\n\nStill valid.",
    metadata: undefined,
  };
  assert.deepEqual(
    Effect.runSync(firecrawlToArticleEffect(explicitUndefinedFirecrawl)),
    firecrawlToArticle(explicitUndefinedFirecrawl),
    "Effect normalization accepts explicit undefined optional fields"
  );
  assert.deepEqual(
    Effect.runSync(parseLayoutSnapshotEffect(strictLayoutJson)),
    parseLayoutSnapshot(strictLayoutJson),
    "layout sync and Effect adapters are equivalent"
  );
  assert.equal(
    Effect.runSync(parseLayoutSnapshotEffect("not json")),
    null,
    "layout Effect adapter preserves tolerant malformed-JSON behavior"
  );

  const normalizationError = Effect.runSync(
    Effect.flip(firecrawlToArticleEffect({}))
  );
  assert.equal(
    normalizationError._tag,
    "FirecrawlNormalizationError",
    "normalization failures use a tagged error"
  );
  assert.ok(
    normalizationError.message.includes("both html and markdown are empty"),
    "normalization error preserves the sync failure message"
  );
  const schemaError = Effect.runSync(
    Effect.flip(firecrawlToArticleEffect({ html: 42 }))
  );
  assert.equal(
    schemaError._tag,
    "ContentSchemaError",
    "invalid normalization input uses a tagged schema error"
  );
  const parserError = Effect.runSync(
    Effect.flip(markdownToBlocksEffect(null as never))
  );
  assert.equal(
    parserError._tag,
    "ContentParserError",
    "throwing parser boundaries use a tagged parser error"
  );
  assert.equal(parserError.parser, "markdown");

  console.log("Zod schema and Effect adapter tests passed");
}

console.log("\nALL CONTENT TESTS PASSED");
