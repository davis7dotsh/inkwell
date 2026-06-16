import { useAuth } from "@clerk/expo";
import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import {
  buildDocumentOutline,
  buildExportMarkdown,
  emptyAnnotations,
  inferDocumentHeadings,
  type Annotations,
  type Block,
  type BlockLayout,
  type BoxAnnotation,
  type NoteAnnotation,
  type Point,
  type Stroke,
  type VoiceMemoAnnotation,
} from "@inkwell/content";
import { useMutation, useQuery } from "convex/react";
import { File, Paths } from "expo-file-system";
import * as Linking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  PointerType,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

import { BlockRenderer } from "../../components/BlockRenderer";
import {
  DOCUMENT_START_ID,
  DocumentOutline,
  DocumentOutlineDrawer,
  OUTLINE_RAIL_WIDTH,
} from "../../components/document-outline";
import { GlassIconButton } from "../../components/glass";
import { ScreenHeader } from "../../components/ScreenHeader";
import { BoxesLayer } from "../../components/annotation/BoxesLayer";
import { MemoPlayerModal } from "../../components/annotation/MemoPlayerModal";
import { MemoRecorderPanel } from "../../components/annotation/MemoRecorderPanel";
import { MemosLayer } from "../../components/annotation/MemosLayer";
import { NoteEditorModal } from "../../components/annotation/NoteEditorModal";
import { NotesLayer } from "../../components/annotation/NotesLayer";
import { StrokesCanvas } from "../../components/annotation/StrokesCanvas";
import { Toolbar, type Tool } from "../../components/annotation/Toolbar";
import { newId } from "../../lib/ids";
import { loadStylusSeen, persistStylusSeen } from "../../lib/stylus";
import { showError } from "../../lib/toast";
import {
  deleteMemoAudio,
  memoFile,
  storeRecording,
  transcribeMemo,
  uploadMemoAudio,
} from "../../lib/voiceMemos";
import {
  CONTENT_PADDING,
  HIGHLIGHTER_COLOR,
  READER_TOP_PADDING,
  HIGHLIGHTER_WIDTH,
  MAX_CONTENT_WIDTH,
  PEN_WIDTH,
  makeThemedStyles,
  penColors,
  serif,
  useTheme,
} from "../../lib/theme";

const API_URL = process.env.EXPO_PUBLIC_API_URL;
const OUTLINE_RAIL_BREAKPOINT = 1320;
const IS_IPHONE = Platform.OS === "ios" && !Platform.isPad;

type UndoOp =
  | { kind: "stroke" | "box" | "note" | "memo"; id: string }
  | {
      kind: "move";
      target: "stroke" | "box" | "note" | "memo";
      id: string;
      dx: number;
      dy: number;
    };

/** An annotation grabbed for repositioning, with its pre-drag geometry. */
type MoveTarget =
  | { kind: "stroke"; original: Stroke }
  | { kind: "box"; original: BoxAnnotation }
  | { kind: "note"; original: NoteAnnotation }
  | { kind: "memo"; original: VoiceMemoAnnotation };

/** Voice memo capture in flight: recording at a point, then transcribing. */
type MemoPhase = { mode: "recording"; at: Point } | { mode: "processing" };

/**
 * Returns `a` with the grabbed annotation offset by (dx, dy) from its
 * pre-drag geometry — absolute against the snapshot, so repeated drag
 * updates never accumulate drift.
 */
function moveAnnotation(
  a: Annotations,
  target: MoveTarget,
  dx: number,
  dy: number
): Annotations {
  switch (target.kind) {
    case "stroke": {
      const moved = {
        ...target.original,
        points: target.original.points.map((q) => ({
          x: q.x + dx,
          y: q.y + dy,
        })),
      };
      return {
        ...a,
        strokes: a.strokes.map((s) => (s.id === moved.id ? moved : s)),
      };
    }
    case "box": {
      const moved = {
        ...target.original,
        x: target.original.x + dx,
        y: target.original.y + dy,
      };
      return {
        ...a,
        boxes: a.boxes.map((b) => (b.id === moved.id ? moved : b)),
      };
    }
    case "note": {
      const moved = {
        ...target.original,
        x: target.original.x + dx,
        y: target.original.y + dy,
      };
      return {
        ...a,
        notes: a.notes.map((n) => (n.id === moved.id ? moved : n)),
      };
    }
    case "memo": {
      const moved = {
        ...target.original,
        x: target.original.x + dx,
        y: target.original.y + dy,
      };
      return {
        ...a,
        memos: a.memos.map((m) => (m.id === moved.id ? moved : m)),
      };
    }
  }
}

