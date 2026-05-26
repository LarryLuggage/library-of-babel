"use client";

import { useMemo } from "react";
import { type CatalogueBook } from "@/lib/books/catalogue";

type LedgerBook = CatalogueBook & { number: number };

export function TagMatchesOverlay({
  tag,
  books,
  onClose,
  onBookClick,
}: {
  tag: string;
  books: LedgerBook[];
  onClose: () => void;
  onBookClick: (book: LedgerBook) => void;
}) {
  const matchingBooks = useMemo(() => {
    return books.filter((book) => book.tags?.includes(tag));
  }, [tag, books]);

  return (
    <div
      className="catalogue-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tag-matches-title"
    >
      <div
        className="catalogue-catalog-card"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Top Header Label */}
        <div className="card-call-number">
          <span>Subject Index</span>
          <span>Tag: {tag}</span>
        </div>

        {/* Rubber stamp indicating matched result count */}
        <div className="card-stamp">
          {matchingBooks.length} {matchingBooks.length === 1 ? "Vol." : "Vols."}
        </div>

        {/* Card Body */}
        <div className="card-body">
          <span className="card-entry-number">Catalog Search Result</span>
          <h3 id="tag-matches-title" className="card-title">
            Volumes matching &ldquo;{tag}&rdquo;
          </h3>
          <p className="card-author">arranged alphabetically</p>

          <ul className="tag-match-list">
            {matchingBooks.map((book) => (
              <li
                key={book.number}
                className="tag-match-item"
                onClick={() => {
                  onBookClick(book);
                  onClose(); // Auto-close search when opening a book detail card
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onBookClick(book);
                    onClose();
                  }
                }}
              >
                <span>
                  <strong>{book.author}</strong>: <em>{book.title}</em>
                </span>
                <span className="catalogue-entry-number">No. {book.number}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Rod Hole at the bottom */}
        <div className="card-rod-hole" aria-hidden="true">
          <div className="card-rod-ring"></div>
        </div>

        {/* Close Button */}
        <button
          className="card-close-btn"
          onClick={onClose}
          type="button"
        >
          Close Drawer
        </button>
      </div>
    </div>
  );
}
