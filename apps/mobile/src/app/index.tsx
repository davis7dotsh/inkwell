import { useAuth } from "@clerk/expo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrushStroke } from "../components/BrushStroke";
import { apiClient } from "../lib/api";
import { colors, serif } from "../lib/theme";
import { showError } from "../lib/toast";

const API_URL = process.env.EXPO_PUBLIC_API_URL;
const FAILED_COLOR = "#B0413E"; // seal red (matches the pen palette)

type ArticleListItem = FunctionReturnType<typeof api.articles.list>[number];

function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  // Cheap sanity check: needs a dot in the host.
  const host = withScheme.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  return host.includes(".") ? withScheme : null;
}

function ArticleCard({
  item,
  onDelete,
  onRetry,
}: {
  item: ArticleListItem;
  onDelete: (id: Id<"articles">) => void;
  onRetry: (id: Id<"articles">) => void;
}) {
  const date = new Date(item.savedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => {
        if (item.status === "ready") router.push(`/article/${item._id}`);
      }}
      onLongPress={() =>
        Alert.alert("Delete article?", item.title, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => onDelete(item._id),
          },
        ])
      }
    >
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1}>
        {[item.siteName, date].filter(Boolean).join("  ·  ")}
      </Text>
      {item.status === "pending" ? (
        <View style={styles.statusRow}>
          <View style={[styles.chip, styles.chipPending]}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.chipPendingText}>Saving…</Text>
          </View>
        </View>
      ) : item.status === "failed" ? (
        <View style={styles.statusRow}>
          <View style={[styles.chip, styles.chipFailed]}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={14}
              color={FAILED_COLOR}
            />
            <Text style={styles.chipFailedText}>Couldn't save</Text>
          </View>
          <Pressable onPress={() => onRetry(item._id)} hitSlop={8}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : item.excerpt ? (
        <Text style={styles.cardExcerpt} numberOfLines={2}>
          {item.excerpt}
        </Text>
      ) : null}
      {item.status === "failed" && item.error ? (
        <Text style={styles.errorDetail} numberOfLines={2}>
          {item.error}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { getToken, signOut } = useAuth();
  const articles = useQuery(api.articles.list);
  const removeArticle = useMutation(api.articles.remove);
  const [url, setUrl] = useState("");

  const onSubmit = useCallback(() => {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      Alert.alert("Hmm", "That doesn't look like a URL.");
      return;
    }
    if (!API_URL) {
      Alert.alert(
        "Not configured",
        "Set EXPO_PUBLIC_API_URL in .env.local to save articles."
      );
      return;
    }
    setUrl("");
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("You're not signed in.");
        const res = await apiClient(API_URL, token).articles.$post({
          json: { url: normalized },
        });
        if (!res.ok) throw new Error(`The server said ${res.status}.`);
        // The pending card arrives via the live query — nothing else to do.
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        showError(`Couldn't save: ${message}`);
        Alert.alert(
          "Couldn't save",
          message
        );
        setUrl(normalized); // hand the URL back for another go
      }
    })();
  }, [url, getToken]);

  const onPaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setUrl(text.trim());
  }, []);

  const onDelete = useCallback(
    (id: Id<"articles">) => {
      void removeArticle({ id });
    },
    [removeArticle]
  );

  const onRetry = useCallback(
    (id: Id<"articles">) => {
      if (!API_URL) {
        Alert.alert(
          "Not configured",
          "Set EXPO_PUBLIC_API_URL in .env.local to save articles."
        );
        return;
      }
      void (async () => {
        try {
          const token = await getToken();
          if (!token) throw new Error("You're not signed in.");
          const res = await apiClient(API_URL, token).articles[":id"].retry.$post(
            { param: { id } }
          );
          if (!res.ok) throw new Error(`The server said ${res.status}.`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          showError(`Couldn't retry: ${message}`);
          Alert.alert(
            "Couldn't retry",
            message
          );
        }
      })();
    },
    [getToken]
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 18 }]}>
      <View style={styles.titleRow}>
        <Text style={styles.appTitle}>Inkwell</Text>
        <Pressable
          onPress={() => void signOut()}
          hitSlop={8}
          style={styles.signOutButton}
        >
          <MaterialCommunityIcons
            name="logout-variant"
            size={20}
            color={colors.inkFaint}
          />
        </Pressable>
      </View>
      <BrushStroke
        width={118}
        height={9}
        color={colors.wash}
        style={{ marginTop: 4 }}
      />
      <Text style={styles.appSubtitle}>
        Save an article, read it, scribble all over it.
      </Text>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="Paste an article URL…"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
        <Pressable onPress={onPaste} style={styles.iconButton} hitSlop={6}>
          <MaterialCommunityIcons
            name="content-paste"
            size={20}
            color={colors.inkSecondary}
          />
        </Pressable>
        <Pressable onPress={onSubmit} style={styles.addButton}>
          <Text style={styles.addButtonText}>Save</Text>
        </Pressable>
      </View>

      <FlatList
        data={articles ?? []}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <ArticleCard item={item} onDelete={onDelete} onRetry={onRetry} />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          articles !== undefined ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name="book-open-page-variant-outline"
                size={44}
                color={colors.inkFaint}
              />
              <Text style={styles.emptyText}>
                Nothing saved yet. Paste a URL above — it'll be waiting here
                on every device.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  appTitle: {
    fontFamily: serif,
    fontSize: 34,
    fontWeight: "700",
    color: colors.ink,
  },
  signOutButton: {
    padding: 6,
  },
  appSubtitle: {
    fontSize: 14,
    color: colors.inkSecondary,
    marginTop: 8,
    marginBottom: 18,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 18,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.ink,
  },
  iconButton: {
    padding: 8,
  },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
  },
  list: {
    paddingBottom: 40,
    gap: 12,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: 16,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardTitle: {
    fontFamily: serif,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "700",
    color: colors.ink,
  },
  cardMeta: {
    fontSize: 12.5,
    color: colors.inkFaint,
    marginTop: 5,
  },
  cardExcerpt: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSecondary,
    marginTop: 7,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 9,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  chipPending: {
    backgroundColor: colors.accentSoft,
  },
  chipPendingText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: colors.accent,
  },
  chipFailed: {
    backgroundColor: "rgba(176, 65, 62, 0.08)",
  },
  chipFailedText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: FAILED_COLOR,
  },
  retryText: {
    fontSize: 13.5,
    fontWeight: "600",
    color: colors.accent,
  },
  errorDetail: {
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.inkFaint,
    marginTop: 6,
  },
  empty: {
    alignItems: "center",
    paddingTop: 70,
    gap: 14,
  },
  emptyText: {
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.inkSecondary,
    textAlign: "center",
    maxWidth: 280,
  },
});
