import * as Clipboard from "expo-clipboard";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { FatalReport } from "../lib/crashGuard";
import { makeThemedStyles, mono, serif, useTheme } from "../lib/theme";

/**
 * Full-screen diagnostic shown instead of crashing: either right when a
 * fatal error is caught ("live") or on the launch after one killed the app
 * ("previous"). Deliberately dependency-free beyond theme + clipboard so it
 * can render when everything else is broken.
 */
export function FatalErrorScreen({
  report,
  mode,
  onClose,
}: {
  report: FatalReport;
  mode: "live" | "previous";
  onClose: () => void;
}) {
  const { scheme } = useTheme();
  const styles = themed[scheme];
  const [copied, setCopied] = useState(false);

  const details = [report.message, report.stack].filter(Boolean).join("\n\n");

  const copyDetails = () => {
    void Clipboard.setStringAsync(
      `Inkwell fatal error (${report.occurredAt})\n\n${details}`
    ).then(() => setCopied(true));
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>
        {mode === "live" ? "Inkwell hit a fatal error" : "Inkwell crashed last time"}
      </Text>
      <Text style={styles.subtitle}>
        {mode === "live"
          ? "Something went wrong that the app couldn't recover from. The details below were saved."
          : "The previous launch ended in a crash. Here's what was recorded before it died."}
        {"\n"}
        {new Date(report.occurredAt).toLocaleString()}
        {report.uiWasMounted ? "" : " · during startup"}
      </Text>
      <ScrollView style={styles.detailsBox} contentContainerStyle={styles.detailsContent}>
        <Text selectable style={styles.detailsText}>
          {details || "No details were captured."}
        </Text>
      </ScrollView>
      <Pressable style={styles.copyButton} onPress={copyDetails}>
        <Text style={styles.copyButtonText}>{copied ? "Copied" : "Copy details"}</Text>
      </Pressable>
      <Pressable style={styles.closeButton} onPress={onClose}>
        <Text style={styles.closeButtonText}>
          {mode === "live" ? "Try again" : "Continue"}
        </Text>
      </Pressable>
    </View>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 30,
      paddingVertical: 40,
      gap: 14,
    },
    title: {
      fontFamily: serif,
      fontSize: 26,
      fontWeight: "700",
      color: c.danger,
      textAlign: "center",
    },
    subtitle: {
      fontSize: 14.5,
      lineHeight: 21,
      color: c.inkSecondary,
      textAlign: "center",
      maxWidth: 460,
    },
    detailsBox: {
      alignSelf: "center",
      width: "100%",
      maxWidth: 560,
      maxHeight: 320,
      flexGrow: 0,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.errorBorder,
      backgroundColor: c.errorSurface,
    },
    detailsContent: {
      padding: 14,
    },
    detailsText: {
      fontFamily: mono,
      fontSize: 12,
      lineHeight: 17,
      color: c.ink,
    },
    copyButton: {
      minWidth: 180,
      alignItems: "center",
      borderRadius: 12,
      backgroundColor: c.accent,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    copyButtonText: {
      color: c.onAccent,
      fontSize: 15,
      fontWeight: "700",
    },
    closeButton: {
      minWidth: 180,
      alignItems: "center",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.surface,
      paddingHorizontal: 18,
      paddingVertical: 12,
    },
    closeButtonText: {
      color: c.ink,
      fontSize: 14,
      fontWeight: "600",
    },
  })
);
