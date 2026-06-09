import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ExtractorWebView } from "../components/ExtractorWebView";
import { ScreenHeader } from "../components/ScreenHeader";
import { htmlToBlocks } from "../lib/htmlToBlocks";
import { newId, saveArticle } from "../lib/storage";
import { colors, serif } from "../lib/theme";
import type { ExtractionResult } from "../lib/types";

export default function AddScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const onResult = useCallback(async (result: ExtractionResult) => {
    try {
      const blocks = htmlToBlocks(result.contentHtml);
      if (blocks.length === 0) {
        setError("The page loaded, but no readable content was found.");
        return;
      }
      const id = newId();
      await saveArticle({
        id,
        url: result.url,
        title: result.title,
        byline: result.byline,
        siteName: result.siteName,
        excerpt: result.excerpt,
        savedAt: new Date().toISOString(),
        blocks,
      });
      router.replace(`/article/${id}`);
    } catch (e) {
      setError(`Failed to process the article: ${String(e)}`);
    }
  }, []);

  const onError = useCallback((message: string) => {
    setError(message);
  }, []);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Save article" />
      {error === null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.status}>Fetching article…</Text>
          <Text style={styles.url} numberOfLines={2}>
            {url}
          </Text>
          {/* Hidden WebView does the actual work. keyed so Retry remounts it. */}
          <ExtractorWebView
            key={attempt}
            url={url ?? ""}
            onResult={(r) => void onResult(r)}
            onError={onError}
          />
        </View>
      ) : (
        <View style={styles.center}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={44}
            color={colors.accent}
          />
          <Text style={styles.errorTitle}>Couldn't save that one</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <View style={styles.row}>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => router.back()}
            >
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                setError(null);
                setAttempt((a) => a + 1);
              }}
            >
              <Text style={styles.primaryText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  status: {
    fontFamily: serif,
    fontSize: 20,
    color: colors.ink,
    marginTop: 8,
  },
  url: {
    fontSize: 13,
    color: colors.inkFaint,
    textAlign: "center",
    maxWidth: 420,
  },
  errorTitle: {
    fontFamily: serif,
    fontSize: 22,
    fontWeight: "700",
    color: colors.ink,
  },
  errorMessage: {
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.inkSecondary,
    textAlign: "center",
    maxWidth: 380,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  primaryText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  secondaryText: {
    color: colors.inkSecondary,
    fontWeight: "600",
    fontSize: 15,
  },
});
