// Key-section boxes, rendered as positioned views inside the content
// container (so they scroll naturally with the article).
import React, { memo } from "react";
import { StyleSheet, View } from "react-native";

import { colors } from "../../lib/theme";
import type { BoxAnnotation } from "../../lib/types";

function Box({ box, scale }: { box: BoxAnnotation; scale: number }) {
  return (
    <View
      style={[
        styles.box,
        {
          left: box.x * scale - 6,
          top: box.y * scale - 4,
          width: box.w * scale + 12,
          height: box.h * scale + 8,
        },
      ]}
    />
  );
}

type Props = {
  boxes: BoxAnnotation[];
  /** In-progress drag preview, in annotation space. */
  previewBox: BoxAnnotation | null;
  scale: number;
};

export const BoxesLayer = memo(function BoxesLayer({
  boxes,
  previewBox,
  scale,
}: Props) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {boxes.map((box) => (
        <Box key={box.id} box={box} scale={scale} />
      ))}
      {previewBox ? <Box box={previewBox} scale={scale} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    borderWidth: 2,
    borderColor: colors.boxStroke,
    backgroundColor: colors.boxFill,
    borderRadius: 8,
    borderStyle: "dashed",
  },
});
