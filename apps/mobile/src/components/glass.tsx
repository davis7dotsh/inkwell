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

import { colors } from "../lib/theme";

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
  children?: React.ReactNode;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
};

/** A glass panel that falls back to a solid themed surface. */
export function GlassSurface({
  style,
  fallbackStyle,
  tintColor,
  isInteractive,
  children,
  pointerEvents,
}: GlassSurfaceProps) {
  if (glassAvailable) {
    return (
      <GlassView
        style={style}
        tintColor={tintColor}
        isInteractive={isInteractive}
        colorScheme="light"
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
  iconColor = colors.accent,
  tintColor,
  disabled,
  style,
}: GlassIconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        pressed && !glassAvailable && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <GlassSurface
        isInteractive
        tintColor={tintColor}
        style={[
          styles.iconButton,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
        fallbackStyle={styles.surfaceFallback}
      >
        <MaterialCommunityIcons name={icon} size={iconSize} color={iconColor} />
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  surfaceFallback: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});
