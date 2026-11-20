"use client";

import { useMemo, useState } from "react";
import {
  getAuthorInitial,
  getBookKey,
  getDivision,
  READING_STATUS_LABELS,
  type LedgerBook,
} from "@/lib/books/catalogue";

export function CatalogueLedger({
  entries,
  onBookClick,
}: {
  entries: LedgerBook[];
  onBookClick: (book: LedgerBook) => void;
}) {
  const pageSize = 96;
  const [visibleCount, setVisibleCount] = useState(pageSize);

  const visibleEntries = entries.slice(0, visibleCount);

  const entriesByInitial = useMemo(() => {
    const groups = new Map<string, LedgerBook[]>();
    for (const entry of visibleEntries) {
      const initial = getAuthorInitial(entry.author);
      const group = groups.get(initial);
      if (group) {
        group.push(entry);
      } else {
        groups.set(initial, [entry]);
      }
    }
    return groups;
  }, [visibleEntries]);

  return (
    <section className="catalogue-ledger" aria-labelledby="ledger-title">
      <div className="catalogue-ledger-heading">
        <p>Complete shelf ledger</p>
        <h2 id="ledger-title">Entries by author</h2>
        <span className="catalogue-ledger-count">
          Showing {Math.min(visibleCount, entries.length)} of {entries.length}{" "}
          matching {entries.length === 1 ? "volume" : "volumes"}
        </span>
      </div>

      {entries.length === 0 && (
        <div className="catalogue-empty-state">
          <p>No volumes match this search.</p>
          <span>Try removing a filter or using a broader title or author.</span>
        </div>
      )}

      {[...entriesByInitial.entries()].map(([initial, groupEntries]) => (
        <section
          className="catalogue-letter"
          id={`author-${initial}`}
          key={initial}
        >
          <h3>{initial}</h3>
          <ol>
            {groupEntries.map((book) => {
              const hasTrackerBadges =
                book.reading_status !== "unread" ||
                book.rating !== null ||
                Boolean(book.loaned_to);

              return (
                <li key={getBookKey(book)} className="catalogue-entry-row">
                  <button
                    type="button"
                    className="catalogue-entry catalogue-entry-interactive"
                    onClick={() => onBookClick(book)}
                    aria-haspopup="dialog"
                  >
                    <span className="catalogue-entry-number">
                      {book.number}
                    </span>
                    <span className="catalogue-entry-body">
                      <span className="catalogue-author">{book.author}.</span>{" "}
                      <cite>{book.title}.</cite>{" "}
                      {book.edition && (
                        <span className="catalogue-edition">
                          {book.edition}.{" "}
                        </span>
                      )}
                      <span className="catalogue-division">
                        {getDivision(book)}.
                      </span>
                    </span>
                    <span className="catalogue-entry-footer">
                      <span className="catalogue-location">
                        Shelf {book.shelf}
                        {book.position ? `. ${book.position}.` : "."}
                      </span>
                      {hasTrackerBadges && (
                        <span className="catalogue-entry-badges">
                          {book.reading_status !== "unread" && (
                            <span
                              className={`ledger-badge ledger-badge--status ledger-badge--${book.reading_status}`}
                            >
                              {READING_STATUS_LABELS[book.reading_status]}
                            </span>
                          )}
                          {book.rating !== null && (
                            <span className="ledger-badge ledger-badge--rating">
                              ★ {book.rating}
                            </span>
                          )}
                          {book.loaned_to && (
                            <span className="ledger-badge ledger-badge--loaned">
                              Loaned
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {visibleCount < entries.length && (
        <div className="catalogue-load-more">
          <p>
            {entries.length - visibleCount} more volumes remain in this result.
          </p>
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + pageSize)}
          >
            Show the next {Math.min(pageSize, entries.length - visibleCount)}{" "}
            volumes
          </button>
        </div>
      )}
    </section>
  );
}
