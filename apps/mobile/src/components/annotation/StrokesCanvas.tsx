// Viewport-sized Skia canvas that renders ink strokes. The canvas itself
// never scrolls; a Reanimated-driven group transform counter-translates by
// the scroll offset so strokes stay glued to the article content.
import { strokeToSvgPath, type Stroke } from "@inkwell/content";
import { Canvas, Group, Path } from "@shopify/react-native-skia";
import React, { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { displayInkColor, useTheme } from "../../lib/theme";

// Stored stroke colors are canonical (light-theme inks); isDark swaps in the
// night-legible variants at render time only.
function StrokePath({ stroke, isDark }: { stroke: Stroke; isDark: boolean }) {
  const path = useMemo(() => strokeToSvgPath(stroke.points), [stroke.points]);
  if (!path) return null;
  return (
    <Path
      path={path}
      color={displayInkColor(stroke.color, isDark)}
      style="stroke"
      strokeWidth={stroke.width}
      strokeCap="round"
      strokeJoin="round"
    />
  );
}

/** Committed strokes, memoized so live drawing only re-renders the active path. */
const CommittedStrokes = memo(function CommittedStrokes({
  strokes,
  isDark,
}: {
  strokes: Stroke[];
  isDark: boolean;
}) {
  return (
    <>
      {strokes.map((stroke) => (
        <StrokePath key={stroke.id} stroke={stroke} isDark={isDark} />
      ))}
    </>
  );
});

type Props = {
  strokes: Stroke[];
  activeStroke: Stroke | null;
  scrollY: SharedValue<number>;
  /** Horizontal offset of the content column inside the viewport. */
  offsetX: number;
  /** Vertical offset of the content column inside the scroll content. */
  offsetY: number;
  /** annotation space -> current render space. */
  scale: number;
};

export function StrokesCanvas({
  strokes,
  activeStroke,
  scrollY,
  offsetX,
  offsetY,
  scale,
}: Props) {
  const { isDark } = useTheme();
  const scrollTransform = useDerivedValue(() => [
    { translateY: -scrollY.value },
  ]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Group transform={scrollTransform}>
          <Group
            transform={[
              { translateX: offsetX },
              { translateY: offsetY },
              { scale },
            ]}
          >
            <CommittedStrokes strokes={strokes} isDark={isDark} />
            {activeStroke ? (
              <StrokePath stroke={activeStroke} isDark={isDark} />
            ) : null}
          </Group>
        </Group>
      </Canvas>
    </View>
  );
}
