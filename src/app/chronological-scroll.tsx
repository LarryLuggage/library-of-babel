"use client";

import { useMemo } from "react";
import {
  compareCatalogueBooks,
  getBookKey,
  getDivision,
  type LedgerBook,
} from "@/lib/books/catalogue";

interface ChronologicalScrollProps {
  books: LedgerBook[];
  onBookClick: (book: LedgerBook) => void;
}

export function ChronologicalScroll({
  books,
  onBookClick,
}: ChronologicalScrollProps) {
  const decadeGroups = useMemo(() => {
    const groups = new Map<string, LedgerBook[]>();

    for (const book of books) {
      const year = book.publish_year;
      let decadeLabel = "Undated";
      if (typeof year === "number" && Number.isFinite(year)) {
        const decadeStart = Math.floor(year / 10) * 10;
        decadeLabel = `${decadeStart}s`;
      }

      const list = groups.get(decadeLabel);
      if (list) {
        list.push(book);
      } else {
        groups.set(decadeLabel, [book]);
      }
    }

    const sortedDecades = [...groups.keys()].sort((a, b) => {
      if (a === "Undated") return 1;
      if (b === "Undated") return -1;
      return Number.parseInt(a, 10) - Number.parseInt(b, 10);
    });

    return sortedDecades.map((decade) => ({
      decade,
      books: [...(groups.get(decade) ?? [])].sort((first, second) => {
        const yearA = first.publish_year ?? Number.MAX_SAFE_INTEGER;
        const yearB = second.publish_year ?? Number.MAX_SAFE_INTEGER;
        if (yearA !== yearB) return yearA - yearB;
        return compareCatalogueBooks(first, second);
      }),
    }));
  }, [books]);

  return (
    <section
      className="catalogue-timeline-section"
      aria-labelledby="timeline-title"
    >
      <div className="catalogue-timeline-heading">
        <p>Chronological display</p>
        <h2 id="timeline-title">Timeline of Volumes</h2>
        <span className="catalogue-ledger-count">
          Showing {books.length} matching {books.length === 1 ? "volume" : "volumes"}
        </span>
      </div>

      {books.length === 0 ? (
        <div className="catalogue-empty-state">
          <p>No volumes match this search.</p>
          <span>
            Try removing a filter or using a broader title or author.
          </span>
        </div>
      ) : (
        <div className="catalogue-timeline-scroll">
          <div className="catalogue-timeline-track">
            {decadeGroups.map(({ decade, books: decadeBooks }) => (
              <div key={decade} className="timeline-decade-column">
                <div className="timeline-decade-header">
                  <h3>{decade}</h3>
                  <span className="timeline-decade-count">
                    {decadeBooks.length}{" "}
                    {decadeBooks.length === 1 ? "volume" : "volumes"}
                  </span>
                </div>
                <ol className="timeline-book-list">
                  {decadeBooks.map((book) => (
                    <li key={getBookKey(book)}>
                      <button
                        type="button"
                        className="timeline-book-card"
                        onClick={() => onBookClick(book)}
                        aria-haspopup="dialog"
                      >
                        <span className="timeline-book-info">
                          <cite className="timeline-book-title">{book.title}</cite>
                          <span className="timeline-book-author">{book.author}</span>
                          {book.publish_year !== null && (
                            <span className="timeline-book-year">
                              {book.publish_year}
                            </span>
                          )}
                        </span>
                        <span className="timeline-book-meta">
                          <span className="timeline-book-division">
                            {getDivision(book)}
                          </span>
                          <span className="timeline-book-shelf">
                            S. {book.shelf}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
