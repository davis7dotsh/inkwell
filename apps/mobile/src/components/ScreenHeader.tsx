// Custom safe-area-aware header. Always offers a way back to the library —
// even when the screen was opened via deep link and has no back history.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../lib/theme";

import { GlassSurface, glassAvailable } from "./glass";

type Props = {
  title?: string;
  /** Rendered at the trailing edge (e.g. open/export buttons). */
  right?: React.ReactNode;
};

export function ScreenHeader({ title, right }: Props) {
  const insets = useSafeAreaInsets();
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.side}>
          <Pressable
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back to library"
            style={({ pressed }) => pressed && !glassAvailable && styles.pressed}
          >
            <GlassSurface
              isInteractive
              style={styles.back}
              fallbackStyle={styles.backFallback}
            >
              <MaterialCommunityIcons
                name="chevron-left"
                size={26}
                color={colors.accent}
              />
              <Text style={styles.backLabel}>Library</Text>
            </GlassSurface>
          </Pressable>
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title ?? ""}
        </Text>
        <View style={[styles.side, styles.right]}>{right}</View>
      </View>
    </View>
  );
}

const SIDE_WIDTH = 110;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  row: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  side: {
    width: SIDE_WIDTH,
    flexDirection: "row",
    alignItems: "center",
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    borderRadius: 20,
    borderCurve: "continuous",
    paddingLeft: 4,
    paddingRight: 14,
  },
  backFallback: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  backLabel: {
    fontSize: 16,
    color: colors.accent,
    fontWeight: "500",
    marginLeft: -1,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  right: {
    justifyContent: "flex-end",
    gap: 10,
  },
  pressed: {
    opacity: 0.6,
  },
});
