"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildTagFrequencyMap,
  filterDisplayTags,
  getBookKey,
  getCatalogueConnection,
  getDivision,
  getNearestConnections,
  type CatalogueBook,
  type CatalogueConnection,
  type LedgerBook,
} from "@/lib/books/catalogue";
import { getTagCooccurrences } from "@/lib/books/relations";

type PositionedConnection = CatalogueConnection & {
  x: number;
  y: number;
};

type BookBridge = {
  first: PositionedConnection;
  second: PositionedConnection;
  score: number;
};

type PositionedTag = {
  tag: string;
  count: number;
  x: number;
  y: number;
};

type TagBridge = {
  first: PositionedTag;
  second: PositionedTag;
  count: number;
};

const NEIGHBOR_COUNT = 9;
const MAP_SIZE = {
  centerX: 360,
  centerY: 280,
};

function getDefaultBookKey(books: CatalogueBook[]): string {
  if (books.length === 0) return "";
  const borgesAnchor = books.find(
    (book) =>
      book.author === "Jorge Luis Borges" && book.title === "Collected Fictions",
  );
  return getBookKey(borgesAnchor ?? books[0]);
}

function getBookLabel(book: CatalogueBook): string {
  return `${book.author}: ${book.title}`;
}

function getPosition(index: number, count: number) {
  const safeCount = Math.max(count, 1);
  const angle = -Math.PI / 2 + (index / safeCount) * Math.PI * 2;
  const radius = 228;

  return {
    x: Number((MAP_SIZE.centerX + Math.cos(angle) * radius).toFixed(3)),
    y: Number((MAP_SIZE.centerY + Math.sin(angle) * radius).toFixed(3)),
  };
}

function positionConnections(connections: CatalogueConnection[]) {
  return connections.map((connection, index) => ({
    ...connection,
    ...getPosition(index, connections.length),
  }));
}

function getBookBridges(
  connections: PositionedConnection[],
  tagFrequency: ReadonlyMap<string, number>,
) {
  const bridges: BookBridge[] = [];

  connections.forEach((first, firstIndex) => {
    connections.slice(firstIndex + 1).forEach((second) => {
      const bridge = getCatalogueConnection(
        first.book,
        second.book,
        tagFrequency,
      );

      if (bridge && bridge.score >= 7) {
        bridges.push({
          first,
          score: bridge.score,
          second,
        });
      }
    });
  });

  return bridges.sort((first, second) => second.score - first.score).slice(0, 12);
}

function getReasonLabel(reasons: string[]) {
  return reasons[0]?.replace(/\.$/, "") ?? "Catalogue link";
}

