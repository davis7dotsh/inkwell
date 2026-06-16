// Liquid-glass building blocks (iOS 26+). Every component degrades to the
// app's pre-glass solid surfaces, so Android, older iOS, and binaries built
// with an older Xcode keep the existing look.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { makeThemedStyles, useTheme } from "../lib/theme";

// Some iOS 26 betas expose Liquid Glass without the API being usable
// (expo/expo#40911), hence both checks.
export const glassAvailable =
  Platform.OS === "ios" &&
  isLiquidGlassAvailable() &&
  isGlassEffectAPIAvailable();

type GlassSurfaceProps = {
  style?: StyleProp<ViewStyle>;
  /** Applied INSTEAD of glass when liquid glass is unavailable. */
  fallbackStyle?: StyleProp<ViewStyle>;
  tintColor?: string;
  isInteractive?: boolean;
  effectStyle?: "clear" | "regular";
  children?: React.ReactNode;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
};

/** A glass panel that falls back to a solid themed surface. */
export function GlassSurface({
  style,
  fallbackStyle,
  tintColor,
  isInteractive,
  effectStyle = "regular",
  children,
  pointerEvents,
}: GlassSurfaceProps) {
  const { scheme } = useTheme();
  if (glassAvailable) {
    return (
      <GlassView
        style={style}
        tintColor={tintColor}
        isInteractive={isInteractive}
        glassEffectStyle={effectStyle}
        colorScheme={scheme}
        pointerEvents={pointerEvents}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[style, fallbackStyle]} pointerEvents={pointerEvents}>
      {children}
    </View>
  );
}

type GlassIconButtonProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  /** Diameter of the circular button. */
  size?: number;
  iconSize?: number;
  iconColor?: string;
  tintColor?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Circular glass icon button — the iOS 26 header/toolbar button shape. */
export function GlassIconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 40,
  iconSize = 20,
  iconColor,
  tintColor,
  disabled,
  style,
}: GlassIconButtonProps) {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        pressed && !glassAvailable && staticStyles.pressed,
        disabled && staticStyles.disabled,
        style,
      ]}
    >
      <GlassSurface
        isInteractive
        tintColor={tintColor}
        effectStyle="clear"
        style={[
          staticStyles.iconButton,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
        fallbackStyle={styles.surfaceFallback}
      >
        <MaterialCommunityIcons
          name={icon}
          size={iconSize}
          color={iconColor ?? c.accent}
        />
      </GlassSurface>
    </Pressable>
  );
}

const staticStyles = StyleSheet.create({
  iconButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    surfaceFallback: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
    },
  })
);
