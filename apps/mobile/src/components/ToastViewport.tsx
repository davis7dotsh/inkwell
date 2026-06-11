import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  subscribeToToasts,
  type ToastMessage,
} from "../lib/toast";
import { makeThemedStyles, useTheme } from "../lib/theme";

import { GlassSurface } from "./glass";

const TOAST_DURATION_MS = 7000;

export function ToastViewport() {
  const insets = useSafeAreaInsets();
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return subscribeToToasts((nextToast) => {
      if (timeout) clearTimeout(timeout);
      setToast(nextToast);
      timeout = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    });
  }, []);

  if (!toast) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.viewport, { paddingTop: insets.top + 10 }]}
    >
      <Pressable
        accessibilityRole="alert"
        onPress={() => setToast(null)}
        style={styles.toastWrap}
      >
        <GlassSurface
          tintColor={toast.kind === "error" ? c.errorSurface : undefined}
          style={styles.toast}
          fallbackStyle={
            toast.kind === "error" ? styles.errorToast : styles.infoToast
          }
        >
          <Text style={styles.text}>{toast.message}</Text>
        </GlassSurface>
      </Pressable>
    </View>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    viewport: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 1000,
      alignItems: "center",
      paddingHorizontal: 18,
    },
    toastWrap: {
      width: "100%",
      maxWidth: 520,
    },
    toast: {
      width: "100%",
      borderRadius: 16,
      borderCurve: "continuous",
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    errorToast: {
      backgroundColor: c.errorSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.errorBorder,
      shadowColor: "#000000",
      shadowOpacity: 0.16,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
    },
    infoToast: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      shadowColor: "#000000",
      shadowOpacity: 0.16,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
    },
    text: {
      color: c.ink,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: "600",
    },
  })
);
