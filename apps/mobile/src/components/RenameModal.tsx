// Small themed modal for renaming an article (works on iOS and Android,
// unlike Alert.prompt). Mirrors the NoteEditorModal interaction patterns:
// backdrop tap dismisses, card anchored high so the keyboard can't cover it.
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { makeThemedStyles, useTheme } from "../lib/theme";

type Props = {
  visible: boolean;
  initialTitle: string;
  onSave: (title: string) => void;
  onCancel: () => void;
};

export function RenameModal({ visible, initialTitle, onSave, onCancel }: Props) {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const [title, setTitle] = useState(initialTitle);
  useEffect(() => {
    if (visible) setTitle(initialTitle);
  }, [visible, initialTitle]);

  const commit = () => {
    const trimmed = title.trim();
    if (trimmed) onSave(trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>Rename</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={commit}
            placeholder="Title"
            placeholderTextColor={c.inkFaint}
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onCancel} style={styles.button}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={commit}
              style={[styles.button, styles.saveButton]}
              accessibilityRole="button"
              accessibilityLabel="Save new title"
            >
              <Text style={[styles.buttonText, styles.saveText]}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.backdrop,
      alignItems: "center",
      justifyContent: "flex-start",
      paddingTop: 130,
      padding: 24,
    },
    card: {
      width: "100%",
      maxWidth: 440,
      backgroundColor: c.surface,
      borderRadius: 20,
      borderCurve: "continuous",
      padding: 18,
      gap: 14,
    },
    title: {
      fontSize: 16,
      fontWeight: "600",
      color: c.ink,
    },
    input: {
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: 10,
      padding: 12,
      fontSize: 15,
      color: c.ink,
      backgroundColor: c.background,
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
      backgroundColor: c.accent,
    },
    buttonText: {
      fontSize: 15,
      fontWeight: "600",
      color: c.inkSecondary,
    },
    saveText: { color: c.onAccent },
  })
);
