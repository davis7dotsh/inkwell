import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
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
import { sampleArticle, seedSampleArticleOnce } from "../lib/sampleArticle";
import { deleteArticle, listArticles, saveArticle } from "../lib/storage";
import { colors, serif } from "../lib/theme";
import type { ArticleSummary } from "../lib/types";

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
}: {
  item: ArticleSummary;
  onDelete: (id: string) => void;
}) {
  const date = new Date(item.savedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/article/${item.id}`)}
      onLongPress={() =>
        Alert.alert("Delete article?", item.title, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => onDelete(item.id),
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
      {item.excerpt ? (
        <Text style={styles.cardExcerpt} numberOfLines={2}>
          {item.excerpt}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    void (async () => {
      await seedSampleArticleOnce();
      setArticles(await listArticles());
      setLoaded(true);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onSubmit = useCallback(() => {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      Alert.alert("Hmm", "That doesn't look like a URL.");
      return;
    }
    setUrl("");
    router.push({ pathname: "/add", params: { url: normalized } });
  }, [url]);

  const onPaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setUrl(text.trim());
  }, []);

  const onDelete = useCallback(
    (id: string) => {
      void deleteArticle(id).then(refresh);
    },
    [refresh]
  );

  const onAddSample = useCallback(() => {
    void saveArticle(sampleArticle).then(() => {
      refresh();
      router.push(`/article/${sampleArticle.id}`);
    });
  }, [refresh]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 18 }]}>
      <Text style={styles.appTitle}>Inkwell</Text>
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
        data={articles}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ArticleCard item={item} onDelete={onDelete} />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name="book-open-page-variant-outline"
                size={44}
                color={colors.inkFaint}
              />
              <Text style={styles.emptyText}>
                Nothing saved yet. Paste a URL above, or take a look around
                first:
              </Text>
              <Pressable onPress={onAddSample} style={styles.sampleButton}>
                <Text style={styles.sampleButtonText}>Add sample article</Text>
              </Pressable>
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
  appTitle: {
    fontFamily: serif,
    fontSize: 34,
    fontWeight: "700",
    color: colors.ink,
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
  sampleButton: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  sampleButtonText: {
    color: colors.accent,
    fontWeight: "600",
    fontSize: 15,
  },
});
