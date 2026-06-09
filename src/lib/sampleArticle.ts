// A bundled sample article so the app is usable (and testable) before the
// first real URL is saved. Seeded with a fixed id.
import Storage from "expo-sqlite/kv-store";

import { getArticle, saveArticle } from "./storage";
import type { Article } from "./types";

const SEEDED_FLAG = "sample-seeded";

/** Adds the sample article on first launch only (re-deleting it sticks). */
export async function seedSampleArticleOnce(): Promise<void> {
  try {
    if (await Storage.getItem(SEEDED_FLAG)) return;
    if (!(await getArticle(SAMPLE_ARTICLE_ID))) {
      await saveArticle(sampleArticle);
    }
    await Storage.setItem(SEEDED_FLAG, "1");
  } catch {
    // Non-fatal; the library's empty state offers the sample too.
  }
}

export const SAMPLE_ARTICLE_ID = "sample";

export const sampleArticle: Article = {
  id: SAMPLE_ARTICLE_ID,
  url: "https://en.wikipedia.org/wiki/Marginalia",
  title: "Marginalia: Notes in the Margins",
  byline: "A bundled sample",
  siteName: "Inkwell",
  excerpt:
    "A short tour of what this app does — save articles, read them comfortably, and mark them up with your Apple Pencil.",
  savedAt: "2026-06-09T12:00:00.000Z",
  blocks: [
    {
      type: "paragraph",
      spans: [
        {
          text: "Marginalia are the notes readers scribble in the margins of a text — questions, arguments, stars next to the passages that matter. This app brings that habit to everything you read on the web.",
        },
      ],
    },
    {
      type: "paragraph",
      spans: [
        { text: "Paste a URL on the library screen and Inkwell downloads the " },
        { text: "core article content", bold: true },
        {
          text: " — no ads, no popups, no sidebars — and lays it out in a clean reader like this one.",
        },
      ],
    },
    { type: "heading", level: 2, spans: [{ text: "Marking things up" }] },
    {
      type: "paragraph",
      spans: [
        { text: "Use the toolbar at the bottom of the screen. The " },
        { text: "pen", italic: true },
        { text: " scribbles ink anywhere, the " },
        { text: "highlighter", italic: true },
        { text: " sweeps translucent color over lines, and the " },
        { text: "box", italic: true },
        {
          text: " tool drags a rectangle around a section to flag it as a key, critical piece.",
        },
      ],
    },
    {
      type: "list",
      ordered: false,
      items: [
        [{ text: "Pen — freehand ink, four colors" }],
        [{ text: "Highlighter — wide translucent strokes" }],
        [{ text: "Box — frame a section as critical" }],
        [{ text: "Note — tap to pin a typed note" }],
        [{ text: "Eraser — drag across anything to remove it" }],
      ],
    },
    {
      type: "quote",
      spans: [
        {
          text: "The marginalia of great readers are often more interesting than the books themselves.",
        },
      ],
    },
    { type: "heading", level: 2, spans: [{ text: "Getting it back out" }] },
    {
      type: "paragraph",
      spans: [
        {
          text: "When you're done, the export button in the header turns your boxes and notes into Markdown — the boxed passages quoted in full — ready to paste into an LLM conversation.",
        },
      ],
    },
    {
      type: "code",
      text: "## Key sections\n> Pen — freehand ink, four colors\n> Box — frame a section as critical\n\n## My notes\n- \"compare this to the PencilKit approach\"",
    },
    { type: "rule" },
    {
      type: "paragraph",
      spans: [
        { text: "Try it now: grab the pencil from the toolbar below and scribble on this page. Everything you draw is saved automatically." },
      ],
    },
  ],
};
