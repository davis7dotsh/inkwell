// Library: the capture console. A prominent save box on top (paste a URL,
// hit Enter, or upload a PDF), filter/sort controls, then the live article
// list — pending cards resolve in place via the Convex live query, no
// polling. Visual language mirrors the iPad library screen.
import { UserButton, useAuth } from "@clerk/react";
import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";

import { BackdropWash } from "../components/BackdropWash";
import { BrushStroke } from "../components/BrushStroke";
import { hcWithType } from "../lib/api";
import { tagDisplayColor, TAG_COLOR_SWATCHES } from "../lib/tagColors";
import { useTheme } from "../lib/theme";

type ArticleListItem = FunctionReturnType<typeof api.articles.list>[number];
type TagItem = FunctionReturnType<typeof api.tags.list>[number];

type ReadStatus = "unread" | "in_progress" | "read";
type SortOrder = "newest" | "oldest";

// Read status is no longer a filter — it's surfaced only as the "unread" dot.
/** Rows written before readStatus existed count as unread. */
const readStatusOf = (article: ArticleListItem): ReadStatus =>
  article.readStatus ?? "unread";

/** Unopened articles (unread, never bumped to in_progress) wear a blue dot. */
const isUnopened = (article: ArticleListItem): boolean =>
  readStatusOf(article) === "unread";

/** Uploaded PDFs have a synthetic upload:// url — nothing to retry/open. */
const isUpload = (article: ArticleListItem) =>
  article.url.startsWith("upload://");

function formatSavedDate(savedAt: number) {
  return new Date(savedAt).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4h6m-5 0v6l-3 4h10l-3-4V4M12 18v3" />
    </svg>
  );
}

/** Processing-state chip only — read/unread is now a dot (see ReadDot). */
function StatusChip({ article }: { article: ArticleListItem }) {
  if (article.status === "pending") {
    return (
      <span className="chip chip-pending">
        <span className="chip-dot" />
        Saving…
      </span>
    );
  }
  if (article.status === "failed") {
    return <span className="chip chip-failed">Failed</span>;
  }
  return null;
}

function ReadDot({ article }: { article: ArticleListItem }) {
  // Only ready, never-opened articles get the unread indicator.
  if (article.status !== "ready" || !isUnopened(article)) return null;
  return (
    <span
      className="unread-dot"
      role="img"
      aria-label="Unread"
      title="Unread"
    />
  );
}

function TagChipList({
  tags,
  tagsById,
}: {
  tags: Id<"tags">[];
  tagsById: Map<string, TagItem>;
}) {
  const resolved = tags
    .map((id) => tagsById.get(id))
    .filter((tag): tag is TagItem => Boolean(tag));
  if (resolved.length === 0) return null;
  return (
    <div className="card-tags">
      {resolved.map((tag) => {
        const color = tagDisplayColor(tag.color);
        return (
          <span
            key={tag._id}
            className="tag-chip tag-chip-static"
            style={{
              color: color.fg,
              background: color.bg,
              borderColor: color.border,
            }}
          >
            {tag.name}
          </span>
        );
      })}
    </div>
  );
}

