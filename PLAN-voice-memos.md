# Inkwell — Voice memo annotations

Add a "voice memo" markup tool to the iPad reader: tap a spot in the article,
record, and a memo chip is pinned there — audio stored in R2, transcript
produced **on-device** and synced through Convex like every other annotation.
The web reader renders the chip, shows the transcript, and plays the audio.

Researched 2026-06-11 (on-device STT landscape, expo-audio, R2 pipeline).
Written to be executed by implementation agents; workstreams have explicit
file boundaries and acceptance criteria. Read §6 (integration notes) before
writing code in the matching workstream.

---

## 1. Locked decisions

| Concern | Decision |
|---|---|
| STT engine | **Apple SpeechAnalyzer/SpeechTranscriber** (iPadOS 26+, fully on-device, ~70× realtime on M-class — a 3-min memo transcribes in ~3 s). Accessed via **`@react-native-ai/apple`** (Callstack, New-Arch Expo module). NOT SFSpeechRecognizer (old dictation-grade model), NOT whisper.rn (550 MB+ model for marginal gain) |
| Transcription timing | **After stop**, file-based. No live captions in v1 (would require a custom Swift module — designated v2 upgrade) |
| Recording | **`expo-audio`** — m4a/AAC, **mono, 64 kbps, metering on** (~0.5 MB/min), hard cap 10 min |
| Audio storage | **Private R2 bucket**, streamed through the existing Hono worker (Clerk-authed `PUT`/`GET`/`DELETE`). No presigned URLs at 1–5 MB; no public bucket |
| Object key | `${userId}/${articleId}/${memoId}.m4a` — derived **server-side** from the Clerk token + route params. Client never stores a key; memo id + article id locate the audio |
| Anchoring | Pinned at a tapped `x,y` in content space, exactly like notes — drag-to-move, width scaling, export context all reuse the existing machinery |
| Persistence | New `memosJson` column on the existing `annotations` row. **Client owns all writes** (transcript is known before save since STT is on-device) — no server write-back, no race with the debounced save |
| Upload lifecycle | Memo saves immediately with `status: "local"`; audio uploads in background; status flips to `"uploaded"` on success. Local file kept in the documents dir as playback cache and for retry |
| Web v1 | Chip + transcript + **audio playback** (authed `fetch` → blob URL → `<audio>`) |
| Upgrade path (not v1) | Workers AI `@cf/openai/whisper-large-v3-turbo` ($0.0005/min, accepts m4a ≤ ~2 MB payload, word timestamps) as a server-side accuracy upgrade; live captions via custom SpeechAnalyzer Expo module |

## 2. Flow

```
 tool: memo → tap (x,y) ─► RecorderPanel (waveform from metering, timer, stop/cancel)
                              │ stop
                              ▼
              expo-audio .m4a in caches → move to documents/memos/<memoId>.m4a
                              │
               ┌──────────────┴───────────────┐
               ▼ (on-device, ~3 s)            ▼ (background)
   SpeechAnalyzer transcribe(file)     PUT /memos/:articleId/:memoId
               │                              │  (worker streams body → R2)
               ▼                              ▼
   memo {id,x,y,durationMs,transcript,    status "local" → "uploaded"
         status} → annotations.memos      (patched into memos + debounced save)
               │
               ▼
   debounced annotations.save (memosJson) ──► Convex ──► live query ──► web chip
                                                          (audio via authed GET)
```

