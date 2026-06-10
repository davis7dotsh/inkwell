// A small hand-painted ink swash, used as a decorative accent (title
// underlines, section dividers). Same fixed tapered-ribbon path as the
// mobile BrushStroke, rendered as plain SVG.
import React from "react";

// Tapered wavy ribbon in a 100x12 box: thick rounded start, slight swell in
// the middle, thinning tail — the "ink wash" gesture.
const RIBBON =
  "M 2 7.6" +
  " C 12 3.6 30 2.8 50 4.2" +
  " C 68 5.4 84 3.6 98 5.4" +
  " C 99.4 5.8 99.4 6.6 98.2 7.0" +
  " C 84 6.6 66 8.6 46 7.8" +
  " C 28 7.1 12 9.6 2.4 9.0" +
  " C 1.2 8.7 1.0 8.1 2 7.6 Z";

type Props = {
  width: number;
  height?: number;
  color: string;
  opacity?: number;
  className?: string;
};

export function BrushStroke({
  width,
  height = 10,
  color,
  opacity = 1,
  className,
}: Props) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path d={RIBBON} fill={color} opacity={opacity} />
    </svg>
  );
}
