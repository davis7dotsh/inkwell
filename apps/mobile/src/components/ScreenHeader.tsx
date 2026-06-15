// Custom safe-area-aware header. Always offers a way back to the library —
// even when the screen was opened via deep link and has no back history.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { makeThemedStyles, serif, useTheme } from "../lib/theme";

import { GlassSurface, glassAvailable } from "./glass";

type Props = {
  title?: string;
  subtitle?: string;
  /** Rendered at the trailing edge (e.g. open/export buttons). */
  right?: React.ReactNode;
  compact?: boolean;
};

export function ScreenHeader({
  title,
  subtitle,
  right,
  compact = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={[styles.row, compact && styles.compactRow]}>
        <View style={[styles.side, compact && styles.compactSide]}>
          <Pressable
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back to library"
            style={({ pressed }) => pressed && !glassAvailable && styles.pressed}
          >
            <GlassSurface
              isInteractive
              effectStyle="clear"
              style={[styles.back, compact && styles.compactBack]}
              fallbackStyle={styles.backFallback}
            >
              <MaterialCommunityIcons
                name="chevron-left"
                size={26}
                color={c.accent}
              />
              {compact ? null : (
                <Text style={styles.backLabel}>Library</Text>
              )}
            </GlassSurface>
          </Pressable>
        </View>
        <View style={styles.titleGroup}>
          <Text style={styles.title} numberOfLines={1}>
            {title ?? ""}
          </Text>
          {subtitle && !compact ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.side,
            styles.right,
            compact && styles.compactRight,
          ]}
        >
          {right}
        </View>
      </View>
    </View>
  );
}

const SIDE_WIDTH = 110;

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: c.background,
    },
    row: {
      height: 64,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
    },
    compactRow: {
      height: 56,
      gap: 8,
      paddingHorizontal: 10,
    },
    side: {
      width: SIDE_WIDTH,
      flexDirection: "row",
      alignItems: "center",
    },
    compactSide: {
      width: 38,
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
    compactBack: {
      width: 38,
      paddingLeft: 0,
      paddingRight: 0,
      justifyContent: "center",
    },
    backFallback: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
    },
    backLabel: {
      fontSize: 16,
      color: c.accent,
      fontWeight: "500",
      marginLeft: -1,
    },
    titleGroup: {
      flex: 1,
      alignItems: "center",
      minWidth: 0,
      paddingHorizontal: 12,
    },
    title: {
      width: "100%",
      textAlign: "center",
      fontFamily: serif,
      fontSize: 15,
      fontWeight: "600",
      color: c.ink,
    },
    subtitle: {
      width: "100%",
      marginTop: 2,
      textAlign: "center",
      fontSize: 11.5,
      color: c.inkFaint,
    },
    right: {
      justifyContent: "flex-end",
      gap: 10,
    },
    compactRight: {
      width: "auto",
      flexShrink: 0,
    },
    pressed: {
      opacity: 0.6,
    },
  })
);
