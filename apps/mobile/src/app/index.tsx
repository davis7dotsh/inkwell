import { useAuth } from "@clerk/expo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { router } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Effect from "effect/Effect";

import { RenameModal } from "../components/RenameModal";
import { TagManagerModal } from "../components/TagManagerModal";
import {
  GlassIconButton,
  GlassSurface,
  glassAvailable,
} from "../components/glass";
import { authCommand, authToken, convexCommand } from "../effect/commands";
import { mobileConfig } from "../effect/codecs";
import { operationalErrorMessage } from "../effect/errors";
import { useMobileEffectRunner } from "../effect/react";
import { retryArticle, saveArticle, uploadPdf } from "../lib/api";
import { pickPdf, readClipboardText } from "../lib/nativeCommands";
import {
  makeThemedStyles,
  serif,
  tagChipColors,
  useTheme,
} from "../lib/theme";
import { showError } from "../lib/toast";

const API_URL = mobileConfig.apiUrl;

type ArticleListItem = FunctionReturnType<typeof api.articles.list>[number];
type Tag = FunctionReturnType<typeof api.tags.list>[number];

type ReadStatus = "unread" | "in_progress" | "read";

// Read status is no longer a filter — it's surfaced only as the "unread" dot.
/** Rows written before readStatus existed count as unread. */
const readStatusOf = (item: ArticleListItem): ReadStatus =>
  item.readStatus ?? "unread";

/** An opened article (in progress or read) has lost its "new" blue dot. */
const isUnopened = (item: ArticleListItem): boolean =>
  readStatusOf(item) === "unread";

