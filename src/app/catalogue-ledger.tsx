"use client";

import { useId, useMemo, useRef, useState } from "react";
import {
  getAuthorInitial,
  getBookKey,
  getDivision,
  READING_STATUS_LABELS,
  READING_STATUS_VALUES,
  type LedgerBook,
  type ReadingStatus,
} from "@/lib/books/catalogue";
import type { BulkBookPatch } from "@/lib/books/triage";

function parseTagList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

export function CatalogueLedger({
  entries,
  onBookClick,
  isBulkMode = false,
  onToggleBulkMode,
  selectedIds,
  onToggleSelect,
  onSelectVisible,
  onClearSelection,
  divisions = [],
  onApplyBulkUpdate,
  isApplyingBulk = false,
}: {
  entries: LedgerBook[];
  onBookClick: (book: LedgerBook) => void;
  isBulkMode?: boolean;
  onToggleBulkMode?: () => void;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (bookId: string) => void;
  onSelectVisible?: (visibleBooks: readonly LedgerBook[]) => void;
  onClearSelection?: () => void;
  divisions?: string[];
  onApplyBulkUpdate?: (patch: BulkBookPatch) => Promise<void>;
  isApplyingBulk?: boolean;
}) {
  const pageSize = 96;
  const [visibleCount, setVisibleCount] = useState(pageSize);

  const ledgerIdPrefix = useId();
  const bulkTitleId = `${ledgerIdPrefix}-bulk-title`;
  const bulkFieldsId = `${ledgerIdPrefix}-bulk-fields`;
  const bulkStatusId = `${ledgerIdPrefix}-bulk-status`;
  const bulkShelfId = `${ledgerIdPrefix}-bulk-shelf`;
  const bulkDivisionId = `${ledgerIdPrefix}-bulk-division`;
  const bulkAddTagsId = `${ledgerIdPrefix}-bulk-add-tags`;
  const bulkRemoveTagsId = `${ledgerIdPrefix}-bulk-remove-tags`;

  const bulkShelfRef = useRef<HTMLInputElement>(null);

  const [bulkStatus, setBulkStatus] = useState<"" | ReadingStatus>("");
  const [bulkShelf, setBulkShelf] = useState("");
  const [bulkDivision, setBulkDivision] = useState("");
  const [bulkAddTags, setBulkAddTags] = useState("");
  const [bulkRemoveTags, setBulkRemoveTags] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [bulkInvalidShelf, setBulkInvalidShelf] = useState(false);
  const [isBulkMinimized, setIsBulkMinimized] = useState(false);

  const visibleEntries = entries.slice(0, visibleCount);
  const selectedCount = selectedIds?.size ?? 0;

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

  const resetBulkForm = () => {
    setBulkStatus("");
    setBulkShelf("");
    setBulkDivision("");
    setBulkAddTags("");
    setBulkRemoveTags("");
    setBulkError("");
    setBulkInvalidShelf(false);
  };

  const handleBulkSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBulkError("");
    setBulkInvalidShelf(false);

    if (selectedCount === 0) {
      setBulkError("Select at least one volume before applying bulk changes.");
      return;
    }

    const patch: BulkBookPatch = {};

    if (bulkStatus) {
      patch.reading_status = bulkStatus;
    }

    const trimmedShelf = bulkShelf.trim();
    if (trimmedShelf) {
      if (!/^\d+$/.test(trimmedShelf)) {
        setBulkError("Shelf must be a whole number (0 or greater).");
        setBulkInvalidShelf(true);
        bulkShelfRef.current?.focus();
        return;
      }
      patch.shelf = Number.parseInt(trimmedShelf, 10);
    }

    if (bulkDivision) {
      patch.top_category = bulkDivision;
    }

    const addTags = parseTagList(bulkAddTags);
    if (addTags.length > 0) {
      patch.add_tags = addTags;
    }

    const removeTags = parseTagList(bulkRemoveTags);
    if (removeTags.length > 0) {
      patch.remove_tags = removeTags;
    }

    if (Object.keys(patch).length === 0) {
      setBulkError(
        "Choose at least one reading status, shelf, division, or tag change to apply.",
      );
      return;
    }

    try {
      await onApplyBulkUpdate?.(patch);
      resetBulkForm();
    } catch (error) {
      setBulkError(
        error instanceof Error
          ? error.message
          : "Could not apply bulk catalogue updates.",
      );
    }
  };

  return (
    <section className="catalogue-ledger" aria-labelledby="ledger-title">
      <div className="catalogue-ledger-heading">
        <p>Complete shelf ledger</p>
        <h2 id="ledger-title">Entries by author</h2>
        <span className="catalogue-ledger-count">
          Showing {Math.min(visibleCount, entries.length)} of {entries.length}{" "}
          matching {entries.length === 1 ? "volume" : "volumes"}
        </span>

        {onToggleBulkMode && (
          <div className="ledger-bulk-toolbar">
            <button
              type="button"
              className="ledger-select-toggle font-mono"
              aria-pressed={Boolean(isBulkMode)}
              disabled={isApplyingBulk}
              onClick={onToggleBulkMode}
            >
              {isBulkMode ? "Done selecting" : "Select volumes"}
            </button>

            {isBulkMode && (
              <>
                <button
                  type="button"
                  className="ledger-bulk-helper-btn font-mono"
                  disabled={visibleEntries.length === 0 || isApplyingBulk}
                  onClick={() => onSelectVisible?.(visibleEntries)}
                >
                  Select visible ({visibleEntries.length})
                </button>
                <button
                  type="button"
                  className="ledger-bulk-helper-btn font-mono"
                  disabled={selectedCount === 0 || isApplyingBulk}
                  onClick={() => onClearSelection?.()}
                >
                  Clear selection ({selectedCount})
                </button>
              </>
            )}
          </div>
        )}
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
              const key = getBookKey(book);
              const checkboxId = `${ledgerIdPrefix}-select-${key}`;
              const isSelected = Boolean(selectedIds?.has(book.id));
              const hasTrackerBadges =
                book.reading_status !== "unread" ||
                book.rating !== null ||
                Boolean(book.loaned_to);

              const entryButton = (
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
              );

              return (
                <li key={key} className="catalogue-entry-row">
                  {isBulkMode ? (
                    <div
                      className={`ledger-bulk-row ${isSelected ? "is-selected" : ""}`}
                    >
                      <div className="ledger-select-control">
                        <input
                          type="checkbox"
                          id={checkboxId}
                          className="ledger-select-checkbox"
                          checked={isSelected}
                          disabled={isApplyingBulk}
                          onChange={() => onToggleSelect?.(book.id)}
                        />
                        <label
                          htmlFor={checkboxId}
                          className="ledger-select-label"
                        >
                          <span className="sr-only">
                            Select {book.title} by {book.author}
                          </span>
                        </label>
                      </div>
                      {entryButton}
                    </div>
                  ) : (
                    entryButton
                  )}
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

      {isBulkMode && selectedCount > 0 && (
        <form
          className="bulk-action-bar"
          aria-labelledby={bulkTitleId}
          onSubmit={(event) => void handleBulkSubmit(event)}
          noValidate
        >
          <div className="bulk-action-header">
            <h3 id={bulkTitleId}>
              Bulk edit ({selectedCount}{" "}
              {selectedCount === 1 ? "volume" : "volumes"} selected)
            </h3>
            <div className="bulk-action-header-actions">
              <p className="bulk-action-subtitle">
                Only filled fields are updated; empty fields stay unchanged.
              </p>
              <button
                type="button"
                className="bulk-action-collapse-btn font-mono"
                aria-expanded={!isBulkMinimized}
                aria-controls={bulkFieldsId}
                onClick={() => setIsBulkMinimized((prev) => !prev)}
              >
                {isBulkMinimized ? "Edit fields" : "Minimize"}
              </button>
            </div>
          </div>

          <div
            id={bulkFieldsId}
            className="bulk-action-fields"
            hidden={isBulkMinimized}
          >
            {bulkError && (
              <p className="editor-error bulk-action-error" role="alert">
                {bulkError}
              </p>
            )}

            <div className="bulk-action-grid">
              <div className="bulk-action-field">
                <label htmlFor={bulkStatusId}>Reading status</label>
                <select
                  id={bulkStatusId}
                  value={bulkStatus}
                  disabled={isApplyingBulk}
                  onChange={(event) =>
                    setBulkStatus(event.target.value as "" | ReadingStatus)
                  }
                >
                  <option value="">No change</option>
                  {READING_STATUS_VALUES.map((status) => (
                    <option key={status} value={status}>
                      {READING_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bulk-action-field">
                <label htmlFor={bulkShelfId}>Shelf</label>
                <input
                  ref={bulkShelfRef}
                  id={bulkShelfId}
                  type="text"
                  inputMode="numeric"
                  value={bulkShelf}
                  disabled={isApplyingBulk}
                  aria-invalid={bulkInvalidShelf ? true : undefined}
                  onChange={(event) => {
                    setBulkShelf(event.target.value);
                    if (bulkInvalidShelf) setBulkInvalidShelf(false);
                  }}
                  placeholder="Unchanged"
                />
              </div>

              <div className="bulk-action-field">
                <label htmlFor={bulkDivisionId}>Division</label>
                <select
                  id={bulkDivisionId}
                  value={bulkDivision}
                  disabled={isApplyingBulk}
                  onChange={(event) => setBulkDivision(event.target.value)}
                >
                  <option value="">No change</option>
                  {divisions.map((division) => (
                    <option key={division} value={division}>
                      {division}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bulk-action-field">
                <label htmlFor={bulkAddTagsId}>Add tags</label>
                <input
                  id={bulkAddTagsId}
                  type="text"
                  value={bulkAddTags}
                  disabled={isApplyingBulk}
                  onChange={(event) => setBulkAddTags(event.target.value)}
                  placeholder="e.g., epistemology, essay"
                />
              </div>

              <div className="bulk-action-field bulk-action-field--wide-mobile">
                <label htmlFor={bulkRemoveTagsId}>Remove tags</label>
                <input
                  id={bulkRemoveTagsId}
                  type="text"
                  value={bulkRemoveTags}
                  disabled={isApplyingBulk}
                  onChange={(event) => setBulkRemoveTags(event.target.value)}
                  placeholder="e.g., to review"
                />
              </div>
            </div>

            <div className="bulk-action-buttons">
              <button
                type="button"
                className="pathfinder-btn btn-secondary font-mono"
                disabled={isApplyingBulk}
                onClick={() => {
                  resetBulkForm();
                  onClearSelection?.();
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="pathfinder-btn btn-primary font-mono"
                disabled={isApplyingBulk}
              >
                {isApplyingBulk
                  ? "Applying..."
                  : `Apply to ${selectedCount} ${selectedCount === 1 ? "volume" : "volumes"}`}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
