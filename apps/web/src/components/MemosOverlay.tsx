// Interactive voice-memo chips over the web reader column. Click a chip to
// expand its transcript and play the audio. The audio route is Clerk-authed
// and <audio src> can't carry an Authorization header, so the bytes arrive
// via fetch (memos are 1–5MB) and play from an object URL.
import { useAuth } from "@clerk/react";
import type { Annotations, VoiceMemoAnnotation } from "@inkwell/content";
import React, { useEffect, useRef, useState } from "react";

const API_URL: string = import.meta.env.VITE_API_URL ?? "";

const formatDuration = (durationMs: number): string => {
  const total = Math.max(1, Math.round(durationMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function MemoChip({
  memo,
  scale,
  articleId,
}: {
  memo: VoiceMemoAnnotation;
  scale: number;
  articleId: string;
}) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  // Fetch the audio once, on first expand.
  useEffect(() => {
    if (!open || audioUrl || audioError) return;
    if (memo.status !== "uploaded" || !API_URL) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("not signed in");
        const res = await fetch(
          `${API_URL.replace(/\/+$/, "")}/memos/${articleId}/${memo.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrlRef.current = URL.createObjectURL(blob);
        setAudioUrl(objectUrlRef.current);
      } catch {
        if (!cancelled) setAudioError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, audioUrl, audioError, memo.status, memo.id, articleId, getToken]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  return (
    <div
      className="memo-annotation"
      style={{ left: memo.x * scale, top: memo.y * scale }}
    >
      <button
        type="button"
        className="memo-chip"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Voice memo, ${formatDuration(memo.durationMs)}`}
      >
        <MicIcon />
        <span>{formatDuration(memo.durationMs)}</span>
      </button>
      {open ? (
        <div className="memo-popover">
          {memo.status === "local" ? (
            <p className="memo-hint">Recorded on iPad — audio not synced yet.</p>
          ) : audioError ? (
            <p className="memo-hint">Couldn't load the audio.</p>
          ) : audioUrl ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- the transcript below is the caption
            <audio controls src={audioUrl} />
          ) : (
            <p className="memo-hint">Loading audio…</p>
          )}
          <p className={memo.transcript ? "memo-transcript" : "memo-hint"}>
            {memo.transcript || "No transcript available."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  annotations: Annotations;
  /** Current rendered width of the content column, in CSS px. */
  columnWidth: number;
  articleId: string;
};

export function MemosOverlay({ annotations, columnWidth, articleId }: Props) {
  const scale =
    annotations.contentWidth > 0 ? columnWidth / annotations.contentWidth : 1;
  if (annotations.memos.length === 0) return null;
  return (
    <div className="memos-layer">
      {annotations.memos.map((memo) => (
        <MemoChip
          key={memo.id}
          memo={memo}
          scale={scale}
          articleId={articleId}
        />
      ))}
    </div>
  );
}
