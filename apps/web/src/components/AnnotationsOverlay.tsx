// Read-only display of iPad markups over the web reader column. All stored
// coordinates are in annotation "content space" (see @inkwell/content
// types.ts) and scale by renderedColumnWidth / annotations.contentWidth.
//
// The two layers mirror the mobile reader's coordinate frames exactly:
// strokes anchor to the scroll-content origin (READER_TOP_PADDING above the
// column top), while boxes and notes anchor to the column's own top-left.
import type { Annotations } from "@inkwell/content";
import { strokeToSvgPath } from "@inkwell/content";
import React from "react";

function annotationScale(annotations: Annotations, columnWidth: number) {
  return annotations.contentWidth > 0
    ? columnWidth / annotations.contentWidth
    : 1;
}

type Props = {
  annotations: Annotations;
  /** Current rendered width of the content column, in CSS px. */
  columnWidth: number;
};

/**
 * Ink strokes as one SVG. Rendered as a sibling of the content column inside
 * the relatively-positioned reader content area (`.strokes-overlay` centers
 * it to the column; height stretches with the article).
 */
export function StrokesOverlay({ annotations, columnWidth }: Props) {
  const scale = annotationScale(annotations, columnWidth);
  if (annotations.strokes.length === 0) return null;
  return (
    <svg
      className="strokes-overlay"
      style={{ width: columnWidth }}
      aria-hidden="true"
    >
      <g transform={`scale(${scale})`}>
        {annotations.strokes.map((stroke) => {
          const d = strokeToSvgPath(stroke.points);
          if (!d) return null;
          return (
            <path
              key={stroke.id}
              d={d}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </g>
    </svg>
  );
}

/**
 * Key-section boxes and sticky-note bubbles, absolutely positioned inside
 * the content column (so they share its origin, exactly like mobile's
 * BoxesLayer/NotesLayer). Box inset/outset paddings match mobile.
 */
export function MarksOverlay({ annotations, columnWidth }: Props) {
  const scale = annotationScale(annotations, columnWidth);
  if (annotations.boxes.length === 0 && annotations.notes.length === 0) {
    return null;
  }
  return (
    <div className="annotations-layer" aria-hidden="true">
      {annotations.boxes.map((box) => (
        <div
          key={box.id}
          className="box-annotation"
          style={{
            left: box.x * scale - 6,
            top: box.y * scale - 4,
            width: box.w * scale + 12,
            height: box.h * scale + 8,
          }}
        />
      ))}
      {annotations.notes.map((note) => (
        <div
          key={note.id}
          className="note-annotation"
          style={{ left: note.x * scale, top: note.y * scale }}
        >
          <p>{note.text}</p>
        </div>
      ))}
    </div>
  );
}
