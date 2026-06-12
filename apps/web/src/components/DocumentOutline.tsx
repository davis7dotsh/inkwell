import type { DocumentOutlineEntry } from "@inkwell/content";
import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export function DocumentOutline({
  entries,
  activeId,
  onNavigate,
}: {
  entries: DocumentOutlineEntry[];
  activeId: string;
  onNavigate: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const activeLinkRef = useRef<HTMLAnchorElement>(null);
  const deferredQuery = useDeferredValue(query);
  const visibleEntries = useMemo(() => {
    const normalized = deferredQuery.trim().toLocaleLowerCase();
    if (!normalized) return entries;
    return entries.filter((entry) =>
      entry.title.toLocaleLowerCase().includes(normalized),
    );
  }, [deferredQuery, entries]);

  useEffect(() => {
    const list = listRef.current;
    const activeLink = activeLinkRef.current;
    if (!list || !activeLink) return;
    const listRect = list.getBoundingClientRect();
    const linkRect = activeLink.getBoundingClientRect();
    if (linkRect.top < listRect.top) {
      list.scrollTop -= listRect.top - linkRect.top;
    } else if (linkRect.bottom > listRect.bottom) {
      list.scrollTop += linkRect.bottom - listRect.bottom;
    }
  }, [activeId, visibleEntries]);

  return (
    <nav className="document-outline" aria-label="Document outline">
      <div className="document-outline-heading">
        <div>
          <span className="document-outline-eyebrow">Document outline</span>
          <h2>Contents</h2>
        </div>
        <span className="document-outline-count">{entries.length}</span>
      </div>

      {entries.length >= 10 ? (
        <label className="document-outline-search">
          <span className="sr-only">Filter document headings</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a section"
          />
        </label>
      ) : null}

      <div className="document-outline-list" ref={listRef}>
        <a
          ref={activeId === "document-start" ? activeLinkRef : undefined}
          href="#document-start"
          className={`document-outline-link document-outline-start${
            activeId === "document-start" ? " document-outline-link-active" : ""
          }`}
          aria-current={activeId === "document-start" ? "location" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onNavigate("document-start");
          }}
        >
          <span className="document-outline-dot" />
          <span>Overview</span>
        </a>

        {visibleEntries.map((entry) => {
          const active = activeId === entry.id;
          const depth = Math.min(entry.depth, 4);
          return (
            <a
              key={entry.id}
              ref={active ? activeLinkRef : undefined}
              href={`#${entry.id}`}
              className={`document-outline-link document-outline-depth-${depth}${
                entry.depth === 0 ? " document-outline-chapter" : ""
              }${active ? " document-outline-link-active" : ""}`}
              aria-current={active ? "location" : undefined}
              title={entry.title}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(entry.id);
              }}
            >
              <span className="document-outline-dot" />
              <span>{entry.title}</span>
            </a>
          );
        })}

        {visibleEntries.length === 0 ? (
          <p className="document-outline-empty">No matching sections.</p>
        ) : null}
      </div>
    </nav>
  );
}
