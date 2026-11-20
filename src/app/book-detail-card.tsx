"use client";

import { useId, useMemo, useRef, useState } from "react";
import {
  filterDisplayTags,
  getBookKey,
  getNearestConnections,
  READING_STATUS_LABELS,
  READING_STATUS_VALUES,
  type CatalogueBook,
  type LedgerBook,
  type ReadingStatus,
} from "@/lib/books/catalogue";
import { ModalDialog, useDialogClose } from "./modal-dialog";

function getLocalTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type BookUpdatePatch = Partial<
  Pick<
    CatalogueBook,
    | "reading_status"
    | "rating"
    | "date_started"
    | "date_finished"
    | "personal_notes"
    | "loaned_to"
  >
>;

function BookDetailContent({
  book,
  books,
  titleId,
  onBookClick,
  onClose,
  onStartPath,
  onTagClick,
  onEditBook,
  onUpdateBook,
  onDeleteBook,
}: {
  book: LedgerBook;
  books: LedgerBook[];
  titleId: string;
  onBookClick: (book: LedgerBook) => void;
  onClose: () => void;
  onStartPath: () => void;
  onTagClick: (tag: string) => void;
  onEditBook: () => void;
  onUpdateBook: (bookId: string, patch: BookUpdatePatch) => Promise<CatalogueBook>;
  onDeleteBook: (bookId: string, bookTitle: string) => Promise<void>;
}) {
  const closeDialog = useDialogClose() ?? onClose;
  const dateFinishedId = useId();
  const loanedToId = useId();
  const personalNotesId = useId();
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  const [dateFinished, setDateFinished] = useState(book.date_finished ?? "");
  const [loanedTo, setLoanedTo] = useState(book.loaned_to ?? "");
  const [personalNotes, setPersonalNotes] = useState(book.personal_notes ?? "");
  const [syncedBookSnapshot, setSyncedBookSnapshot] = useState(() => ({
    id: book.id,
    date_finished: book.date_finished ?? "",
    loaned_to: book.loaned_to ?? "",
    personal_notes: book.personal_notes ?? "",
  }));

  if (
    syncedBookSnapshot.id !== book.id ||
    syncedBookSnapshot.date_finished !== (book.date_finished ?? "") ||
    syncedBookSnapshot.loaned_to !== (book.loaned_to ?? "") ||
    syncedBookSnapshot.personal_notes !== (book.personal_notes ?? "")
  ) {
    setSyncedBookSnapshot({
      id: book.id,
      date_finished: book.date_finished ?? "",
      loaned_to: book.loaned_to ?? "",
      personal_notes: book.personal_notes ?? "",
    });
    setDateFinished(book.date_finished ?? "");
    setLoanedTo(book.loaned_to ?? "");
    setPersonalNotes(book.personal_notes ?? "");
  }

  const [isUpdating, setIsUpdating] = useState(false);
  const [trackerStatus, setTrackerStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const displayTags = useMemo(
    () => filterDisplayTags(book.tags),
    [book.tags],
  );

  const booksByKey = useMemo(
    () => new Map(books.map((candidate) => [getBookKey(candidate), candidate])),
    [books],
  );

  const relatedBooks = useMemo(
    () =>
      getNearestConnections(book, books, 3)
        .map((connection) => booksByKey.get(getBookKey(connection.book)))
        .filter((candidate): candidate is LedgerBook => Boolean(candidate)),
    [book, books, booksByKey],
  );

  const applyQuickUpdate = async (
    patch: BookUpdatePatch,
    successMessage: string,
  ) => {
    setIsUpdating(true);
    setTrackerStatus(null);
    try {
      await onUpdateBook(book.id, patch);
      setTrackerStatus({ kind: "success", message: successMessage });
    } catch (error) {
      setTrackerStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not save reading update.",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStatusSelect = async (nextStatus: ReadingStatus) => {
    const patch: BookUpdatePatch = { reading_status: nextStatus };
    if (
      nextStatus === "finished" &&
      !book.date_finished &&
      !dateFinished.trim()
    ) {
      const today = getLocalTodayIsoDate();
      patch.date_finished = today;
      setDateFinished(today);
    }
    await applyQuickUpdate(
      patch,
      `Marked as ${READING_STATUS_LABELS[nextStatus]}.`,
    );
  };

  const handleRatingSelect = async (star: number) => {
    const nextRating = book.rating === star ? null : star;
    await applyQuickUpdate(
      { rating: nextRating },
      nextRating === null
        ? "Cleared personal rating."
        : `Rated ${nextRating} out of 5 stars.`,
    );
  };

  const handleSaveNotes = async (event: React.FormEvent) => {
    event.preventDefault();
    await applyQuickUpdate(
      {
        date_finished: dateFinished.trim() || null,
        loaned_to: loanedTo.trim() || null,
        personal_notes: personalNotes.trim() || null,
      },
      "Tracker notes saved.",
    );
  };

  const handleRevealDelete = () => {
    setConfirmingDelete(true);
    window.requestAnimationFrame(() => {
      cancelDeleteRef.current?.focus();
    });
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setTrackerStatus(null);
    try {
      await onDeleteBook(book.id, book.title);
      closeDialog();
    } catch (error) {
      setIsDeleting(false);
      setTrackerStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not remove this volume.",
      });
    }
  };

  return (
    <div className="catalogue-catalog-card catalogue-catalog-card--structured">
      <div className="card-header-bar">
        <div className="card-call-number">
          <span>Sh. {book.shelf}</span>
          <span>Pos. {book.position || "—"}</span>
        </div>

        {book.top_category && (
          <div className="card-stamp">{book.top_category}</div>
        )}
      </div>

      <div className="card-scroll-body">
        <span className="card-entry-number">Vol. {book.number}</span>
        <h2 id={titleId} className="card-title">
          {book.title}
        </h2>
        <p className="card-author">by {book.author}</p>

        <div className="card-meta-list">
          <div>
            <strong>Edition:</strong> {book.edition || "Unspecified edition"}
          </div>
          {book.sub_category && (
            <div>
              <strong>Sub-Category:</strong> {book.sub_category}
            </div>
          )}
          {book.publish_year !== null && (
            <div>
              <strong>Published:</strong> {book.publish_year}
            </div>
          )}
          <div>
            <strong>Location:</strong> Shelf {book.shelf}
            {book.position ? `, ${book.position}` : ""}
          </div>
        </div>

        {book.summary && (
          <div className="card-summary">
            <p>{book.summary}</p>
          </div>
        )}

        {displayTags.length > 0 && (
          <div className="card-subjects">
            <h4>Subjects &amp; cross-references</h4>
            <div className="card-tags" aria-label="Volume subjects">
              {displayTags.map((tag) => (
                <button
                  key={tag}
                  className="card-tag catalogue-tag-interactive"
                  onClick={() => onTagClick(tag)}
                  type="button"
                  aria-label={`Show catalogue volumes tagged ${tag}`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        <section
          className="card-reading-ledger"
          aria-label="Reading Ledger tracker"
        >
          <h4>Reading Ledger</h4>

          <div
            className="reading-status-group"
            role="group"
            aria-label="Reading status"
          >
            {READING_STATUS_VALUES.map((status) => (
              <button
                key={status}
                type="button"
                className="status-pill-btn"
                aria-pressed={book.reading_status === status}
                disabled={isUpdating || isDeleting}
                onClick={() => handleStatusSelect(status)}
              >
                {READING_STATUS_LABELS[status]}
              </button>
            ))}
          </div>

          <div
            className="reading-rating-row"
            role="group"
            aria-label="Personal rating"
          >
            <span className="reading-rating-label">Rating</span>
            <div className="rating-stars">
              {[1, 2, 3, 4, 5].map((star) => {
                const isSelected = book.rating === star;
                const isFilled = (book.rating ?? 0) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    className={`rating-star-btn ${isFilled ? "is-filled" : ""}`}
                    aria-pressed={isSelected}
                    aria-label={`${star} ${star === 1 ? "star" : "stars"}${isSelected ? " (click to clear)" : ""}`}
                    disabled={isUpdating || isDeleting}
                    onClick={() => handleRatingSelect(star)}
                  >
                    <span aria-hidden="true">{isFilled ? "★" : "☆"}</span>
                  </button>
                );
              })}
              {book.rating !== null && (
                <span className="rating-caption">{book.rating}/5</span>
              )}
            </div>
          </div>

          <form className="reading-notes-form" onSubmit={handleSaveNotes}>
            <div className="reading-notes-grid">
              <div className="reading-field">
                <label htmlFor={dateFinishedId}>Date finished</label>
                <input
                  id={dateFinishedId}
                  type="date"
                  value={dateFinished}
                  onChange={(event) => setDateFinished(event.target.value)}
                />
              </div>
              <div className="reading-field">
                <label htmlFor={loanedToId}>Loaned to</label>
                <input
                  id={loanedToId}
                  type="text"
                  value={loanedTo}
                  onChange={(event) => setLoanedTo(event.target.value)}
                  placeholder="Borrower name"
                />
              </div>
            </div>

            <div className="reading-field">
              <label htmlFor={personalNotesId}>Personal notes</label>
              <textarea
                id={personalNotesId}
                rows={3}
                value={personalNotes}
                onChange={(event) => setPersonalNotes(event.target.value)}
                placeholder="Marginalia, reading impressions, or shelf notes..."
              />
            </div>

            <div className="reading-notes-actions">
              <button
                type="submit"
                className="btn-tracker-save"
                disabled={isUpdating || isDeleting}
              >
                {isUpdating ? "Saving..." : "Save tracker notes"}
              </button>
              {trackerStatus && (
                <p
                  className={`tracker-feedback tracker-feedback--${trackerStatus.kind}`}
                  role={trackerStatus.kind === "error" ? "alert" : "status"}
                >
                  {trackerStatus.message}
                </p>
              )}
            </div>
          </form>
        </section>

        <div className="card-primary-actions card-action-bar">
          <button
            type="button"
            className="btn-action-primary"
            onClick={onStartPath}
            disabled={isDeleting}
          >
            Start a path from this volume
          </button>
          <div className="card-secondary-actions">
            <button
              type="button"
              className="btn-action-secondary"
              onClick={onEditBook}
              disabled={isDeleting}
            >
              Edit volume
            </button>
            <button
              type="button"
              className="btn-action-danger-outline"
              onClick={handleRevealDelete}
              disabled={confirmingDelete || isDeleting}
            >
              Remove volume
            </button>
          </div>
          <div
            className={`card-delete-confirm ${confirmingDelete ? "is-visible" : ""}`}
            aria-hidden={!confirmingDelete}
          >
            <span>Remove this volume permanently?</span>
            <div className="card-delete-confirm-buttons">
              <button
                type="button"
                className="btn-action-danger"
                onClick={handleConfirmDelete}
                disabled={!confirmingDelete || isDeleting}
                tabIndex={confirmingDelete ? 0 : -1}
              >
                {isDeleting ? "Removing..." : "Confirm remove"}
              </button>
              <button
                ref={cancelDeleteRef}
                type="button"
                className="btn-action-secondary"
                onClick={() => setConfirmingDelete(false)}
                disabled={!confirmingDelete || isDeleting}
                tabIndex={confirmingDelete ? 0 : -1}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>

        {relatedBooks.length > 0 && (
          <div className="card-related-books">
            <h4>Related volumes</h4>
            <ul>
              {relatedBooks.map((relatedBook) => (
                <li key={getBookKey(relatedBook)}>
                  <button
                    type="button"
                    onClick={() => onBookClick(relatedBook)}
                  >
                    <cite>{relatedBook.title}</cite>
                    <span>
                      {relatedBook.author} · Shelf {relatedBook.shelf}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card-footer">
        <div className="card-rod-hole" aria-hidden="true">
          <div className="card-rod-ring" />
        </div>
        <button className="card-close-btn" onClick={closeDialog} type="button">
          Close Volume
        </button>
      </div>
    </div>
  );
}

export function BookDetailCard({
  book,
  books,
  onBookClick,
  onClose,
  onStartPath,
  onTagClick,
  onEditBook,
  onUpdateBook,
  onDeleteBook,
}: {
  book: LedgerBook;
  books: LedgerBook[];
  onBookClick: (book: LedgerBook) => void;
  onClose: () => void;
  onStartPath: () => void;
  onTagClick: (tag: string) => void;
  onEditBook: () => void;
  onUpdateBook: (bookId: string, patch: BookUpdatePatch) => Promise<CatalogueBook>;
  onDeleteBook: (bookId: string, bookTitle: string) => Promise<void>;
}) {
  const titleId = useId();

  return (
    <ModalDialog
      open
      onClose={onClose}
      labelledBy={titleId}
      className="catalogue-dialog--card"
    >
      <BookDetailContent
        book={book}
        books={books}
        titleId={titleId}
        onBookClick={onBookClick}
        onClose={onClose}
        onStartPath={onStartPath}
        onTagClick={onTagClick}
        onEditBook={onEditBook}
        onUpdateBook={onUpdateBook}
        onDeleteBook={onDeleteBook}
      />
    </ModalDialog>
  );
}
