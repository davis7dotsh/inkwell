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
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackdropWash } from "../components/BackdropWash";
import { BrushStroke } from "../components/BrushStroke";
import {
  GlassIconButton,
  GlassSurface,
  glassAvailable,
} from "../components/glass";
import { apiClient } from "../lib/api";
import { makeThemedStyles, serif, useTheme } from "../lib/theme";
import { showError } from "../lib/toast";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

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
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const date = new Date(item.savedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const confirmDelete = (onCancel?: () => void) =>
    Alert.alert("Delete article?", item.title, [
      { text: "Cancel", style: "cancel", onPress: onCancel },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => onDelete(item._id),
      },
    ]);
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={36}
      overshootRight={false}
      renderRightActions={(_progress, _translation, methods) => (
        <View style={styles.deleteActionWrap}>
          <Pressable
            onPress={() => confirmDelete(methods.close)}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.title}`}
            style={({ pressed }) => [
              styles.deleteAction,
              pressed && { opacity: 0.85 },
            ]}
          >
            <MaterialCommunityIcons
              name="trash-can-outline"
              size={22}
              color="#FFFFFF"
            />
            <Text style={styles.deleteActionText}>Delete</Text>
          </Pressable>
        </View>
      )}
    >
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => {
        if (item.status === "ready") router.push(`/article/${item._id}`);
      }}
      onLongPress={() => confirmDelete()}
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
            <ActivityIndicator size="small" color={c.accent} />
            <Text style={styles.chipPendingText}>Saving…</Text>
          </View>
        </View>
      ) : item.status === "failed" ? (
        <View style={styles.statusRow}>
          <View style={[styles.chip, styles.chipFailed]}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={14}
              color={c.danger}
            />
            <Text style={styles.chipFailedText}>Couldn&apos;t save</Text>
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
    </ReanimatedSwipeable>
  );
}

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
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
      <BackdropWash />
      <View style={styles.titleRow}>
        <Text style={styles.appTitle}>Inkwell</Text>
        <GlassIconButton
          icon="logout-variant"
          onPress={() => void signOut()}
          accessibilityLabel="Sign out"
          size={38}
          iconSize={18}
          iconColor={c.inkSecondary}
        />
      </View>
      <BrushStroke
        width={118}
        height={9}
        color={c.wash}
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
          placeholderTextColor={c.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
        <GlassIconButton
          icon="content-paste"
          onPress={() => void onPaste()}
          accessibilityLabel="Paste from clipboard"
          size={44}
          iconSize={19}
          iconColor={c.inkSecondary}
        />
        <Pressable
          onPress={onSubmit}
          accessibilityRole="button"
          style={({ pressed }) => pressed && !glassAvailable && styles.cardPressed}
        >
          <GlassSurface
            isInteractive
            tintColor={c.accent}
            style={styles.addButton}
            fallbackStyle={styles.addButtonFallback}
          >
            <Text style={styles.addButtonText}>Save</Text>
          </GlassSurface>
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
                color={c.inkFaint}
              />
              <Text style={styles.emptyText}>
                Nothing saved yet. Paste a URL above — it&apos;ll be waiting
                here on every device.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
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
      color: c.ink,
    },
    appSubtitle: {
      fontSize: 14,
      color: c.inkSecondary,
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
      height: 44,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: 22,
      borderCurve: "continuous",
      paddingHorizontal: 16,
      fontSize: 15,
      color: c.ink,
    },
    addButton: {
      height: 44,
      borderRadius: 22,
      borderCurve: "continuous",
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    addButtonFallback: {
      backgroundColor: c.accent,
    },
    addButtonText: {
      color: c.onAccent,
      fontWeight: "600",
      fontSize: 15,
    },
    list: {
      paddingBottom: 40,
      gap: 12,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: 16,
      borderCurve: "continuous",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      padding: 16,
    },
    deleteActionWrap: {
      justifyContent: "center",
      paddingLeft: 12,
    },
    deleteAction: {
      flex: 1,
      width: 88,
      borderRadius: 16,
      borderCurve: "continuous",
      backgroundColor: c.dangerSolid,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    deleteActionText: {
      color: "#FFFFFF",
      fontSize: 12.5,
      fontWeight: "600",
    },
    cardPressed: {
      opacity: 0.7,
    },
    cardTitle: {
      fontFamily: serif,
      fontSize: 19,
      lineHeight: 25,
      fontWeight: "700",
      color: c.ink,
    },
    cardMeta: {
      fontSize: 12.5,
      color: c.inkFaint,
      marginTop: 5,
    },
    cardExcerpt: {
      fontSize: 14,
      lineHeight: 20,
      color: c.inkSecondary,
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
      backgroundColor: c.accentSoft,
    },
    chipPendingText: {
      fontSize: 12.5,
      fontWeight: "600",
      color: c.accent,
    },
    chipFailed: {
      backgroundColor: c.dangerSoft,
    },
    chipFailedText: {
      fontSize: 12.5,
      fontWeight: "600",
      color: c.danger,
    },
    retryText: {
      fontSize: 13.5,
      fontWeight: "600",
      color: c.accent,
    },
    errorDetail: {
      fontSize: 12.5,
      lineHeight: 17,
      color: c.inkFaint,
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
      color: c.inkSecondary,
      textAlign: "center",
      maxWidth: 280,
    },
  })
);
