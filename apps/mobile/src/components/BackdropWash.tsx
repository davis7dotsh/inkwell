// Faint hand-painted ink swashes scattered on the paper — the same brush
// gesture as the logo underline, scaled up and laid at slight angles. Gives
// liquid glass real edges to refract without resorting to gradients (which
// band on iPad panels and read generic).
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

type Swash = {
  path: string;
  x: number; // left edge, fraction of window width
  y: number; // top edge, fraction of window height
  w: number; // painted width, fraction of window width
  /** Height relative to width — lower is thinner. */
  aspect: number;
  rotate: number; // degrees
  opacity: number;
};

// Hand-placed: a bold sweep up by the header actions, a quiet line across
// the middle, and a wide soft band low on the page. Fractions keep the
// composition stable across iPad orientations.
const SWASHES: Swash[] = [
  { path: RIBBON, x: 0.5, y: 0.07, w: 0.55, aspect: 0.075, rotate: -7, opacity: 0.3 },
  { path: LINE, x: -0.08, y: 0.42, w: 0.5, aspect: 0.06, rotate: 4, opacity: 0.22 },
  { path: RIBBON, x: 0.45, y: 0.82, w: 0.62, aspect: 0.08, rotate: -3, opacity: 0.16 },
  { path: LINE, x: 0.02, y: 0.9, w: 0.34, aspect: 0.055, rotate: 6, opacity: 0.14 },
];

export function BackdropWash() {
  const { width, height } = useWindowDimensions();
  const { c } = useTheme();
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {SWASHES.map((s, i) => {
        const w = s.w * width;
        const h = w * s.aspect;
        return (
          <Group
            key={i}
            transform={[
              { translateX: s.x * width },
              { translateY: s.y * height },
              { rotate: (s.rotate * Math.PI) / 180 },
              { scaleX: w / 100 },
              { scaleY: h / 12 },
            ]}
          >
            <Path path={s.path} color={c.wash} opacity={s.opacity} />
          </Group>
        );
      })}
    </Canvas>
  );
}
