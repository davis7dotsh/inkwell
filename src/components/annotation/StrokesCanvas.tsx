// Viewport-sized Skia canvas that renders ink strokes. The canvas itself
// never scrolls; a Reanimated-driven group transform counter-translates by
// the scroll offset so strokes stay glued to the article content.
import { Canvas, Group, Path } from "@shopify/react-native-skia";
import React, { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { strokeToSvgPath } from "../../lib/strokePath";
import type { Stroke } from "../../lib/types";

function StrokePath({ stroke }: { stroke: Stroke }) {
  const path = useMemo(() => strokeToSvgPath(stroke.points), [stroke.points]);
  if (!path) return null;
  return (
    <Path
      path={path}
      color={stroke.color}
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
}: {
  strokes: Stroke[];
}) {
  return (
    <>
      {strokes.map((stroke) => (
        <StrokePath key={stroke.id} stroke={stroke} />
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
  /** annotation space -> current render space. */
  scale: number;
};

export function StrokesCanvas({
  strokes,
  activeStroke,
  scrollY,
  offsetX,
  scale,
}: Props) {
  const scrollTransform = useDerivedValue(() => [
    { translateY: -scrollY.value },
  ]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Group transform={scrollTransform}>
          <Group transform={[{ translateX: offsetX }, { scale }]}>
            <CommittedStrokes strokes={strokes} />
            {activeStroke ? <StrokePath stroke={activeStroke} /> : null}
          </Group>
        </Group>
      </Canvas>
    </View>
  );
}
