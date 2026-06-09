# Inkwell

Save articles from the web, read them in a clean serif reader, and mark them up
with your Apple Pencil — ink, highlighter, boxes around key sections, and
pinned notes. Export your markups as Markdown to paste into an LLM.

Built with Expo SDK 54 / React Native 0.81 / pnpm. (Pinned to SDK 54 because
that's the newest Expo Go on the App Store.)

Ink-wash palette: deep ink `#0E2E52` · brush blue `#1B4F8A` · stroke blue
`#3D7BC0` · wash `#8FB8DE` · mist `#E4EEF7` · paper `#F7F8F6`.

## Run it

```bash
pnpm install
pnpm start        # then press i for the iOS simulator, or scan the QR in Expo Go on iPad
```

The first launch seeds a sample article that explains the tools. Paste any
article URL on the library screen to save the real thing.

## How it works

**Extraction** — a hidden `WebView` loads the URL (so client-rendered pages
work), then a vendored copy of Mozilla Readability is injected and posts the
cleaned article HTML back (`src/components/ExtractorWebView.tsx`,
`src/lib/extractScript.ts`). Re-vendor with `pnpm vendor:readability`.

**Reader** — the article HTML is parsed once at save time by
`src/lib/htmlToBlocks.ts` (htmlparser2, pure JS) into a typed `Block[]` model,
rendered natively by `src/components/BlockRenderer.tsx`. No WebView at read
time; articles are stored offline.

**Annotation** — all coordinates live in "content space" (relative to the text
column, scaled by the column width recorded at creation), so markups stay
anchored across rotation and screen sizes:

- ink/highlighter strokes render on a viewport-fixed Skia canvas
  counter-translated by the scroll offset via Reanimated
  (`src/components/annotation/StrokesCanvas.tsx`);
- boxes and note bubbles are plain views inside the scroll content;
- a gesture capture layer (active when a tool is selected) turns pans into
  strokes/boxes and taps into notes; the eraser hit-tests everything.

**Persistence** — `expo-sqlite/kv-store`, one key per article + per annotation
set (`src/lib/storage.ts`). Annotations autosave ~600 ms after each change.

**Export** — the share button builds Markdown from the markups: boxed sections
quote the article text they enclose (block layouts are measured at render
time), highlights quote covered passages, notes keep nearby context
(`src/lib/exportMarkdown.ts`).

## Tests

```bash
pnpm tsx scripts/test-parser.ts          # HTML → blocks parser fixtures
pnpm tsx scripts/test-extract-script.mjs # injected-JS syntax check
pnpm tsc --noEmit
```

## Known v1 limits

- Web pages only — no PDFs yet.
- Pen strokes export as positions/counts, not text (no handwriting OCR).
- Tools are mode-based via the toolbar; no pencil-vs-finger detection yet.
- LLM chat is intentionally out of scope for v1 — use the Markdown export.

## License

MIT — see [LICENSE](LICENSE).
