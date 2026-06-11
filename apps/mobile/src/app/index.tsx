import { useAuth } from "@clerk/expo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
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
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackdropWash } from "../components/BackdropWash";
import { BrushStroke } from "../components/BrushStroke";
import { RenameModal } from "../components/RenameModal";
import {
  GlassIconButton,
  GlassSurface,
  glassAvailable,
} from "../components/glass";
import { apiClient, uploadPdf } from "../lib/api";
import { makeThemedStyles, serif, useTheme } from "../lib/theme";
import { showError } from "../lib/toast";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type ArticleListItem = FunctionReturnType<typeof api.articles.list>[number];

type ReadStatus = "unread" | "in_progress" | "read";
type StatusFilter = "all" | ReadStatus;

/** Rows written before readStatus existed count as unread. */
const readStatusOf = (item: ArticleListItem): ReadStatus =>
  item.readStatus ?? "unread";

/** Uploaded PDFs carry a synthetic upload:// url — nothing to retry/open. */
const isUpload = (item: ArticleListItem) => item.url.startsWith("upload://");

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "in_progress", label: "In progress" },
  { value: "read", label: "Read" },
];

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

function ReadStatusBadge({ status }: { status: ReadStatus }) {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  if (status === "read") {
    return (
      <View style={[styles.readBadge, styles.readBadgeDone]}>
        <MaterialCommunityIcons name="check" size={12} color={c.inkFaint} />
        <Text style={styles.readBadgeDoneText}>Read</Text>
      </View>
    );
  }
  return (
    <View style={[styles.readBadge, styles.readBadgeActive]}>
      <Text style={styles.readBadgeActiveText}>
        {status === "unread" ? "Unread" : "In progress"}
      </Text>
    </View>
  );
}

