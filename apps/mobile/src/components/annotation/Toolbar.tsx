import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  displayInkColor,
  makeThemedStyles,
  penColors,
  useTheme,
} from "../../lib/theme";
import { GlassSurface } from "../glass";

export type Tool =
  | "read"
  | "pen"
  | "highlighter"
  | "box"
  | "note"
  | "memo"
  | "eraser";

const TOOLS: {
  tool: Tool;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
}[] = [
  { tool: "read", icon: "book-open-variant", label: "Reading mode" },
  { tool: "pen", icon: "pencil", label: "Pen" },
  { tool: "highlighter", icon: "marker", label: "Highlighter" },
  { tool: "box", icon: "vector-square", label: "Box" },
  { tool: "note", icon: "note-plus-outline", label: "Note" },
  { tool: "memo", icon: "microphone-outline", label: "Voice memo" },
  { tool: "eraser", icon: "eraser", label: "Eraser" },
];

// VoiceOver/TalkBack names for the stored pen inks (see penColors in theme).
const PEN_COLOR_NAMES: Record<string, string> = {
  "#0E2E52": "Deep ink",
  "#1B4F8A": "Brush blue",
  "#3D7BC0": "Stroke blue",
  "#B0413E": "Seal red",
};

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
  const { scheme, c, isDark } = useTheme();
  const styles = themed[scheme];
  return (
    <View
      style={[styles.wrap, { right: Math.max(insets.right, 12) + 14 }]}
      pointerEvents="box-none"
    >
      {tool === "pen" && (
        <GlassSurface
          style={[styles.pill, styles.colorRow]}
          fallbackStyle={styles.pillFallback}
        >
          {penColors.map((color) => (
            <Pressable
              key={color}
              onPress={() => onPenColorChange(color)}
              accessibilityRole="button"
              accessibilityLabel={`${PEN_COLOR_NAMES[color] ?? color} pen`}
              accessibilityState={{ selected: color === penColor }}
              hitSlop={8}
              style={[
                styles.colorDot,
                { backgroundColor: displayInkColor(color, isDark) },
                color === penColor && styles.colorDotActive,
              ]}
            />
          ))}
        </GlassSurface>
      )}
      <GlassSurface style={styles.pill} fallbackStyle={styles.pillFallback}>
        {TOOLS.map(({ tool: t, icon, label }) => (
          <Pressable
            key={t}
            onPress={() => onToolChange(t)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: tool === t }}
            style={[styles.button, tool === t && styles.buttonActive]}
          >
            <MaterialCommunityIcons
              name={icon}
              size={22}
              color={tool === t ? c.accent : c.inkSecondary}
            />
          </Pressable>
        ))}
        <View style={styles.divider} />
        <Pressable
          onPress={onUndo}
          disabled={!canUndo}
          accessibilityRole="button"
          accessibilityLabel="Undo last annotation"
          accessibilityState={{ disabled: !canUndo }}
          style={styles.button}
        >
          <MaterialCommunityIcons
            name="undo"
            size={22}
            color={canUndo ? c.inkSecondary : c.hairline}
          />
        </Pressable>
      </GlassSurface>
    </View>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    wrap: {
      position: "absolute",
      top: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 10,
    },
    pill: {
      flexDirection: "column",
      alignItems: "center",
      borderRadius: 28,
      borderCurve: "continuous",
      paddingHorizontal: 6,
      paddingVertical: 8,
      gap: 2,
    },
    pillFallback: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
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
      backgroundColor: c.accentSoft,
    },
    divider: {
      width: 24,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.hairline,
      marginVertical: 4,
    },
    colorRow: {
      paddingHorizontal: 8,
      paddingVertical: 12,
      gap: 10,
    },
    colorDot: {
      width: 24,
      height: 24,
      borderRadius: 12,
    },
    colorDotActive: {
      borderWidth: 3,
      borderColor: c.background,
      transform: [{ scale: 1.2 }],
    },
  })
);
