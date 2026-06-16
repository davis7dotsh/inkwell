// Pinned voice memos, rendered as small mic chips inside the content
// container (NotesLayer's sibling). Chip sizes are reported back for
// read-mode drag hit-testing.
import type { VoiceMemoAnnotation } from "@inkwell/content";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { makeThemedStyles, useTheme } from "../../lib/theme";

export const formatMemoDuration = (durationMs: number): string => {
  const total = Math.max(1, Math.round(durationMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

type Props = {
  memos: VoiceMemoAnnotation[];
  scale: number;
  onPressMemo: (memo: VoiceMemoAnnotation) => void;
  /** Reports rendered chip size (current render px) for hit-testing. */
  onMemoLayout: (id: string, size: { w: number; h: number }) => void;
};

export const MemosLayer = memo(function MemosLayer({
  memos,
  scale,
  onPressMemo,
  onMemoLayout,
}: Props) {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  return (
    <>
      {memos.map((m) => (
        <Pressable
          key={m.id}
          style={[styles.chip, { left: m.x * scale, top: m.y * scale }]}
          onPress={() => onPressMemo(m)}
          accessibilityRole="button"
          accessibilityLabel={`Voice memo, ${formatMemoDuration(m.durationMs)}`}
          onLayout={(e) =>
            onMemoLayout(m.id, {
              w: e.nativeEvent.layout.width,
              h: e.nativeEvent.layout.height,
            })
          }
        >
          <MaterialCommunityIcons
            name="microphone"
            size={15}
            color={c.accent}
          />
          <Text style={styles.duration}>{formatMemoDuration(m.durationMs)}</Text>
          {m.status === "local" ? <Text style={styles.pendingDot}>•</Text> : null}
        </Pressable>
      ))}
    </>
  );
});

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    chip: {
      position: "absolute",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: c.noteBackground,
      borderColor: c.noteBorder,
      borderWidth: 1,
      borderRadius: 14,
      borderBottomLeftRadius: 3,
      paddingHorizontal: 9,
      paddingVertical: 5,
      shadowColor: "#172A3E",
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    duration: {
      fontSize: 12.5,
      fontWeight: "600",
      color: c.noteText,
      fontVariant: ["tabular-nums"],
    },
    // Subtle "audio not synced yet" marker; clears once the upload lands.
    pendingDot: {
      fontSize: 16,
      lineHeight: 16,
      color: c.accent,
      marginLeft: 1,
    },
  })
);
