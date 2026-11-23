"use client";

import { useMemo } from "react";
import {
  compareCatalogueBooks,
  formatPublishYear,
  getBookKey,
  getDivision,
  getTimelineBucket,
  type LedgerBook,
  type TimelineBucket,
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
    const groups = new Map<
      string,
      { bucket: TimelineBucket; books: LedgerBook[] }
    >();

    for (const book of books) {
      const bucket = getTimelineBucket(book.publish_year);
      const existing = groups.get(bucket.key);
      if (existing) {
        existing.books.push(book);
      } else {
        groups.set(bucket.key, { bucket, books: [book] });
      }
    }

    return [...groups.values()]
      .sort((first, second) => first.bucket.sortOrder - second.bucket.sortOrder)
      .map(({ bucket, books: groupBooks }) => ({
        bucket,
        books: [...groupBooks].sort((first, second) => {
          const yearA =
            typeof first.publish_year === "number" &&
            Number.isFinite(first.publish_year)
              ? first.publish_year
              : Number.MAX_SAFE_INTEGER;
          const yearB =
            typeof second.publish_year === "number" &&
            Number.isFinite(second.publish_year)
              ? second.publish_year
              : Number.MAX_SAFE_INTEGER;
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
            {decadeGroups.map(({ bucket, books: decadeBooks }) => (
              <div key={bucket.key} className="timeline-decade-column">
                <div className="timeline-decade-header">
                  <h3>{bucket.label}</h3>
                  <span className="timeline-decade-count">
                    {decadeBooks.length}{" "}
                    {decadeBooks.length === 1 ? "volume" : "volumes"}
                  </span>
                </div>
                <ol className="timeline-book-list">
                  {decadeBooks.map((book) => {
                    const formattedYear = formatPublishYear(book.publish_year);
                    return (
                      <li key={getBookKey(book)}>
                        <button
                          type="button"
                          className="timeline-book-card"
                          onClick={() => onBookClick(book)}
                          aria-haspopup="dialog"
                        >
                          <span className="timeline-book-info">
                            <cite className="timeline-book-title">
                              {book.title}
                            </cite>
                            <span className="timeline-book-author">
                              {book.author}
                            </span>
                            {formattedYear && (
                              <span className="timeline-book-year">
                                {formattedYear}
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
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
