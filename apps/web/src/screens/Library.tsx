// Library: the capture console. A prominent save box on top (paste a URL,
// hit Enter), then the live article list — pending cards resolve in place
// via the Convex live query, no polling.
import { UserButton, useAuth } from "@clerk/react";
import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import React, { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { BrushStroke } from "../components/BrushStroke";
import { hcWithType } from "../lib/api";
import { colors } from "../lib/theme";

type ArticleListItem = FunctionReturnType<typeof api.articles.list>[number];

function formatSavedDate(savedAt: number) {
  return new Date(savedAt).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function StatusChip({ status }: { status: ArticleListItem["status"] }) {
  if (status === "pending") {
    return (
      <span className="chip chip-pending">
        <span className="chip-dot" />
        Saving…
      </span>
    );
  }
  if (status === "failed") {
    return <span className="chip chip-failed">Failed</span>;
  }
  return null;
}

function ArticleCard({
  article,
  onRetry,
  onDelete,
}: {
  article: ArticleListItem;
  onRetry: (article: ArticleListItem) => Promise<void>;
  onDelete: (id: Id<"articles">) => void;
}) {
  const [retrying, setRetrying] = useState(false);

  const meta = [article.siteName, formatSavedDate(article.savedAt)]
    .filter(Boolean)
    .join("  ·  ");

  const body = (
    <>
      <div className="card-top">
        <h2 className="card-title">{article.title}</h2>
        <button
          className="card-delete"
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
      <p className="card-meta">
        {meta}
        <StatusChip status={article.status} />
      </p>
      {article.excerpt ? (
        <p className="card-excerpt">{article.excerpt}</p>
      ) : null}
      {article.status === "failed" ? (
        <div className="card-failed-row">
          <span className="card-error">{article.error ?? "Save failed."}</span>
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
        </div>
      ) : null}
    </>
  );

  if (article.status === "ready") {
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

export function Library() {
  const { getToken } = useAuth();
  const articles = useQuery(api.articles.list);
  const removeArticle = useMutation(api.articles.remove);

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  return (
    <div className="library">
      <header className="app-header">
        <div className="wordmark">
          <h1>Inkwell</h1>
          <BrushStroke width={96} height={8} color={colors.wash} opacity={0.75} />
        </div>
        <UserButton />
      </header>

      <form className="save-form" onSubmit={onSave}>
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste a link to save — articles or PDFs"
          aria-label="Article URL"
          autoFocus
        />
        <button type="submit" disabled={saving || !draft.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
      {saveError ? <p className="save-error">{saveError}</p> : null}

      {articles === undefined ? (
        <div className="center-state">
          <span className="pulse-dot" />
        </div>
      ) : articles.length === 0 ? (
        <div className="center-state">
          <p>Nothing saved yet.</p>
          <p className="center-state-hint">
            Paste a link above — it'll be waiting on your iPad too.
          </p>
        </div>
      ) : (
        <ul className="article-list">
          {articles.map((article) => (
            <ArticleCard
              key={article._id}
              article={article}
              onRetry={onRetry}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
