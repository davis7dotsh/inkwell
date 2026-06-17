// Voice memo orchestration. Expo audio hooks remain in React components; this
// module owns the typed file, transcription, and network Effects around them.
import type { File } from "expo-file-system";
import * as Effect from "effect/Effect";

import {
  ConfigurationError,
  FileOperationError,
  HttpResponseError,
  TranscriptionError,
  unknownErrorMessage,
} from "../effect/errors";
import { MobileConfig, MobileFiles, MobileHttp } from "../effect/services";

const LANGUAGE = "en-US";

type AppleTranscription = {
  isAvailable(language: string): boolean;
  prepare(language: string): Promise<void>;
  transcribe(
    data: ArrayBufferLike,
    language: string
  ): Promise<{ segments: { text: string }[]; duration: number }>;
};

/**
 * Lazy + guarded: an older development client may not contain this native
 * module, and TurboModuleRegistry.getEnforcing throws during require().
 */
function loadTranscription(): AppleTranscription | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@react-native-ai/apple").AppleTranscription;
  } catch {
    return null;
  }
}

let transcription: AppleTranscription | null | undefined;
let prepared: Promise<void> | null = null;

const getTranscription = (): AppleTranscription | null => {
  if (transcription === undefined) transcription = loadTranscription();
  return transcription;
};

const transcriptionFailure = (operation: string, error: unknown) =>
  new TranscriptionError({
    operation,
    message: unknownErrorMessage(error),
  });

/**
 * Starts the speech model install so it can overlap with recording. Failure is
 * typed and resets the cached attempt, allowing a later memo to retry.
 */
export const prepareTranscription = Effect.suspend(() => {
  const service = getTranscription();
  if (!service?.isAvailable(LANGUAGE)) return Effect.void;
  const preparation = prepared ?? service.prepare(LANGUAGE);
  prepared = preparation;
  return Effect.tryPromise({
    try: () => preparation,
    catch: (error) => {
      prepared = null;
      return transcriptionFailure("prepare transcription", error);
    },
  });
});

/** Transcribes one stored recording. Callers decide whether to use a fallback. */
export const transcribeMemo = (
  file: File
): Effect.Effect<string, TranscriptionError> =>
  Effect.gen(function* () {
    const service = getTranscription();
    if (!service?.isAvailable(LANGUAGE)) {
      return yield* new TranscriptionError({
        operation: "transcribe memo",
        message: "On-device transcription is unavailable.",
      });
    }
    yield* prepareTranscription;
    const audio = yield* Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: (error) => transcriptionFailure("read memo audio", error),
    });
    const result = yield* Effect.tryPromise({
      try: () => service.transcribe(audio, LANGUAGE),
      catch: (error) => transcriptionFailure("transcribe memo", error),
    });
    return result.segments
      .map((segment) => segment.text)
      .join("")
      .trim();
  });

export const findMemoFile = (memoId: string) =>
  Effect.gen(function* () {
    const files = yield* MobileFiles;
    return yield* files.findMemoFile(memoId);
  });

export const storeRecording = (recordingUri: string, memoId: string) =>
  Effect.gen(function* () {
    const files = yield* MobileFiles;
    return yield* files.storeRecording(recordingUri, memoId);
  });

export const memoAudioUrl = (
  apiUrl: string,
  articleId: string,
  memoId: string
): string => `${apiUrl.replace(/\/+$/, "")}/memos/${articleId}/${memoId}`;

const configuredApiUrl = Effect.gen(function* () {
  const config = yield* MobileConfig;
  if (!config.apiUrl) {
    return yield* new ConfigurationError({
      key: "EXPO_PUBLIC_API_URL",
      message: "Set EXPO_PUBLIC_API_URL in .env.local to sync voice memos.",
    });
  }
  return config.apiUrl;
});

/** Raw-body PUT of a stored m4a. */
export const uploadMemoAudio = (input: {
  readonly token: string;
  readonly articleId: string;
  readonly memoId: string;
}) =>
  Effect.gen(function* () {
    const apiUrl = yield* configuredApiUrl;
    const files = yield* MobileFiles;
    const file = yield* files.findMemoFile(input.memoId);
    if (!file) {
      return yield* new FileOperationError({
        operation: "upload memo",
        path: input.memoId,
        message: "The local recording is missing.",
      });
    }
    const http = yield* MobileHttp;
    const response = yield* http.request(
      "upload memo audio",
      memoAudioUrl(apiUrl, input.articleId, input.memoId),
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "audio/mp4",
        },
        body: file,
      }
    );
    if (!response.ok) {
      return yield* new HttpResponseError({
        operation: "upload memo audio",
        status: response.status,
        message: `The server said ${response.status}.`,
      });
    }
  });

/**
 * Best-effort deletion still reports failures to Effect logging instead of
 * discarding rejected promises. Missing API configuration/token only skips R2.
 */
export const deleteMemoAudio = (input: {
  readonly token: string | null;
  readonly articleId: string;
  readonly memoId: string;
}) =>
  Effect.gen(function* () {
    const files = yield* MobileFiles;
    yield* files.deleteMemoFile(input.memoId).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not delete local memo audio", error)
      )
    );

    const config = yield* MobileConfig;
    if (!config.apiUrl || !input.token) return;
    const http = yield* MobileHttp;
    const response = yield* http.request(
      "delete memo audio",
      memoAudioUrl(config.apiUrl, input.articleId, input.memoId),
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${input.token}` },
      }
    );
    if (!response.ok) {
      return yield* new HttpResponseError({
        operation: "delete memo audio",
        status: response.status,
        message: `The server said ${response.status}.`,
      });
    }
  });
