// ReaderTags: the tag row under the article meta in the reader. Shows the
// article's tags as colored chips and a small "+ Tags" popover to attach,
// detach, or create tags — the same operations the library card offers, so
// tagging stays in reach while reading. Tag state streams live from
// api.tags.list / api.articles.get.
import { api } from "@inkwell/backend/convex/_generated/api";
import type { Id } from "@inkwell/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Exit } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";

import { convexCommand } from "../lib/effect/convex";
import {
  exitFailureMessage,
  runBrowserEffect,
} from "../lib/effect/react";
import { tagDisplayColor } from "../lib/tagColors";

export function ReaderTags({
  articleId,
  tagIds,
}: {
  articleId: Id<"articles">;
  tagIds: Id<"tags">[];
}) {
  const tags = useQuery(api.tags.list);
  const createTag = useMutation(api.tags.create);
  const addToArticle = useMutation(api.tags.addToArticle);
  const removeFromArticle = useMutation(api.tags.removeFromArticle);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [commandError, setCommandError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const tagsList = tags ?? [];
  const tagsById = useMemo(
    () => new Map(tagsList.map((tag) => [tag._id as string, tag])),
    [tagsList]
  );
  const attached = useMemo(
    () => new Set(tagIds.map((id) => id as string)),
    [tagIds]
  );

  // Dismiss the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onCreateAndAttach = async () => {
    const name = draft.trim();
    if (!name) return;
    setCommandError(null);
    const exit = await runBrowserEffect(
      convexCommand("Create and attach tag", async () => {
        const id = await createTag({ name });
        await addToArticle({ articleId, tagId: id });
      }),
    );
    if (Exit.isSuccess(exit)) {
      setDraft(""); // only clear once the tag is created and attached
    } else {
      setCommandError(
        exitFailureMessage(exit, "Couldn't create and attach this tag."),
      );
    }
  };

  const updateAttachedTag = (
    operation: string,
    run: () => Promise<unknown>,
  ) => {
    setCommandError(null);
    void runBrowserEffect(convexCommand(operation, run)).then((exit) => {
      if (Exit.isFailure(exit)) {
        setCommandError(exitFailureMessage(exit, `${operation} failed.`));
      }
    });
  };

  const resolved = tagIds
    .map((id) => tagsById.get(id as string))
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));

  return (
    <div className="reader-tags" ref={wrapRef}>
      {resolved.map((tag) => {
        const color = tagDisplayColor(tag.color);
        return (
          <span
            key={tag._id}
            className="tag-chip tag-chip-static"
            style={{ color: color.fg, background: color.bg, borderColor: color.border }}
          >
            {tag.name}
          </span>
        );
      })}
      <button
        type="button"
        className={`reader-tags-toggle${open ? " reader-tags-toggle-active" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {resolved.length > 0 ? "Edit tags" : "+ Tags"}
      </button>
      {open ? (
        <div className="reader-tags-popover" role="dialog" aria-label="Tags">
          <div className="tag-editor-chips">
            {tagsList.length === 0 ? (
              <span className="tag-editor-empty">
                No tags yet — create one below.
              </span>
            ) : (
              tagsList.map((tag) => {
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
                        ? updateAttachedTag("Remove tag from article", () =>
                            removeFromArticle({
                              articleId,
                              tagId: tag._id,
                            }),
                          )
                        : updateAttachedTag("Add tag to article", () =>
                            addToArticle({ articleId, tagId: tag._id }),
                          )
                    }
                  >
                    {isOn ? "✓ " : ""}
                    {tag.name}
                  </button>
                );
              })
            )}
          </div>
          {commandError ? (
            <p className="save-error" role="alert">
              {commandError}
            </p>
          ) : null}
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
            />
            <button type="submit" className="rename-action" disabled={!draft.trim()}>
              Add
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
