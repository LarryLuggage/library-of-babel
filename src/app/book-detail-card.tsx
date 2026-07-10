"use client";

import { useMemo } from "react";
import {
  getBookKey,
  getNearestConnections,
  type CatalogueBook,
} from "@/lib/books/catalogue";

type LedgerBook = CatalogueBook & { number: number };

export function BookDetailCard({
  book,
  books,
  onBookClick,
  onClose,
  onStartPath,
  onTagClick,
}: {
  book: LedgerBook;
  books: LedgerBook[];
  onBookClick: (book: LedgerBook) => void;
  onClose: () => void;
  onStartPath: () => void;
  onTagClick?: (tag: string) => void;
}) {
  const relatedBooks = useMemo(
    () =>
      getNearestConnections(book, books, 3)
        .map((connection) => books.find((candidate) => getBookKey(candidate) === getBookKey(connection.book)))
        .filter((candidate): candidate is LedgerBook => Boolean(candidate)),
    [book, books],
  );

  return (
    <div
      className="catalogue-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-title"
    >
      <div
        className="catalogue-catalog-card"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Call Number / Location in top-left */}
        <div className="card-call-number">
          <span>Sh. {book.shelf}</span>
          <span>Pos. {book.position}</span>
        </div>

        {/* Division Stamp in top-right */}
        {book.top_category && (
          <div className="card-stamp">
            {book.top_category}
          </div>
        )}

        {/* Card Body */}
        <div className="card-body">
          <span className="card-entry-number">Vol. {book.number}</span>
          <h3 id="card-title" className="card-title">
            {book.title}
          </h3>
          <p className="card-author">by {book.author}</p>

          <div className="card-meta-list">
            <div>
              <strong>Edition:</strong> {book.edition}
            </div>
            {book.sub_category && (
              <div>
                <strong>Sub-Category:</strong> {book.sub_category}
              </div>
            )}
            <div>
              <strong>Location:</strong> Shelf {book.shelf}, {book.position}
            </div>
          </div>

          {book.summary && (
            <div className="card-summary">
              <p>{book.summary}</p>
            </div>
          )}

          {book.tags && book.tags.length > 0 && (
            <div className="card-subjects">
              <h4>Filter the catalogue by subject</h4>
              <div className="card-tags" aria-label="Subject filters">
                {book.tags.map((tag) => {
                  if (onTagClick) {
                    return (
                      <button
                        key={tag}
                        className="card-tag catalogue-tag-interactive"
                        onClick={() => onTagClick(tag)}
                        type="button"
                        aria-label={`Show catalogue volumes tagged ${tag}`}
                      >
                        {tag}
                      </button>
                    );
                  }
                  return (
                    <span key={tag} className="card-tag">
                      {tag}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card-primary-actions">
            <button type="button" onClick={onStartPath}>
              Start a path from this volume
            </button>
          </div>

          {relatedBooks.length > 0 && (
            <div className="card-related-books">
              <h4>Related volumes</h4>
              <ul>
                {relatedBooks.map((relatedBook) => (
                  <li key={getBookKey(relatedBook)}>
                    <button type="button" onClick={() => onBookClick(relatedBook)}>
                      <cite>{relatedBook.title}</cite>
                      <span>{relatedBook.author} · Shelf {relatedBook.shelf}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Rod Hole at the bottom */}
        <div className="card-rod-hole" aria-hidden="true">
          <div className="card-rod-ring"></div>
        </div>

        {/* Close Button styled as a stamp or tab */}
        <button
          className="card-close-btn"
          onClick={onClose}
          type="button"
        >
          Close Volume
        </button>
      </div>
    </div>
  );
}