function ArticleCard({
  item,
  onDelete,
  onRename,
  onRetry,
  onSwipeOpen,
}: {
  item: ArticleListItem;
  onDelete: (id: Id<"articles">) => void;
  onRename: (item: ArticleListItem) => void;
  onRetry: (item: ArticleListItem) => void;
  /** Called as this row starts to open, so the screen can close any other. */
  onSwipeOpen: (row: SwipeableMethods | null) => void;
}) {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const swipeRef = useRef<SwipeableMethods>(null);
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
  const showActions = () =>
    Alert.alert(item.title, undefined, [
      { text: "Rename", onPress: () => onRename(item) },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => onDelete(item._id),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={36}
      overshootRight={false}
      onSwipeableOpenStartDrag={() => onSwipeOpen(swipeRef.current)}
      renderRightActions={(_progress, _translation, methods) => (
        <View style={styles.rowActionsWrap}>
          <Pressable
            onPress={() => {
              methods.close();
              onRename(item);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Rename ${item.title}`}
            style={({ pressed }) => [
              styles.rowAction,
              styles.renameAction,
              pressed && { opacity: 0.85 },
            ]}
          >
            <MaterialCommunityIcons
              name="pencil-outline"
              size={22}
              color={c.onAccent}
            />
            <Text style={[styles.rowActionText, { color: c.onAccent }]}>
              Rename
            </Text>
          </Pressable>
          <Pressable
            onPress={() => confirmDelete(methods.close)}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.title}`}
            style={({ pressed }) => [
              styles.rowAction,
              styles.deleteAction,
              pressed && { opacity: 0.85 },
            ]}
          >
            <MaterialCommunityIcons
              name="trash-can-outline"
              size={22}
              color="#FFFFFF"
            />
            <Text style={styles.rowActionText}>Delete</Text>
          </Pressable>
        </View>
      )}
    >
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => {
        if (item.status === "ready") router.push(`/article/${item._id}`);
      }}
      onLongPress={showActions}
    >
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>
      <View style={styles.metaRow}>
        <Text style={[styles.cardMeta, { flexShrink: 1 }]} numberOfLines={1}>
          {[item.siteName, date].filter(Boolean).join("  ·  ")}
        </Text>
        {item.status === "ready" ? (
          <ReadStatusBadge status={readStatusOf(item)} />
        ) : null}
      </View>
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
          {isUpload(item) ? null : (
            <Pressable onPress={() => onRetry(item)} hitSlop={8}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          )}
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
  const renameArticle = useMutation(api.articles.rename);
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [renameTarget, setRenameTarget] = useState<ArticleListItem | null>(
    null
  );

  // Only one swipe row open at a time — opening a new one closes the last.
  const openRowRef = useRef<SwipeableMethods | null>(null);
  const onSwipeOpen = useCallback((row: SwipeableMethods | null) => {
    if (openRowRef.current && openRowRef.current !== row) {
      openRowRef.current.close();
    }
    openRowRef.current = row;
  }, []);

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

  const onUpload = useCallback(async () => {
    if (!API_URL) {
      Alert.alert(
        "Not configured",
        "Set EXPO_PUBLIC_API_URL in .env.local to save articles."
      );
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("You're not signed in.");
      await uploadPdf(API_URL, token, {
        uri: asset.uri,
        name: asset.name ?? "document.pdf",
        mimeType: asset.mimeType,
      });
      // The pending card arrives via the live query — nothing else to do.
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showError(`Couldn't upload: ${message}`);
      Alert.alert("Couldn't upload", message);
    } finally {
      setUploading(false);
    }
  }, [getToken]);

  const onDelete = useCallback(
    (id: Id<"articles">) => {
      void removeArticle({ id });
    },
    [removeArticle]
  );

  const onRename = useCallback((item: ArticleListItem) => {
    setRenameTarget(item);
  }, []);

  const onSaveRename = useCallback(
    (title: string) => {
      if (renameTarget) {
        void renameArticle({ id: renameTarget._id, title });
      }
      setRenameTarget(null);
    },
    [renameTarget, renameArticle]
  );

  const onRetry = useCallback(
    (item: ArticleListItem) => {
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
          // The url travels in the body — the worker's Convex access is
          // write-only, so it can't look the article up itself.
          const res = await apiClient(API_URL, token).articles[":id"].retry.$post(
            { param: { id: item._id }, json: { url: item.url } }
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

  const visibleArticles = useMemo(() => {
    if (!articles) return [];
    const filtered =
      filter === "all"
        ? articles
        : articles.filter((item) => readStatusOf(item) === filter);
    // articles.list is newest-first; flip a copy for oldest-first.
    return sortOrder === "newest" ? filtered : [...filtered].reverse();
  }, [articles, filter, sortOrder]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 18 }]}>
      <BackdropWash />
      <View style={styles.titleRow}>
        <View style={styles.titleLeft}>
          <Text style={styles.appTitle}>Inkwell</Text>
          {__DEV__ ? (
            <View style={styles.devBadge} accessibilityLabel="Development build">
              <Text style={styles.devBadgeText}>DEV</Text>
            </View>
          ) : null}
        </View>
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
        <GlassIconButton
          icon={uploading ? "progress-upload" : "file-upload-outline"}
          onPress={() => void onUpload()}
          accessibilityLabel="Upload a PDF"
          disabled={uploading}
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

      <View style={styles.controlsRow}>
        <View style={styles.filterChips}>
          {FILTERS.map(({ value, label }) => {
            const active = filter === value;
            return (
              <Pressable
                key={value}
                onPress={() => setFilter(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.filterChip, active && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() =>
            setSortOrder((order) => (order === "newest" ? "oldest" : "newest"))
          }
          accessibilityRole="button"
          accessibilityLabel="Toggle sort order"
          hitSlop={6}
          style={styles.sortButton}
        >
          <MaterialCommunityIcons
            name={
              sortOrder === "newest"
                ? "sort-calendar-descending"
                : "sort-calendar-ascending"
            }
            size={16}
            color={c.inkSecondary}
          />
          <Text style={styles.sortText}>
            {sortOrder === "newest" ? "Newest" : "Oldest"}
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={visibleArticles}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <ArticleCard
            item={item}
            onDelete={onDelete}
            onRename={onRename}
            onRetry={onRetry}
            onSwipeOpen={onSwipeOpen}
          />
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
                {articles.length > 0
                  ? "Nothing here — try another filter."
                  : "Nothing saved yet. Paste a URL above — it'll be waiting here on every device."}
              </Text>
            </View>
          ) : null
        }
      />

      <RenameModal
        visible={renameTarget !== null}
        initialTitle={renameTarget?.title ?? ""}
        onSave={onSaveRename}
        onCancel={() => setRenameTarget(null)}
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
    titleLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    // Tiny "running against dev" marker — only rendered in dev builds.
    devBadge: {
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.linkUnderline,
      borderRadius: 6,
      borderCurve: "continuous",
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    devBadgeText: {
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.8,
      color: c.accent,
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
      marginBottom: 12,
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
    controlsRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 14,
    },
    filterChips: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexWrap: "wrap",
      flexShrink: 1,
    },
    filterChip: {
      borderRadius: 16,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: c.hairline,
      backgroundColor: c.surface,
      paddingHorizontal: 13,
      paddingVertical: 6,
    },
    filterChipActive: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    filterChipText: {
      fontSize: 13,
      fontWeight: "600",
      color: c.inkSecondary,
    },
    filterChipTextActive: {
      color: c.onAccent,
    },
    sortButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingVertical: 6,
    },
    sortText: {
      fontSize: 13,
      fontWeight: "600",
      color: c.inkSecondary,
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
    rowActionsWrap: {
      flexDirection: "row",
      alignItems: "stretch",
      gap: 10,
      paddingLeft: 12,
    },
    rowAction: {
      width: 88,
      borderRadius: 16,
      borderCurve: "continuous",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    renameAction: {
      backgroundColor: c.accent,
    },
    deleteAction: {
      backgroundColor: c.dangerSolid,
    },
    rowActionText: {
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
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 5,
    },
    cardMeta: {
      fontSize: 12.5,
      color: c.inkFaint,
    },
    readBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    readBadgeActive: {
      backgroundColor: c.accentSoft,
    },
    readBadgeActiveText: {
      fontSize: 11,
      fontWeight: "600",
      color: c.accent,
    },
    readBadgeDone: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
    },
    readBadgeDoneText: {
      fontSize: 11,
      fontWeight: "600",
      color: c.inkFaint,
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
