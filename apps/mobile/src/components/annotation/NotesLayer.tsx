// Pinned typed notes, rendered as sticky-note bubbles inside the content
// container. Bubble sizes are reported back for eraser/tap hit-testing.
import type { NoteAnnotation } from "@inkwell/content";
import React, { memo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { makeThemedStyles, useTheme } from "../../lib/theme";

type Props = {
  notes: NoteAnnotation[];
  scale: number;
  onPressNote: (note: NoteAnnotation) => void;
  /** Reports rendered bubble size (current render px) for hit-testing. */
  onNoteLayout: (id: string, size: { w: number; h: number }) => void;
};

export const NotesLayer = memo(function NotesLayer({
  notes,
  scale,
  onPressNote,
  onNoteLayout,
}: Props) {
  const { scheme } = useTheme();
  const styles = themed[scheme];
  return (
    <>
      {notes.map((note) => (
        <Pressable
          key={note.id}
          style={[styles.note, { left: note.x * scale, top: note.y * scale }]}
          onPress={() => onPressNote(note)}
          onLayout={(e) =>
            onNoteLayout(note.id, {
              w: e.nativeEvent.layout.width,
              h: e.nativeEvent.layout.height,
            })
          }
        >
          <Text style={styles.noteText} numberOfLines={6}>
            {note.text}
          </Text>
        </Pressable>
      ))}
    </>
  );
});

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    note: {
      position: "absolute",
      maxWidth: 230,
      backgroundColor: c.noteBackground,
      borderColor: c.noteBorder,
      borderWidth: 1,
      borderRadius: 10,
      borderBottomLeftRadius: 2,
      paddingHorizontal: 10,
      paddingVertical: 7,
      shadowColor: "#172A3E",
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    noteText: {
      fontSize: 13.5,
      lineHeight: 19,
      color: c.noteText,
    },
  })
);
