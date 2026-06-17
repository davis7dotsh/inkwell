// Tag manager — create, rename, recolor, and delete the user's tags, and
// (when opened against an article) attach/detach them to that article.
//
// Mirrors RenameModal's interaction language: a high-anchored card over a
// dismissing backdrop. All writes go through the tags.* mutations passed in
// by the caller, so this stays a pure presentational + wiring component.
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { Doc, Id } from "@inkwell/backend/convex/_generated/dataModel";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  DEFAULT_TAG_COLOR,
  makeThemedStyles,
  tagChipColors,
  tagColors,
  useTheme,
} from "../lib/theme";

type Tag = Doc<"tags">;

type Props = {
  visible: boolean;
  tags: Tag[];
  /** When set, rows gain an attach/detach toggle for this article. */
  articleId: Id<"articles"> | null;
  /** Tag ids currently attached to the target article. */
  articleTagIds: Id<"tags">[];
  onClose: () => void;
  onCreate: (name: string, color?: string) => void;
  onRename: (id: Id<"tags">, name: string) => void;
  onSetColor: (id: Id<"tags">, color?: string) => void;
  onRemove: (id: Id<"tags">) => void;
  onAttach: (articleId: Id<"articles">, tagId: Id<"tags">) => void;
  onDetach: (articleId: Id<"articles">, tagId: Id<"tags">) => void;
};

