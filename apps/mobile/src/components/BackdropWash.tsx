// Soft radial blue washes painted behind a screen so liquid glass has
// real color variance to refract — on flat paper the glass all but
// disappears. Theme-aware: airy wash blues by day, deep glows at night.
import {
  Canvas,
  Circle,
  RadialGradient,
  vec,
} from "@shopify/react-native-skia";
import React from "react";
import { StyleSheet, useWindowDimensions } from "react-native";

import { useTheme } from "../lib/theme";

type Blob = { cx: number; cy: number; r: number; color: string };

// Positions/radii are fractions of the window so the wash composes the same
// on any iPad orientation.
const LIGHT_BLOBS: Blob[] = [
  { cx: 0.92, cy: 0.02, r: 0.42, color: "rgba(143, 184, 222, 0.50)" }, // wash
  { cx: 0.04, cy: 0.30, r: 0.36, color: "rgba(27, 79, 138, 0.13)" }, // brush
  { cx: 0.55, cy: 0.95, r: 0.55, color: "rgba(61, 123, 192, 0.16)" }, // stroke
];

const DARK_BLOBS: Blob[] = [
  { cx: 0.92, cy: 0.02, r: 0.46, color: "rgba(27, 79, 138, 0.55)" },
  { cx: 0.04, cy: 0.30, r: 0.38, color: "rgba(61, 123, 192, 0.22)" },
  { cx: 0.55, cy: 0.95, r: 0.60, color: "rgba(14, 46, 82, 0.65)" },
];

export function BackdropWash() {
  const { width, height } = useWindowDimensions();
  const { isDark } = useTheme();
  const blobs = isDark ? DARK_BLOBS : LIGHT_BLOBS;
  const base = Math.max(width, height);
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {blobs.map((blob, i) => {
        const c = vec(blob.cx * width, blob.cy * height);
        const r = blob.r * base;
        return (
          <Circle key={i} c={c} r={r}>
            <RadialGradient
              c={c}
              r={r}
              colors={[blob.color, "transparent"]}
            />
          </Circle>
        );
      })}
    </Canvas>
  );
}
