import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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

const IPHONE_TOOLS = TOOLS.filter(({ tool }) =>
  ["read", "note", "memo", "eraser"].includes(tool),
);

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
  isPhone?: boolean;
};

export function Toolbar({
  tool,
  onToolChange,
  penColor,
  onPenColorChange,
  canUndo,
  onUndo,
  isPhone = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { scheme, c, isDark } = useTheme();
  const styles = themed[scheme];
  const tools = isPhone ? IPHONE_TOOLS : TOOLS;
  const [dismissed, setDismissed] = useState(false);

  const finishDismiss = useCallback(() => {
    onToolChange("read");
    setDismissed(true);
  }, [onToolChange]);

  const restore = useCallback(() => {
    setDismissed(false);
  }, []);

  const dismissGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX(6)
        .failOffsetY([-20, 20])
        .onEnd((event) => {
          if (event.translationX > 18 || event.velocityX > 300) {
            finishDismiss();
          }
        }),
    [finishDismiss],
  );

  if (!isPhone && dismissed) {
    return (
      <View
        style={[styles.handleWrap, { right: Math.max(insets.right, 0) - 8 }]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={restore}
          accessibilityRole="button"
          accessibilityLabel="Show annotation tools"
          hitSlop={4}
          style={styles.handleTarget}
        >
          <GlassSurface
            isInteractive
            effectStyle="clear"
            style={styles.handle}
            fallbackStyle={styles.handleFallback}
          >
            <View style={styles.handleLine} />
          </GlassSurface>
        </Pressable>
      </View>
    );
  }

  if (isPhone) {
    return (
      <View
        style={[styles.phoneWrap, { bottom: Math.max(insets.bottom, 10) }]}
        pointerEvents="box-none"
      >
        <GlassSurface
          effectStyle="clear"
          style={[styles.pill, styles.phonePill]}
          fallbackStyle={styles.pillFallback}
        >
          {tools.map(({ tool: t, icon, label }) => (
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
          {canUndo ? (
            <>
              <View style={styles.phoneDivider} />
              <Pressable
                onPress={onUndo}
                accessibilityRole="button"
                accessibilityLabel="Undo last annotation"
                style={styles.button}
              >
                <MaterialCommunityIcons
                  name="undo"
                  size={22}
                  color={c.inkSecondary}
                />
              </Pressable>
            </>
          ) : null}
        </GlassSurface>
      </View>
    );
  }

  return (
    <View
      style={[styles.wrap, { right: Math.max(insets.right, 12) + 14 }]}
      pointerEvents="box-none"
    >
      <GestureDetector gesture={dismissGesture}>
        <View style={styles.desktopRail}>
          {tool === "pen" ? (
            <GlassSurface
              effectStyle="clear"
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
          ) : null}
          <GlassSurface
            effectStyle="clear"
            style={styles.pill}
            fallbackStyle={styles.pillFallback}
          >
            {tools.map(({ tool: t, icon, label }) => (
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
            {canUndo ? (
              <>
                <View style={styles.divider} />
                <Pressable
                  onPress={onUndo}
                  accessibilityRole="button"
                  accessibilityLabel="Undo last annotation"
                  style={styles.button}
                >
                  <MaterialCommunityIcons
                    name="undo"
                    size={22}
                    color={c.inkSecondary}
                  />
                </Pressable>
              </>
            ) : null}
            <View style={styles.divider} />
            <Pressable
              onPress={finishDismiss}
              accessibilityRole="button"
              accessibilityLabel="Hide annotation tools"
              style={styles.button}
            >
              <MaterialCommunityIcons
                name="chevron-right"
                size={21}
                color={c.inkFaint}
              />
            </Pressable>
          </GlassSurface>
        </View>
      </GestureDetector>
    </View>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    wrap: {
      position: "absolute",
      top: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    desktopRail: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    handleWrap: {
      position: "absolute",
      top: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    handleTarget: {
      width: 44,
      height: 88,
      alignItems: "flex-end",
      justifyContent: "center",
    },
    handle: {
      width: 15,
      height: 72,
      borderRadius: 8,
      borderCurve: "continuous",
      alignItems: "center",
      justifyContent: "center",
    },
    handleFallback: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
    },
    handleLine: {
      width: 2,
      height: 30,
      borderRadius: 1,
      backgroundColor: c.inkFaint,
      opacity: 0.42,
    },
    phoneWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      alignItems: "center",
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
    phonePill: {
      flexDirection: "row",
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 2,
    },
    pillFallback: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      shadowColor: "#172A3E",
      shadowOpacity: 0.13,
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
    phoneDivider: {
      width: StyleSheet.hairlineWidth,
      height: 24,
      backgroundColor: c.hairline,
      marginHorizontal: 4,
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
  }),
);
