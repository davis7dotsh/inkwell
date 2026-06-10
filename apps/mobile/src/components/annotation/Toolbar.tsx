import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, penColors } from "../../lib/theme";

export type Tool = "read" | "pen" | "highlighter" | "box" | "note" | "eraser";

const TOOLS: {
  tool: Tool;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}[] = [
  { tool: "read", icon: "book-open-variant" },
  { tool: "pen", icon: "pencil" },
  { tool: "highlighter", icon: "marker" },
  { tool: "box", icon: "vector-square" },
  { tool: "note", icon: "note-plus-outline" },
  { tool: "eraser", icon: "eraser" },
];

type Props = {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  penColor: string;
  onPenColorChange: (color: string) => void;
  canUndo: boolean;
  onUndo: () => void;
};

export function Toolbar({
  tool,
  onToolChange,
  penColor,
  onPenColorChange,
  canUndo,
  onUndo,
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 14 }]}
      pointerEvents="box-none"
    >
      {tool === "pen" && (
        <View style={[styles.pill, styles.colorRow]}>
          {penColors.map((color) => (
            <Pressable
              key={color}
              onPress={() => onPenColorChange(color)}
              style={[
                styles.colorDot,
                { backgroundColor: color },
                color === penColor && styles.colorDotActive,
              ]}
            />
          ))}
        </View>
      )}
      <View style={styles.pill}>
        {TOOLS.map(({ tool: t, icon }) => (
          <Pressable
            key={t}
            onPress={() => onToolChange(t)}
            style={[styles.button, tool === t && styles.buttonActive]}
          >
            <MaterialCommunityIcons
              name={icon}
              size={22}
              color={tool === t ? colors.accent : colors.inkSecondary}
            />
          </Pressable>
        ))}
        <View style={styles.divider} />
        <Pressable
          onPress={onUndo}
          disabled={!canUndo}
          style={styles.button}
        >
          <MaterialCommunityIcons
            name="undo"
            size={22}
            color={canUndo ? colors.inkSecondary : colors.hairline}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 10,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    shadowColor: "#0E2E52",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  button: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonActive: {
    backgroundColor: colors.accentSoft,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: colors.hairline,
    marginHorizontal: 4,
  },
  colorRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  colorDotActive: {
    borderWidth: 3,
    borderColor: colors.accentSoft,
    transform: [{ scale: 1.2 }],
  },
});
