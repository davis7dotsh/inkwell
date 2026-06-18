import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import { fetch as expoFetch, type FetchRequestInit } from "expo/fetch";
import * as Linking from "expo-linking";
import Storage from "expo-sqlite/kv-store";
import * as WebBrowser from "expo-web-browser";
import { Platform, Share } from "react-native";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { mobileConfig } from "./codecs";
import {
  FileOperationError,
  HttpRequestError,
  NativeCommandError,
  StorageOperationError,
  unknownErrorMessage,
} from "./errors";

export class MobileConfig extends Context.Service<
  MobileConfig,
  typeof mobileConfig
>()("Inkwell/MobileConfig") {}

export class MobileHttp extends Context.Service<
  MobileHttp,
  {
    readonly request: (
      operation: string,
      url: string,
      init?: FetchRequestInit,
    ) => Effect.Effect<Response, HttpRequestError>;
  }
>()("Inkwell/MobileHttp") {}

export class MobileFiles extends Context.Service<
  MobileFiles,
  {
    readonly findMemoFile: (
      memoId: string,
    ) => Effect.Effect<File | null, FileOperationError>;
    readonly storeRecording: (
      recordingUri: string,
      memoId: string,
    ) => Effect.Effect<File, FileOperationError>;
    readonly deleteMemoFile: (
      memoId: string,
    ) => Effect.Effect<void, FileOperationError>;
    readonly writeMarkdownExport: (
      name: string,
      markdown: string,
    ) => Effect.Effect<File, FileOperationError>;
  }
>()("Inkwell/MobileFiles") {}

export class MobileKeyValueStore extends Context.Service<
  MobileKeyValueStore,
  {
    readonly get: (
      key: string,
    ) => Effect.Effect<string | null, StorageOperationError>;
    readonly set: (
      key: string,
      value: string,
    ) => Effect.Effect<void, StorageOperationError>;
  }
>()("Inkwell/MobileKeyValueStore") {}

export type PickedPdf = {
  uri: string;
  name: string;
  mimeType?: string;
};

export class MobileNative extends Context.Service<
  MobileNative,
  {
    readonly getClipboardText: Effect.Effect<string, NativeCommandError>;
    readonly setClipboardText: (
      value: string,
    ) => Effect.Effect<void, NativeCommandError>;
    readonly pickPdf: Effect.Effect<PickedPdf | null, NativeCommandError>;
    readonly openUrl: (url: string) => Effect.Effect<void, NativeCommandError>;
    readonly openBrowser: (
      url: string,
    ) => Effect.Effect<void, NativeCommandError>;
    readonly shareMarkdown: (input: {
      title: string;
      markdown: string;
      fileUrl?: string;
    }) => Effect.Effect<void, NativeCommandError>;
    readonly warmBrowser: Effect.Effect<void, NativeCommandError>;
    readonly coolBrowser: Effect.Effect<void, NativeCommandError>;
  }
>()("Inkwell/MobileNative") {}

export class MobileIds extends Context.Service<
  MobileIds,
  {
    readonly make: Effect.Effect<string>;
  }
>()("Inkwell/MobileIds") {}

const fileError =
  (operation: string, path: string) =>
  (error: unknown): FileOperationError =>
    new FileOperationError({
      operation,
      path,
      message: unknownErrorMessage(error),
    });

const nativeCommand = <A>(
  operation: string,
  evaluate: (signal: AbortSignal) => PromiseLike<A>,
) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (error) =>
      new NativeCommandError({
        operation,
        message: unknownErrorMessage(error),
      }),
  });

const MobileConfigLive = Layer.succeed(MobileConfig, mobileConfig);

const MobileHttpLive = Layer.succeed(MobileHttp, {
  request: (operation, url, init) =>
    Effect.tryPromise({
      try: (signal) => expoFetch(url, { ...init, signal }),
      catch: (error) =>
        new HttpRequestError({
          operation,
          url,
          message: unknownErrorMessage(error),
        }),
    }),
});

