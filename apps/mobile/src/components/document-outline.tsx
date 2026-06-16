import type { DocumentOutlineEntry } from "@inkwell/content";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { makeThemedStyles, serif, useTheme } from "../lib/theme";

type Props = {
  entries: DocumentOutlineEntry[];
  activeId: string;
  onNavigate: (entry: DocumentOutlineEntry | null) => void;
};

export const DOCUMENT_START_ID = "document-start";
export const OUTLINE_RAIL_WIDTH = 300;

export function DocumentOutline({ entries, activeId, onNavigate }: Props) {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const [query, setQuery] = useState("");
  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return entries;
    return entries.filter((entry) =>
      entry.title.toLocaleLowerCase().includes(normalized)
    );
  }, [entries, query]);

  return (
    <View style={styles.outline}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>Document outline</Text>
          <Text style={styles.title}>Contents</Text>
        </View>
        <Text style={styles.count}>{entries.length}</Text>
      </View>

      {entries.length >= 10 ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Find a section"
          placeholderTextColor={c.inkFaint}
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Filter document headings"
          style={styles.search}
        />
      ) : null}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        <OutlineLink
          title="Overview"
          depth={0}
          active={activeId === DOCUMENT_START_ID}
          chapter
          onPress={() => onNavigate(null)}
        />
        {visibleEntries.map((entry) => (
          <OutlineLink
            key={entry.id}
            title={entry.title}
            depth={entry.depth}
            active={activeId === entry.id}
            chapter={entry.depth === 0}
            onPress={() => onNavigate(entry)}
          />
        ))}
        {visibleEntries.length === 0 ? (
          <Text style={styles.empty}>No matching sections.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function OutlineLink({
  title,
  depth,
  active,
  chapter,
  onPress,
}: {
  title: string;
  depth: number;
  active: boolean;
  chapter: boolean;
  onPress: () => void;
}) {
  const { scheme } = useTheme();
  const styles = themed[scheme];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.link,
        { paddingLeft: 28 + Math.min(depth, 4) * 14 },
        chapter && styles.chapter,
        active && styles.linkActive,
        pressed && styles.linkPressed,
      ]}
    >
      <View style={[styles.dot, active && styles.dotActive]} />
      <Text
        numberOfLines={2}
        style={[
          styles.linkText,
          chapter && styles.chapterText,
          depth >= 2 && styles.deepText,
          active && styles.linkTextActive,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function DocumentOutlineDrawer({
  visible,
  entries,
  activeId,
  onNavigate,
  onClose,
}: Props & {
  visible: boolean;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const styles = themed[scheme];
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.drawer}>
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close document outline"
        />
        <View
          style={[
            styles.drawerPanel,
            {
              width: Math.min(380, width * 0.9),
              paddingTop: Math.max(insets.top, 18),
              paddingBottom: Math.max(insets.bottom, 18),
            },
          ]}
        >
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close document outline"
            style={styles.close}
          >
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
          <DocumentOutline
            entries={entries}
            activeId={activeId}
            onNavigate={onNavigate}
          />
        </View>
      </View>
    </Modal>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    outline: {
      flex: 1,
      minHeight: 0,
    },
    heading: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: 6,
      paddingBottom: 18,
    },
    eyebrow: {
      color: c.inkFaint,
      fontSize: 11,
      fontWeight: "600",
      marginBottom: 2,
    },
    title: {
      color: c.ink,
      fontFamily: serif,
      fontSize: 22,
      lineHeight: 27,
      fontWeight: "700",
    },
    count: {
      minWidth: 26,
      color: c.inkFaint,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
      textAlign: "center",
    },
    search: {
      height: 38,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      borderRadius: 11,
      borderCurve: "continuous",
      backgroundColor: c.surfaceMuted,
      paddingHorizontal: 12,
      marginBottom: 16,
      color: c.ink,
      fontSize: 16,
    },
    list: {
      paddingBottom: 28,
    },
    link: {
      position: "relative",
      minHeight: 38,
      borderRadius: 10,
      borderCurve: "continuous",
      paddingTop: 9,
      paddingRight: 10,
      paddingBottom: 9,
      justifyContent: "center",
      marginBottom: 2,
    },
    linkPressed: {
      backgroundColor: c.mist,
    },
    linkActive: {
      backgroundColor: c.mist,
    },
    dot: {
      position: "absolute",
      left: 12,
      top: 16,
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.hairline,
    },
    dotActive: {
      left: 11,
      top: 15,
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.accent,
    },
    linkText: {
      color: c.inkSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    linkTextActive: {
      color: c.accent,
      fontWeight: "600",
    },
    chapter: {
      marginTop: 5,
    },
    chapterText: {
      color: c.ink,
      fontFamily: serif,
      fontSize: 14,
      fontWeight: "700",
    },
    deepText: {
      color: c.inkFaint,
      fontSize: 12,
    },
    empty: {
      paddingHorizontal: 12,
      paddingVertical: 16,
      color: c.inkFaint,
      fontSize: 13,
    },
    drawer: {
      flex: 1,
      flexDirection: "row",
    },
    scrim: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: c.backdrop,
    },
    drawerPanel: {
      flex: 1,
      backgroundColor: c.surface,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: c.hairline,
      paddingHorizontal: 18,
      boxShadow: "12px 0 36px rgba(9, 24, 40, 0.18)",
    },
    close: {
      alignSelf: "flex-end",
      paddingHorizontal: 8,
      paddingBottom: 12,
    },
    closeText: {
      color: c.accent,
      fontSize: 14,
      fontWeight: "600",
    },
  })
);