function ColorSwatches({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (color: string) => void;
}) {
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  return (
    <View style={styles.swatchRow}>
      {tagColors.map((color) => {
        const active = color.toLowerCase() === selected.toLowerCase();
        return (
          <Pressable
            key={color}
            onPress={() => onSelect(color)}
            accessibilityRole="button"
            accessibilityLabel={`Use color ${color}`}
            accessibilityState={{ selected: active }}
            style={[
              styles.swatch,
              { backgroundColor: color },
              active && { borderColor: c.ink, borderWidth: 2 },
            ]}
          >
            {active ? (
              <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function TagManagerModal({ visible, onClose, ...rest }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Mounting the body only while open gives it fresh transient input
          state on each open — no setState-in-effect reset needed. */}
      {visible ? <TagManagerBody onClose={onClose} {...rest} /> : null}
    </Modal>
  );
}

function TagManagerBody({
  tags,
  articleId,
  articleTagIds,
  onClose,
  onCreate,
  onRename,
  onSetColor,
  onRemove,
  onAttach,
  onDetach,
}: Omit<Props, "visible">) {
  const { scheme, c, isDark } = useTheme();
  const styles = themed[scheme];

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(DEFAULT_TAG_COLOR);
  // The tag whose name/color is being edited inline, if any.
  const [editingId, setEditingId] = useState<Id<"tags"> | null>(null);
  const [editName, setEditName] = useState("");

  const attached = new Set(articleTagIds.map(String));

  const commitCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreate(trimmed, newColor);
    setNewName("");
    setNewColor(DEFAULT_TAG_COLOR);
  };

  const beginEdit = (tag: Tag) => {
    setEditingId(tag._id);
    setEditName(tag.name);
  };

  const commitEdit = (tag: Tag) => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== tag.name) onRename(tag._id, trimmed);
    setEditingId(null);
  };

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              {articleId ? "Tags for this article" : "Manage tags"}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <MaterialCommunityIcons
                name="close"
                size={20}
                color={c.inkFaint}
              />
            </Pressable>
          </View>

          {/* Create a new tag */}
          <View style={styles.createRow}>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="New tag name"
              placeholderTextColor={c.inkFaint}
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={commitCreate}
            />
            <Pressable
              onPress={commitCreate}
              accessibilityRole="button"
              accessibilityLabel="Create tag"
              disabled={!newName.trim()}
              style={[
                styles.createButton,
                !newName.trim() && styles.createButtonDisabled,
              ]}
            >
              <MaterialCommunityIcons name="plus" size={20} color={c.onAccent} />
            </Pressable>
          </View>
          <ColorSwatches selected={newColor} onSelect={setNewColor} />

          {/* Existing tags */}
          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {tags.length === 0 ? (
              <Text style={styles.empty}>
                No tags yet. Create one above to start organizing.
              </Text>
            ) : (
              tags.map((tag) => {
                const chip = tagChipColors(tag.color, isDark);
                const isAttached = attached.has(String(tag._id));
                const isEditing = editingId === tag._id;
                return (
                  <View key={tag._id} style={styles.tagRow}>
                    {articleId ? (
                      <Pressable
                        onPress={() =>
                          isAttached
                            ? onDetach(articleId, tag._id)
                            : onAttach(articleId, tag._id)
                        }
                        hitSlop={8}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isAttached }}
                        accessibilityLabel={`${
                          isAttached ? "Remove" : "Add"
                        } tag ${tag.name}`}
                        style={[
                          styles.checkbox,
                          isAttached && {
                            backgroundColor: c.accent,
                            borderColor: c.accent,
                          },
                        ]}
                      >
                        {isAttached ? (
                          <MaterialCommunityIcons
                            name="check"
                            size={14}
                            color={c.onAccent}
                          />
                        ) : null}
                      </Pressable>
                    ) : null}

                    <View style={styles.tagMain}>
                      {isEditing ? (
                        <TextInput
                          style={[styles.input, styles.editInput]}
                          value={editName}
                          onChangeText={setEditName}
                          autoFocus
                          selectTextOnFocus
                          returnKeyType="done"
                          onSubmitEditing={() => commitEdit(tag)}
                          onBlur={() => commitEdit(tag)}
                          placeholder="Tag name"
                          placeholderTextColor={c.inkFaint}
                        />
                      ) : (
                        <Pressable
                          onPress={() =>
                            articleId
                              ? isAttached
                                ? onDetach(articleId, tag._id)
                                : onAttach(articleId, tag._id)
                              : beginEdit(tag)
                          }
                          style={[
                            styles.tagChip,
                            {
                              backgroundColor: chip.fill,
                              borderColor: chip.border,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.tagDot,
                              { backgroundColor: chip.text },
                            ]}
                          />
                          <Text
                            style={[styles.tagChipText, { color: chip.text }]}
                            numberOfLines={1}
                          >
                            {tag.name}
                          </Text>
                        </Pressable>
                      )}

                      {isEditing ? (
                        <ColorSwatches
                          selected={tag.color ?? DEFAULT_TAG_COLOR}
                          onSelect={(color) => onSetColor(tag._id, color)}
                        />
                      ) : null}
                    </View>

                    <View style={styles.tagActions}>
                      {isEditing ? (
                        <Pressable
                          onPress={() => commitEdit(tag)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel="Done editing tag"
                          style={styles.iconButton}
                        >
                          <MaterialCommunityIcons
                            name="check"
                            size={20}
                            color={c.accent}
                          />
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => beginEdit(tag)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit tag ${tag.name}`}
                          style={styles.iconButton}
                        >
                          <MaterialCommunityIcons
                            name="pencil-outline"
                            size={18}
                            color={c.inkSecondary}
                          />
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => onRemove(tag._id)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete tag ${tag.name}`}
                        style={styles.iconButton}
                      >
                        <MaterialCommunityIcons
                          name="trash-can-outline"
                          size={18}
                          color={c.danger}
                        />
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
  );
}

const themed = makeThemedStyles((c) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.backdrop,
      alignItems: "center",
      justifyContent: "flex-start",
      paddingTop: 96,
      padding: 24,
    },
    card: {
      width: "100%",
      maxWidth: 460,
      maxHeight: "80%",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      borderRadius: 24,
      borderCurve: "continuous",
      padding: 20,
      gap: 14,
      shadowColor: "#172A3E",
      shadowOpacity: 0.14,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 12 },
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      fontSize: 16,
      fontWeight: "600",
      color: c.ink,
    },
    createRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: 10,
      borderCurve: "continuous",
      padding: 12,
      fontSize: 15,
      color: c.ink,
      backgroundColor: c.surfaceMuted,
    },
    editInput: {
      paddingVertical: 8,
    },
    createButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderCurve: "continuous",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accent,
    },
    createButtonDisabled: {
      opacity: 0.4,
    },
    swatchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    swatch: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      alignItems: "center",
      justifyContent: "center",
    },
    list: {
      flexGrow: 0,
    },
    empty: {
      fontSize: 14,
      lineHeight: 20,
      color: c.inkFaint,
      paddingVertical: 8,
    },
    tagRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: c.hairline,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 4,
    },
    tagMain: {
      flex: 1,
      minWidth: 0,
      gap: 8,
    },
    tagChip: {
      alignSelf: "flex-start",
      maxWidth: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 14,
      borderCurve: "continuous",
      borderWidth: 1,
      paddingHorizontal: 11,
      paddingVertical: 6,
    },
    tagDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    tagChipText: {
      fontSize: 13.5,
      fontWeight: "600",
      flexShrink: 1,
    },
    tagActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    iconButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
  })
);