function ArticleCard({
  article,
  tagsById,
  allTags,
  isRenaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRetry,
  onDelete,
  onSetPinned,
  onAttachTag,
  onDetachTag,
  onCreateTag,
}: {
  article: ArticleListItem;
  tagsById: Map<string, TagItem>;
  allTags: TagItem[];
  isRenaming: boolean;
  onStartRename: (id: Id<"articles">) => void;
  onCommitRename: (id: Id<"articles">, title: string) => void;
  onCancelRename: () => void;
  onRetry: (article: ArticleListItem) => Promise<void>;
  onDelete: (id: Id<"articles">) => void;
  onSetPinned: (id: Id<"articles">, pinned: boolean) => void;
  onAttachTag: (articleId: Id<"articles">, tagId: Id<"tags">) => void;
  onDetachTag: (articleId: Id<"articles">, tagId: Id<"tags">) => void;
  onCreateTag: (name: string) => Promise<Id<"tags"> | null>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [titleDraft, setTitleDraft] = useState(article.title);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);

  const meta = [article.siteName, formatSavedDate(article.savedAt)]
    .filter(Boolean)
    .join("  ·  ");

  const top = isRenaming ? (
    <form
      className="rename-form"
      onSubmit={(e) => {
        e.preventDefault();
        onCommitRename(article._id, titleDraft);
      }}
    >
      <input
        className="rename-input"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        aria-label="Article title"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancelRename();
        }}
      />
      <button type="submit" className="rename-action" disabled={!titleDraft.trim()}>
        Save
      </button>
      <button
        type="button"
        className="rename-action rename-action-cancel"
        onClick={onCancelRename}
      >
        Cancel
      </button>
    </form>
  ) : (
    <>
      <h2 className="card-title">
        <ReadDot article={article} />
        {article.pinned ? (
          <span className="pin-indicator" title="Pinned" aria-label="Pinned">
            <PinIcon />
          </span>
        ) : null}
        {article.title}
      </h2>
      <div className="card-actions">
        <button
          className={`card-action${article.pinned ? " card-action-active" : ""}`}
          title={article.pinned ? "Unpin" : "Pin to top"}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSetPinned(article._id, !article.pinned);
          }}
        >
          {article.pinned ? "Unpin" : "Pin"}
        </button>
        <button
          className={`card-action${tagEditorOpen ? " card-action-active" : ""}`}
          title="Tags"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTagEditorOpen((open) => !open);
          }}
        >
          Tags
        </button>
        <button
          className="card-action"
          title="Rename"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTitleDraft(article.title);
            onStartRename(article._id);
          }}
        >
          Rename
        </button>
        <button
          className="card-action card-action-danger"
          title="Delete article"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(article._id);
          }}
        >
          Delete
        </button>
      </div>
    </>
  );

  const body = (
    <>
      <div className="card-top">{top}</div>
      <p className="card-meta">
        {meta}
        {article.status !== "ready" ? <StatusChip article={article} /> : null}
      </p>
      <TagChipList tags={article.tags} tagsById={tagsById} />
      {tagEditorOpen ? (
        <ArticleTagEditor
          article={article}
          allTags={allTags}
          onAttachTag={onAttachTag}
          onDetachTag={onDetachTag}
          onCreateTag={onCreateTag}
          onClose={() => setTagEditorOpen(false)}
        />
      ) : null}
      {article.excerpt ? (
        <p className="card-excerpt">{article.excerpt}</p>
      ) : null}
      {article.status === "failed" ? (
        <div className="card-failed-row">
          <span className="card-error">{article.error ?? "Save failed."}</span>
          {isUpload(article) ? null : (
            <button
              className="retry-button"
              disabled={retrying}
              onClick={async (e) => {
                e.preventDefault();
                setRetrying(true);
                try {
                  await onRetry(article);
                } finally {
                  setRetrying(false);
                }
              }}
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      ) : null}
    </>
  );

  // While renaming or editing tags, swap the link wrapper out so interacting
  // with the card never navigates to the reader.
  if (article.status === "ready" && !isRenaming && !tagEditorOpen) {
    return (
      <li>
        <Link to={`/read/${article._id}`} className="card card-ready">
          {body}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <div className="card">{body}</div>
    </li>
  );
}

/** Inline per-article tag picker: toggle existing tags, or create a new one. */
function ArticleTagEditor({
  article,
  allTags,
  onAttachTag,
  onDetachTag,
  onCreateTag,
  onClose,
}: {
  article: ArticleListItem;
  allTags: TagItem[];
  onAttachTag: (articleId: Id<"articles">, tagId: Id<"tags">) => void;
  onDetachTag: (articleId: Id<"articles">, tagId: Id<"tags">) => void;
  onCreateTag: (name: string) => Promise<Id<"tags"> | null>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const attached = useMemo(
    () => new Set(article.tags.map((id) => id as string)),
    [article.tags]
  );

  const onCreateAndAttach = async () => {
    const name = draft.trim();
    if (!name) return;
    const id = await onCreateTag(name);
    if (id) {
      onAttachTag(article._id, id);
      setDraft(""); // keep the draft if creation failed, so retry is painless
    }
  };

  return (
    <div className="tag-editor">
      <div className="tag-editor-chips">
        {allTags.length === 0 ? (
          <span className="tag-editor-empty">
            No tags yet — create one below.
          </span>
        ) : (
          allTags.map((tag) => {
            const isOn = attached.has(tag._id as string);
            const color = tagDisplayColor(tag.color);
            return (
              <button
                key={tag._id}
                type="button"
                aria-pressed={isOn}
                className={`tag-chip tag-chip-toggle${isOn ? " tag-chip-on" : ""}`}
                style={
                  isOn
                    ? {
                        color: color.fg,
                        background: color.bg,
                        borderColor: color.border,
                      }
                    : { borderColor: color.border }
                }
                onClick={() =>
                  isOn
                    ? onDetachTag(article._id, tag._id)
                    : onAttachTag(article._id, tag._id)
                }
              >
                {isOn ? "✓ " : ""}
                {tag.name}
              </button>
            );
          })
        )}
      </div>
      <form
        className="tag-editor-create"
        onSubmit={(e) => {
          e.preventDefault();
          void onCreateAndAttach();
        }}
      >
        <input
          className="tag-editor-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New tag…"
          aria-label="New tag name"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
        />
        <button
          type="submit"
          className="rename-action"
          disabled={!draft.trim()}
        >
          Add
        </button>
        <button
          type="button"
          className="rename-action rename-action-cancel"
          onClick={onClose}
        >
          Done
        </button>
      </form>
    </div>
  );
}

/** Library-wide tag manager: rename, recolor, and delete tags. */
function TagManager({
  allTags,
  onCreateTag,
  onRenameTag,
  onSetColor,
  onRemoveTag,
  onClose,
}: {
  allTags: TagItem[];
  onCreateTag: (name: string) => Promise<Id<"tags"> | null>;
  onRenameTag: (id: Id<"tags">, name: string) => void;
  onSetColor: (id: Id<"tags">, color: string | undefined) => void;
  onRemoveTag: (id: Id<"tags">) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An inline row editor that handled Escape marks it; don't also close.
      if (e.defaultPrevented) return;
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="tag-modal" role="dialog" aria-modal="true" aria-label="Manage tags">
      <button
        type="button"
        className="tag-modal-scrim"
        aria-label="Close tag manager"
        onClick={onClose}
      />
      <div className="tag-modal-panel">
        <div className="tag-modal-head">
          <h2>Manage tags</h2>
          <button type="button" className="tag-modal-close" onClick={onClose}>
            Close
          </button>
        </div>
        <form
          className="tag-modal-create"
          onSubmit={async (e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            const created = await onCreateTag(name);
            if (created) setNewName(""); // preserve input if creation failed
          }}
        >
          <input
            className="tag-editor-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add a tag…"
            aria-label="New tag name"
            autoFocus
          />
          <button type="submit" className="pill-button" disabled={!newName.trim()}>
            Add tag
          </button>
        </form>
        {allTags.length === 0 ? (
          <p className="tag-modal-empty">No tags yet.</p>
        ) : (
          <ul className="tag-modal-list">
            {allTags.map((tag) => (
              <TagManagerRow
                key={tag._id}
                tag={tag}
                onRenameTag={onRenameTag}
                onSetColor={onSetColor}
                onRemoveTag={onRemoveTag}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TagManagerRow({
  tag,
  onRenameTag,
  onSetColor,
  onRemoveTag,
}: {
  tag: TagItem;
  onRenameTag: (id: Id<"tags">, name: string) => void;
  onSetColor: (id: Id<"tags">, color: string | undefined) => void;
  onRemoveTag: (id: Id<"tags">) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(tag.name);
  const color = tagDisplayColor(tag.color);

  return (
    <li className="tag-modal-row">
      <div className="tag-modal-swatches" role="group" aria-label="Tag color">
        {TAG_COLOR_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={`tag-swatch${tag.color === swatch ? " tag-swatch-on" : ""}`}
            style={{ background: swatch }}
            aria-label={`Set color ${swatch}`}
            aria-pressed={tag.color === swatch}
            onClick={() =>
              onSetColor(tag._id, tag.color === swatch ? undefined : swatch)
            }
          />
        ))}
      </div>
      {editing ? (
        <form
          className="rename-form"
          onSubmit={(e) => {
            e.preventDefault();
            const name = nameDraft.trim();
            if (name) onRenameTag(tag._id, name);
            setEditing(false);
          }}
        >
          <input
            className="tag-editor-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            aria-label="Tag name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Stop the modal's window-level Escape listener from also firing.
                e.preventDefault();
                e.stopPropagation();
                setEditing(false);
              }
            }}
          />
          <button type="submit" className="rename-action" disabled={!nameDraft.trim()}>
            Save
          </button>
          <button
            type="button"
            className="rename-action rename-action-cancel"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span
            className="tag-chip tag-chip-static tag-modal-name"
            style={{ color: color.fg, background: color.bg, borderColor: color.border }}
          >
            {tag.name}
          </span>
          <div className="tag-modal-row-actions">
            <button
              type="button"
              className="card-action"
              onClick={() => {
                setNameDraft(tag.name);
                setEditing(true);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="card-action card-action-danger"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete the “${tag.name}” tag? It will be removed from all articles.`
                  )
                ) {
                  onRemoveTag(tag._id);
                }
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="center-state">{children}</div>;
}

export function Library() {
  const { getToken } = useAuth();
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

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<Id<"articles"> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tagsList = useMemo(() => tags ?? [], [tags]);
  const tagsById = useMemo(
    () => new Map(tagsList.map((tag) => [tag._id as string, tag])),
    [tagsList]
  );

  // Drop filter selections for tags that no longer exist (e.g. just deleted).
  useEffect(() => {
    if (!tags) return;
    setSelectedTags((prev) => {
      const valid = new Set<string>();
      for (const id of prev) if (tagsById.has(id)) valid.add(id);
      return valid.size === prev.size ? prev : valid;
    });
  }, [tags, tagsById]);

  // Per-request Authorization header: the Clerk token is short-lived, so it
  // is fetched fresh on every call rather than baked into the client.
  const client = useMemo(
    () =>
      hcWithType(import.meta.env.VITE_API_URL ?? "", {
        headers: async (): Promise<Record<string, string>> => {
          const token = await getToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    [getToken]
  );

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const url = draft.trim();
    if (!url || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await client.articles.$post({ json: { url } });
      if (res.ok) {
        // The pending card arrives via the live query; nothing else to do.
        setDraft("");
      } else {
        setSaveError(`Save failed (HTTP ${res.status}).`);
      }
    } catch {
      setSaveError("Couldn't reach the API — check VITE_API_URL.");
    } finally {
      setSaving(false);
    }
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!file || uploading) return;
    setUploading(true);
    setSaveError(null);
    try {
      const res = await client.articles.upload.$post({ form: { file } });
      if (!res.ok) {
        setSaveError(`Upload failed (HTTP ${res.status}).`);
      }
    } catch {
      setSaveError("Couldn't reach the API — check VITE_API_URL.");
    } finally {
      setUploading(false);
    }
  };

  const onRetry = async (article: ArticleListItem) => {
    // The card flips out of "failed" via the live query when the re-run
    // lands; a failed retry just leaves it failed. The url travels in the
    // body — the worker's Convex access is write-only, so it can't look the
    // article up itself.
    await client.articles[":id"].retry
      .$post({ param: { id: article._id }, json: { url: article.url } })
      .catch(() => undefined);
  };

  const onDelete = (id: Id<"articles">) => {
    if (window.confirm("Delete this article and its annotations?")) {
      void removeArticle({ id });
    }
  };

  const onCommitRename = (id: Id<"articles">, title: string) => {
    const trimmed = title.trim();
    if (trimmed) void renameArticle({ id, title: trimmed });
    setRenamingId(null);
  };

  const onSetPinned = (id: Id<"articles">, pinned: boolean) =>
    void setPinned({ id, pinned });

  const onCreateTag = async (name: string): Promise<Id<"tags"> | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      return await createTag({ name: trimmed });
    } catch {
      return null;
    }
  };

  const onAttachTag = (articleId: Id<"articles">, tagId: Id<"tags">) =>
    void addTagToArticle({ articleId, tagId });
  const onDetachTag = (articleId: Id<"articles">, tagId: Id<"tags">) =>
    void removeTagFromArticle({ articleId, tagId });

  const toggleTagFilter = (id: string) =>
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleArticles = useMemo(() => {
    if (!articles) return undefined;
    // Tag filter: OR semantics — keep articles carrying at least one selection.
    let filtered = articles;
    if (selectedTags.size > 0) {
      filtered = filtered.filter((article) =>
        article.tags.some((tagId) => selectedTags.has(tagId as string))
      );
    }
    // articles.list is newest-first; flip a copy for oldest-first.
    const ordered = sortOrder === "newest" ? filtered : [...filtered].reverse();
    // Pinned articles float to the top, preserving order within each group.
    const pinned = ordered.filter((article) => article.pinned);
    const rest = ordered.filter((article) => !article.pinned);
    return [...pinned, ...rest];
  }, [articles, sortOrder, selectedTags]);

  const { c } = useTheme();

  return (
    <div className="library">
      <BackdropWash />
      <header className="app-header">
        <div className="wordmark">
          <div className="wordmark-row">
            <h1>Inkwell</h1>
            {import.meta.env.DEV ? (
              <span className="dev-badge" title="Development build">
                DEV
              </span>
            ) : null}
          </div>
          <BrushStroke width={118} height={9} color={c.wash} />
        </div>
        <div className="app-header-actions">
          <Link to="/mcp-setup" className="header-link">
            Connect MCP
          </Link>
          <UserButton />
        </div>
      </header>
      <p className="app-subtitle">
        Save an article, read it, scribble all over it.
      </p>

      <form className="save-form" onSubmit={onSave}>
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste a link to save — articles or PDFs"
          aria-label="Article URL"
          autoFocus
        />
        <button
          type="submit"
          className="pill-button"
          disabled={saving || !draft.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="pill-button pill-button-secondary"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Upload PDF"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: "none" }}
          onChange={(e) => void onPickFile(e)}
        />
      </form>
      {saveError ? <p className="save-error">{saveError}</p> : null}

      <div className="tag-bar" role="group" aria-label="Filter by tag">
        {tagsList.map((tag) => {
          const active = selectedTags.has(tag._id as string);
          const color = tagDisplayColor(tag.color);
          return (
            <button
              key={tag._id}
              type="button"
              aria-pressed={active}
              className={`tag-chip tag-chip-filter${active ? " tag-chip-on" : ""}`}
              style={
                active
                  ? {
                      color: color.fg,
                      background: color.bg,
                      borderColor: color.border,
                    }
                  : { borderColor: color.border }
              }
              onClick={() => toggleTagFilter(tag._id as string)}
            >
              {active ? "✓ " : ""}
              {tag.name}
            </button>
          );
        })}
        {selectedTags.size > 0 ? (
          <button
            type="button"
            className="tag-bar-clear"
            onClick={() => setSelectedTags(new Set())}
          >
            Clear tags
          </button>
        ) : null}
        <button
          type="button"
          className="tag-bar-manage"
          onClick={() => setTagManagerOpen(true)}
        >
          {tagsList.length > 0 ? "Manage tags" : "+ Add tags"}
        </button>
        <button
          className="sort-toggle"
          onClick={() =>
            setSortOrder((order) => (order === "newest" ? "oldest" : "newest"))
          }
          title="Toggle sort order"
        >
          {sortOrder === "newest" ? "Newest first ↓" : "Oldest first ↑"}
        </button>
      </div>

      {visibleArticles === undefined ? (
        <EmptyState>
          <span className="pulse-dot" />
        </EmptyState>
      ) : visibleArticles.length === 0 ? (
        <EmptyState>
          {articles && articles.length > 0 ? (
            <p>Nothing {selectedTags.size > 0 ? "with those tags" : "to show"}.</p>
          ) : (
            <>
              <p>Nothing saved yet.</p>
              <p className="center-state-hint">
                Paste a link above — it'll be waiting on your iPad too.
              </p>
            </>
          )}
        </EmptyState>
      ) : (
        <ul className="article-list">
          {visibleArticles.map((article) => (
            <ArticleCard
              key={article._id}
              article={article}
              tagsById={tagsById}
              allTags={tagsList}
              isRenaming={renamingId === article._id}
              onStartRename={setRenamingId}
              onCommitRename={onCommitRename}
              onCancelRename={() => setRenamingId(null)}
              onRetry={onRetry}
              onDelete={onDelete}
              onSetPinned={onSetPinned}
              onAttachTag={onAttachTag}
              onDetachTag={onDetachTag}
              onCreateTag={onCreateTag}
            />
          ))}
        </ul>
      )}

      {tagManagerOpen ? (
        <TagManager
          allTags={tagsList}
          onCreateTag={onCreateTag}
          onRenameTag={(id, name) => void renameTag({ id, name })}
          onSetColor={(id, color) => void setTagColor({ id, color })}
          onRemoveTag={(id) => void removeTag({ id })}
          onClose={() => setTagManagerOpen(false)}
        />
      ) : null}
    </div>
  );
}
