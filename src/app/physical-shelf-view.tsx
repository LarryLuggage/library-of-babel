"use client";

import { useId, useMemo } from "react";
import {
  getAuthorSortKey,
  getBookKey,
  READING_STATUS_LABELS,
  type CatalogueBook,
} from "@/lib/books/catalogue";
import { buildPhysicalShelves } from "@/lib/books/shelves";

function getSpineAuthorLabel(author: string): string {
  const sortKey = getAuthorSortKey(author);
  const commaIndex = sortKey.indexOf(",");
  if (commaIndex > 0) {
    return sortKey.slice(0, commaIndex).trim();
  }
  return sortKey;
}

function getBookAccessibleLabel(
  book: CatalogueBook,
  shelf: number,
  rawPosition: string,
): string {
  const parts = [`${book.title} by ${book.author}`, `Shelf ${shelf}`];
  if (rawPosition) {
    parts.push(rawPosition);
  }
  if (book.reading_status !== "unread") {
    parts.push(READING_STATUS_LABELS[book.reading_status]);
  }
  if (book.loaned_to) {
    parts.push(`Loaned to ${book.loaned_to}`);
  }
  return parts.join(", ");
}

/**
 * Renders the Library of Babel organised as physical shelves (Shelves 1-41) with standing spines and horizontal stacks.
 */
export function PhysicalShelfView<T extends CatalogueBook>({
  books,
  onBookClick,
}: {
  books: readonly T[];
  onBookClick: (book: T) => void;
}) {
  const headingId = useId();
  const shelfGroups = useMemo(() => buildPhysicalShelves(books), [books]);

  const jumpToShelf = (shelfNumber: number) => {
    const target = document.getElementById(`physical-shelf-${shelfNumber}`);
    if (!target) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <section
      className="catalogue-shelves-section"
      aria-labelledby={headingId}
    >
      <div className="catalogue-ledger-heading">
        <p>Physical Bookcase</p>
        <h2 id={headingId}>Shelves 1–41</h2>
        <span className="catalogue-ledger-count">
          Showing {books.length} matching{" "}
          {books.length === 1 ? "volume" : "volumes"} across{" "}
          {shelfGroups.length} {shelfGroups.length === 1 ? "shelf" : "shelves"}
        </span>
      </div>

      {books.length === 0 ? (
        <div className="catalogue-empty-state">
          <p>No volumes match this search.</p>
          <span>
            Try removing a filter or using a broader title, author, or shelf.
          </span>
        </div>
      ) : (
        <>
          <nav className="shelf-jump-rail" aria-label="Shelf jump index">
            <span className="shelf-jump-label font-mono">Jump to shelf</span>
            <ol className="shelf-jump-list">
              {shelfGroups.map((shelfGroup) => (
                <li key={shelfGroup.shelf}>
                  <button
                    type="button"
                    className="shelf-jump-btn font-mono"
                    onClick={() => jumpToShelf(shelfGroup.shelf)}
                    aria-label={`Jump to Shelf ${shelfGroup.shelf} (${shelfGroup.totalBooks} ${shelfGroup.totalBooks === 1 ? "volume" : "volumes"})`}
                  >
                    {shelfGroup.shelf}
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <div className="bookcase-shelves-list">
            {shelfGroups.map((shelfGroup) => (
              <section
                key={shelfGroup.shelf}
                id={`physical-shelf-${shelfGroup.shelf}`}
                className="bookcase-shelf"
                aria-labelledby={`physical-shelf-title-${shelfGroup.shelf}`}
              >
                <div className="bookcase-shelf-header">
                  <h3 id={`physical-shelf-title-${shelfGroup.shelf}`}>
                    Shelf {shelfGroup.shelf}
                  </h3>
                  <span className="bookcase-shelf-count font-mono">
                    {shelfGroup.totalBooks}{" "}
                    {shelfGroup.totalBooks === 1 ? "volume" : "volumes"}
                  </span>
                </div>

                {shelfGroup.stacks.length > 0 && (
                  <div className="shelf-stacks-row">
                    {shelfGroup.stacks.map((stack) => (
                      <div key={stack.label} className="shelf-stack-group">
                        <span className="shelf-stack-label font-mono">
                          {stack.label}
                        </span>
                        <ul className="shelf-stack-list">
                          {stack.books.map((item) => {
                            const hasIndicator =
                              item.book.reading_status !== "unread" ||
                              Boolean(item.book.loaned_to);
                            return (
                              <li key={getBookKey(item.book)}>
                                <button
                                  type="button"
                                  className={`shelf-stack-book shelf-spine--${item.colorTone}`}
                                  onClick={() => onBookClick(item.book)}
                                  aria-haspopup="dialog"
                                  aria-label={getBookAccessibleLabel(
                                    item.book,
                                    shelfGroup.shelf,
                                    item.rawPosition,
                                  )}
                                >
                                  <cite className="shelf-stack-title">
                                    {item.book.title}
                                  </cite>
                                  <span className="shelf-stack-author">
                                    {item.book.author}
                                  </span>
                                  {hasIndicator && (
                                    <span
                                      className={`shelf-spine-dot ${
                                        item.book.loaned_to
                                          ? "is-loaned"
                                          : `is-${item.book.reading_status}`
                                      }`}
                                      aria-hidden="true"
                                    />
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {shelfGroup.standing.length > 0 && (
                  <div className="shelf-standing-bay">
                    <div
                      className="shelf-standing-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label={`Shelf ${shelfGroup.shelf} standing volumes`}
                    >
                      <div className="shelf-standing-row">
                        {shelfGroup.standing.map((spine) => {
                          const hasIndicator =
                            spine.book.reading_status !== "unread" ||
                            Boolean(spine.book.loaned_to);
                          return (
                            <button
                              key={getBookKey(spine.book)}
                              type="button"
                              className={`shelf-spine shelf-spine--${spine.colorTone} shelf-spine--${spine.heightVariant}`}
                              onClick={() => onBookClick(spine.book)}
                              aria-haspopup="dialog"
                              aria-label={getBookAccessibleLabel(
                                spine.book,
                                shelfGroup.shelf,
                                spine.rawPosition,
                              )}
                            >
                              {hasIndicator && (
                                <span
                                  className={`shelf-spine-dot ${
                                    spine.book.loaned_to
                                      ? "is-loaned"
                                      : `is-${spine.book.reading_status}`
                                  }`}
                                  aria-hidden="true"
                                />
                              )}
                              <span className="shelf-spine-title">
                                {spine.book.title}
                              </span>
                              <span className="shelf-spine-author">
                                {getSpineAuthorLabel(spine.book.author)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="shelf-ledge" aria-hidden="true" />
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
