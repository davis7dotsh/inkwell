// A quiet ink motif tucked into the bottom-right corner — the logo's brush
// gesture stacked in parallel strokes that fade as they climb away from the
// corner. Direct SVG port of the mobile BackdropWash (Skia) so both apps
// share the same backdrop language. Fixed behind the content; never
// intercepts pointer events.
import React, { useEffect, useState } from "react";

import { useTheme } from "../lib/theme";

// Same fixed tapered-ribbon path as BrushStroke (100x12 box).
const RIBBON =
  "M 2 7.6" +
  " C 12 3.6 30 2.8 50 4.2" +
  " C 68 5.4 84 3.6 98 5.4" +
  " C 99.4 5.8 99.4 6.6 98.2 7.0" +
  " C 84 6.6 66 8.6 46 7.8" +
  " C 28 7.1 12 9.6 2.4 9.0" +
  " C 1.2 8.7 1.0 8.1 2 7.6 Z";

// A longer, thinner sibling of RIBBON in the same 100x12 box — reads as a
// single confident pen line rather than a wash band.
const LINE =
  "M 2 6.4" +
  " C 20 4.6 45 4.0 70 5.0" +
  " C 82 5.5 92 5.2 98 5.8" +
  " C 99 6.1 99 6.6 98 6.8" +
  " C 88 7.4 70 6.8 50 6.9" +
  " C 30 7.0 14 7.8 2.6 7.4" +
  " C 1.4 7.2 1.2 6.7 2 6.4 Z";

type Row = {
  path: string;
  /** Painted width as a fraction of the window width. */
  w: number;
  /** Height relative to width — lower is thinner. */
  aspect: number;
  /** Gap above the bottom edge, as a fraction of the shortest side. */
  lift: number;
  /** Extra inset from the right edge, fraction of window width. */
  inset: number;
  opacity: number;
};

// Stacked from the corner upward: each stroke a little shorter, a little
// farther from the edge, and fainter — the pattern dissolves into the paper.
const ROWS: Row[] = [
  { path: RIBBON, w: 0.3, aspect: 0.08, lift: 0.035, inset: -0.03, opacity: 0.34 },
  { path: LINE, w: 0.26, aspect: 0.06, lift: 0.085, inset: -0.01, opacity: 0.24 },
  { path: RIBBON, w: 0.21, aspect: 0.075, lift: 0.135, inset: 0.015, opacity: 0.16 },
  { path: LINE, w: 0.16, aspect: 0.055, lift: 0.185, inset: 0.04, opacity: 0.09 },
];

const TILT = -8;

function useWindowSize() {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

export function BackdropWash() {
  const { width, height } = useWindowSize();
  const { c } = useTheme();
  const short = Math.min(width, height);
  return (
    <svg
      className="backdrop-wash"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {ROWS.map((row, i) => {
        const w = row.w * width;
        const h = w * row.aspect;
        const x = width - w - row.inset * width;
        const y = height - row.lift * short - h;
        return (
          <g
            key={i}
            transform={`translate(${x} ${y}) rotate(${TILT}) scale(${w / 100} ${h / 12})`}
          >
            <path d={row.path} fill={c.wash} opacity={row.opacity} />
          </g>
        );
      })}
    </svg>
  );
}
