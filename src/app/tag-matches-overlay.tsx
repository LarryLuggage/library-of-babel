"use client";

import { useMemo } from "react";
import {
  filterDisplayTags,
  getBookKey,
  type LedgerBook,
} from "@/lib/books/catalogue";
import { ModalDialog, useDialogClose } from "./modal-dialog";

function TagMatchesContent({
  tag,
  matchingBooks,
  onBookClick,
  onFilterByTag,
  onClose,
}: {
  tag: string;
  matchingBooks: LedgerBook[];
  onBookClick: (book: LedgerBook) => void;
  onFilterByTag: (tag: string) => void;
  onClose: () => void;
}) {
  const closeDialog = useDialogClose() ?? onClose;

  return (
    <div className="catalogue-catalog-card catalogue-catalog-card--structured">
      <div className="card-header-bar">
        <div className="card-call-number">
          <span>Subject Index</span>
          <span>Tag: {tag}</span>
        </div>

        <div className="card-stamp">
          {matchingBooks.length} {matchingBooks.length === 1 ? "Vol." : "Vols."}
        </div>
      </div>

      <div className="card-scroll-body">
        <span className="card-entry-number">Catalog Search Result</span>
        <h2 id="tag-matches-title" className="card-title">
          Volumes matching &ldquo;{tag}&rdquo;
        </h2>
        <p className="card-author">arranged by author surname</p>

        <div className="card-primary-actions">
          <button
            type="button"
            onClick={() => {
              onFilterByTag(tag);
            }}
          >
            Filter catalogue by this subject
          </button>
        </div>

        {matchingBooks.length === 0 ? (
          <p className="card-empty-note">
            No volumes currently carry this subject tag.
          </p>
        ) : (
          <ul className="tag-match-list">
            {matchingBooks.map((book) => (
              <li key={getBookKey(book)}>
                <button
                  type="button"
                  className="tag-match-item"
                  onClick={() => {
                    onBookClick(book);
                    onClose();
                  }}
                >
                  <span className="tag-match-item-label">
                    <strong>{book.author}</strong>: <em>{book.title}</em>
                  </span>
                  <span className="catalogue-entry-number">
                    No. {book.number}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card-footer">
        <div className="card-rod-hole" aria-hidden="true">
          <div className="card-rod-ring" />
        </div>
        <button className="card-close-btn" onClick={closeDialog} type="button">
          Close Drawer
        </button>
      </div>
    </div>
  );
}

export function TagMatchesOverlay({
  tag,
  books,
  onClose,
  onBookClick,
  onFilterByTag,
}: {
  tag: string;
  books: LedgerBook[];
  onClose: () => void;
  onBookClick: (book: LedgerBook) => void;
  onFilterByTag: (tag: string) => void;
}) {
  const matchingBooks = useMemo(() => {
    const normalizedTarget = tag.toLocaleLowerCase("en-US");
    return books.filter((book) =>
      filterDisplayTags(book.tags).some(
        (candidate) => candidate.toLocaleLowerCase("en-US") === normalizedTarget,
      ),
    );
  }, [tag, books]);

  return (
    <ModalDialog
      open
      onClose={onClose}
      labelledBy="tag-matches-title"
      className="catalogue-dialog--card"
    >
      <TagMatchesContent
        tag={tag}
        matchingBooks={matchingBooks}
        onBookClick={onBookClick}
        onFilterByTag={onFilterByTag}
        onClose={onClose}
      />
    </ModalDialog>
  );
}