Playback (mobile): local file if present, else `GET /memos/:articleId/:memoId`
(Range-capable) with the Clerk bearer token. Playback (web): authed `fetch` →
blob URL (audio elements can't send headers).

## 3. Spike gate (do this FIRST, before any other mobile work)

Half-day gate on the M5 iPad dev client. If any check fails, fall back to a
custom Expo module (§7 fallback) — the rest of the plan is unchanged.

1. `pnpm -F inkwell-mobile add @react-native-ai/apple expo-audio` → prebuild →
   rebuild dev client (follow apps/mobile/AGENTS.md, **including the hermes
   marker step**).
2. Record a ~30 s m4a with expo-audio (mono/64 kbps preset below).
3. Transcribe that file with `@react-native-ai/apple` (direct
   `AppleTranscription` API, no Vercel `ai` dependency — §6.1). Verify:
   RN 0.85 compat, **m4a/AAC input accepted**, en-US asset
   download/`prepare()` works, transcript quality acceptable, returns
   duration + segments.
4. Confirm no speech-recognition permission prompt appears (mic only).

## 4. Workstreams

### W1 — `packages/content`: memo type + export

Files: `src/types.ts`, `src/exportMarkdown.ts`, `src/index.ts`, tests.

- `types.ts`:
  ```ts
  /** A recorded voice memo pinned to a location in the article. */
  export type VoiceMemoAnnotation = {
    id: string;
    x: number;
    y: number;
    durationMs: number;
    transcript: string;        // "" when transcription failed/unavailable
    status: "local" | "uploaded";
    createdAt: number;
  };
  ```
  Add `memos: VoiceMemoAnnotation[]` to `Annotations`; update
  `emptyAnnotations()`. Coordinates follow the existing content-space rule
  (scale by `currentContentWidth / contentWidth`).
- `exportMarkdown.ts`: export memos like notes — transcript quoted with the
  nearby block context, prefixed `🎤` (skip memos with empty transcripts).
- Tests: extend the package test with a memos fixture (round-trip + export).

Acceptance: `pnpm -F @inkwell/content test` passes; package stays RN-free.

### W2 — `packages/backend`: schema + functions

Files: `convex/schema.ts`, `convex/annotations.ts`.

- Schema: add `memosJson: v.optional(v.string())` to `annotations`
  (**optional** — existing rows lack it; never backfill).
- `annotations.get`: parse `memosJson ?? "[]"` into `memos`.
- `annotations.save`: accept optional `memosJson` arg, write it on
  insert/patch. Auth unchanged (`requireOwnedArticle`).

Acceptance: `npx convex codegen` clean; old rows still load (memos `[]`);
mobile save round-trips memos.

### W3 — `apps/api`: R2 bucket + audio routes

Files: `wrangler.jsonc`, `src/index.ts` (chained routes — RPC type inference),
`src/memos.ts` if split.

- `wrangler.jsonc`: `r2_buckets: [{ binding: "MEMOS", bucket_name:
  "inkwell-memos" }]` in prod; `inkwell-memos-dev` under `env.dev`.
- Routes (all Clerk-authed; key = `${auth.userId}/${articleId}/${memoId}.m4a`
  so ownership is enforced by prefix — users can never address another
  user's objects):
  - `PUT /memos/:articleId/:memoId` — require `content-type: audio/mp4` (415
    otherwise), reject `content-length > 25 MB` (413), stream `c.req.raw.body`
    into `MEMOS.put()` (never `arrayBuffer()`), return `{ size }`.
  - `GET /memos/:articleId/:memoId` — Range-aware (see §6.3 for the
    mandatory manual `206`/`Content-Range` handling), `Accept-Ranges: bytes`,
    404 when missing.
  - `DELETE /memos/:articleId/:memoId` — `MEMOS.delete()`, 204. Best-effort
    from clients; orphans are pennies.
- CORS: the web SPA fetches audio cross-origin — add `hono/cors` for the
  `/memos/*` routes allowing the web origins (localhost dev + prod domain),
  methods `GET`, headers `Authorization, Range`, expose `Content-Range`.
  (RN traffic ignores CORS; this is web-only plumbing.)

Acceptance: `wrangler dev` + curl: PUT a file → GET full → GET with
`Range: bytes=0-1023` returns 206 with correct `Content-Range` → DELETE →
GET 404. Unauthed requests 401. Cross-user access impossible by construction.

### W4 — `apps/mobile`: tool, recorder, playback, pipeline

Files: `app.json`, `src/components/annotation/Toolbar.tsx`, new
`src/components/annotation/MemoRecorderPanel.tsx`, new
`src/components/annotation/MemosLayer.tsx` (+ playback popover), new
`src/lib/voiceMemos.ts`, `src/app/article/[id].tsx`.

- Deps/config: `expo-audio` (+ its config plugin with a
  `microphonePermission` string — the ONLY new permission; SpeechAnalyzer
  needs no speech-recognition key, §6.4) and `@react-native-ai/apple`.
  Native deps changed ⇒ prebuild + dev-client rebuild per apps/mobile/AGENTS.md
  (hermes marker!).
- Toolbar: add `"memo"` to `Tool` + TOOLS array (mic icon).
- Reader (`[id].tsx`):
  - Memo tool + tap → if a recording is already active, ignore; else open
    `MemoRecorderPanel` anchored at content-space `(x,y)`.
  - Seed/parse/persist `memos` alongside strokes/boxes/notes
    (`memosJson: JSON.stringify(a.memos)` in `persistAnnotations`).
  - Hit-testing: include memo chips in `findMoveTarget` (before notes) so
    read-mode drag works; moves go through the existing undo machinery.
  - Undo: memo creation pushes an op; undoing removes the memo from state
    (fire best-effort DELETE if already uploaded).
- `MemoRecorderPanel`: `useAudioRecorder` with
  `{ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true,
  numberOfChannels: 1, bitRate: 64000 }`; `useAudioRecorderState(rec, 100)`
  drives a metering waveform + timer; `record({ forDuration: 600 })`.
  Audio-session dance and interruption handling per §6.2. Cancel discards the
  file. Stop → §6.2 post-stop sequence → hand the file to the pipeline.
- `src/lib/voiceMemos.ts` — the pipeline:
  1. Move recording caches → `documents/memos/<memoId>.m4a` (caches are
     evictable).
  2. Transcribe via `AppleTranscription` (§6.1); on failure save
     `transcript: ""` (chip shows "no transcript") — never block the memo on
     STT.
  3. Insert memo into annotations state (`status: "local"`) → debounced save
     fires as usual.
  4. Background upload: `expo/fetch` + `File` raw-body PUT (§6.5) with the
     Clerk token; on 2xx patch the memo to `status: "uploaded"`.
  5. Retry: on article open, re-upload any `"local"` memos whose file exists.
  - Model prep: on first selection of the memo tool call
    `AppleTranscription.prepare()` (downloads the locale asset if missing;
    show a one-time "preparing speech model" toast).
- `MemosLayer` (modeled on `NotesLayer`): chip at `(x·s, y·s)` showing 🎤 +
  duration (+ transcript first line). Tap → popover: play/pause + scrubber
  (`useAudioPlayer` on the local file, else the worker URL with auth header
  and `downloadFirst: true`), full transcript, delete (removes from state +
  best-effort DELETE route).

Acceptance (on the iPad dev client): record → chip appears with transcript in
seconds → kill the app, reopen: memo persisted, audio plays → airplane-mode
record works fully (transcript included), upload retries on reconnect →
interruption (Siri/alarm) mid-recording doesn't crash and keeps or cleanly
discards partial audio → drag, undo, delete all behave like notes.

### W5 — `apps/web`: render + playback

Files: `src/components/AnnotationsOverlay.tsx`, `src/screens/Reader.tsx`,
small `src/lib/memoAudio.ts`.

- Reader: parse `memos` from the annotations query (same JSON pattern).
- Overlay: memo chip positioned like notes (`x·scale, y·scale`) showing 🎤 +
  duration + transcript (collapsed/expandable).
- Playback: on first play, `fetch(API_URL/memos/:articleId/:memoId,
  { headers: { Authorization: Bearer <getToken()> } })` → `URL.createObjectURL`
  → `<audio controls>`; revoke on unmount. Memos with `status: "local"`
  render the chip + transcript with a "recorded on iPad, not yet synced"
  state instead of a player.

Acceptance: a memo recorded on the iPad appears live on the open web reader
and plays; transcript readable; no CORS errors from the prod + localhost
origins.

## 5. Execution order

```
Spike gate (§3) ─┐
W1 content ──────┼─► W4 mobile ─► W5 web
W2 backend ──────┤
W3 api ──────────┘        (W1/W2/W3 are independent and parallel)
```

## 6. Integration notes (version-critical, verified 2026-06-11)

### 6.1 `@react-native-ai/apple` (v0.12.x)

- iOS 26+, New Architecture, RN ≥ 0.76 required — all satisfied. Works in
  Expo dev clients; docs: react-native-ai.com/docs/apple/transcription.
- Use the direct module API — do NOT add the Vercel `ai` package for one
  call: `AppleTranscription.isAvailable()` / `.prepare()` / `.transcribe(audio)`
  where audio is an ArrayBuffer/base64 (read the m4a via expo-file-system
  `File`). Returns `{ text, segments, durationInSeconds }`.
- File/buffer only — no streaming (that's the v2 custom-module upgrade).
- `prepare()` wraps AssetInventory download; assets are OS-managed and shared
  across apps (often already installed if Voice Memos transcription was ever
  used). First-ever use needs network.
- **Verify exact API surface during the spike** — the package is pre-1.0.

### 6.2 `expo-audio` (SDK 56) recorder

- Before recording: `await setAudioModeAsync({ allowsRecording: true,
  playsInSilentMode: true })`. **After stop: `allowsRecording: false`** —
  otherwise iOS stays in `.playAndRecord` and playback is quiet/odd-routed.
- Presets don't enable metering — set `isMeteringEnabled: true`. `metering`
  is dBFS (−160…0); normalize ≈ `max(0, 1 + dB/60)` for bar heights.
- Recordings land in **caches** — move to documents promptly.
- `statusListener`: on `mediaServicesDidReset: true` the recorder is dead —
  `prepareToRecordAsync()` again. Interruptions (call/Siri) pause without
  auto-resume; treat as stop.
- Playback: `useAudioPlayer({ uri, headers }, { downloadFirst: true })` +
  `useAudioPlayerStatus` for progress; `seekTo(seconds)`.

### 6.3 R2 GET via Worker — the Range gotcha

`MEMOS.get(key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers })`
parses Range for you, but the binding does NOT set the status or
`Content-Range` — you must respond `206` and build
`Content-Range: bytes <start>-<end>/<size>` from `object.range` yourself,
plus `Accept-Ranges: bytes` and `object.writeHttpMetadata(headers)`.
(AVPlayer needs correct 206s for seeking; `downloadFirst` hides most of it,
but get it right.)

### 6.4 Permissions

Only `NSMicrophoneUsageDescription` (via the expo-audio config plugin).
SpeechAnalyzer needs **no** `NSSpeechRecognitionUsageDescription` and no
`SFSpeechRecognizer.requestAuthorization` — verified against Apple's official
sample. File-only transcription prompts nothing.

### 6.5 Upload from RN (SDK 56)

`expo/fetch` + the new `File`: `fetch(url, { method: "PUT", headers:
{ Authorization, "Content-Type": "audio/mp4" }, body: new File(uri) })`
streams the raw body. (Legacy `FileSystem.uploadAsync` now lives under
`expo-file-system/legacy` and throws from the main entry.) If a progress bar
is wanted: `File.createUploadTask(url, { uploadType: BINARY_CONTENT, … })`.
The binary route stays plain fetch — don't force it through the `hc` RPC
client; keep RPC for JSON routes only.

## 7. Risks

| Risk | Mitigation |
|---|---|
| `@react-native-ai/apple` rejects m4a buffers or breaks on RN 0.85 | Spike gate (§3). Fallback: custom Expo Swift module wrapping SpeechAnalyzer (~100 lines; reference impls: Apple's `SwiftTranscriptionSampleApp`, Callstack's blog, `expo-speech-transcriber`, `react-native-nitro-speech`). Pipeline/UX unchanged |
| iPad runs iPadOS 27 beta | SpeechAnalyzer API unchanged in 27 (no renames/deprecations); beta quirks → test on device early (spike) |
| First-use model download offline | `prepare()` on tool selection + toast; memo still records, transcript retried later is v2 — v1 just saves `transcript: ""` |
| Multi-device: `"local"` memo not yet uploaded | Other devices show transcript + "not yet synced" state (W5); audio follows when the iPad comes online |
| Orphaned R2 objects (undo/delete races, deleted articles) | Best-effort DELETEs; storage is ~$0.015/GB-mo — ignore in v1, lifecycle cleanup later |
| Transcription quality on jargon (whisper-small-class WER) | Acceptable for v1; designated upgrade: Workers AI whisper-large-v3-turbo re-transcribe after upload (schema already carries the transcript field — server would patch `memosJson`, requiring the separate-table refactor noted in §8) |

## 8. Out of scope (v2+)

- Live captions while recording (custom SpeechAnalyzer module, volatile results)
- Server-side Whisper re-transcription for accuracy (if added, move memo
  metadata out of `memosJson` into its own table first — server writes into
  the client-owned JSON blob would race the debounced save)
- Transcript editing, search over transcripts, word-timestamp karaoke UI
- Android (`expo-speech-recognition` or Workers AI become relevant)
- R2 lifecycle cleanup for deleted articles

## 9. Davis checklist (manual, before W3 deploy)

- [ ] `wrangler r2 bucket create inkwell-memos` and `inkwell-memos-dev`
      (wrangler is already authenticated)
- [ ] No new secrets, no Clerk/Convex dashboard changes
- [ ] After W4 native-dep changes: rebuild the dev client once
      (`pnpm ipad:dev`), remembering the hermes marker step
