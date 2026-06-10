// Custom safe-area-aware header. Always offers a way back to the library —
// even when the screen was opened via deep link and has no back history.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "../lib/theme";

type Props = {
  title?: string;
  /** Rendered at the trailing edge (e.g. an export button). */
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
        <Pressable
          onPress={goBack}
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        >
          <MaterialCommunityIcons
            name="chevron-left"
            size={28}
            color={colors.accent}
          />
          <Text style={styles.backLabel}>Library</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title ?? ""}
        </Text>
        <View style={styles.right}>{right}</View>
      </View>
    </View>
  );
}

const SIDE_WIDTH = 96;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  row: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  back: {
    width: SIDE_WIDTH,
    flexDirection: "row",
    alignItems: "center",
  },
  backLabel: {
    fontSize: 16,
    color: colors.accent,
    marginLeft: -2,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  right: {
    width: SIDE_WIDTH,
    alignItems: "flex-end",
    paddingRight: 6,
  },
});
