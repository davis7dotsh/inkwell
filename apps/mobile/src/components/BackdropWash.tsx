// A quiet ink motif tucked into the bottom-right corner — the logo's brush
// gesture stacked in parallel strokes that fade as they climb away from the
// corner. The rest of the page stays clean paper.
import { Canvas, Group, Path } from "@shopify/react-native-skia";
import React from "react";
import { StyleSheet, useWindowDimensions } from "react-native";

import { useTheme } from "../lib/theme";

import { RIBBON } from "./BrushStroke";

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
  {
    path: RIBBON,
    w: 0.3,
    aspect: 0.08,
    lift: 0.035,
    inset: -0.03,
    opacity: 0.34,
  },
  {
    path: LINE,
    w: 0.26,
    aspect: 0.06,
    lift: 0.085,
    inset: -0.01,
    opacity: 0.24,
  },
  {
    path: RIBBON,
    w: 0.21,
    aspect: 0.075,
    lift: 0.135,
    inset: 0.015,
    opacity: 0.16,
  },
  {
    path: LINE,
    w: 0.16,
    aspect: 0.055,
    lift: 0.185,
    inset: 0.04,
    opacity: 0.09,
  },
];

const TILT = (-8 * Math.PI) / 180;

export function BackdropWash() {
  const { width, height } = useWindowDimensions();
  const { c } = useTheme();
  const short = Math.min(width, height);
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {ROWS.map((row, i) => {
        const w = row.w * width;
        const h = w * row.aspect;
        const x = width - w - row.inset * width;
        const y = height - row.lift * short - h;
        return (
          <Group
            key={i}
            transform={[
              { translateX: x },
              { translateY: y },
              { rotate: TILT },
              { scaleX: w / 100 },
              { scaleY: h / 12 },
            ]}
          >
            <Path path={row.path} color={c.wash} opacity={row.opacity} />
          </Group>
        );
      })}
    </Canvas>
  );
}