/** Uploaded PDFs carry a synthetic upload:// url — nothing to retry/open. */
const isUpload = (item: ArticleListItem) => item.url.startsWith("upload://");

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
  tagsById,
  onDelete,
  onRename,
  onRetry,
  onTogglePin,
  onEditTags,
  onSwipeOpen,
}: {
  item: ArticleListItem;
  tagsById: Map<string, Tag>;
  onDelete: (id: Id<"articles">) => void;
  onRename: (item: ArticleListItem) => void;
  onRetry: (item: ArticleListItem) => void;
  onTogglePin: (item: ArticleListItem) => void;
  onEditTags: (item: ArticleListItem) => void;
  /** Called as this row starts to open, so the screen can close any other. */
  onSwipeOpen: (row: SwipeableMethods | null) => void;
}) {
  const { scheme, c, isDark } = useTheme();
  const styles = themed[scheme];
  const swipeRef = useRef<SwipeableMethods>(null);
  const date = new Date(item.savedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  // Resolve the article's tag ids to live tag docs (some may have been
  // deleted out from under the join — skip those).
  const cardTags = item.tags
    .map((id) => tagsById.get(String(id)))
    .filter((t): t is Tag => t !== undefined);
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
      {
        text: item.pinned ? "Unpin" : "Pin to top",
        onPress: () => onTogglePin(item),
      },
      { text: "Tags…", onPress: () => onEditTags(item) },
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
              onTogglePin(item);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`
            }
            style={({ pressed }) => [
              styles.rowAction,
              styles.pinAction,
              pressed && { opacity: 0.85 },
            ]}
          >
            <MaterialCommunityIcons
              name={item.pinned ? "pin-off-outline" : "pin-outline"}
              size={22}
              color={c.accent}
            />
            <Text style={[styles.rowActionText, { color: c.accent }]}>
              {item.pinned ? "Unpin" : "Pin"}
            </Text>
          </Pressable>
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
        <View style={styles.cardHeadingRow}>
          <View style={styles.cardHeading}>
            <View style={styles.titleLine}>
              {item.status === "ready" && isUnopened(item) ? (
                <View
                  style={styles.unreadDot}
                  accessibilityLabel="Unread"
                />
              ) : null}
              {item.pinned ? (
                <MaterialCommunityIcons
                  name="pin"
                  size={15}
                  color={c.accent}
                  style={styles.pinIcon}
                  accessibilityLabel="Pinned"
                />
              ) : null}
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={[styles.cardMeta, { flexShrink: 1 }]} numberOfLines={1}>
                {[item.siteName, date].filter(Boolean).join("  ·  ")}
              </Text>
            </View>
            {cardTags.length > 0 ? (
              <View style={styles.cardTagRow}>
                {cardTags.map((tag) => {
                  const chip = tagChipColors(tag.color, isDark);
                  return (
                    <View
                      key={tag._id}
                      style={[
                        styles.cardTagChip,
                        {
                          backgroundColor: chip.fill,
                          borderColor: chip.border,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.cardTagText, { color: chip.text }]}
                        numberOfLines={1}
                      >
                        {tag.name}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
          <Pressable
            onPress={showActions}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${item.title}`}
            style={styles.moreButton}
          >
            <MaterialCommunityIcons
              name="dots-horizontal"
              size={20}
              color={c.inkFaint}
            />
          </Pressable>
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
  const { width } = useWindowDimensions();
  const { scheme, c } = useTheme();
  const styles = themed[scheme];
  const { getToken, signOut } = useAuth();
  const run = useMobileEffectRunner();
  const articles = useQuery(api.articles.list);
  const tags = useQuery(api.tags.list);
  const removeArticle = useMutation(api.articles.remove);
  const renameArticle = useMutation(api.articles.rename);
  const setPinned = useMutation(api.articles.setPinned);
  const createTag = useMutation(api.tags.create);
  const renameTag = useMutation(api.tags.rename);
  const setTagColor = useMutation(api.tags.setColor);
  const removeTag = useMutation(api.tags.remove);
  const addTagToArticle = useMutation(api.tags.addToArticle);
  const removeTagFromArticle = useMutation(api.tags.removeFromArticle);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<Id<"tags">[]>([]);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [renameTarget, setRenameTarget] = useState<ArticleListItem | null>(
    null
  );
  // The tag manager is open when this is non-null; the article (or null for
  // global management) tells it whether to show attach toggles.
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [tagArticleTarget, setTagArticleTarget] =
    useState<ArticleListItem | null>(null);
  const urlInputRef = useRef<TextInput>(null);
  const isCompact = width < 700;

  // id → tag lookup for card chips and attach state. Memoized so cards reuse
  // one map per query update.
  const tagsById = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const tag of tags ?? []) map.set(String(tag._id), tag);
    return map;
  }, [tags]);

  // A selected tag can outlive the selection (deleted on another device, in
  // the web app, or by an agent). Derive the live subset so a stale id never
  // leaves an invisible filter pinning the list to empty — no reconciling
  // effect needed.
  const activeTagIds = useMemo(
    () => selectedTagIds.filter((id) => tagsById.has(String(id))),
    [selectedTagIds, tagsById]
  );

  // Live view of the article the tag manager targets — keeps its attach
  // checkmarks in sync as addToArticle/removeFromArticle land.
  const liveTagArticle = useMemo(() => {
    if (!tagArticleTarget) return null;
    return (
      articles?.find((a) => a._id === tagArticleTarget._id) ?? tagArticleTarget
    );
  }, [articles, tagArticleTarget]);

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
    setAddOpen(false);
    run(
      Effect.gen(function* () {
        const token = yield* authToken("save article", getToken);
        yield* saveArticle({ token, url: normalized });
      }),
      {
        onFailure: (error) => {
          const message = operationalErrorMessage(error);
          showError(`Couldn't save: ${message}`);
          Alert.alert("Couldn't save", message);
          setUrl(normalized);
        },
        onDefect: (error) => {
          const message = operationalErrorMessage(error);
          showError(`Couldn't save: ${message}`);
          Alert.alert("Couldn't save", message);
          setUrl(normalized);
        },
      }
    );
  }, [url, getToken, run]);

  const onPaste = useCallback(() => {
    run(readClipboardText, {
      onSuccess: (text) => {
        if (text) setUrl(text.trim());
      },
      onFailure: (error) =>
        showError(`Couldn't paste: ${operationalErrorMessage(error)}`),
    });
  }, [run]);

  const onUpload = useCallback(() => {
    if (!API_URL) {
      Alert.alert(
        "Not configured",
        "Set EXPO_PUBLIC_API_URL in .env.local to save articles."
      );
      return;
    }
    run(pickPdf, {
      onSuccess: (asset) => {
        if (!asset) return;
        setUploading(true);
        run(
          Effect.gen(function* () {
            const token = yield* authToken("upload PDF", getToken);
            yield* uploadPdf({ token, file: asset });
          }),
          {
            onSuccess: () => {
              setUploading(false);
              setAddOpen(false);
            },
            onFailure: (error) => {
              setUploading(false);
              const message = operationalErrorMessage(error);
              showError(`Couldn't upload: ${message}`);
              Alert.alert("Couldn't upload", message);
            },
            onDefect: (error) => {
              setUploading(false);
              const message = operationalErrorMessage(error);
              showError(`Couldn't upload: ${message}`);
              Alert.alert("Couldn't upload", message);
            },
          }
        );
      },
      onFailure: (error) => {
        const message = operationalErrorMessage(error);
        showError(`Couldn't choose a PDF: ${message}`);
        Alert.alert("Couldn't upload", message);
      },
    });
  }, [getToken, run]);

  const onDelete = useCallback(
    (id: Id<"articles">) => {
      run(convexCommand("delete article", () => removeArticle({ id })), {
        onFailure: (error) =>
          showError(`Couldn't delete: ${operationalErrorMessage(error)}`),
      });
    },
    [removeArticle, run]
  );

  const onRename = useCallback((item: ArticleListItem) => {
    setRenameTarget(item);
  }, []);

  const onSaveRename = useCallback(
    (title: string) => {
      if (renameTarget) {
        run(
          convexCommand("rename article", () =>
            renameArticle({ id: renameTarget._id, title })
          ),
          {
            onFailure: (error) =>
              showError(`Couldn't rename: ${operationalErrorMessage(error)}`),
          }
        );
      }
      setRenameTarget(null);
    },
    [renameTarget, renameArticle, run]
  );

  const onTogglePin = useCallback(
    (item: ArticleListItem) => {
      run(
        convexCommand("update pin", () =>
          setPinned({ id: item._id, pinned: !item.pinned })
        ),
        {
          onFailure: (error) =>
            showError(`Couldn't update pin: ${operationalErrorMessage(error)}`),
        }
      );
    },
    [run, setPinned]
  );

  const onEditTags = useCallback((item: ArticleListItem) => {
    setTagArticleTarget(item);
    setTagManagerOpen(true);
  }, []);

  const onManageTags = useCallback(() => {
    setTagArticleTarget(null);
    setTagManagerOpen(true);
  }, []);

  const onCloseTagManager = useCallback(() => {
    setTagManagerOpen(false);
    setTagArticleTarget(null);
  }, []);

  const onCreateTag = useCallback(
    (name: string, color?: string) => {
      run(convexCommand("create tag", () => createTag({ name, color })), {
        onFailure: (error) =>
          showError(`Couldn't create tag: ${operationalErrorMessage(error)}`),
      });
    },
    [createTag, run]
  );

  const onRenameTag = useCallback(
    (id: Id<"tags">, name: string) => {
      run(convexCommand("rename tag", () => renameTag({ id, name })), {
        onFailure: (error) =>
          showError(`Couldn't rename tag: ${operationalErrorMessage(error)}`),
      });
    },
    [renameTag, run]
  );

  const onSetTagColor = useCallback(
    (id: Id<"tags">, color?: string) => {
      run(
        convexCommand("set tag color", () => setTagColor({ id, color })),
        {
          onFailure: (error) =>
            showError(
              `Couldn't update color: ${operationalErrorMessage(error)}`
            ),
        }
      );
    },
    [run, setTagColor]
  );

  const onRemoveTag = useCallback(
    (id: Id<"tags">) => {
      const tag = tagsById.get(String(id));
      Alert.alert(
        "Delete tag?",
        tag
          ? `"${tag.name}" will be removed from every article.`
          : "This tag will be removed from every article.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              run(convexCommand("delete tag", () => removeTag({ id })), {
                onFailure: (error) =>
                  showError(
                    `Couldn't delete tag: ${operationalErrorMessage(error)}`
                  ),
              });
              // Drop it from the active filter if it was selected.
              setSelectedTagIds((ids) => ids.filter((t) => t !== id));
            },
          },
        ]
      );
    },
    [removeTag, run, tagsById]
  );

  const onAttachTag = useCallback(
    (articleId: Id<"articles">, tagId: Id<"tags">) => {
      run(
        convexCommand("add tag to article", () =>
          addTagToArticle({ articleId, tagId })
        ),
        {
          onFailure: (error) =>
            showError(`Couldn't add tag: ${operationalErrorMessage(error)}`),
        }
      );
    },
    [addTagToArticle, run]
  );

  const onDetachTag = useCallback(
    (articleId: Id<"articles">, tagId: Id<"tags">) => {
      run(
        convexCommand("remove tag from article", () =>
          removeTagFromArticle({ articleId, tagId })
        ),
        {
          onFailure: (error) =>
            showError(`Couldn't remove tag: ${operationalErrorMessage(error)}`),
        }
      );
    },
    [removeTagFromArticle, run]
  );

  const toggleTagFilter = useCallback((id: Id<"tags">) => {
    setSelectedTagIds((ids) =>
      ids.includes(id) ? ids.filter((t) => t !== id) : [...ids, id]
    );
  }, []);

  const onRetry = useCallback(
    (item: ArticleListItem) => {
      if (!API_URL) {
        Alert.alert(
          "Not configured",
          "Set EXPO_PUBLIC_API_URL in .env.local to save articles."
        );
        return;
      }
      run(
        Effect.gen(function* () {
          const token = yield* authToken("retry article", getToken);
          yield* retryArticle({
            token,
            articleId: item._id,
            url: item.url,
          });
        }),
        {
          onFailure: (error) => {
            const message = operationalErrorMessage(error);
            showError(`Couldn't retry: ${message}`);
            Alert.alert("Couldn't retry", message);
          },
          onDefect: (error) => {
            const message = operationalErrorMessage(error);
            showError(`Couldn't retry: ${message}`);
            Alert.alert("Couldn't retry", message);
          },
        }
      );
    },
    [getToken, run]
  );

  const visibleArticles = useMemo(() => {
    if (!articles) return [];
    // Tag filter: OR semantics — keep articles carrying at least one of the
    // selected tags.
    const tagFiltered =
      activeTagIds.length === 0
        ? articles
        : articles.filter((item) => {
            const ids = new Set(item.tags.map(String));
            return activeTagIds.some((id) => ids.has(String(id)));
          });
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = normalizedQuery
      ? tagFiltered.filter((item) =>
          [item.title, item.siteName, item.excerpt]
            .filter(Boolean)
            .some((value) =>
              value?.toLocaleLowerCase().includes(normalizedQuery)
            )
        )
      : tagFiltered;
    // articles.list is newest-first; flip a copy for oldest-first.
    const sorted = sortOrder === "newest" ? filtered : [...filtered].reverse();
    // Pinned articles float to the top regardless of sort, preserving the
    // chosen order within each group (stable partition).
    const pinned = sorted.filter((item) => item.pinned);
    const rest = sorted.filter((item) => !item.pinned);
    return pinned.length > 0 ? [...pinned, ...rest] : sorted;
  }, [articles, activeTagIds, query, sortOrder]);

  const toggleAdd = useCallback(() => {
    const next = !addOpen;
    setAddOpen(next);
    if (next) {
      run(Effect.sleep(50), {
        onSuccess: () => urlInputRef.current?.focus(),
      });
    }
  }, [addOpen, run]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 18 }]}>
      <View style={styles.libraryShell}>
        <View style={styles.titleRow}>
          <View style={styles.titleLeft}>
            <Text style={styles.appTitle}>Inkwell</Text>
            {__DEV__ ? (
              <View
                style={styles.devBadge}
                accessibilityLabel="Development build"
              >
                <Text style={styles.devBadgeText}>DEV</Text>
              </View>
            ) : null}
          </View>
          <GlassIconButton
            icon="logout-variant"
            onPress={() =>
              run(authCommand("sign out", signOut), {
                onFailure: (error) =>
                  showError(`Couldn't sign out: ${operationalErrorMessage(error)}`),
              })
            }
            accessibilityLabel="Sign out"
            size={38}
            iconSize={18}
            iconColor={c.inkSecondary}
          />
        </View>

        <View style={[styles.utilityRow, isCompact && styles.utilityRowCompact]}>
          <View style={styles.searchField}>
            <MaterialCommunityIcons
              name="magnify"
              size={19}
              color={c.inkFaint}
            />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search library"
              placeholderTextColor={c.inkFaint}
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel="Search library"
            />
          </View>
          <Pressable
            onPress={toggleAdd}
            accessibilityRole="button"
            accessibilityState={{ expanded: addOpen }}
            style={({ pressed }) =>
              pressed && !glassAvailable && styles.cardPressed
            }
          >
            <GlassSurface
              isInteractive
              effectStyle="clear"
              tintColor={addOpen ? c.accentSoft : undefined}
              style={styles.addControl}
              fallbackStyle={styles.addControlFallback}
            >
              <MaterialCommunityIcons
                name={addOpen ? "close" : "plus"}
                size={20}
                color={c.accent}
              />
              <Text style={styles.addControlText}>
                {addOpen ? "Close" : "Add"}
              </Text>
            </GlassSurface>
          </Pressable>
        </View>

        {addOpen ? (
          <View style={styles.captureArea}>
            <Text style={styles.captureLabel}>Add to your library</Text>
            <View style={[styles.inputRow, isCompact && styles.inputRowCompact]}>
              <TextInput
                ref={urlInputRef}
                style={styles.input}
                value={url}
                onChangeText={setUrl}
                placeholder="Paste an article URL"
                placeholderTextColor={c.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={onSubmit}
              />
              <View style={styles.captureActions}>
                <GlassIconButton
                  icon="content-paste"
                  onPress={onPaste}
                  accessibilityLabel="Paste from clipboard"
                  size={44}
                  iconSize={19}
                  iconColor={c.inkSecondary}
                />
                <GlassIconButton
                  icon={uploading ? "progress-upload" : "file-upload-outline"}
                  onPress={onUpload}
                  accessibilityLabel="Upload a PDF"
                  disabled={uploading}
                  size={44}
                  iconSize={19}
                  iconColor={c.inkSecondary}
                />
                <Pressable
                  onPress={onSubmit}
                  accessibilityRole="button"
                  style={({ pressed }) =>
                    pressed && !glassAvailable && styles.cardPressed
                  }
                >
                  <GlassSurface
                    isInteractive
                    effectStyle="clear"
                    tintColor={c.accent}
                    style={styles.addButton}
                    fallbackStyle={styles.addButtonFallback}
                  >
                    <Text style={styles.addButtonText}>Save</Text>
                  </GlassSurface>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.sectionHeadingRow}>
          <Text style={styles.sectionTitle}>Library</Text>
          <View style={styles.headingControls}>
            <Pressable
              onPress={onManageTags}
              accessibilityRole="button"
              accessibilityLabel="Manage tags"
              hitSlop={6}
              style={styles.manageTagsButton}
            >
              <MaterialCommunityIcons
                name="tag-multiple-outline"
                size={16}
                color={c.inkSecondary}
              />
            </Pressable>
            <Pressable
              onPress={() =>
                setSortOrder((order) =>
                  order === "newest" ? "oldest" : "newest"
                )
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
        </View>

        {(tags?.length ?? 0) > 0 ? (
          <View style={styles.tagBarRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.tagBarScroll}
              contentContainerStyle={styles.tagBar}
            >
            {activeTagIds.length > 0 ? (
              <Pressable
                onPress={() => setSelectedTagIds([])}
                accessibilityRole="button"
                accessibilityLabel="Clear tag filters"
                style={[styles.tagFilterChip, styles.tagClearChip]}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={13}
                  color={c.inkSecondary}
                />
                <Text style={styles.tagClearText}>Clear</Text>
              </Pressable>
            ) : null}
            {(tags ?? []).map((tag) => {
              const active = selectedTagIds.includes(tag._id);
              const chip = tagChipColors(tag.color, scheme === "dark");
              return (
                <Pressable
                  key={tag._id}
                  onPress={() => toggleTagFilter(tag._id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.tagFilterChip,
                    {
                      backgroundColor: active ? chip.text : chip.fill,
                      borderColor: active ? chip.text : chip.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tagFilterText,
                      { color: active ? c.onAccent : chip.text },
                    ]}
                    numberOfLines={1}
                  >
                    {tag.name}
                  </Text>
                </Pressable>
              );
            })}
            </ScrollView>
          </View>
        ) : null}

        <FlatList
          style={styles.articleList}
          data={visibleArticles}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <ArticleCard
              item={item}
              tagsById={tagsById}
              onDelete={onDelete}
              onRename={onRename}
              onRetry={onRetry}
              onTogglePin={onTogglePin}
              onEditTags={onEditTags}
              onSwipeOpen={onSwipeOpen}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            articles !== undefined ? (
              <View style={styles.empty}>
                <MaterialCommunityIcons
                  name="book-open-page-variant-outline"
                  size={38}
                  color={c.inkFaint}
                />
                <Text style={styles.emptyTitle}>
                  {query.trim()
                    ? "No matching articles"
                    : articles.length > 0
                      ? "Nothing in this view"
                      : "Your library is ready"}
                </Text>
                <Text style={styles.emptyText}>
                  {query.trim()
                    ? "Try a title, publication, or phrase from the article."
                    : articles.length > 0
                      ? "Choose another reading status."
                      : "Add an article or PDF to begin a focused reading collection."}
                </Text>
              </View>
            ) : null
          }
        />
      </View>

      <RenameModal
        visible={renameTarget !== null}
        initialTitle={renameTarget?.title ?? ""}
        onSave={onSaveRename}
        onCancel={() => setRenameTarget(null)}
      />

      <TagManagerModal
        visible={tagManagerOpen}
        tags={tags ?? []}
        articleId={liveTagArticle?._id ?? null}
        articleTagIds={liveTagArticle?.tags ?? []}
        onClose={onCloseTagManager}
        onCreate={onCreateTag}
        onRename={onRenameTag}
        onSetColor={onSetTagColor}
        onRemove={onRemoveTag}
        onAttach={onAttachTag}
        onDetach={onDetachTag}
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
    libraryShell: {
      width: "100%",
      maxWidth: 960,
      flex: 1,
      alignSelf: "center",
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
    utilityRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 22,
      marginBottom: 28,
    },
    utilityRowCompact: {
      marginTop: 18,
      marginBottom: 24,
    },
    searchField: {
      height: 44,
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      borderRadius: 22,
      borderCurve: "continuous",
      paddingHorizontal: 14,
    },
    searchInput: {
      flex: 1,
      height: 44,
      fontSize: 15,
      color: c.ink,
    },
    addControl: {
      minWidth: 92,
      height: 44,
      borderRadius: 22,
      borderCurve: "continuous",
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
    },
    addControlFallback: {
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
    },
    addControlText: {
      fontSize: 15,
      fontWeight: "600",
      color: c.accent,
    },
    captureArea: {
      marginTop: -12,
      marginBottom: 28,
      padding: 16,
      borderRadius: 16,
      borderCurve: "continuous",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
    },
    captureLabel: {
      marginBottom: 10,
      fontSize: 13,
      fontWeight: "600",
      color: c.inkSecondary,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    inputRowCompact: {
      alignItems: "stretch",
      flexDirection: "column",
    },
    input: {
      flex: 1,
      minWidth: 0,
      height: 44,
      backgroundColor: c.background,
      borderWidth: 1,
      borderColor: c.hairline,
      borderRadius: 22,
      borderCurve: "continuous",
      paddingHorizontal: 16,
      fontSize: 15,
      color: c.ink,
    },
    captureActions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 8,
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
    sectionHeadingRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 16,
    },
    sectionTitle: {
      fontFamily: serif,
      fontSize: 27,
      lineHeight: 34,
      fontWeight: "600",
      color: c.ink,
    },
    // Manage tags + sort toggle, right-aligned on the Library heading line.
    headingControls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    tagBarRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
      marginBottom: 6,
    },
    // Fills the row so Manage tags + the sort toggle align to the right.
    tagBarScroll: {
      flex: 1,
    },
    tagBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingRight: 4,
    },
    tagFilterChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: 14,
      borderCurve: "continuous",
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 6,
      maxWidth: 200,
    },
    tagFilterText: {
      fontSize: 13,
      fontWeight: "600",
      flexShrink: 1,
    },
    tagClearChip: {
      backgroundColor: c.surface,
      borderColor: c.hairline,
    },
    tagClearText: {
      fontSize: 13,
      fontWeight: "600",
      color: c.inkSecondary,
    },
    manageTagsButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
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
    articleList: {
      flex: 1,
      minHeight: 0,
    },
    list: {
      paddingBottom: 40,
      flexGrow: 1,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.hairline,
    },
    card: {
      minHeight: 112,
      paddingHorizontal: 4,
      paddingVertical: 19,
    },
    cardHeadingRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    cardHeading: {
      flex: 1,
      minWidth: 0,
    },
    moreButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      marginTop: -5,
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
    pinAction: {
      backgroundColor: c.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
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
      opacity: 0.62,
    },
    titleLine: {
      flexDirection: "row",
      alignItems: "baseline",
    },
    // A small "new / not yet opened" marker, baseline-aligned with the title.
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.accent,
      marginRight: 8,
      alignSelf: "center",
      marginTop: 2,
    },
    pinIcon: {
      marginRight: 5,
      alignSelf: "center",
      marginTop: 1,
    },
    cardTitle: {
      flex: 1,
      fontFamily: serif,
      fontSize: 20,
      lineHeight: 27,
      fontWeight: "600",
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
    cardTagRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 8,
    },
    cardTagChip: {
      maxWidth: 160,
      borderRadius: 11,
      borderCurve: "continuous",
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    cardTagText: {
      fontSize: 11.5,
      fontWeight: "600",
    },
    cardExcerpt: {
      fontSize: 14,
      lineHeight: 21,
      color: c.inkSecondary,
      marginTop: 9,
      maxWidth: 720,
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
      gap: 9,
    },
    emptyTitle: {
      fontFamily: serif,
      fontSize: 20,
      fontWeight: "600",
      color: c.ink,
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
