import * as Effect from "effect/Effect";

import { MobileFiles, MobileNative } from "../effect/services";

export const readClipboardText = Effect.gen(function* () {
  const native = yield* MobileNative;
  return yield* native.getClipboardText;
});

export const writeClipboardText = (value: string) =>
  Effect.gen(function* () {
    const native = yield* MobileNative;
    yield* native.setClipboardText(value);
  });

export const pickPdf = Effect.gen(function* () {
  const native = yield* MobileNative;
  return yield* native.pickPdf;
});

export const openUrl = (url: string) =>
  Effect.gen(function* () {
    const native = yield* MobileNative;
    yield* native.openUrl(url);
  });

export const openBrowser = (url: string) =>
  Effect.gen(function* () {
    const native = yield* MobileNative;
    yield* native.openBrowser(url);
  });

export const warmBrowser = Effect.gen(function* () {
  const native = yield* MobileNative;
  yield* native.warmBrowser;
});

export const coolBrowser = Effect.gen(function* () {
  const native = yield* MobileNative;
  yield* native.coolBrowser;
});

export const shareMarkdown = (input: {
  readonly title: string;
  readonly fileName: string;
  readonly markdown: string;
}) =>
  Effect.gen(function* () {
    const files = yield* MobileFiles;
    const native = yield* MobileNative;
    const fileUrl = yield* files
      .writeMarkdownExport(input.fileName, input.markdown)
      .pipe(
        Effect.map((file) => file.uri),
        Effect.catch((error) =>
          Effect.logWarning("Could not write Markdown export", error).pipe(
            Effect.as(undefined),
          ),
        ),
      );
    yield* native.shareMarkdown({
      title: input.title,
      markdown: input.markdown,
      fileUrl,
    });
  });