const MobileFilesLive = Layer.succeed(MobileFiles, {
  findMemoFile: (memoId) =>
    Effect.try({
      try: () => {
        const file = new File(Paths.document, "memos", `${memoId}.m4a`);
        return file.exists ? file : null;
      },
      catch: fileError("find memo", memoId),
    }),
  storeRecording: (recordingUri, memoId) =>
    Effect.try({
      try: () => {
        const directory = new Directory(Paths.document, "memos");
        if (!directory.exists) directory.create({ intermediates: true });
        const source = new File(recordingUri);
        const destination = new File(directory, `${memoId}.m4a`);
        if (destination.exists) destination.delete();
        source.moveSync(destination);
        return destination;
      },
      catch: fileError("store recording", recordingUri),
    }),
  deleteMemoFile: (memoId) =>
    Effect.try({
      try: () => {
        const file = new File(Paths.document, "memos", `${memoId}.m4a`);
        if (file.exists) file.delete();
      },
      catch: fileError("delete memo", memoId),
    }),
  writeMarkdownExport: (name, markdown) =>
    Effect.try({
      try: () => {
        const safeName =
          name
            .trim()
            .replace(/[<>:"/\\|?*]/g, "_")
            .slice(0, 80) || "export";
        const file = new File(Paths.cache, `${safeName}.md`);
        if (file.exists) file.delete();
        file.write(markdown);
        return file;
      },
      catch: fileError("write Markdown export", name),
    }),
});

const MobileKeyValueStoreLive = Layer.succeed(MobileKeyValueStore, {
  get: (key) =>
    Effect.tryPromise({
      try: () => Storage.getItem(key),
      catch: (error) =>
        new StorageOperationError({
          operation: "read",
          key,
          message: unknownErrorMessage(error),
        }),
    }),
  set: (key, value) =>
    Effect.tryPromise({
      try: () => Storage.setItem(key, value),
      catch: (error) =>
        new StorageOperationError({
          operation: "write",
          key,
          message: unknownErrorMessage(error),
        }),
    }),
});

const MobileNativeLive = Layer.succeed(MobileNative, {
  getClipboardText: nativeCommand("read clipboard", () =>
    Clipboard.getStringAsync(),
  ),
  setClipboardText: (value) =>
    nativeCommand("write clipboard", () => Clipboard.setStringAsync(value)),
  pickPdf: nativeCommand("pick PDF", async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) return null;
    return {
      uri: asset.uri,
      name: asset.name ?? "document.pdf",
      mimeType: asset.mimeType,
    };
  }),
  openUrl: (url) =>
    nativeCommand("open URL", async () => {
      await Linking.openURL(url);
    }),
  openBrowser: (url) =>
    nativeCommand("open browser", async () => {
      await WebBrowser.openBrowserAsync(url);
    }),
  shareMarkdown: ({ title, markdown, fileUrl }) =>
    nativeCommand("share Markdown", async () => {
      await Share.share(
        fileUrl && Platform.OS === "ios"
          ? { url: fileUrl, title }
          : { message: markdown },
      );
    }),
  warmBrowser: nativeCommand("warm browser", async () => {
    await WebBrowser.warmUpAsync();
  }),
  coolBrowser: nativeCommand("cool browser", async () => {
    await WebBrowser.coolDownAsync();
  }),
});

const MobileIdsLive = Layer.succeed(MobileIds, {
  make: Effect.sync(() => {
    const random = Crypto.getRandomValues(new Uint32Array(2));
    const suffix = `${random[0].toString(36).padStart(7, "0")}${random[1]
      .toString(36)
      .padStart(7, "0")}`.slice(0, 8);
    return `${Date.now().toString(36)}${suffix}`;
  }),
});

export const MobileLive = Layer.mergeAll(
  MobileConfigLive,
  MobileHttpLive,
  MobileFilesLive,
  MobileKeyValueStoreLive,
  MobileNativeLive,
  MobileIdsLive,
);
