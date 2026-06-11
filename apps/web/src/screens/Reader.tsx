// Reader: read-only web rendering of a saved article plus the iPad markups.
// Blocks come from articles.get (blocksJson), annotations stream live from
// annotations.get and are drawn scaled over the content column.
import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import type { Annotations, Block } from "@inkwell/content";
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
import { MAX_CONTENT_WIDTH, useTheme } from "../lib/theme";

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

function ReaderBar({
  title,
  withProgress,
}: {
  title?: string;
  withProgress?: boolean;
}) {
  return (
    <header className="reader-bar">
      <Link to="/" className="back-link">
        ← Library
      </Link>
      <span className="reader-title">{title ?? ""}</span>
      <span />
      {withProgress ? <ScrollProgressBar /> : null}
    </header>
  );
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
}): Annotations | null {
  try {
    return {
      contentWidth: doc.contentWidth,
      strokes: JSON.parse(doc.strokesJson),
      boxes: JSON.parse(doc.boxesJson),
      notes: JSON.parse(doc.notesJson),
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
    article ? { articleId: article._id } : "skip"
  );
  const setReadStatus = useMutation(api.articles.setReadStatus);

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
    [annotationDoc]
  );

  // The annotation scale tracks the column's rendered width (≤ 700px).
  const [columnWidth, setColumnWidth] = useState<number | null>(null);
  const columnRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setColumnWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
          {article.error ?? "Unknown error."} You can retry it from the
          library.
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
      <ReaderBar title={article.title} withProgress />
      <div className="reader-content">
        <article className="content-column" ref={columnRef}>
          <h1 className="article-title">{article.title}</h1>
          <p className="article-meta">{meta}</p>
          <BrushStroke
            width={Math.min(220, (columnWidth ?? MAX_CONTENT_WIDTH) * 0.4)}
            height={8}
            color={c.wash}
            opacity={0.75}
            className="title-brush"
          />
          <BlockRenderer blocks={blocks} />
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
            <MarksOverlay annotations={annotations} columnWidth={columnWidth} />
          ) : null}
        </article>
        {annotations && columnWidth ? (
          <StrokesOverlay annotations={annotations} columnWidth={columnWidth} />
        ) : null}
      </div>
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
