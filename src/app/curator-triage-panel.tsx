"use client";

import { useId, useRef, useState } from "react";
import {
  filterDisplayTags,
  formatPublishYear,
  getBookKey,
  READING_STATUS_LABELS,
  type CatalogueBook,
} from "@/lib/books/catalogue";
import type {
  DuplicateGroup,
  TriageFilter,
  TriageSummary,
} from "@/lib/books/triage";

const MISSING_FILTER_LABELS: Record<
  Exclude<TriageFilter, "" | "duplicates">,
  string
> = {
  missing_any: "Volumes missing any metadata",
  missing_summary: "Volumes missing summaries",
  missing_year: "Volumes missing publish years",
  missing_tags: "Volumes missing subject tags",
};

export function CuratorTriagePanel({
  triageFilter,
  duplicateGroups,
  triageSummary,
  canEdit,
  onInspectBook,
  onDeleteBook,
  onRequestAuth,
  onClearTriage,
}: {
  triageFilter: TriageFilter;
  duplicateGroups: DuplicateGroup[];
  triageSummary: TriageSummary;
  canEdit: boolean;
  onInspectBook: (book: CatalogueBook) => void;
  onDeleteBook: (bookId: string, bookTitle: string) => Promise<void>;
  onRequestAuth: (reason?: string, afterAuth?: () => void) => void;
  onClearTriage: () => void;
}) {
  const headingId = useId();
  const cancelConfirmRef = useRef<HTMLButtonElement>(null);

  const [confirmingBookId, setConfirmingBookId] = useState<string | null>(null);
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{
    bookId: string;
    message: string;
  } | null>(null);

  if (!triageFilter) {
    return null;
  }

  const handleRequestRemove = (bookId: string) => {
    setDeleteError(null);
    if (!canEdit) {
      onRequestAuth(
        "Curator sign-in is required before removing duplicate volumes.",
        () => {
          setConfirmingBookId(bookId);
        },
      );
      return;
    }

    setConfirmingBookId(bookId);
    window.requestAnimationFrame(() => {
      cancelConfirmRef.current?.focus();
    });
  };

  const handleConfirmRemove = async (book: CatalogueBook) => {
    setDeletingBookId(book.id);
    setDeleteError(null);
    try {
      await onDeleteBook(book.id, book.title);
      setConfirmingBookId(null);
    } catch (error) {
      setDeleteError({
        bookId: book.id,
        message:
          error instanceof Error
            ? error.message
            : "Could not remove duplicate volume.",
      });
    } finally {
      setDeletingBookId(null);
    }
  };

  if (triageFilter === "duplicates") {
    return (
      <section
        className="curator-triage-panel"
        aria-labelledby={headingId}
      >
        <div className="curator-triage-header">
          <div className="curator-triage-heading">
            <p className="curator-triage-kicker font-mono">curator triage</p>
            <h3 id={headingId}>Possible duplicate volumes</h3>
            <p className="curator-triage-subtitle">
              {duplicateGroups.length}{" "}
              {duplicateGroups.length === 1
                ? "duplicate group"
                : "duplicate groups"}{" "}
              detected ({triageSummary.duplicates}{" "}
              {triageSummary.duplicates === 1 ? "volume" : "volumes"}). Compare
              shelf location, metadata completeness, and reading notes before
              removing a redundant copy.
            </p>
          </div>
          <button
            type="button"
            className="pathfinder-btn btn-secondary font-mono"
            onClick={onClearTriage}
          >
            Clear triage
          </button>
        </div>

        {duplicateGroups.length === 0 ? (
          <div className="curator-triage-empty">
            <p>No possible duplicate groups remain in the catalogue.</p>
          </div>
        ) : (
          <div className="duplicate-groups-list">
            {duplicateGroups.map((group) => (
              <article key={group.key} className="duplicate-group-card">
                <header className="duplicate-group-header">
                  <span className="duplicate-group-reason font-mono">
                    {group.reason}
                  </span>
                  <span className="duplicate-group-count font-mono">
                    {group.books.length}{" "}
                    {group.books.length === 1 ? "copy" : "copies"}
                  </span>
                </header>

                <div className="duplicate-copy-grid">
                  {group.books.map((book) => {
                    const key = getBookKey(book);
                    const displayTags = filterDisplayTags(book.tags);
                    const formattedYear = formatPublishYear(book.publish_year);
                    const hasSummary = Boolean(book.summary?.trim());
                    const isConfirming = confirmingBookId === book.id && canEdit;
                    const isDeleting = deletingBookId === book.id;

                    return (
                      <div key={key} className="duplicate-copy-card">
                        <div className="duplicate-copy-meta">
                          <span className="duplicate-copy-location font-mono">
                            Shelf {book.shelf} ·{" "}
                            {book.position ? `Pos. ${book.position}` : "Pos. —"}
                          </span>
                          <h4 className="duplicate-copy-title">
                            <cite>{book.title}</cite>
                          </h4>
                          <p className="duplicate-copy-author">{book.author}</p>
                          <p className="duplicate-copy-edition">
                            {book.edition || "Unspecified edition"}
                          </p>
                        </div>

                        <div className="duplicate-copy-pills">
                          <span
                            className={`ledger-badge ledger-badge--status ledger-badge--${book.reading_status}`}
                          >
                            {READING_STATUS_LABELS[book.reading_status]}
                          </span>
                          <span className="ledger-badge ledger-badge--rating">
                            {book.rating !== null
                              ? `★ ${book.rating}/5`
                              : "Unrated"}
                          </span>
                          <span
                            className={`triage-status-pill ${hasSummary ? "is-present" : "is-missing"}`}
                          >
                            {hasSummary ? "Summary ✓" : "Missing summary"}
                          </span>
                          <span
                            className={`triage-status-pill ${formattedYear ? "is-present" : "is-missing"}`}
                          >
                            {formattedYear
                              ? `Year: ${formattedYear}`
                              : "Missing year"}
                          </span>
                          <span
                            className={`triage-status-pill ${displayTags.length > 0 ? "is-present" : "is-missing"}`}
                          >
                            {displayTags.length > 0
                              ? `${displayTags.length} ${displayTags.length === 1 ? "tag" : "tags"}`
                              : "Missing tags"}
                          </span>
                        </div>

                        {deleteError?.bookId === book.id && (
                          <p className="tracker-feedback tracker-feedback--error" role="alert">
                            {deleteError.message}
                          </p>
                        )}

                        <div className="duplicate-copy-actions">
                          <button
                            type="button"
                            className="btn-action-secondary"
                            aria-label={`Inspect ${book.title} by ${book.author}`}
                            disabled={isDeleting}
                            onClick={() => onInspectBook(book)}
                          >
                            Inspect
                          </button>

                          {!isConfirming ? (
                            <button
                              type="button"
                              className="btn-action-danger-outline"
                              aria-label={`Remove duplicate ${book.title} on shelf ${book.shelf}`}
                              disabled={isDeleting}
                              onClick={() => handleRequestRemove(book.id)}
                            >
                              Remove duplicate
                            </button>
                          ) : (
                            <div className="duplicate-confirm-inline">
                              <button
                                type="button"
                                className="btn-action-danger"
                                aria-label={`Confirm remove ${book.title} on shelf ${book.shelf}`}
                                disabled={isDeleting}
                                onClick={() => void handleConfirmRemove(book)}
                              >
                                {isDeleting ? "Removing..." : "Confirm remove"}
                              </button>
                              <button
                                ref={cancelConfirmRef}
                                type="button"
                                className="btn-action-secondary"
                                disabled={isDeleting}
                                onClick={() => setConfirmingBookId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className="curator-triage-panel curator-triage-panel--notice"
      aria-labelledby={headingId}
    >
      <div className="curator-triage-header">
        <div className="curator-triage-heading">
          <p className="curator-triage-kicker font-mono">curator triage</p>
          <h3 id={headingId}>{MISSING_FILTER_LABELS[triageFilter]}</h3>
          <p className="curator-triage-subtitle">
            {triageSummary.missing_any} incomplete total ·{" "}
            {triageSummary.missing_summary} missing summary ·{" "}
            {triageSummary.missing_year} missing publish year ·{" "}
            {triageSummary.missing_tags} missing subjects. Click any volume to
            run <strong>1-Click Enrich</strong> or toggle{" "}
            <strong>Select volumes</strong> for batch tagging and status edits.
          </p>
        </div>
        <button
          type="button"
          className="pathfinder-btn btn-secondary font-mono"
          onClick={onClearTriage}
        >
          Clear triage
        </button>
      </div>
    </section>
  );
}
