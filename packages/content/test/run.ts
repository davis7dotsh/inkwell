// Tests for @inkwell/content. Run with: pnpm --filter @inkwell/content test

// @ts-ignore -- @types/node is not installed in this package; tsx provides
// the real implementation at runtime.
import nodeAssert from "node:assert/strict";

import { buildExportMarkdown } from "../src/exportMarkdown";
import { htmlToBlocks } from "../src/htmlToBlocks";
import { markdownToBlocks } from "../src/markdownToBlocks";
import { firecrawlToArticle } from "../src/normalize";
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

console.log("\nALL CONTENT TESTS PASSED");