export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = id as Id<"articles">;
  const { width: windowWidth } = useWindowDimensions();
  const { scheme, c } = useTheme();
  const styles = themed[scheme];

  const article = useQuery(api.articles.get, { id: articleId });
  const remoteAnnotations = useQuery(api.annotations.get, { articleId });
  const saveAnnotations = useMutation(api.annotations.save);
  const setReadStatus = useMutation(api.articles.setReadStatus);

  // Opening an unread article flips it to in-progress — once per visit, so
  // "mark as unread" from the footer isn't immediately undone.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (article?.status !== "ready") return;
    autoStartedRef.current = true;
    if ((article.readStatus ?? "unread") === "unread") {
      void setReadStatus({ id: articleId, status: "in_progress" });
    }
  }, [article, articleId, setReadStatus]);

  // Local annotation state is the source of truth while the screen is open;
  // the live query only seeds it once on load.
  const [annotations, setAnnotations] = useState<Annotations | null>(null);
  const [tool, setTool] = useState<Tool>("read");
  const [penColor, setPenColor] = useState<string>(penColors[0]);
  const [activeStroke, setActiveStroke] = useState<Stroke | null>(null);
  const [previewBox, setPreviewBox] = useState<BoxAnnotation | null>(null);
  const [noteEditor, setNoteEditor] = useState<
    | { mode: "new"; at: Point }
    | { mode: "edit"; note: NoteAnnotation }
    | null
  >(null);
  const [memoPhase, setMemoPhase] = useState<MemoPhase | null>(null);
  const [playerMemoId, setPlayerMemoId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoOp[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [activeOutlineId, setActiveOutlineId] = useState(DOCUMENT_START_ID);
  const { getToken } = useAuth();

  const blocksJson = article?.blocksJson;
  const blocks = useMemo<Block[]>(() => {
    if (!blocksJson) return [];
    try {
      return inferDocumentHeadings(JSON.parse(blocksJson) as Block[]);
    } catch {
      return [];
    }
  }, [blocksJson]);
  const outline = useMemo(() => buildDocumentOutline(blocks), [blocks]);
  const hasOutline = outline.length > 0;
  const showOutlineRail =
    hasOutline && windowWidth >= OUTLINE_RAIL_BREAKPOINT;

  // undefined = still loading, null = no annotations row yet.
  const loadedAnnotations = useMemo<Annotations | null | undefined>(() => {
    if (remoteAnnotations === undefined) return undefined;
    if (remoteAnnotations === null) return null;
    return {
      contentWidth: remoteAnnotations.contentWidth,
      strokes: JSON.parse(remoteAnnotations.strokesJson) as Stroke[],
      boxes: JSON.parse(remoteAnnotations.boxesJson) as BoxAnnotation[],
      notes: JSON.parse(remoteAnnotations.notesJson) as NoteAnnotation[],
      // Rows written before voice memos existed lack the column.
      memos: JSON.parse(
        remoteAnnotations.memosJson ?? "[]"
      ) as VoiceMemoAnnotation[],
    };
  }, [remoteAnnotations]);

  const readerViewportWidth = showOutlineRail
    ? windowWidth - OUTLINE_RAIL_WIDTH
    : windowWidth;
  const contentWidth = Math.min(
    MAX_CONTENT_WIDTH,
    readerViewportWidth - CONTENT_PADDING * 2
  );
  const offsetX = (readerViewportWidth - contentWidth) / 2;
  const scale = annotations ? contentWidth / annotations.contentWidth : 1;

  const scrollRef = useRef<ScrollView>(null);
  const layoutsRef = useRef(new Map<number, BlockLayout>());
  const updateActiveOutline = useCallback(
    (offset: number, contentHeight: number, viewportHeight: number) => {
      let nextId = DOCUMENT_START_ID;
      const threshold = offset + 88;
      for (const entry of outline) {
        const layout = layoutsRef.current.get(entry.blockIndex);
        if (!layout || layout.y > threshold) break;
        nextId = entry.id;
      }
      const scrollable = contentHeight > viewportHeight + 4;
      const atBottom =
        scrollable && offset + viewportHeight >= contentHeight - 4;
      if (atBottom && outline.length > 0) {
        nextId = outline[outline.length - 1].id;
      }
      setActiveOutlineId((current) => (current === nextId ? current : nextId));
    },
    [outline]
  );

  const scrollY = useSharedValue(0);
  const scrollContentHeight = useSharedValue(0);
  const scrollViewportHeight = useSharedValue(0);
  const lastOutlineOffset = useSharedValue(-100);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
    scrollContentHeight.value = event.contentSize.height;
    scrollViewportHeight.value = event.layoutMeasurement.height;
    if (
      hasOutline &&
      Math.abs(event.contentOffset.y - lastOutlineOffset.value) >= 16
    ) {
      lastOutlineOffset.value = event.contentOffset.y;
      runOnJS(updateActiveOutline)(
        event.contentOffset.y,
        event.contentSize.height,
        event.layoutMeasurement.height
      );
    }
  });

  // Reading progress: scaleX is cheaper than animating width, and the bar
  // tracks the scroll on the UI thread.
  const progressBarStyle = useAnimatedStyle(() => {
    const scrollable = scrollContentHeight.value - scrollViewportHeight.value;
    const progress =
      scrollable > 0 ? Math.min(1, Math.max(0, scrollY.value / scrollable)) : 0;
    return { transform: [{ scaleX: progress }] };
  });

  // Apple Pencil: once a stylus touch has ever been seen on this device,
  // fingers scroll while the pencil draws. Until then, fingers draw.
  const [hasStylus, setHasStylus] = useState(false);
  const hasStylusSV = useSharedValue(false);
  useEffect(() => {
    void loadStylusSeen().then((seen) => {
      if (seen) {
        setHasStylus(true);
        hasStylusSV.value = true;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const markStylusSeen = useCallback(() => {
    setHasStylus(true);
    persistStylusSeen();
  }, []);

  // Refs so the (stable) gesture callbacks never see stale values. Updated in
  // an effect (not during render) to stay React-Compiler-safe.
  const stateRef = useRef({ tool, penColor, scale, offsetX, hasStylus });
  const anchorRef = useRef<Point | null>(null);
  // Read-mode pencil drag in flight: the grabbed annotation, the grab point,
  // and the total content-space delta applied so far.
  const moveRef = useRef<{
    target: MoveTarget;
    from: Point;
    dx: number;
    dy: number;
  } | null>(null);
  // Hit-test answer relay for the gesture worklet: -1 = pending on the JS
  // thread, 1 = drag an annotation, 0 = miss (hand the touch to the scroll).
  const moveHitSV = useSharedValue(0);
  const moveTouchTokenSV = useSharedValue(0);
  const currentTouchTokenRef = useRef(0);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const previewBoxRef = useRef<BoxAnnotation | null>(null);
  const noteSizesRef = useRef(new Map<string, { w: number; h: number }>());
  const memoSizesRef = useRef(new Map<string, { w: number; h: number }>());
  const annotationsRef = useRef<Annotations | null>(null);
  const memoPhaseRef = useRef<MemoPhase | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => {
    stateRef.current = { tool, penColor, scale, offsetX, hasStylus };
    annotationsRef.current = annotations;
    memoPhaseRef.current = memoPhase;
  });

  // ---- load & persist ----
  useEffect(() => {
    if (loadedAnnotations === undefined) return;
    // Seed once; later live updates don't clobber in-progress local edits.
    setAnnotations(
      (current) => current ?? loadedAnnotations ?? emptyAnnotations(contentWidth)
    );
    // contentWidth intentionally omitted: only used to seed new annotations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedAnnotations]);

  const persistAnnotations = useCallback(
    (a: Annotations) => {
      void saveAnnotations({
        articleId,
        contentWidth: a.contentWidth,
        strokesJson: JSON.stringify(a.strokes),
        boxesJson: JSON.stringify(a.boxes),
        notesJson: JSON.stringify(a.notes),
        memosJson: JSON.stringify(a.memos),
      });
    },
    [articleId, saveAnnotations]
  );

  useEffect(() => {
    if (!annotations || !dirtyRef.current) return;
    const timer = setTimeout(() => persistAnnotations(annotations), 600);
    return () => clearTimeout(timer);
  }, [annotations, persistAnnotations]);

  useEffect(
    () => () => {
      if (annotationsRef.current && dirtyRef.current) {
        persistAnnotations(annotationsRef.current);
      }
    },
    [persistAnnotations]
  );

  // ---- annotation mutations ----
  const update = useCallback((fn: (a: Annotations) => Annotations) => {
    setAnnotations((a) => {
      if (!a) return a;
      const next = fn(a);
      if (next !== a) dirtyRef.current = true;
      return next;
    });
  }, []);

  const pushUndo = useCallback((op: UndoOp) => {
    setUndoStack((s) => [...s, op]);
  }, []);

  // ---- voice memos: audio pipeline ----
  /** Best-effort removal of a deleted memo's audio (local cache + R2). */
  const cleanupMemoAudio = useCallback(
    async (memoId: string) => {
      const token = await getToken().catch(() => null);
      await deleteMemoAudio({ apiUrl: API_URL, token, articleId, memoId });
    },
    [articleId, getToken]
  );

  /** Background audio upload; flips the memo to "uploaded" when it lands. */
  const uploadMemo = useCallback(
    async (memoId: string) => {
      if (!API_URL) return;
      const token = await getToken().catch(() => null);
      if (!token) return;
      const ok = await uploadMemoAudio({
        apiUrl: API_URL,
        token,
        articleId,
        memoId,
      });
      if (ok) {
        update((a) => ({
          ...a,
          memos: a.memos.map((m) =>
            m.id === memoId ? { ...m, status: "uploaded" as const } : m
          ),
        }));
      }
    },
    [articleId, getToken, update]
  );

  // Re-uploads any memo whose audio never left this device (e.g. recorded
  // offline) — once per screen visit, after annotations have seeded.
  const retriedUploadsRef = useRef(false);
  useEffect(() => {
    if (retriedUploadsRef.current || !annotations) return;
    retriedUploadsRef.current = true;
    for (const memo of annotations.memos) {
      if (memo.status === "local" && memoFile(memo.id).exists) {
        void uploadMemo(memo.id);
      }
    }
  }, [annotations, uploadMemo]);

  const onMemoRecorded = useCallback(
    async (at: Point, recording: { uri: string; durationMs: number }) => {
      setMemoPhase({ mode: "processing" });
      try {
        const memoId = newId();
        const file = storeRecording(recording.uri, memoId);
        // On-device SpeechAnalyzer; "" when unavailable — never blocks.
        const transcript = await transcribeMemo(file);
        const memo: VoiceMemoAnnotation = {
          id: memoId,
          x: at.x,
          y: at.y,
          durationMs: recording.durationMs,
          transcript,
          status: "local",
          createdAt: Date.now(),
        };
        update((a) => ({ ...a, memos: [...a.memos, memo] }));
        pushUndo({ kind: "memo", id: memoId });
        void uploadMemo(memoId);
      } catch {
        showError("Couldn't save the voice memo.");
      } finally {
        setMemoPhase(null);
      }
    },
    [pushUndo, update, uploadMemo]
  );

  const onDeleteMemo = useCallback(
    (memo: VoiceMemoAnnotation) => {
      update((a) => ({
        ...a,
        memos: a.memos.filter((m) => m.id !== memo.id),
      }));
      setPlayerMemoId(null);
      void cleanupMemoAudio(memo.id);
    },
    [cleanupMemoAudio, update]
  );

  /** Shifts one annotation by (dx, dy) — used to undo a move. */
  const translateAnnotation = useCallback(
    (
      kind: "stroke" | "box" | "note" | "memo",
      id: string,
      dx: number,
      dy: number
    ) => {
      update((a) => {
        if (kind === "stroke") {
          const original = a.strokes.find((s) => s.id === id);
          return original ? moveAnnotation(a, { kind, original }, dx, dy) : a;
        }
        if (kind === "box") {
          const original = a.boxes.find((b) => b.id === id);
          return original ? moveAnnotation(a, { kind, original }, dx, dy) : a;
        }
        if (kind === "memo") {
          const original = a.memos.find((m) => m.id === id);
          return original ? moveAnnotation(a, { kind, original }, dx, dy) : a;
        }
        const original = a.notes.find((n) => n.id === id);
        return original ? moveAnnotation(a, { kind, original }, dx, dy) : a;
      });
    },
    [update]
  );

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      const op = stack[stack.length - 1];
      if (!op) return stack;
      if (op.kind === "move") {
        translateAnnotation(op.target, op.id, -op.dx, -op.dy);
      } else {
        update((a) => ({
          ...a,
          strokes:
            op.kind === "stroke"
              ? a.strokes.filter((s) => s.id !== op.id)
              : a.strokes,
          boxes:
            op.kind === "box" ? a.boxes.filter((b) => b.id !== op.id) : a.boxes,
          notes:
            op.kind === "note"
              ? a.notes.filter((n) => n.id !== op.id)
              : a.notes,
          memos:
            op.kind === "memo"
              ? a.memos.filter((m) => m.id !== op.id)
              : a.memos,
        }));
        // Undoing a memo's creation also drops its recording.
        if (op.kind === "memo") void cleanupMemoAudio(op.id);
      }
      return stack.slice(0, -1);
    });
  }, [cleanupMemoAudio, translateAnnotation, update]);

  // ---- gesture handling ----
  // The draw detector wraps the scroll CONTENT, so x/y arrive with the
  // scroll offset already baked in. Annotation space is anchored to the
  // content column's top-left, so strip the column offset and the scroll
  // content's top padding before unscaling.
  const toPoint = useCallback((x: number, y: number): Point => {
    const { scale: s, offsetX: ox } = stateRef.current;
    return { x: (x - ox) / s, y: (y - READER_TOP_PADDING) / s };
  }, []);

  const eraseAt = useCallback(
    (p: Point) => {
      const { scale: s } = stateRef.current;
      const strokeThreshold = 20 / s;
      const borderThreshold = 24 / s;
      update((a) => {
        const strokes = a.strokes.filter(
          (stroke) =>
            Math.min(
              ...stroke.points.map((q) => Math.hypot(q.x - p.x, q.y - p.y))
            ) > strokeThreshold
        );
        const boxes = a.boxes.filter((b) => {
          const nearX =
            Math.abs(p.x - b.x) < borderThreshold ||
            Math.abs(p.x - (b.x + b.w)) < borderThreshold;
          const nearY =
            Math.abs(p.y - b.y) < borderThreshold ||
            Math.abs(p.y - (b.y + b.h)) < borderThreshold;
          const withinX =
            p.x > b.x - borderThreshold && p.x < b.x + b.w + borderThreshold;
          const withinY =
            p.y > b.y - borderThreshold && p.y < b.y + b.h + borderThreshold;
          return !((nearX && withinY) || (nearY && withinX));
        });
        const notes = a.notes.filter((n) => {
          const size = noteSizesRef.current.get(n.id);
          if (!size) return true;
          return !(
            p.x >= n.x &&
            p.x <= n.x + size.w / s &&
            p.y >= n.y &&
            p.y <= n.y + size.h / s
          );
        });
        if (
          strokes.length === a.strokes.length &&
          boxes.length === a.boxes.length &&
          notes.length === a.notes.length
        ) {
          return a;
        }
        return { ...a, strokes, boxes, notes };
      });
    },
    [update]
  );

  // Which annotation a read-mode pencil touch grabs. Later items render on
  // top, so each list is searched newest-first: note bubbles, then ink
  // strokes (eraser-style point distance), then boxes by their dashed border
  // (interiors stay scrollable — boxes wrap whole sections).
  const findMoveTarget = useCallback((p: Point): MoveTarget | null => {
    const a = annotationsRef.current;
    if (!a) return null;
    const { scale: s } = stateRef.current;
    const memo = [...a.memos].reverse().find((m) => {
      const size = memoSizesRef.current.get(m.id);
      if (!size) return false;
      return (
        p.x >= m.x &&
        p.x <= m.x + size.w / s &&
        p.y >= m.y &&
        p.y <= m.y + size.h / s
      );
    });
    if (memo) return { kind: "memo", original: memo };
    const note = [...a.notes].reverse().find((n) => {
      const size = noteSizesRef.current.get(n.id);
      if (!size) return false;
      return (
        p.x >= n.x &&
        p.x <= n.x + size.w / s &&
        p.y >= n.y &&
        p.y <= n.y + size.h / s
      );
    });
    if (note) return { kind: "note", original: note };
    const strokeThreshold = 20 / s;
    const stroke = [...a.strokes]
      .reverse()
      .find(
        (st) =>
          Math.min(
            ...st.points.map((q) => Math.hypot(q.x - p.x, q.y - p.y))
          ) <= strokeThreshold
      );
    if (stroke) return { kind: "stroke", original: stroke };
    const borderThreshold = 24 / s;
    const box = [...a.boxes].reverse().find((b) => {
      const nearX =
        Math.abs(p.x - b.x) < borderThreshold ||
        Math.abs(p.x - (b.x + b.w)) < borderThreshold;
      const nearY =
        Math.abs(p.y - b.y) < borderThreshold ||
        Math.abs(p.y - (b.y + b.h)) < borderThreshold;
      const withinX =
        p.x > b.x - borderThreshold && p.x < b.x + b.w + borderThreshold;
      const withinY =
        p.y > b.y - borderThreshold && p.y < b.y + b.h + borderThreshold;
      return (nearX && withinY) || (nearY && withinX);
    });
    if (box) return { kind: "box", original: box };
    return null;
  }, []);

  // Runs on the JS thread while the gesture worklet holds the touch
  // undetermined; answers through moveHitSV so the worklet can activate
  // (drag) or fail (let the pencil scroll).
  const evaluateMoveHit = useCallback(
    (token: number, x: number, y: number) => {
      if (token !== moveTouchTokenSV.value) return;
      currentTouchTokenRef.current = token;
      const p = toPoint(x, y);
      const target = findMoveTarget(p);
      if (
        token !== currentTouchTokenRef.current ||
        token !== moveTouchTokenSV.value
      ) {
        return;
      }
      moveRef.current = target ? { target, from: p, dx: 0, dy: 0 } : null;
      moveHitSV.value = target ? 1 : 0;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [findMoveTarget, toPoint]
  );

  const clearFailedMoveHit = useCallback((token: number) => {
    if (token !== currentTouchTokenRef.current) return;
    currentTouchTokenRef.current = 0;
    moveRef.current = null;
  }, []);

  const onPanStart = useCallback(
    (x: number, y: number) => {
      const { tool: t, penColor: color, scale: s } = stateRef.current;
      const p = toPoint(x, y);
      if (t === "pen" || t === "highlighter") {
        const stroke: Stroke = {
          id: newId(),
          tool: t === "highlighter" ? "highlighter" : "pen",
          color: t === "highlighter" ? HIGHLIGHTER_COLOR : color,
          width: (t === "highlighter" ? HIGHLIGHTER_WIDTH : PEN_WIDTH) / s,
          points: [p],
        };
        activeStrokeRef.current = stroke;
        setActiveStroke(stroke);
      } else if (t === "box") {
        anchorRef.current = p;
        const box = { id: "preview", x: p.x, y: p.y, w: 0, h: 0 };
        previewBoxRef.current = box;
        setPreviewBox(box);
      } else if (t === "eraser") {
        eraseAt(p);
      }
    },
    [eraseAt, toPoint]
  );

  const onPanUpdate = useCallback(
    (x: number, y: number) => {
      const { tool: t } = stateRef.current;
      const p = toPoint(x, y);
      if (t === "read") {
        const m = moveRef.current;
        if (!m) return;
        m.dx = p.x - m.from.x;
        m.dy = p.y - m.from.y;
        update((a) => moveAnnotation(a, m.target, m.dx, m.dy));
      } else if (t === "pen" || t === "highlighter") {
        const current = activeStrokeRef.current;
        if (!current) return;
        const next = { ...current, points: [...current.points, p] };
        activeStrokeRef.current = next;
        setActiveStroke(next);
      } else if (t === "box") {
        const anchor = anchorRef.current;
        if (!anchor) return;
        const box = {
          id: "preview",
          x: Math.min(anchor.x, p.x),
          y: Math.min(anchor.y, p.y),
          w: Math.abs(p.x - anchor.x),
          h: Math.abs(p.y - anchor.y),
        };
        previewBoxRef.current = box;
        setPreviewBox(box);
      } else if (t === "eraser") {
        eraseAt(p);
      }
    },
    [eraseAt, toPoint, update]
  );

  const onPanEnd = useCallback(() => {
    const { tool: t, scale: s } = stateRef.current;
    if (t === "read") {
      // moveHitSV is reset by the worklet on the next touch-down; resetting
      // it here (async, JS thread) could clobber that touch's pending state.
      const m = moveRef.current;
      moveRef.current = null;
      if (m && (m.dx !== 0 || m.dy !== 0)) {
        pushUndo({
          kind: "move",
          target: m.target.kind,
          id: m.target.original.id,
          dx: m.dx,
          dy: m.dy,
        });
      }
    } else if (t === "pen" || t === "highlighter") {
      const stroke = activeStrokeRef.current;
      activeStrokeRef.current = null;
      setActiveStroke(null);
      if (stroke && stroke.points.length > 0) {
        update((a) => ({ ...a, strokes: [...a.strokes, stroke] }));
        pushUndo({ kind: "stroke", id: stroke.id });
      }
    } else if (t === "box") {
      const box = previewBoxRef.current;
      anchorRef.current = null;
      previewBoxRef.current = null;
      setPreviewBox(null);
      if (box && box.w * s > 16 && box.h * s > 16) {
        const committed = { ...box, id: newId() };
        update((a) => ({ ...a, boxes: [...a.boxes, committed] }));
        pushUndo({ kind: "box", id: committed.id });
      }
    }
  }, [pushUndo, update]);

  const onNoteTap = useCallback(
    (x: number, y: number) => {
      const { scale: s } = stateRef.current;
      const p = toPoint(x, y);
      const existing = annotationsRef.current?.notes.find((n) => {
        const size = noteSizesRef.current.get(n.id);
        if (!size) return false;
        return (
          p.x >= n.x &&
          p.x <= n.x + size.w / s &&
          p.y >= n.y &&
          p.y <= n.y + size.h / s
        );
      });
      setNoteEditor(
        existing ? { mode: "edit", note: existing } : { mode: "new", at: p }
      );
    },
    [toPoint]
  );

  // Memo-tool tap: an existing chip opens its player; empty space starts a
  // recording at that point (one take at a time).
  const onMemoTap = useCallback(
    (x: number, y: number) => {
      if (memoPhaseRef.current) return;
      const { scale: s } = stateRef.current;
      const p = toPoint(x, y);
      const existing = annotationsRef.current?.memos.find((m) => {
        const size = memoSizesRef.current.get(m.id);
        if (!size) return false;
        return (
          p.x >= m.x &&
          p.x <= m.x + size.w / s &&
          p.y >= m.y &&
          p.y <= m.y + size.h / s
        );
      });
      if (existing) {
        setPlayerMemoId(existing.id);
        return;
      }
      setMemoPhase({ mode: "recording", at: p });
    },
    [toPoint]
  );

  // Native handle for the ScrollView so the draw pan can hard-block
  // scrolling (palms included) while a pencil stroke is active.
  const nativeScroll = useMemo(() => Gesture.Native(), []);

  const isDrawTool =
    tool === "pen" || tool === "highlighter" || tool === "box" || tool === "eraser";
  const isReadMode = tool === "read";

  // IMPORTANT: these callbacks run as worklets (no .runOnJS(true)) because
  // the StateManager's activate()/fail() are silent no-ops on the JS thread.
  // Stylus touches activate instantly (zero-slop ink); finger touches fail
  // the pan so the ancestor ScrollView takes the gesture — unless no stylus
  // has ever been seen, in which case fingers draw like before.
  //
  // In read mode the pencil can grab an existing annotation and drag it to
  // reposition: the worklet parks the touch (manual activation) while the JS
  // thread hit-tests, then moveHitSV tells it to activate (drag) or fail
  // (the pencil scrolls like before). Fingers always scroll.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isDrawTool || isReadMode)
        .maxPointers(1)
        .manualActivation(true)
        .blocksExternalGesture(nativeScroll)
        .onTouchesDown((e, manager) => {
          "worklet";
          if (e.numberOfTouches > 1) {
            manager.fail();
            return;
          }
          const isStylus = e.pointerType === PointerType.STYLUS;
          if (isStylus && !hasStylusSV.value) {
            hasStylusSV.value = true;
            runOnJS(markStylusSeen)();
          }
          if (isReadMode) {
            if (!isStylus) {
              manager.fail();
              return;
            }
            const token = moveTouchTokenSV.value + 1;
            moveTouchTokenSV.value = token;
            moveHitSV.value = -1;
            const touch = e.allTouches[0];
            runOnJS(evaluateMoveHit)(token, touch.x, touch.y);
            return;
          }
          if (isStylus || !hasStylusSV.value) {
            manager.activate();
          } else {
            manager.fail();
          }
        })
        .onTouchesMove((_e, manager) => {
          "worklet";
          if (!isReadMode) return;
          if (moveHitSV.value === 1) {
            manager.activate();
          } else if (moveHitSV.value === 0) {
            manager.fail();
          }
        })
        .onTouchesUp((_e, manager) => {
          "worklet";
          // Pencil lifted before the hit test answered (or on a miss): release
          // the touch. An activated drag ends through the normal pan flow.
          if (isReadMode && moveHitSV.value !== 1) {
            const token = moveTouchTokenSV.value;
            if (token === moveTouchTokenSV.value) {
              moveTouchTokenSV.value = token + 1;
              moveHitSV.value = 0;
              runOnJS(clearFailedMoveHit)(token);
            }
            manager.fail();
          }
        })
        .onStart((e) => {
          "worklet";
          runOnJS(onPanStart)(e.x, e.y);
        })
        .onUpdate((e) => {
          "worklet";
          runOnJS(onPanUpdate)(e.x, e.y);
        })
        .onEnd(() => {
          "worklet";
          runOnJS(onPanEnd)();
        })
        .onFinalize(() => {
          "worklet";
          runOnJS(onPanEnd)();
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isDrawTool,
      isReadMode,
      nativeScroll,
      markStylusSeen,
      evaluateMoveHit,
      clearFailedMoveHit,
      onPanStart,
      onPanUpdate,
      onPanEnd,
    ]
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(tool === "note" || tool === "memo")
        .runOnJS(true)
        .onEnd((e, success) => {
          // Tap uses no StateManager, so the JS thread is fine here. With a
          // stylus on record, only the pencil places notes/memos.
          if (!success) return;
          if (
            stateRef.current.hasStylus &&
            e.pointerType !== PointerType.STYLUS
          ) {
            return;
          }
          if (stateRef.current.tool === "memo") onMemoTap(e.x, e.y);
          else onNoteTap(e.x, e.y);
        }),
    [tool, onNoteTap, onMemoTap]
  );

  const drawGestures = useMemo(
    () => Gesture.Race(panGesture, tapGesture),
    [panGesture, tapGesture]
  );

  // ---- note editor actions ----
  const saveNote = useCallback(
    (text: string) => {
      if (!noteEditor) return;
      if (noteEditor.mode === "edit") {
        update((a) => ({
          ...a,
          notes: a.notes.map((n) =>
            n.id === noteEditor.note.id ? { ...n, text } : n
          ),
        }));
      } else {
        const note: NoteAnnotation = {
          id: newId(),
          x: noteEditor.at.x,
          y: noteEditor.at.y,
          text,
        };
        update((a) => ({ ...a, notes: [...a.notes, note] }));
        pushUndo({ kind: "note", id: note.id });
      }
      setNoteEditor(null);
    },
    [noteEditor, pushUndo, update]
  );

  const deleteNote = useCallback(() => {
    if (noteEditor?.mode !== "edit") return;
    update((a) => ({
      ...a,
      notes: a.notes.filter((n) => n.id !== noteEditor.note.id),
    }));
    setNoteEditor(null);
  }, [noteEditor, update]);

  const onPressNote = useCallback((note: NoteAnnotation) => {
    setNoteEditor({ mode: "edit", note });
  }, []);

  const onNoteLayout = useCallback((noteId: string, size: { w: number; h: number }) => {
    noteSizesRef.current.set(noteId, size);
  }, []);

  const onMemoLayout = useCallback(
    (memoId: string, size: { w: number; h: number }) => {
      memoSizesRef.current.set(memoId, size);
    },
    []
  );

  const onPressMemo = useCallback((memo: VoiceMemoAnnotation) => {
    setPlayerMemoId(memo.id);
  }, []);

  const onBlockLayout = useCallback((index: number, layout: BlockLayout) => {
    layoutsRef.current.set(index, layout);
  }, []);

  const onOutlineNavigate = useCallback(
    (entry: (typeof outline)[number] | null) => {
      const y = entry
        ? layoutsRef.current.get(entry.blockIndex)?.y
        : 0;
      if (y === undefined) return;
      scrollRef.current?.scrollTo({
        y: Math.max(0, y - 18),
        animated: true,
      });
      setActiveOutlineId(entry?.id ?? DOCUMENT_START_ID);
      setOutlineOpen(false);
    },
    []
  );

  // ---- header actions ----
  const onOpenOriginal = useCallback(() => {
    if (article?.url) void Linking.openURL(article.url);
  }, [article?.url]);

  // Exports a real .md file (named after the article) so the share sheet
  // offers AirDrop / Save to Files / app handoff instead of a wall of text.
  const onExport = useCallback(() => {
    if (!article || !annotationsRef.current) return;
    const markdown = buildExportMarkdown(
      {
        title: article.title,
        byline: article.byline,
        siteName: article.siteName,
        excerpt: article.excerpt,
        blocks,
        url: article.url,
        savedAt: article.savedAt,
      },
      annotationsRef.current,
      layoutsRef.current,
      stateRef.current.scale
    );
    let fileUrl: string | null = null;
    try {
      const name =
        article.title.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 80) ||
        "article";
      const file = new File(Paths.cache, `${name}.md`);
      if (file.exists) file.delete();
      file.write(markdown);
      fileUrl = file.uri;
    } catch {
      // Couldn't write the file — fall back to sharing the raw text.
    }
    // Share.share's `url` is iOS-only; Android ignores it and would show an
    // empty sheet, so Android always gets the markdown text.
    void Share.share(
      fileUrl && Platform.OS === "ios"
        ? { url: fileUrl, title: article.title }
        : { message: markdown }
    );
  }, [article, blocks]);

  // Live view of the memo being played, so upload-status changes (synced
  // badge) reach an open player modal.
  const playerMemo = playerMemoId
    ? (annotations?.memos.find((m) => m.id === playerMemoId) ?? null)
    : null;

  const ready = article !== undefined && article.status === "ready";
  const isRead = article !== undefined && article.readStatus === "read";
  // Uploaded PDFs carry a synthetic upload:// url — no original to open.
  const isUpload = article?.url.startsWith("upload://") ?? false;

  const onToggleRead = useCallback(() => {
    void setReadStatus({
      id: articleId,
      status: isRead ? "unread" : "read",
    });
  }, [articleId, isRead, setReadStatus]);

  const savedDate = article
    ? new Date(article.savedAt).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const compactHeaderActions =
    !showOutlineRail && hasOutline && !isUpload;
  const headerButtonSize = compactHeaderActions ? 32 : 40;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={article?.title ?? ""}
        subtitle={
          article
            ? [article.siteName, savedDate].filter(Boolean).join("  ·  ")
            : undefined
        }
        compact={IS_IPHONE}
        right={
          ready ? (
            <View style={styles.headerActions}>
              {!showOutlineRail && hasOutline ? (
                <GlassIconButton
                  icon="format-list-bulleted"
                  onPress={() => setOutlineOpen(true)}
                  accessibilityLabel="Open document outline"
                  size={headerButtonSize}
                  iconSize={18}
                />
              ) : null}
              {isUpload ? null : (
                <GlassIconButton
                  icon="apple-safari"
                  onPress={onOpenOriginal}
                  accessibilityLabel="Open original article in browser"
                  size={headerButtonSize}
                  iconSize={18}
                />
              )}
              <GlassIconButton
                icon="file-export-outline"
                onPress={onExport}
                accessibilityLabel="Export markup as Markdown"
                size={headerButtonSize}
                iconSize={18}
              />
            </View>
          ) : null
        }
      />
      {article !== undefined && article.status === "failed" ? (
        <View style={styles.center}>
          <Text style={styles.missing}>
            {article.error ?? "This article failed to save."}
          </Text>
        </View>
      ) : !ready || !annotations ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : (
        <View style={styles.readerArea}>
          <View style={styles.progressTrack} pointerEvents="none">
            <Animated.View
              style={[
                styles.progressFill,
                { width: windowWidth },
                progressBarStyle,
              ]}
            />
          </View>
          <View style={styles.readerLayout}>
            {showOutlineRail ? (
              <View style={styles.outlineRail}>
                <DocumentOutline
                  entries={outline}
                  activeId={activeOutlineId}
                  onNavigate={onOutlineNavigate}
                />
              </View>
            ) : null}
            <View style={styles.readerPane}>
              <GestureDetector gesture={nativeScroll}>
                <Animated.ScrollView
                  ref={scrollRef}
                  onScroll={scrollHandler}
                  scrollEventThrottle={16}
                  scrollEnabled={tool === "read" || hasStylus}
                  onContentSizeChange={(_w, h) => {
                    scrollContentHeight.value = h;
                  }}
                  onLayout={(e) => {
                    scrollViewportHeight.value = e.nativeEvent.layout.height;
                  }}
                >
                  <GestureDetector gesture={drawGestures}>
                    <View
                      collapsable={false}
                      style={styles.scrollContent}
                    >
                      <View
                        style={{ width: contentWidth, alignSelf: "center" }}
                      >
                        <Text
                          style={[styles.title, IS_IPHONE && styles.phoneTitle]}
                        >
                          {article.title}
                        </Text>
                        <Text style={styles.meta}>
                          {[article.byline, article.siteName, savedDate]
                            .filter(Boolean)
                            .join("  ·  ")}
                        </Text>
                        <View style={styles.titleRule} />
                        <BlockRenderer
                          blocks={blocks}
                          contentWidth={contentWidth}
                          onBlockLayout={onBlockLayout}
                        />
                        <BoxesLayer
                          boxes={annotations.boxes}
                          previewBox={previewBox}
                          scale={scale}
                        />
                        <NotesLayer
                          notes={annotations.notes}
                          scale={scale}
                          onPressNote={onPressNote}
                          onNoteLayout={onNoteLayout}
                        />
                        <MemosLayer
                          memos={annotations.memos}
                          scale={scale}
                          onPressMemo={onPressMemo}
                          onMemoLayout={onMemoLayout}
                        />
                        <View style={styles.readFooter}>
                          <Pressable
                            onPress={onToggleRead}
                            accessibilityRole="button"
                            accessibilityLabel={
                              isRead ? "Mark as unread" : "Mark as read"
                            }
                            style={({ pressed }) => [
                              styles.markReadButton,
                              isRead && styles.markReadButtonDone,
                              pressed && { opacity: 0.8 },
                            ]}
                          >
                            <Text
                              style={[
                                styles.markReadText,
                                isRead && styles.markReadTextDone,
                              ]}
                            >
                              {isRead
                                ? "Read. Mark as unread"
                                : "Mark as read"}
                            </Text>
                          </Pressable>
                          {isRead ? null : (
                            <Text style={styles.readFooterHint}>
                              Finished? This moves it to your Read list
                              everywhere.
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>
                  </GestureDetector>
                </Animated.ScrollView>
              </GestureDetector>

              <StrokesCanvas
                strokes={annotations.strokes}
                activeStroke={activeStroke}
                scrollY={scrollY}
                offsetX={offsetX}
                offsetY={READER_TOP_PADDING}
                scale={scale}
              />
            </View>
          </View>

          <Toolbar
            tool={tool}
            onToolChange={setTool}
            penColor={penColor}
            onPenColorChange={setPenColor}
            canUndo={undoStack.length > 0}
            onUndo={undo}
            isPhone={IS_IPHONE}
          />

          <NoteEditorModal
            visible={noteEditor !== null}
            initialText={noteEditor?.mode === "edit" ? noteEditor.note.text : ""}
            isEditing={noteEditor?.mode === "edit"}
            onSave={saveNote}
            onDelete={deleteNote}
            onCancel={() => setNoteEditor(null)}
          />

          {memoPhase?.mode === "recording" ? (
            <MemoRecorderPanel
              onComplete={(recording) =>
                void onMemoRecorded(memoPhase.at, recording)
              }
              onCancel={(message) => {
                setMemoPhase(null);
                if (message) showError(message);
              }}
            />
          ) : null}
          {memoPhase?.mode === "processing" ? (
            <View style={styles.transcribingWrap} pointerEvents="none">
              <View style={styles.transcribingPill}>
                <ActivityIndicator size="small" color={c.accent} />
                <Text style={styles.transcribingText}>Transcribing…</Text>
              </View>
            </View>
          ) : null}
          {playerMemo ? (
            <MemoPlayerModal
              memo={playerMemo}
              articleId={articleId}
              onDelete={onDeleteMemo}
              onClose={() => setPlayerMemoId(null)}
            />
          ) : null}
        </View>
      )}
      {!showOutlineRail && hasOutline ? (
        <DocumentOutlineDrawer
          visible={outlineOpen}
          entries={outline}
          activeId={activeOutlineId}
          onNavigate={onOutlineNavigate}
          onClose={() => setOutlineOpen(false)}
        />
      ) : null}
    </View>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
    },
    readerArea: {
      flex: 1,
    },
    readerLayout: {
      flex: 1,
      flexDirection: "row",
    },
    readerPane: {
      flex: 1,
      minWidth: 0,
      position: "relative",
    },
    outlineRail: {
      width: OUTLINE_RAIL_WIDTH,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: c.hairline,
      backgroundColor: c.surface,
      paddingHorizontal: 18,
      paddingTop: 24,
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    progressTrack: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 2,
      zIndex: 10,
    },
    progressFill: {
      height: 2,
      backgroundColor: c.accent,
      transformOrigin: "left",
      borderTopRightRadius: 2,
      borderBottomRightRadius: 2,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 40,
    },
    missing: {
      fontSize: 16,
      lineHeight: 23,
      color: c.inkSecondary,
      textAlign: "center",
    },
    scrollContent: {
      paddingTop: READER_TOP_PADDING,
      paddingBottom: 160,
    },
    title: {
      fontFamily: serif,
      fontSize: 40,
      lineHeight: 48,
      fontWeight: "600",
      color: c.ink,
      marginBottom: 14,
    },
    phoneTitle: {
      fontSize: 31,
      lineHeight: 39,
    },
    meta: {
      fontSize: 12.5,
      color: c.inkFaint,
      marginBottom: 22,
    },
    titleRule: {
      width: 54,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.inkFaint,
      marginBottom: 34,
    },
    readFooter: {
      alignItems: "center",
      gap: 10,
      marginTop: 56,
    },
    markReadButton: {
      height: 44,
      borderRadius: 22,
      borderCurve: "continuous",
      paddingHorizontal: 26,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
    },
    markReadButtonDone: {
      backgroundColor: c.surfaceMuted,
    },
    markReadText: {
      fontSize: 15,
      fontWeight: "600",
      color: c.accent,
    },
    markReadTextDone: {
      color: c.inkSecondary,
    },
    readFooterHint: {
      fontSize: 13,
      color: c.inkFaint,
    },
    transcribingWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 34,
      alignItems: "center",
    },
    transcribingPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: 22,
      borderCurve: "continuous",
      paddingHorizontal: 16,
      paddingVertical: 10,
      shadowColor: "#0E2E52",
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    transcribingText: {
      fontSize: 14,
      fontWeight: "600",
      color: c.inkSecondary,
    },
  })
);
