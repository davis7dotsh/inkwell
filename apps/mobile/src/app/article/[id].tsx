import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import {
  buildExportMarkdown,
  emptyAnnotations,
  type Annotations,
  type Block,
  type BlockLayout,
  type BoxAnnotation,
  type NoteAnnotation,
  type Point,
  type Stroke,
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
import { BrushStroke } from "../../components/BrushStroke";
import { GlassIconButton } from "../../components/glass";
import { ScreenHeader } from "../../components/ScreenHeader";
import { BoxesLayer } from "../../components/annotation/BoxesLayer";
import { NoteEditorModal } from "../../components/annotation/NoteEditorModal";
import { NotesLayer } from "../../components/annotation/NotesLayer";
import { StrokesCanvas } from "../../components/annotation/StrokesCanvas";
import { Toolbar, type Tool } from "../../components/annotation/Toolbar";
import { newId } from "../../lib/ids";
import { loadStylusSeen, persistStylusSeen } from "../../lib/stylus";
import {
  CONTENT_PADDING,
  HIGHLIGHTER_COLOR,
  HIGHLIGHTER_WIDTH,
  MAX_CONTENT_WIDTH,
  PEN_WIDTH,
  makeThemedStyles,
  penColors,
  serif,
  useTheme,
} from "../../lib/theme";

type UndoOp = { kind: "stroke" | "box" | "note"; id: string };

export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = id as Id<"articles">;
  const { width: windowWidth } = useWindowDimensions();
  const { scheme, c } = useTheme();
  const styles = themed[scheme];

  const article = useQuery(api.articles.get, { id: articleId });
  const remoteAnnotations = useQuery(api.annotations.get, { articleId });
  const saveAnnotations = useMutation(api.annotations.save);

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
  const [undoStack, setUndoStack] = useState<UndoOp[]>([]);

  const blocks = useMemo<Block[]>(
    () =>
      article?.blocksJson ? (JSON.parse(article.blocksJson) as Block[]) : [],
    [article?.blocksJson]
  );

  // undefined = still loading, null = no annotations row yet.
  const loadedAnnotations = useMemo<Annotations | null | undefined>(() => {
    if (remoteAnnotations === undefined) return undefined;
    if (remoteAnnotations === null) return null;
    return {
      contentWidth: remoteAnnotations.contentWidth,
      strokes: JSON.parse(remoteAnnotations.strokesJson) as Stroke[],
      boxes: JSON.parse(remoteAnnotations.boxesJson) as BoxAnnotation[],
      notes: JSON.parse(remoteAnnotations.notesJson) as NoteAnnotation[],
    };
  }, [remoteAnnotations]);

  const contentWidth = Math.min(
    MAX_CONTENT_WIDTH,
    windowWidth - CONTENT_PADDING * 2
  );
  const offsetX = (windowWidth - contentWidth) / 2;
  const scale = annotations ? contentWidth / annotations.contentWidth : 1;

  const scrollY = useSharedValue(0);
  const scrollContentHeight = useSharedValue(0);
  const scrollViewportHeight = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
    scrollContentHeight.value = event.contentSize.height;
    scrollViewportHeight.value = event.layoutMeasurement.height;
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
  const activeStrokeRef = useRef<Stroke | null>(null);
  const previewBoxRef = useRef<BoxAnnotation | null>(null);
  const noteSizesRef = useRef(new Map<string, { w: number; h: number }>());
  const layoutsRef = useRef(new Map<number, BlockLayout>());
  const annotationsRef = useRef<Annotations | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => {
    stateRef.current = { tool, penColor, scale, offsetX, hasStylus };
    annotationsRef.current = annotations;
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

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      const op = stack[stack.length - 1];
      if (!op) return stack;
      update((a) => ({
        ...a,
        strokes:
          op.kind === "stroke"
            ? a.strokes.filter((s) => s.id !== op.id)
            : a.strokes,
        boxes:
          op.kind === "box" ? a.boxes.filter((b) => b.id !== op.id) : a.boxes,
        notes:
          op.kind === "note" ? a.notes.filter((n) => n.id !== op.id) : a.notes,
      }));
      return stack.slice(0, -1);
    });
  }, [update]);

  // ---- gesture handling ----
  // The draw detector wraps the scroll CONTENT, so x/y arrive in content
  // space (scroll offset already baked in); only the column offset applies.
  const toPoint = useCallback((x: number, y: number): Point => {
    const { scale: s, offsetX: ox } = stateRef.current;
    return { x: (x - ox) / s, y: y / s };
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
      if (t === "pen" || t === "highlighter") {
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
    [eraseAt, toPoint]
  );

  const onPanEnd = useCallback(() => {
    const { tool: t, scale: s } = stateRef.current;
    if (t === "pen" || t === "highlighter") {
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

  // Native handle for the ScrollView so the draw pan can hard-block
  // scrolling (palms included) while a pencil stroke is active.
  const nativeScroll = useMemo(() => Gesture.Native(), []);

  const isDrawTool =
    tool === "pen" || tool === "highlighter" || tool === "box" || tool === "eraser";

  // IMPORTANT: these callbacks run as worklets (no .runOnJS(true)) because
  // the StateManager's activate()/fail() are silent no-ops on the JS thread.
  // Stylus touches activate instantly (zero-slop ink); finger touches fail
  // the pan so the ancestor ScrollView takes the gesture — unless no stylus
  // has ever been seen, in which case fingers draw like before.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isDrawTool)
        .maxPointers(1)
        .manualActivation(true)
        .blocksExternalGesture(nativeScroll)
        .onTouchesDown((e, manager) => {
          "worklet";
          if (e.numberOfTouches > 1) {
            manager.fail();
            return;
          }
          if (e.pointerType === PointerType.STYLUS) {
            if (!hasStylusSV.value) {
              hasStylusSV.value = true;
              runOnJS(markStylusSeen)();
            }
            manager.activate();
          } else if (hasStylusSV.value) {
            manager.fail();
          } else {
            manager.activate();
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
    [isDrawTool, nativeScroll, markStylusSeen, onPanStart, onPanUpdate, onPanEnd]
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .enabled(tool === "note")
        .runOnJS(true)
        .onEnd((e, success) => {
          // Tap uses no StateManager, so the JS thread is fine here. With a
          // stylus on record, only the pencil places notes.
          if (!success) return;
          if (
            stateRef.current.hasStylus &&
            e.pointerType !== PointerType.STYLUS
          ) {
            return;
          }
          onNoteTap(e.x, e.y);
        }),
    [tool, onNoteTap]
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

  const onBlockLayout = useCallback((index: number, layout: BlockLayout) => {
    layoutsRef.current.set(index, layout);
  }, []);

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

  const ready = article !== undefined && article.status === "ready";

  const savedDate = article
    ? new Date(article.savedAt).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={article?.title ?? ""}
        right={
          ready ? (
            <>
              <GlassIconButton
                icon="apple-safari"
                onPress={onOpenOriginal}
                accessibilityLabel="Open original article in browser"
              />
              <GlassIconButton
                icon="file-export-outline"
                onPress={onExport}
                accessibilityLabel="Export markup as Markdown"
              />
            </>
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
          <GestureDetector gesture={nativeScroll}>
            <Animated.ScrollView
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
                <View collapsable={false} style={styles.scrollContent}>
                  <View style={{ width: contentWidth, alignSelf: "center" }}>
              <Text style={styles.title}>{article.title}</Text>
              <Text style={styles.meta}>
                {[article.byline, article.siteName, savedDate]
                  .filter(Boolean)
                  .join("  ·  ")}
              </Text>
              <BrushStroke
                width={Math.min(220, contentWidth * 0.4)}
                height={8}
                color={c.wash}
                opacity={0.75}
                style={{ marginBottom: 26 }}
              />
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
            scale={scale}
          />

          <Toolbar
            tool={tool}
            onToolChange={setTool}
            penColor={penColor}
            onPenColorChange={setPenColor}
            canUndo={undoStack.length > 0}
            onUndo={undo}
          />

          <NoteEditorModal
            visible={noteEditor !== null}
            initialText={noteEditor?.mode === "edit" ? noteEditor.note.text : ""}
            isEditing={noteEditor?.mode === "edit"}
            onSave={saveNote}
            onDelete={deleteNote}
            onCancel={() => setNoteEditor(null)}
          />
        </View>
      )}
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
    progressTrack: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      zIndex: 10,
    },
    progressFill: {
      height: 3,
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
      paddingTop: 28,
      paddingBottom: 160,
    },
    title: {
      fontFamily: serif,
      fontSize: 32,
      lineHeight: 40,
      fontWeight: "700",
      color: c.ink,
      marginBottom: 12,
    },
    meta: {
      fontSize: 13,
      color: c.inkFaint,
      marginBottom: 14,
    },
  })
);
