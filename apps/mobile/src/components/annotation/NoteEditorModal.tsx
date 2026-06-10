import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors } from "../../lib/theme";

type Props = {
  visible: boolean;
  /** Non-empty when editing an existing note. */
  initialText: string;
  isEditing: boolean;
  onSave: (text: string) => void;
  onDelete: () => void;
  onCancel: () => void;
};

export function NoteEditorModal({
  visible,
  initialText,
  isEditing,
  onSave,
  onDelete,
  onCancel,
}: Props) {
  const [text, setText] = useState(initialText);
  useEffect(() => {
    if (visible) setText(initialText);
  }, [visible, initialText]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      {/* Tapping the backdrop always dismisses — never trap the user. The
          card is anchored near the top so the keyboard can't cover it. */}
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{isEditing ? "Edit note" : "New note"}</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder="Write a note…"
            placeholderTextColor={colors.inkFaint}
          />
          <View style={styles.row}>
            {isEditing ? (
              <Pressable onPress={onDelete} style={styles.button}>
                <Text style={[styles.buttonText, styles.deleteText]}>Delete</Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable onPress={onCancel} style={styles.button}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => text.trim() && onSave(text.trim())}
              style={[styles.button, styles.saveButton]}
            >
              <Text style={[styles.buttonText, styles.saveText]}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(14, 46, 82, 0.35)",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 130,
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderCurve: "continuous",
    padding: 18,
    gap: 14,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  input: {
    minHeight: 96,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
    backgroundColor: colors.background,
    textAlignVertical: "top",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 18,
    borderCurve: "continuous",
  },
  saveButton: {
    backgroundColor: colors.accent,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.inkSecondary,
  },
  saveText: { color: "#FFFFFF" },
  deleteText: { color: colors.danger },
});
