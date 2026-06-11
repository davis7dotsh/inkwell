// Voice memo plumbing: on-device transcription (Apple SpeechAnalyzer via
// @react-native-ai/apple), the local audio store, and audio upload to R2
// through the api worker. The annotation JSON that syncs through Convex
// carries only placement + transcript + upload status; the m4a bytes live at
// PUT/GET /memos/:articleId/:memoId (see PLAN-voice-memos.md).
import { Directory, File, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";

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
 * Lazy + guarded: in a dev client built before this native module existed,
 * TurboModuleRegistry.getEnforcing throws at import time — degrade to
 * "no transcription" instead of a red screen.
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

const getTranscription = (): AppleTranscription | null =>
  (transcription ??= loadTranscription());

/**
 * Kicks off the speech model asset install (no-op when already on device).
 * Called when recording starts so the download overlaps with speaking.
 */
export function prepareTranscription(): void {
  const t = getTranscription();
  if (!t?.isAvailable(LANGUAGE)) return;
  prepared ??= t.prepare(LANGUAGE).catch(() => {
    prepared = null; // failed installs (e.g. offline) retry on the next memo
  });
}

/**
 * Transcribes a recorded memo on-device. Returns "" when speech recognition
 * is unavailable or fails — a memo is never blocked on its transcript.
 */
export async function transcribeMemo(file: File): Promise<string> {
  const t = getTranscription();
  if (!t?.isAvailable(LANGUAGE)) return "";
  try {
    prepareTranscription();
    await prepared;
    const audio = await file.arrayBuffer();
    const { segments } = await t.transcribe(audio, LANGUAGE);
    return segments
      .map((s) => s.text)
      .join("")
      .trim();
  } catch {
    return "";
  }
}

/**
 * Local audio store: documents/memos/<memoId>.m4a. A recording lives here
 * from capture until upload, and stays after as a playback cache (memos are
 * ~0.5MB/min; cheap next to offline playback working).
 */
export function memoFile(memoId: string): File {
  const dir = new Directory(Paths.document, "memos");
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, `${memoId}.m4a`);
}

/** Moves a fresh recording out of the evictable caches dir into the store. */
export function storeRecording(recordingUri: string, memoId: string): File {
  const src = new File(recordingUri);
  const dest = memoFile(memoId);
  if (dest.exists) dest.delete();
  src.move(dest);
  return dest;
}

export const memoAudioUrl = (
  apiUrl: string,
  articleId: string,
  memoId: string
): string => `${apiUrl.replace(/\/+$/, "")}/memos/${articleId}/${memoId}`;

/** Raw-body PUT of the stored m4a. Returns whether the upload landed. */
export async function uploadMemoAudio(opts: {
  apiUrl: string;
  token: string;
  articleId: string;
  memoId: string;
}): Promise<boolean> {
  const file = memoFile(opts.memoId);
  if (!file.exists) return false;
  try {
    const res = await expoFetch(
      memoAudioUrl(opts.apiUrl, opts.articleId, opts.memoId),
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "audio/mp4",
        },
        body: file,
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort cleanup when a memo is deleted or its creation is undone.
 * Orphaned R2 objects cost effectively nothing, so failures are ignored.
 */
export async function deleteMemoAudio(opts: {
  apiUrl: string | undefined;
  token: string | null;
  articleId: string;
  memoId: string;
}): Promise<void> {
  try {
    const file = memoFile(opts.memoId);
    if (file.exists) file.delete();
  } catch {
    // Local cache cleanup is opportunistic.
  }
  if (!opts.apiUrl || !opts.token) return;
  try {
    await expoFetch(memoAudioUrl(opts.apiUrl, opts.articleId, opts.memoId), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${opts.token}` },
    });
  } catch {
    // Remote cleanup is opportunistic too.
  }
}
