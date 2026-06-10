import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  subscribeToToasts,
  type ToastMessage,
} from "../lib/toast";
import { colors } from "../lib/theme";

const TOAST_DURATION_MS = 7000;

export function ToastViewport() {
  const insets = useSafeAreaInsets();
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
        style={[
          styles.toast,
          toast.kind === "error" ? styles.errorToast : styles.infoToast,
        ]}
      >
        <Text style={styles.text}>{toast.message}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    alignItems: "center",
    paddingHorizontal: 18,
  },
  toast: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  errorToast: {
    backgroundColor: "#FFF1EF",
    borderColor: "#D98C82",
  },
  infoToast: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
  },
  text: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
  },
});