export function CatalogueConstellation({
  books,
  onTagClick,
  onBookClick,
  mode = "similarity",
}: {
  books: LedgerBook[];
  onTagClick?: (tag: string) => void;
  onBookClick?: (book: LedgerBook) => void;
  mode?: "similarity" | "tag";
}) {
  const idPrefix = useId();
  const titleId = `${idPrefix}-map-title`;
  const focusVolumeId = `${idPrefix}-focus-volume`;
  const focusListboxId = `${idPrefix}-focus-volume-results`;
  const focusTagId = `${idPrefix}-focus-tag`;

  const searchContainerRef = useRef<HTMLDivElement>(null);

  const booksByKey = useMemo(
    () => new Map(books.map((book) => [getBookKey(book), book])),
    [books],
  );

  const tagFrequency = useMemo(() => buildTagFrequencyMap(books), [books]);
  const tagGraph = useMemo(() => getTagCooccurrences(books), [books]);

  const booksByTag = useMemo(() => {
    const map = new Map<string, LedgerBook[]>();
    for (const book of books) {
      for (const tag of filterDisplayTags(book.tags)) {
        const list = map.get(tag);
        if (list) {
          list.push(book);
        } else {
          map.set(tag, [book]);
        }
      }
    }
    return map;
  }, [books]);

  // --- Similarity Constellation State ---
  const [focusKey, setFocusKey] = useState(() => getDefaultBookKey(books));
  const [connectionKey, setConnectionKey] = useState("");

  const focusBook = booksByKey.get(focusKey) ?? books[0] ?? null;
  const [focusSearch, setFocusSearch] = useState(() =>
    focusBook ? getBookLabel(focusBook) : "",
  );
  const [showFocusResults, setShowFocusResults] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const focusMatches = useMemo(() => {
    const query = focusSearch.trim().toLocaleLowerCase("en-US");
    if (!query) return books.slice(0, 10);
    return books
      .filter((book) =>
        getBookLabel(book).toLocaleLowerCase("en-US").includes(query),
      )
      .slice(0, 10);
  }, [books, focusSearch]);

  const connections = useMemo(() => {
    if (!focusBook) return [];
    return positionConnections(
      getNearestConnections(focusBook, books, NEIGHBOR_COUNT, tagFrequency),
    );
  }, [books, focusBook, tagFrequency]);

  const selectedConnection =
    connections.find(
      (connection) => getBookKey(connection.book) === connectionKey,
    ) ?? connections[0] ?? null;

  const bridges = useMemo(
    () => getBookBridges(connections, tagFrequency),
    [connections, tagFrequency],
  );

  // --- Tag Constellation State ---
  const topTagsList = useMemo(
    () =>
      [...tagGraph.nodes]
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        .slice(0, 100),
    [tagGraph.nodes],
  );

  const [focusTag, setFocusTag] = useState(
    () => topTagsList[0]?.tag ?? "",
  );
  const resolvedFocusTag = tagGraph.tagCounts.has(focusTag)
    ? focusTag
    : topTagsList[0]?.tag ?? "";

  const [selectedTagKey, setSelectedTagKey] = useState("");

  const tagConnections = useMemo(() => {
    if (!resolvedFocusTag) return [];
    const neighbors = tagGraph.cooccurrenceMap.get(resolvedFocusTag);
    if (!neighbors) return [];

    const sorted = [...neighbors.entries()]
      .filter(([tag]) => tag !== resolvedFocusTag)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, NEIGHBOR_COUNT);

    return sorted.map(([tag, count], index) => ({
      tag,
      count,
      ...getPosition(index, sorted.length),
    }));
  }, [resolvedFocusTag, tagGraph.cooccurrenceMap]);

  const selectedTagNode = useMemo(
    () =>
      tagConnections.find((tc) => tc.tag === selectedTagKey) ??
      tagConnections[0] ??
      null,
    [tagConnections, selectedTagKey],
  );

  const selectedTagTotalCount = selectedTagNode
    ? tagGraph.tagCounts.get(selectedTagNode.tag) ?? 0
    : 0;

  const sharedBooks = useMemo(() => {
    if (!selectedTagNode || !resolvedFocusTag) return [];
    const focusBookList = booksByTag.get(resolvedFocusTag) ?? [];
    const focusKeys = new Set(focusBookList.map(getBookKey));
    return (booksByTag.get(selectedTagNode.tag) ?? []).filter((book) =>
      focusKeys.has(getBookKey(book)),
    );
  }, [booksByTag, resolvedFocusTag, selectedTagNode]);

  const tagBridges = useMemo(() => {
    const list: TagBridge[] = [];
    tagConnections.forEach((first, firstIndex) => {
      const firstCo = tagGraph.cooccurrenceMap.get(first.tag);
      tagConnections.slice(firstIndex + 1).forEach((second) => {
        const count = firstCo?.get(second.tag) ?? 0;
        if (count >= 2) {
          list.push({ first, second, count });
        }
      });
    });
    return list.sort((a, b) => b.count - a.count).slice(0, 12);
  }, [tagConnections, tagGraph.cooccurrenceMap]);

  // Clear selections when focus changes
  const [prevFocusKey, setPrevFocusKey] = useState(focusKey);
  if (focusKey !== prevFocusKey) {
    setPrevFocusKey(focusKey);
    setConnectionKey("");
  }

  const [prevFocusTag, setPrevFocusTag] = useState(resolvedFocusTag);
  if (resolvedFocusTag !== prevFocusTag) {
    setPrevFocusTag(resolvedFocusTag);
    setSelectedTagKey("");
  }

  useEffect(() => {
    if (!showFocusResults) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        searchContainerRef.current &&
        target &&
        !searchContainerRef.current.contains(target)
      ) {
        setShowFocusResults(false);
        setHighlightedIndex(-1);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showFocusResults]);

  const selectFocusVolume = (book: LedgerBook) => {
    const key = getBookKey(book);
    setConnectionKey("");
    setFocusKey(key);
    setFocusSearch(getBookLabel(book));
    setShowFocusResults(false);
    setHighlightedIndex(-1);
  };

  const handleFocusComboboxKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!showFocusResults) {
        setShowFocusResults(true);
        setHighlightedIndex(focusMatches.length > 0 ? 0 : -1);
      } else if (focusMatches.length > 0) {
        setHighlightedIndex((prev) =>
          prev < focusMatches.length - 1 ? prev + 1 : 0,
        );
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!showFocusResults) {
        setShowFocusResults(true);
        setHighlightedIndex(focusMatches.length - 1);
      } else if (focusMatches.length > 0) {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : focusMatches.length - 1,
        );
      }
    } else if (
      event.key === "Enter" &&
      showFocusResults &&
      highlightedIndex >= 0 &&
      focusMatches[highlightedIndex]
    ) {
      event.preventDefault();
      selectFocusVolume(focusMatches[highlightedIndex]);
    } else if (event.key === "Escape" && showFocusResults) {
      event.preventDefault();
      setShowFocusResults(false);
      setHighlightedIndex(-1);
    }
  };

  if (books.length === 0 || !focusBook) {
    return (
      <section className="catalogue-constellation" aria-labelledby={titleId}>
        <div className="catalogue-map-heading">
          <p>
            {mode === "similarity"
              ? "Relational map no. 1"
              : "Relational map no. 2"}
          </p>
          <h2 id={titleId}>
            {mode === "similarity"
              ? "Similarity constellation"
              : "Tag co-occurrence constellation"}
          </h2>
        </div>
        <div className="catalogue-empty-state">
          <p>No volumes available to map.</p>
          <span>Add a volume to render the constellation.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="catalogue-constellation" aria-labelledby={titleId}>
      <div className="catalogue-map-heading">
        <p>
          {mode === "similarity"
            ? "Relational map no. 1"
            : "Relational map no. 2"}
        </p>
        <h2 id={titleId}>
          {mode === "similarity"
            ? "Similarity constellation"
            : "Tag co-occurrence constellation"}
        </h2>
        <div className="catalogue-map-picker">
          {mode === "similarity" ? (
            <>
              <label htmlFor={focusVolumeId}>Focus volume</label>
              <div className="catalogue-map-search" ref={searchContainerRef}>
                <input
                  id={focusVolumeId}
                  type="search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls={focusListboxId}
                  aria-expanded={showFocusResults}
                  aria-activedescendant={
                    showFocusResults &&
                    highlightedIndex >= 0 &&
                    focusMatches[highlightedIndex]
                      ? `${focusListboxId}-opt-${highlightedIndex}`
                      : undefined
                  }
                  placeholder="Search title or author"
                  onChange={(event) => {
                    setFocusSearch(event.target.value);
                    setShowFocusResults(true);
                    setHighlightedIndex(-1);
                  }}
                  onFocus={() => setShowFocusResults(true)}
                  onKeyDown={handleFocusComboboxKeyDown}
                  value={focusSearch}
                />
                {showFocusResults && (
                  <ul
                    id={focusListboxId}
                    role="listbox"
                    className="catalogue-map-search-results"
                  >
                    {focusMatches.map((book, index) => {
                      const bookKey = getBookKey(book);
                      const isHighlighted = index === highlightedIndex;
                      return (
                        <li key={bookKey} role="none">
                          <button
                            type="button"
                            id={`${focusListboxId}-opt-${index}`}
                            role="option"
                            tabIndex={-1}
                            data-highlighted={isHighlighted}
                            aria-selected={isHighlighted || bookKey === focusKey}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            onClick={() => selectFocusVolume(book)}
                          >
                            <strong>{book.author}</strong>
                            <span>{book.title}</span>
                          </button>
                        </li>
                      );
                    })}
                    {focusMatches.length === 0 && (
                      <li
                        className="no-matches"
                        role="option"
                        aria-disabled="true"
                        aria-selected="false"
                      >
                        No volumes match
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <>
              <label htmlFor={focusTagId}>Focus Subject/Tag</label>
              <select
                id={focusTagId}
                onChange={(event) => {
                  setSelectedTagKey("");
                  setFocusTag(event.target.value);
                }}
                value={resolvedFocusTag}
              >
                {topTagsList.map(({ tag, count }) => (
                  <option key={tag} value={tag}>
                    {tag} ({tagGraph.tagCounts.get(tag) ?? count} vols)
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      <div className="catalogue-map-body">
        {mode === "similarity" ? (
          <div
            className="catalogue-map-plot"
            aria-label={`Books nearest ${focusBook.title} by current catalogue relationships`}
          >
            <svg aria-hidden="true" viewBox="0 0 720 560">
              <g className="catalogue-map-bridges">
                {bridges.map((bridge) => (
                  <line
                    key={`${getBookKey(bridge.first.book)}-${getBookKey(bridge.second.book)}`}
                    x1={bridge.first.x}
                    x2={bridge.second.x}
                    y1={bridge.first.y}
                    y2={bridge.second.y}
                  />
                ))}
              </g>
              <g className="catalogue-map-rays">
                {connections.map((connection) => (
                  <line
                    key={getBookKey(connection.book)}
                    x1={MAP_SIZE.centerX}
                    x2={connection.x}
                    y1={MAP_SIZE.centerY}
                    y2={connection.y}
                  />
                ))}
              </g>
            </svg>

            <div className="catalogue-map-center">
              <span>{getDivision(focusBook)}</span>
              <cite>{focusBook.title}</cite>
              <strong>{focusBook.author}</strong>
            </div>

            {connections.map((connection) => {
              const bookKey = getBookKey(connection.book);
              const isSelected =
                selectedConnection !== null &&
                bookKey === getBookKey(selectedConnection.book);

              return (
                <button
                  aria-pressed={isSelected}
                  className="catalogue-map-node"
                  data-selected={isSelected}
                  key={bookKey}
                  onClick={() => setConnectionKey(bookKey)}
                  style={{
                    left: `${(connection.x / 720) * 100}%`,
                    top: `${(connection.y / 560) * 100}%`,
                  }}
                  title={getReasonLabel(connection.reasons)}
                  type="button"
                  aria-label={`${connection.book.title} by ${connection.book.author}. ${getReasonLabel(connection.reasons)}`}
                >
                  <cite>{connection.book.title}</cite>
                  <span>{connection.book.author}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div
            className="catalogue-map-plot tag-map-plot"
            aria-label={`Tags co-occurring with ${resolvedFocusTag}`}
          >
            <svg aria-hidden="true" viewBox="0 0 720 560">
              <g className="catalogue-map-bridges">
                {tagBridges.map((bridge) => (
                  <line
                    key={`${bridge.first.tag}-${bridge.second.tag}`}
                    x1={bridge.first.x}
                    x2={bridge.second.x}
                    y1={bridge.first.y}
                    y2={bridge.second.y}
                  />
                ))}
              </g>
              <g className="catalogue-map-rays">
                {tagConnections.map((tc) => (
                  <line
                    key={tc.tag}
                    x1={MAP_SIZE.centerX}
                    x2={tc.x}
                    y1={MAP_SIZE.centerY}
                    y2={tc.y}
                  />
                ))}
              </g>
            </svg>

            <div className="catalogue-map-center tag-center">
              <span>focus tag</span>
              <strong className="tag-center-label">{resolvedFocusTag}</strong>
              <span className="tag-center-count">
                {tagGraph.tagCounts.get(resolvedFocusTag) ?? 0} volumes
              </span>
            </div>

            {tagConnections.map((tc) => {
              const isSelected =
                selectedTagNode !== null && tc.tag === selectedTagNode.tag;

              return (
                <button
                  aria-pressed={isSelected}
                  className="catalogue-map-node tag-node"
                  data-selected={isSelected}
                  key={tc.tag}
                  onClick={() => setSelectedTagKey(tc.tag)}
                  style={{
                    left: `${(tc.x / 720) * 100}%`,
                    top: `${(tc.y / 560) * 100}%`,
                  }}
                  title={`Co-occurs ${tc.count} times`}
                  type="button"
                  aria-label={`${tc.tag}, shared by ${tc.count} volumes with ${resolvedFocusTag}`}
                >
                  <strong className="tag-node-label">{tc.tag}</strong>
                  <span className="tag-node-count">Shared: {tc.count} vols</span>
                </button>
              );
            })}
          </div>
        )}

        {mode === "similarity" ? (
          selectedConnection ? (
            <aside className="catalogue-map-notes" aria-live="polite">
              <p>Nearest linked volume</p>
              <h3>{selectedConnection.book.title}</h3>
              <strong>{selectedConnection.book.author}</strong>
              <dl>
                <div>
                  <dt>Division</dt>
                  <dd>{getDivision(selectedConnection.book)}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>
                    Shelf {selectedConnection.book.shelf}.{" "}
                    {selectedConnection.book.position || "Unpositioned"}.
                  </dd>
                </div>
              </dl>
              {selectedConnection.book.summary && (
                <p className="catalogue-map-summary">
                  {selectedConnection.book.summary}
                </p>
              )}
              {filterDisplayTags(selectedConnection.book.tags).length > 0 && (
                <div className="catalogue-map-tags" aria-label="Book tags">
                  {filterDisplayTags(selectedConnection.book.tags).map((tag) =>
                    onTagClick ? (
                      <button
                        key={tag}
                        className="catalogue-tag catalogue-tag-interactive"
                        onClick={() => onTagClick(tag)}
                        type="button"
                      >
                        {tag}
                      </button>
                    ) : (
                      <span key={tag} className="catalogue-tag">
                        {tag}
                      </span>
                    ),
                  )}
                </div>
              )}
              <h4>Why it appears</h4>
              <ul>
                {selectedConnection.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {onBookClick && (
                <div className="tag-sidebar-actions">
                  <button
                    type="button"
                    className="catalogue-tag-interactive catalogue-tag sidebar-inspect-btn"
                    onClick={() => {
                      const matched = booksByKey.get(
                        getBookKey(selectedConnection.book),
                      );
                      if (matched) onBookClick(matched);
                    }}
                  >
                    Open volume card ↗
                  </button>
                </div>
              )}
            </aside>
          ) : (
            <aside className="catalogue-map-notes" aria-live="polite">
              <p>Nearest linked volume</p>
              <h3>No linked volumes</h3>
              <p className="catalogue-map-summary">
                This volume shares no division, shelf, or subject tags with other
                books yet.
              </p>
            </aside>
          )
        ) : selectedTagNode ? (
          <aside
            className="catalogue-map-notes tag-notes-sidebar"
            aria-live="polite"
          >
            <p>Linked Subject/Tag</p>
            <h3 className="font-mono">{selectedTagNode.tag}</h3>
            <dl>
              <div>
                <dt>Co-occurrence Strength</dt>
                <dd>
                  Shares <strong>{selectedTagNode.count}</strong> volumes with
                  &ldquo;{resolvedFocusTag}&rdquo;
                </dd>
              </div>
              <div>
                <dt>Global Catalog Occurrence</dt>
                <dd>
                  Appears on <strong>{selectedTagTotalCount}</strong> volumes
                  overall
                </dd>
              </div>
            </dl>

            <h4>Shared Volumes ({sharedBooks.length})</h4>
            <ul className="shared-books-list">
              {sharedBooks.slice(0, 5).map((book) => (
                <li key={getBookKey(book)} className="shared-book-item">
                  <button
                    type="button"
                    className="shared-book-link"
                    onClick={() => onBookClick?.(book)}
                  >
                    <cite>{book.title}</cite>
                  </button>{" "}
                  by <span className="shared-book-author">{book.author}</span>
                </li>
              ))}
              {sharedBooks.length > 5 && (
                <li className="shared-books-more">
                  And {sharedBooks.length - 5} more volumes...
                </li>
              )}
            </ul>

            <div className="tag-sidebar-actions">
              <button
                type="button"
                className="catalogue-tag-interactive catalogue-tag sidebar-inspect-btn"
                onClick={() => onTagClick?.(selectedTagNode.tag)}
              >
                Inspect tag matches ↗
              </button>
            </div>
          </aside>
        ) : (
          <aside
            className="catalogue-map-notes tag-notes-sidebar"
            aria-live="polite"
          >
            <p>Linked Subject/Tag</p>
            <h3>No co-occurring subjects</h3>
            <p className="catalogue-map-summary">
              Select another subject tag to inspect co-occurrence relationships.
            </p>
          </aside>
        )}
      </div>

      <details className="catalogue-map-list">
        <summary>
          {mode === "similarity"
            ? "View these book relationships as a list"
            : "View these tag relationships as a list"}
        </summary>
        {mode === "similarity" ? (
          <ol>
            {connections.map((connection) => (
              <li key={getBookKey(connection.book)}>
                <button
                  type="button"
                  onClick={() => setConnectionKey(getBookKey(connection.book))}
                >
                  <strong>{connection.book.title}</strong>
                  <span>
                    {connection.book.author} — {getReasonLabel(connection.reasons)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <ol>
            {tagConnections.map((connection) => (
              <li key={connection.tag}>
                <button
                  type="button"
                  onClick={() => setSelectedTagKey(connection.tag)}
                >
                  <strong>{connection.tag}</strong>
                  <span>
                    Shared by {connection.count} volumes with {resolvedFocusTag}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
