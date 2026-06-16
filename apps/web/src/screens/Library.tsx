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
import { useTheme } from "../lib/theme";

type ArticleListItem = FunctionReturnType<typeof api.articles.list>[number];

type ReadStatus = "unread" | "in_progress" | "read";
type StatusFilter = "all" | ReadStatus;
type SortOrder = "newest" | "oldest";

/** Rows written before readStatus existed count as unread. */
const readStatusOf = (article: ArticleListItem): ReadStatus =>
  article.readStatus ?? "unread";

/** Uploaded PDFs have a synthetic upload:// url — nothing to retry/open. */
const isUpload = (article: ArticleListItem) =>
  article.url.startsWith("upload://");

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "in_progress", label: "In progress" },
  { value: "read", label: "Read" },
];

function formatSavedDate(savedAt: number) {
  return new Date(savedAt).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

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
  const status = readStatusOf(article);
  if (status === "unread") {
    return <span className="chip chip-unread">Unread</span>;
  }
  if (status === "in_progress") {
    return (
      <span className="chip chip-in-progress">
        <span className="chip-dot" />
        In progress
      </span>
    );
  }
  return <span className="chip chip-read">✓ Read</span>;
}

function ArticleCard({
  article,
  isRenaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRetry,
  onDelete,
}: {
  article: ArticleListItem;
  isRenaming: boolean;
  onStartRename: (id: Id<"articles">) => void;
  onCommitRename: (id: Id<"articles">, title: string) => void;
  onCancelRename: () => void;
  onRetry: (article: ArticleListItem) => Promise<void>;
  onDelete: (id: Id<"articles">) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [titleDraft, setTitleDraft] = useState(article.title);

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
      <h2 className="card-title">{article.title}</h2>
      <div className="card-actions">
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
        <StatusChip article={article} />
      </p>
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

  // While renaming, swap the link wrapper out so typing never navigates.
  if (article.status === "ready" && !isRenaming) {
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

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="center-state">{children}</div>;
}

export function Library() {
  const { getToken } = useAuth();
  const articles = useQuery(api.articles.list);
  const removeArticle = useMutation(api.articles.remove);
  const renameArticle = useMutation(api.articles.rename);

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [renamingId, setRenamingId] = useState<Id<"articles"> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const visibleArticles = useMemo(() => {
    if (!articles) return undefined;
    const filtered =
      filter === "all"
        ? articles
        : articles.filter((article) => readStatusOf(article) === filter);
    // articles.list is newest-first; flip a copy for oldest-first.
    return sortOrder === "newest" ? filtered : [...filtered].reverse();
  }, [articles, filter, sortOrder]);

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

      <div className="library-controls">
        <div className="filter-chips" role="group" aria-label="Filter by status">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={`filter-chip${filter === value ? " filter-chip-active" : ""}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
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
            <p>Nothing {filter === "in_progress" ? "in progress" : filter}.</p>
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
              isRenaming={renamingId === article._id}
              onStartRename={setRenamingId}
              onCommitRename={onCommitRename}
              onCancelRename={() => setRenamingId(null)}
              onRetry={onRetry}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
