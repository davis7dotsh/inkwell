// A small hand-painted ink swash, used as a decorative accent (title
// underlines, section dividers). Drawn with Skia from a fixed tapered-ribbon
// path so every instance scales cleanly to any size.
import { Canvas, Group, Path } from "@shopify/react-native-skia";
import React from "react";
import type { StyleProp, ViewStyle } from "react-native";

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
  style?: StyleProp<ViewStyle>;
};

export function BrushStroke({
  width,
  height = 10,
  color,
  opacity = 1,
  style,
}: Props) {
  return (
    <Canvas style={[{ width, height }, style]}>
      <Group transform={[{ scaleX: width / 100 }, { scaleY: height / 12 }]}>
        <Path path={RIBBON} color={color} opacity={opacity} />
      </Group>
    </Canvas>
  );
}
