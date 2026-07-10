"use client";

import { useMemo, useState } from "react";
import {
  getBookKey,
  getCatalogueConnection,
  getDivision,
  getNearestConnections,
  type CatalogueBook,
  type CatalogueConnection,
} from "@/lib/books/catalogue";

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
  count: number; // co-occurrence count
  x: number;
  y: number;
};

type TagBridge = {
  first: PositionedTag;
  second: PositionedTag;
  count: number; // shared books
};

const NEIGHBOR_COUNT = 9;
const MAP_SIZE = {
  centerX: 360,
  centerY: 280,
};

function getDefaultBookKey(books: CatalogueBook[]) {
  const borgesAnchor = books.find(
    (book) =>
      book.author === "Jorge Luis Borges" && book.title === "Collected Fictions",
  );

  return getBookKey(borgesAnchor ?? books[0]);
}

function getBookLabel(book: CatalogueBook) {
  return `${book.author}: ${book.title}`;
}

function getPosition(index: number, count: number) {
  const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
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

function getBookBridges(connections: PositionedConnection[]) {
  const bridges: BookBridge[] = [];

  connections.forEach((first, firstIndex) => {
    connections.slice(firstIndex + 1).forEach((second) => {
      const bridge = getCatalogueConnection(first.book, second.book);

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
  books: (CatalogueBook & { number: number })[];
  onTagClick?: (tag: string) => void;
  onBookClick?: (book: CatalogueBook & { number: number }) => void;
  mode?: "similarity" | "tag";
}) {
  const booksByKey = useMemo(
    () => new Map(books.map((book) => [getBookKey(book), book])),
    [books],
  );

  // --- Similarity Constellation State ---
  const [focusKey, setFocusKey] = useState(() => getDefaultBookKey(books));
  const [connectionKey, setConnectionKey] = useState("");

  const focusBook = booksByKey.get(focusKey) ?? books[0];
  const [focusSearch, setFocusSearch] = useState(() => getBookLabel(focusBook));
  const [showFocusResults, setShowFocusResults] = useState(false);
  const focusMatches = useMemo(() => {
    const query = focusSearch.trim().toLocaleLowerCase("en-US");
    if (!query) return books.slice(0, 10);
    return books
      .filter((book) => getBookLabel(book).toLocaleLowerCase("en-US").includes(query))
      .slice(0, 10);
  }, [books, focusSearch]);
  const connections = useMemo(
    () => positionConnections(getNearestConnections(focusBook, books, NEIGHBOR_COUNT)),
    [books, focusBook],
  );
  const selectedConnection =
    connections.find((connection) => getBookKey(connection.book) === connectionKey) ??
    connections[0];
  const bridges = useMemo(() => getBookBridges(connections), [connections]);

  // --- Tag Constellation State ---
  // 1. Get top 100 tags in the library to populate the select picker
  const topTagsList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of books) {
      if (b.tags) {
        for (const t of b.tags) {
          counts.set(t, (counts.get(t) || 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 100)
      .map(([tag]) => tag);
  }, [books]);

  const [focusTag, setFocusTag] = useState(() => topTagsList[0] || "literature");
  const [selectedTagKey, setSelectedTagKey] = useState("");

  // Calculate co-occurrences for the focus tag
  const tagConnections = useMemo(() => {
    const coOccurCounts = new Map<string, number>();
    for (const b of books) {
      if (b.tags && b.tags.includes(focusTag)) {
        for (const t of b.tags) {
          if (t !== focusTag) {
            coOccurCounts.set(t, (coOccurCounts.get(t) || 0) + 1);
          }
        }
      }
    }

    // Top 9 co-occurring tags
    const sorted = [...coOccurCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, NEIGHBOR_COUNT);

    return sorted.map(([tag, count], index) => ({
      tag,
      count,
      ...getPosition(index, sorted.length),
    }));
  }, [books, focusTag]);

  const selectedTagNode = useMemo(() => {
    return (
      tagConnections.find((tc) => tc.tag === selectedTagKey) ||
      tagConnections[0]
    );
  }, [tagConnections, selectedTagKey]);

  // Calculate total occurrences in the library for the selected tag
  const selectedTagTotalCount = useMemo(() => {
    if (!selectedTagNode) return 0;
    return books.filter((b) => b.tags?.includes(selectedTagNode.tag)).length;
  }, [books, selectedTagNode]);

  // Find books that share both the focusTag and selectedTagNode
  const sharedBooks = useMemo(() => {
    if (!selectedTagNode) return [];
    return books.filter(
      (b) => b.tags?.includes(focusTag) && b.tags?.includes(selectedTagNode.tag)
    );
  }, [books, focusTag, selectedTagNode]);

  // Calculate tag bridges (co-occurrence between the surrounding 9 tags)
  const tagBridges = useMemo(() => {
    const list: TagBridge[] = [];
    tagConnections.forEach((first, firstIndex) => {
      tagConnections.slice(firstIndex + 1).forEach((second) => {
        // Calculate shared books
        let count = 0;
        for (const b of books) {
          if (b.tags && b.tags.includes(first.tag) && b.tags.includes(second.tag)) {
            count++;
          }
        }
        if (count >= 2) {
          list.push({ first, second, count });
        }
      });
    });
    return list.sort((a, b) => b.count - a.count).slice(0, 12);
  }, [books, tagConnections]);

  // Clear selections when focus changes (handled during render to avoid cascading effects)
  const [prevFocusKey, setPrevFocusKey] = useState(focusKey);
  if (focusKey !== prevFocusKey) {
    setPrevFocusKey(focusKey);
    setConnectionKey("");
  }

  const [prevFocusTag, setPrevFocusTag] = useState(focusTag);
  if (focusTag !== prevFocusTag) {
    setPrevFocusTag(focusTag);
    setSelectedTagKey("");
  }

  return (
    <section className="catalogue-constellation" aria-labelledby="map-title">
      <div className="catalogue-map-heading">
        <p>{mode === "similarity" ? "Relational map no. 1" : "Relational map no. 2"}</p>
        <h2 id="map-title">
          {mode === "similarity" ? "Similarity constellation" : "Tag co-occurrence constellation"}
        </h2>
        <div className="catalogue-map-picker">
          {mode === "similarity" ? (
            <>
              <label htmlFor="focus-volume">Focus volume</label>
              <div className="catalogue-map-search">
              <input
                id="focus-volume"
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="focus-volume-results"
                aria-expanded={showFocusResults}
                placeholder="Search title or author"
                onChange={(event) => {
                  setFocusSearch(event.target.value);
                  setShowFocusResults(true);
                }}
                onFocus={() => setShowFocusResults(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setShowFocusResults(false);
                }}
                value={focusSearch}
              />
              {showFocusResults && (
                <ul id="focus-volume-results" role="listbox" className="catalogue-map-search-results">
                  {focusMatches.map((book) => {
                    const bookKey = getBookKey(book);
                    return (
                      <li key={bookKey} role="none">
                        <button
                          type="button"
                          role="option"
                          aria-selected={bookKey === focusKey}
                          onClick={() => {
                            setConnectionKey("");
                            setFocusKey(bookKey);
                            setFocusSearch(getBookLabel(book));
                            setShowFocusResults(false);
                          }}
                        >
                          <strong>{book.author}</strong>
                          <span>{book.title}</span>
                        </button>
                      </li>
                    );
                  })}
                  {focusMatches.length === 0 && <li className="no-matches" role="option" aria-disabled="true" aria-selected="false">No volumes match</li>}
                </ul>
              )}
              </div>
            </>
          ) : (
            <>
              <label htmlFor="focus-tag">Focus Subject/Tag</label>
              <select
                id="focus-tag"
                onChange={(event) => {
                  setSelectedTagKey("");
                  setFocusTag(event.target.value);
                }}
                value={focusTag}
              >
                {topTagsList.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag} ({books.filter(b => b.tags?.includes(tag)).length} vols)
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      <div className="catalogue-map-body">
        {mode === "similarity" ? (
          // Similarity Constellation Plot
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
              const isSelected = bookKey === getBookKey(selectedConnection.book);

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
          // Tag Co-occurrence Constellation Plot
          <div
            className="catalogue-map-plot tag-map-plot"
            aria-label={`Tags co-occurring with ${focusTag}`}
          >
            <svg aria-hidden="true" viewBox="0 0 720 560">
              <g className="catalogue-map-bridges">
                {tagBridges.map((bridge, idx) => (
                  <line
                    key={idx}
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
              <strong className="text-xl font-bold font-mono tracking-wider">{focusTag}</strong>
              <span className="text-xs opacity-75">{books.filter(b => b.tags?.includes(focusTag)).length} volumes</span>
            </div>

            {tagConnections.map((tc) => {
              const isSelected = selectedTagNode && tc.tag === selectedTagNode.tag;

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
                  aria-label={`${tc.tag}, shared by ${tc.count} volumes with ${focusTag}`}
                >
                  <strong className="font-mono text-center block w-full">{tc.tag}</strong>
                  <span className="text-center block w-full text-xs">Shared: {tc.count} vols</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Notes details sidebar */}
        {mode === "similarity" ? (
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
                  {selectedConnection.book.position}.
                </dd>
              </div>
            </dl>
            {selectedConnection.book.summary && (
              <p className="catalogue-map-summary">
                {selectedConnection.book.summary}
              </p>
            )}
            {selectedConnection.book.tags && selectedConnection.book.tags.length > 0 && (
              <div className="catalogue-map-tags" aria-label="Book tags">
                {selectedConnection.book.tags.map((tag) => {
                  if (onTagClick) {
                    return (
                      <button
                        key={tag}
                        className="catalogue-tag catalogue-tag-interactive"
                        onClick={() => onTagClick(tag)}
                        type="button"
                      >
                        {tag}
                      </button>
                    );
                  }
                  return (
                    <span key={tag} className="catalogue-tag">
                      {tag}
                    </span>
                  );
                })}
              </div>
            )}
            <h4>Why it appears</h4>
            <ul>
              {selectedConnection.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </aside>
        ) : (
          // Tag sidebar
          selectedTagNode && (
            <aside className="catalogue-map-notes tag-notes-sidebar" aria-live="polite">
              <p>Linked Subject/Tag</p>
              <h3 className="font-mono">{selectedTagNode.tag}</h3>
              <dl>
                <div>
                  <dt>Co-occurrence Strength</dt>
                  <dd>Shares <strong>{selectedTagNode.count}</strong> volumes with &ldquo;{focusTag}&rdquo;</dd>
                </div>
                <div>
                  <dt>Global Catalog Occurrence</dt>
                  <dd>Appears on <strong>{selectedTagTotalCount}</strong> volumes overall</dd>
                </div>
              </dl>

              <h4>Shared Volumes ({sharedBooks.length})</h4>
              <ul className="shared-books-list">
                {sharedBooks.slice(0, 5).map((book) => (
                  <li key={book.number} className="shared-book-item">
                    <span
                      className="shared-book-link cursor-pointer hover:underline text-green-900"
                      onClick={() => onBookClick && onBookClick(book)}
                    >
                      <cite>{book.title}</cite>
                    </span>{" "}
                    by <span className="font-semibold text-xs">{book.author}</span>
                  </li>
                ))}
                {sharedBooks.length > 5 && (
                  <li className="text-xs italic text-gray-700">
                    And {sharedBooks.length - 5} more volumes...
                  </li>
                )}
              </ul>

              <div className="tag-sidebar-actions mt-4">
                <button
                  type="button"
                  className="catalogue-tag-interactive catalogue-tag font-mono px-3 py-1 text-sm inline-block"
                  onClick={() => onTagClick && onTagClick(selectedTagNode.tag)}
                >
                  Inspect tag matches ↗
                </button>
              </div>
            </aside>
          )
        )}
      </div>

      <details className="catalogue-map-list">
        <summary>
          {mode === "similarity" ? "View these book relationships as a list" : "View these tag relationships as a list"}
        </summary>
        {mode === "similarity" ? (
          <ol>
            {connections.map((connection) => (
              <li key={getBookKey(connection.book)}>
                <button type="button" onClick={() => setConnectionKey(getBookKey(connection.book))}>
                  <strong>{connection.book.title}</strong>
                  <span>{connection.book.author} — {getReasonLabel(connection.reasons)}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <ol>
            {tagConnections.map((connection) => (
              <li key={connection.tag}>
                <button type="button" onClick={() => setSelectedTagKey(connection.tag)}>
                  <strong>{connection.tag}</strong>
                  <span>Shared by {connection.count} volumes with {focusTag}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
