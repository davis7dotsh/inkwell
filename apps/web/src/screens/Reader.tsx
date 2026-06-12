// Reader: read-only web rendering of a saved article plus the iPad markups.
// Blocks come from articles.get (blocksJson), annotations stream live from
// annotations.get and are drawn scaled over the content column.
import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import {
  buildDocumentOutline,
  buildExportMarkdown,
  emptyAnnotations,
  type Annotations,
  type Block,
  type BlockLayout,
} from "@inkwell/content";
import { useMutation, useQuery } from "convex/react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useParams } from "react-router-dom";

import { MarksOverlay, StrokesOverlay } from "../components/AnnotationsOverlay";
import { BlockRenderer } from "../components/BlockRenderer";
import { BrushStroke } from "../components/BrushStroke";
import { DocumentOutline } from "../components/DocumentOutline";
import { MemosOverlay } from "../components/MemosOverlay";
import { MAX_CONTENT_WIDTH, useTheme } from "../lib/theme";

const DOCUMENT_START_ID = "document-start";

/** Thin reading-progress bar pinned to the bottom edge of the sticky bar.
 * Writes the transform directly so scrolling never re-renders the reader. */
function ScrollProgressBar() {
  const fillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress =
        max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${progress})`;
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  return (
    <div className="scroll-progress-track" aria-hidden>
      <div ref={fillRef} className="scroll-progress-fill" />
    </div>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 14v5h14v-5" />
    </svg>
  );
}

function ContentsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

function ReaderBar({
  title,
  withProgress,
  onExport,
  hasOutline,
  onToggleOutline,
}: {
  title?: string;
  withProgress?: boolean;
  onExport?: () => void;
  hasOutline?: boolean;
  onToggleOutline?: () => void;
}) {
  return (
    <header className="reader-bar">
      <Link to="/" className="back-link">
        ← Library
      </Link>
      <span className="reader-title">{title ?? ""}</span>
      <div className="reader-actions">
        {hasOutline && onToggleOutline ? (
          <button
            type="button"
            className="reader-outline-toggle"
            onClick={onToggleOutline}
            aria-label="Open document outline"
          >
            <ContentsIcon />
            <span>Contents</span>
          </button>
        ) : null}
        {onExport ? (
          <button
            type="button"
            className="reader-export-button"
            onClick={onExport}
            aria-label="Export markup as Markdown"
          >
            <ExportIcon />
            <span>Export</span>
          </button>
        ) : null}
      </div>
      {withProgress ? <ScrollProgressBar /> : null}
    </header>
  );
}

function useActiveDocumentSection(
  outline: ReturnType<typeof buildDocumentOutline>,
) {
  const [activeId, setActiveId] = useState(DOCUMENT_START_ID);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const threshold = 104;
      let nextId = DOCUMENT_START_ID;
      for (const entry of outline) {
        const element = document.getElementById(entry.id);
        if (!element || element.getBoundingClientRect().top > threshold) break;
        nextId = entry.id;
      }
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4;
      if (atBottom && outline.length > 0) {
        nextId = outline[outline.length - 1].id;
      }
      setActiveId((current) => (current === nextId ? current : nextId));
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [outline]);

  return activeId;
}

function CenterState({ children }: { children: ReactNode }) {
  return (
    <div className="reader">
      <ReaderBar />
      <div className="center-state">{children}</div>
    </div>
  );
}

/**
 * Convex queries throw from the hook on bad ids or cross-user access; the
 * boundary turns that into a calm "not found" screen.
 */
class ReaderBoundary extends React.Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <CenterState>
          <p>Article not found.</p>
          <Link to="/" className="back-link">
            Back to the library
          </Link>
        </CenterState>
      );
    }
    return this.props.children;
  }
}

function parseAnnotations(doc: {
  contentWidth: number;
  strokesJson: string;
  boxesJson: string;
  notesJson: string;
  /** Rows written before voice memos existed lack the column. */
  memosJson?: string;
}): Annotations | null {
  try {
    return {
      contentWidth: doc.contentWidth,
      strokes: JSON.parse(doc.strokesJson),
      boxes: JSON.parse(doc.boxesJson),
      notes: JSON.parse(doc.notesJson),
      memos: JSON.parse(doc.memosJson ?? "[]"),
    };
  } catch {
    return null;
  }
}

function ReaderInner({ id }: { id: Id<"articles"> }) {
  const { c } = useTheme();
  const article = useQuery(api.articles.get, { id });
  const annotationDoc = useQuery(
    api.annotations.get,
    article ? { articleId: article._id } : "skip",
  );
  const setReadStatus = useMutation(api.articles.setReadStatus);
  const [outlineOpen, setOutlineOpen] = useState(false);

  // Opening an unread article flips it to in-progress — once per visit, so
  // "mark as unread" from the footer isn't immediately undone.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (article?.status !== "ready") return;
    autoStartedRef.current = true;
    if ((article.readStatus ?? "unread") === "unread") {
      void setReadStatus({ id, status: "in_progress" });
    }
  }, [article, id, setReadStatus]);

  const blocks = useMemo<Block[]>(() => {
    if (!article?.blocksJson) return [];
    try {
      return JSON.parse(article.blocksJson) as Block[];
    } catch {
      return [];
    }
  }, [article?.blocksJson]);

  const annotations = useMemo<Annotations | null>(
    () => (annotationDoc ? parseAnnotations(annotationDoc) : null),
    [annotationDoc],
  );
  const outline = useMemo(() => buildDocumentOutline(blocks), [blocks]);
  const headingIds = useMemo(
    () =>
      new Map(outline.map((entry) => [entry.blockIndex, entry.id] as const)),
    [outline],
  );
  const activeOutlineId = useActiveDocumentSection(outline);

  const onOutlineNavigate = useCallback((targetId: string) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
    window.history.replaceState(null, "", `#${targetId}`);
    setOutlineOpen(false);
  }, []);

  useEffect(() => {
    if (!outlineOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOutlineOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [outlineOpen]);

  useEffect(() => {
    if (outline.length === 0 || !window.location.hash) return;
    const targetId = decodeURIComponent(window.location.hash.slice(1));
    const frame = requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [outline]);

  // The annotation scale tracks the column's rendered width (≤ 900px).
  const [columnWidth, setColumnWidth] = useState<number | null>(null);
  const blocksRef = useRef<HTMLDivElement>(null);
  const columnRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setColumnWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onExport = useCallback(async () => {
    const blockContainer = blocksRef.current;
    const column = blockContainer?.parentElement;
    if (
      !article ||
      article.status !== "ready" ||
      !columnWidth ||
      !blockContainer ||
      !column
    ) {
      return;
    }

    const columnTop = column.getBoundingClientRect().top;
    const layouts = new Map<number, BlockLayout>();
    Array.from(blockContainer.children).forEach((element, index) => {
      const rect = element.getBoundingClientRect();
      layouts.set(index, { y: rect.top - columnTop, height: rect.height });
    });

    const exportAnnotations = annotations ?? emptyAnnotations(columnWidth);
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
      exportAnnotations,
      layouts,
      columnWidth / exportAnnotations.contentWidth,
    );
    const baseName =
      article.title
        .replace(/[\\/:*?"<>|\n\r]+/g, " ")
        .trim()
        .slice(0, 80) || "article";
    const file = new File([markdown], `${baseName}.md`, {
      type: "text/markdown;charset=utf-8",
    });

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: article.title });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
      }
    }

    const fileUrl = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(fileUrl), 0);
  }, [annotations, article, blocks, columnWidth]);

  if (article === undefined) {
    return (
      <CenterState>
        <span className="pulse-dot" />
      </CenterState>
    );
  }

  if (article.status === "pending") {
    return (
      <CenterState>
        <span className="chip chip-pending">
          <span className="chip-dot" />
          Saving…
        </span>
        <p className="center-state-hint">
          Still preparing this article — it will appear here the moment it's
          ready.
        </p>
      </CenterState>
    );
  }

  if (article.status === "failed") {
    return (
      <CenterState>
        <p>This article failed to save.</p>
        <p className="center-state-hint">
          {article.error ?? "Unknown error."} You can retry it from the library.
        </p>
        <Link to="/" className="back-link">
          Back to the library
        </Link>
      </CenterState>
    );
  }

  const savedDate = new Date(article.savedAt).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const meta = [article.byline, article.siteName, savedDate]
    .filter(Boolean)
    .join("  ·  ");

  const isRead = article.readStatus === "read";

  return (
    <div className="reader">
      <ReaderBar
        title={article.title}
        withProgress
        onExport={() => void onExport()}
        hasOutline={outline.length > 0}
        onToggleOutline={() => setOutlineOpen(true)}
      />
      <div className="reader-content">
        <div className="reader-layout">
          {outline.length > 0 ? (
            <aside className="document-outline-rail">
              <DocumentOutline
                entries={outline}
                activeId={activeOutlineId}
                onNavigate={onOutlineNavigate}
              />
            </aside>
          ) : null}
          <article className="content-column" ref={columnRef}>
            <h1 id={DOCUMENT_START_ID} tabIndex={-1} className="article-title">
              {article.title}
            </h1>
            <p className="article-meta">{meta}</p>
            <BrushStroke
              width={Math.min(220, (columnWidth ?? MAX_CONTENT_WIDTH) * 0.4)}
              height={8}
              color={c.wash}
              opacity={0.75}
              className="title-brush"
            />
            <div className="article-blocks" ref={blocksRef}>
              <BlockRenderer blocks={blocks} headingIds={headingIds} />
            </div>
            <footer className="read-footer">
              <button
                className={`mark-read-button${isRead ? " mark-read-button-done" : ""}`}
                onClick={() =>
                  void setReadStatus({
                    id,
                    status: isRead ? "unread" : "read",
                  })
                }
              >
                {isRead ? "✓ Read — mark as unread" : "Mark as read"}
              </button>
              {isRead ? null : (
                <p className="read-footer-hint">
                  Finished? This moves it to your Read list everywhere.
                </p>
              )}
            </footer>
            {annotations && columnWidth ? (
              <>
                <MarksOverlay
                  annotations={annotations}
                  columnWidth={columnWidth}
                />
                <StrokesOverlay
                  annotations={annotations}
                  columnWidth={columnWidth}
                />
                <MemosOverlay
                  annotations={annotations}
                  columnWidth={columnWidth}
                  articleId={article._id}
                />
              </>
            ) : null}
          </article>
        </div>
      </div>
      {outline.length > 0 && outlineOpen ? (
        <div className="document-outline-drawer">
          <button
            type="button"
            className="document-outline-scrim"
            onClick={() => setOutlineOpen(false)}
            aria-label="Close document outline"
          />
          <aside
            className="document-outline-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Document outline"
          >
            <button
              type="button"
              className="document-outline-close"
              onClick={() => setOutlineOpen(false)}
              aria-label="Close document outline"
            >
              Close
            </button>
            <DocumentOutline
              entries={outline}
              activeId={activeOutlineId}
              onNavigate={onOutlineNavigate}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export function Reader() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return (
      <CenterState>
        <p>Article not found.</p>
      </CenterState>
    );
  }
  return (
    <ReaderBoundary key={id}>
      <ReaderInner id={id as Id<"articles">} />
    </ReaderBoundary>
  );
}
