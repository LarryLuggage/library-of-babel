"use client";

import { useId, useRef, useState } from "react";
import {
  formatPublishYear,
  MAX_PUBLISH_YEAR,
  MIN_PUBLISH_YEAR,
  READING_STATUS_LABELS,
  READING_STATUS_VALUES,
  type CatalogueBook,
  type ReadingStatus,
} from "@/lib/books/catalogue";
import type { LookupCandidate } from "@/lib/books/lookup";
import { ModalDialog, useDialogClose } from "./modal-dialog";

function BookEditorForm({
  mode,
  book,
  divisions,
  titleId,
  onClose,
  onSaved,
  onUnauthorized,
  isSaving,
  setIsSaving,
}: {
  mode: "create" | "edit";
  book?: CatalogueBook;
  divisions: string[];
  titleId: string;
  onClose: () => void;
  onSaved: (
    savedBook: CatalogueBook,
    mode: "create" | "edit",
    previousId?: string,
  ) => void;
  onUnauthorized?: () => void;
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
}) {
  const closeDialog = useDialogClose() ?? onClose;
  const formPrefix = useId();
  const divisionListId = `${formPrefix}-divisions`;
  const lookupInputId = `${formPrefix}-lookup`;

  const titleRef = useRef<HTMLInputElement>(null);
  const authorRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLInputElement>(null);
  const publishYearRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(book?.title ?? "");
  const [author, setAuthor] = useState(book?.author ?? "");
  const [edition, setEdition] = useState(book?.edition ?? "");
  const [shelf, setShelf] = useState(book ? String(book.shelf) : "1");
  const [position, setPosition] = useState(book?.position ?? "");
  const [topCategory, setTopCategory] = useState(book?.top_category ?? "");
  const [subCategory, setSubCategory] = useState(book?.sub_category ?? "");
  const [publishYear, setPublishYear] = useState(
    book?.publish_year !== null && book?.publish_year !== undefined
      ? String(book.publish_year)
      : "",
  );
  const [tagsText, setTagsText] = useState(book?.tags.join(", ") ?? "");
  const [summary, setSummary] = useState(book?.summary ?? "");
  const [readingStatus, setReadingStatus] = useState<ReadingStatus>(
    book?.reading_status ?? "unread",
  );
  const [rating, setRating] = useState(
    book?.rating !== null && book?.rating !== undefined
      ? String(book.rating)
      : "",
  );
  const [dateFinished, setDateFinished] = useState(book?.date_finished ?? "");
  const [loanedTo, setLoanedTo] = useState(book?.loaned_to ?? "");
  const [personalNotes, setPersonalNotes] = useState(book?.personal_notes ?? "");
  const [errorMsg, setErrorMsg] = useState("");
  const [invalidField, setInvalidField] = useState<
    "title" | "author" | "shelf" | "publish_year" | null
  >(null);

  // Quick bibliographic lookup state (create mode only)
  const [lookupQuery, setLookupQuery] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [hasLookedUp, setHasLookedUp] = useState(false);
  const [lookupCandidates, setLookupCandidates] = useState<LookupCandidate[]>(
    [],
  );
  const [lookupError, setLookupError] = useState("");
  const [lookupNotice, setLookupNotice] = useState("");
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<
    number | null
  >(null);

  const handleLookup = async () => {
    const trimmed = lookupQuery.trim();
    setLookupError("");
    setLookupNotice("");
    setSelectedCandidateIndex(null);

    if (trimmed.length < 2) {
      setLookupError("Enter at least 2 characters or an ISBN to look up.");
      return;
    }

    setIsLookingUp(true);
    try {
      const response = await fetch(
        `/api/books/lookup?q=${encodeURIComponent(trimmed)}`,
      );
      const data = (await response.json().catch(() => ({}))) as {
        candidates?: LookupCandidate[];
        error?: string;
      };

      if (!response.ok) {
        setLookupError(
          data.error || "Could not reach bibliographic lookup service.",
        );
        setLookupCandidates([]);
        setHasLookedUp(true);
        setIsLookingUp(false);
        return;
      }

      const list = Array.isArray(data.candidates)
        ? data.candidates.slice(0, 6)
        : [];
      setLookupCandidates(list);
      setHasLookedUp(true);
    } catch {
      setLookupError("Network error during bibliographic lookup.");
      setLookupCandidates([]);
      setHasLookedUp(true);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleLookupKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleLookup();
    }
  };

  const applyLookupCandidate = (
    candidate: LookupCandidate,
    index: number,
  ) => {
    setTitle(candidate.title);
    setAuthor(candidate.author);
    setEdition(candidate.edition);
    setPublishYear(
      candidate.publish_year !== null ? String(candidate.publish_year) : "",
    );
    setTagsText(candidate.tags.join(", "));
    setSummary(candidate.summary ?? "");
    setSelectedCandidateIndex(index);
    setErrorMsg("");
    setInvalidField(null);
    setLookupNotice(
      "Filled bibliographic details — verify shelf and position before saving.",
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg("");
    setInvalidField(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMsg("Title is required.");
      setInvalidField("title");
      titleRef.current?.focus();
      return;
    }

    const trimmedAuthor = author.trim();
    if (!trimmedAuthor) {
      setErrorMsg("Author is required.");
      setInvalidField("author");
      authorRef.current?.focus();
      return;
    }

    const parsedShelf = Number.parseInt(shelf.trim(), 10);
    if (!Number.isInteger(parsedShelf) || parsedShelf < 0) {
      setErrorMsg("Shelf must be a whole number (0 or greater).");
      setInvalidField("shelf");
      shelfRef.current?.focus();
      return;
    }

    let parsedYear: number | null = null;
    if (publishYear.trim()) {
      const yearNum = Number(publishYear.trim());
      if (
        !Number.isInteger(yearNum) ||
        yearNum < MIN_PUBLISH_YEAR ||
        yearNum > MAX_PUBLISH_YEAR
      ) {
        setErrorMsg(
          `Publish year must be a whole year between ${MIN_PUBLISH_YEAR} (BCE) and ${MAX_PUBLISH_YEAR}.`,
        );
        setInvalidField("publish_year");
        publishYearRef.current?.focus();
        return;
      }
      parsedYear = yearNum;
    }

    const parsedTags = tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const payload = {
      title: trimmedTitle,
      author: trimmedAuthor,
      edition: edition.trim(),
      shelf: parsedShelf,
      position: position.trim(),
      top_category: topCategory.trim() || null,
      sub_category: subCategory.trim() || null,
      publish_year: parsedYear,
      tags: parsedTags,
      summary: summary.trim() || null,
      reading_status: readingStatus,
      rating: rating ? Number.parseInt(rating, 10) : null,
      date_finished: dateFinished.trim() || null,
      loaned_to: loanedTo.trim() || null,
      personal_notes: personalNotes.trim() || null,
    };

    setIsSaving(true);
    try {
      const endpoint =
        mode === "create"
          ? "/api/books"
          : `/api/books/${encodeURIComponent(book!.id)}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => ({}))) as {
        book?: CatalogueBook;
        error?: string;
        issues?: Array<
          string | { message?: string; path?: Array<string | number> }
        >;
      };

      if (response.status === 401) {
        setErrorMsg(body.error || "Curator sign-in is required to save.");
        setIsSaving(false);
        onUnauthorized?.();
        return;
      }

      if (!response.ok || !body.book) {
        const issueDetail =
          Array.isArray(body.issues) && body.issues.length > 0
            ? body.issues
                .map((issue) =>
                  typeof issue === "string" ? issue : issue.message,
                )
                .filter(Boolean)
                .join(" ")
            : "";
        setErrorMsg(
          issueDetail ||
            body.error ||
            "Could not save volume to the catalogue.",
        );
        setIsSaving(false);
        return;
      }

      onSaved(body.book, mode, book?.id);
      setIsSaving(false);
      onClose();
    } catch {
      setErrorMsg("Network error while saving volume.");
      setIsSaving(false);
    }
  };

  return (
    <div className="catalogue-editor-card">
      <button
        type="button"
        className="card-close-slip"
        onClick={closeDialog}
        disabled={isSaving}
        aria-label="Close volume editor"
      >
        <span className="slip-cancel">Close</span>
        <span className="slip-stamp font-mono">DISMISS</span>
      </button>

      <header className="pathfinder-card-header">
        <span className="card-rubric-tag font-mono">
          {mode === "create" ? "new accession" : "ledger amendment"}
        </span>
        <h2 id={titleId}>
          {mode === "create" ? "Add a Volume" : "Edit Volume"}
        </h2>
        <p className="pathfinder-subtitle">
          {mode === "create"
            ? "Enter bibliographic details and shelf coordinates for the new accession."
            : "Amend the bibliographic record or reading ledger for this volume."}
        </p>
      </header>

      {errorMsg && (
        <div className="editor-error" role="alert">
          {errorMsg}
        </div>
      )}

      <form
        className="editor-form"
        onSubmit={handleSubmit}
        aria-labelledby={titleId}
        noValidate
      >
        {mode === "create" && (
          <fieldset className="editor-lookup-panel">
            <legend>Quick bibliographic lookup</legend>

            <div className="editor-lookup-controls">
              <div className="editor-field editor-lookup-input-wrap">
                <label htmlFor={lookupInputId}>
                  Search by title, author, or ISBN
                </label>
                <input
                  id={lookupInputId}
                  name="lookup_query"
                  type="search"
                  enterKeyHint="search"
                  autoCorrect="off"
                  spellCheck={false}
                  value={lookupQuery}
                  onChange={(event) => setLookupQuery(event.target.value)}
                  onKeyDown={handleLookupKeyDown}
                  placeholder="e.g., Ficciones Borges or 9780802130303"
                />
              </div>
              <button
                type="button"
                className="pathfinder-btn btn-secondary font-mono editor-lookup-btn"
                onClick={() => void handleLookup()}
                disabled={isLookingUp || isSaving}
              >
                {isLookingUp ? "SEARCHING..." : "Lookup"}
              </button>
            </div>

            {lookupError && (
              <p className="editor-error" role="alert">
                {lookupError}
              </p>
            )}

            {lookupNotice && (
              <p className="editor-lookup-status font-mono" role="status">
                {lookupNotice}
              </p>
            )}

            {!isLookingUp &&
              hasLookedUp &&
              !lookupError &&
              lookupCandidates.length === 0 && (
                <p className="editor-lookup-empty">
                  No matching bibliographic records found. You can enter the
                  volume details manually below.
                </p>
              )}

            {lookupCandidates.length > 0 && (
              <ul
                className="editor-lookup-results"
                aria-label="Bibliographic lookup candidates"
              >
                {lookupCandidates.map((candidate, index) => {
                  const isApplied = selectedCandidateIndex === index;
                  const candidateYear = formatPublishYear(
                    candidate.publish_year,
                  );
                  return (
                    <li
                      key={`${candidate.source}-${candidate.isbn ?? index}-${candidate.title}`}
                    >
                      <button
                        type="button"
                        className="editor-lookup-candidate"
                        aria-pressed={isApplied}
                        onClick={() => applyLookupCandidate(candidate, index)}
                      >
                        <span className="editor-lookup-candidate-main">
                          <cite className="editor-lookup-candidate-title">
                            {candidate.title}
                          </cite>
                          <span className="editor-lookup-candidate-meta">
                            {candidate.author}
                            {candidateYear && ` · ${candidateYear}`}
                            {candidate.edition && ` · ${candidate.edition}`}
                            {candidate.isbn && ` · ISBN ${candidate.isbn}`}
                          </span>
                        </span>
                        <span className="editor-lookup-source font-mono">
                          {candidate.source === "open_library"
                            ? "Open Library"
                            : "Google Books"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        )}

        <div className="editor-grid">
          <div className="editor-field editor-field--wide">
            <label htmlFor={`${formPrefix}-title`}>
              Title <span aria-hidden="true">*</span>
            </label>
            <input
              ref={titleRef}
              id={`${formPrefix}-title`}
              name="title"
              type="text"
              required
              aria-invalid={invalidField === "title" ? true : undefined}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (invalidField === "title") setInvalidField(null);
              }}
              placeholder="e.g., Collected Fictions"
            />
          </div>

          <div className="editor-field editor-field--wide">
            <label htmlFor={`${formPrefix}-author`}>
              Author <span aria-hidden="true">*</span>
            </label>
            <input
              ref={authorRef}
              id={`${formPrefix}-author`}
              name="author"
              type="text"
              required
              aria-invalid={invalidField === "author" ? true : undefined}
              value={author}
              onChange={(event) => {
                setAuthor(event.target.value);
                if (invalidField === "author") setInvalidField(null);
              }}
              placeholder="e.g., Jorge Luis Borges"
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-edition`}>Edition</label>
            <input
              id={`${formPrefix}-edition`}
              name="edition"
              type="text"
              value={edition}
              onChange={(event) => setEdition(event.target.value)}
              placeholder="e.g., Penguin Classics, 1999"
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-year`}>Publish year</label>
            <input
              ref={publishYearRef}
              id={`${formPrefix}-year`}
              name="publish_year"
              type="number"
              min={MIN_PUBLISH_YEAR}
              max={MAX_PUBLISH_YEAR}
              step={1}
              aria-describedby={`${formPrefix}-year-hint`}
              aria-invalid={invalidField === "publish_year" ? true : undefined}
              value={publishYear}
              onChange={(event) => {
                setPublishYear(event.target.value);
                if (invalidField === "publish_year") setInvalidField(null);
              }}
              placeholder="e.g., 1962 or -375"
            />
            <span
              id={`${formPrefix}-year-hint`}
              className="text-xs italic text-[var(--catalogue-faded-ink)]"
            >
              Negative integers denote BCE (e.g., -375 for 375 BCE).
            </span>
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-shelf`}>
              Shelf <span aria-hidden="true">*</span>
            </label>
            <input
              ref={shelfRef}
              id={`${formPrefix}-shelf`}
              name="shelf"
              type="number"
              min={0}
              step={1}
              required
              aria-invalid={invalidField === "shelf" ? true : undefined}
              value={shelf}
              onChange={(event) => {
                setShelf(event.target.value);
                if (invalidField === "shelf") setInvalidField(null);
              }}
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-position`}>Position</label>
            <input
              id={`${formPrefix}-position`}
              name="position"
              type="text"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              placeholder="e.g., Upper row, 4th from left"
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-division`}>Division</label>
            <input
              id={`${formPrefix}-division`}
              name="top_category"
              type="text"
              list={divisionListId}
              value={topCategory}
              onChange={(event) => setTopCategory(event.target.value)}
              placeholder="e.g., Literature"
            />
            <datalist id={divisionListId}>
              {divisions.map((division) => (
                <option key={division} value={division} />
              ))}
            </datalist>
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-subcategory`}>Sub-category</label>
            <input
              id={`${formPrefix}-subcategory`}
              name="sub_category"
              type="text"
              value={subCategory}
              onChange={(event) => setSubCategory(event.target.value)}
              placeholder="e.g., Latin American Fiction"
            />
          </div>

          <div className="editor-field editor-field--wide">
            <label htmlFor={`${formPrefix}-tags`}>Tags (comma-separated)</label>
            <input
              id={`${formPrefix}-tags`}
              name="tags"
              type="text"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="e.g., labyrinths, metaphysics, argentine fiction"
            />
          </div>

          <div className="editor-field editor-field--wide">
            <label htmlFor={`${formPrefix}-summary`}>Summary</label>
            <textarea
              id={`${formPrefix}-summary`}
              name="summary"
              rows={3}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Short descriptive synopsis of the volume..."
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-status`}>Reading status</label>
            <select
              id={`${formPrefix}-status`}
              name="reading_status"
              value={readingStatus}
              onChange={(event) =>
                setReadingStatus(event.target.value as ReadingStatus)
              }
            >
              {READING_STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {READING_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-rating`}>Rating</label>
            <select
              id={`${formPrefix}-rating`}
              name="rating"
              value={rating}
              onChange={(event) => setRating(event.target.value)}
            >
              <option value="">Unrated</option>
              <option value="1">1 star (★)</option>
              <option value="2">2 stars (★★)</option>
              <option value="3">3 stars (★★★)</option>
              <option value="4">4 stars (★★★★)</option>
              <option value="5">5 stars (★★★★★)</option>
            </select>
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-finished`}>Date finished</label>
            <input
              id={`${formPrefix}-finished`}
              name="date_finished"
              type="date"
              value={dateFinished}
              onChange={(event) => setDateFinished(event.target.value)}
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-loaned`}>Loaned to</label>
            <input
              id={`${formPrefix}-loaned`}
              name="loaned_to"
              type="text"
              value={loanedTo}
              onChange={(event) => setLoanedTo(event.target.value)}
              placeholder="Borrower name"
            />
          </div>

          <div className="editor-field editor-field--wide">
            <label htmlFor={`${formPrefix}-notes`}>Personal notes</label>
            <textarea
              id={`${formPrefix}-notes`}
              name="personal_notes"
              rows={3}
              value={personalNotes}
              onChange={(event) => setPersonalNotes(event.target.value)}
              placeholder="Reading notes or provenance..."
            />
          </div>
        </div>

        <div className="editor-actions">
          <button
            type="button"
            className="pathfinder-btn btn-secondary font-mono"
            onClick={closeDialog}
            disabled={isSaving}
          >
            CANCEL
          </button>
          <button
            type="submit"
            className="pathfinder-btn btn-primary font-mono"
            disabled={isSaving}
          >
            {isSaving
              ? "SAVING..."
              : mode === "create"
                ? "ADD VOLUME"
                : "SAVE CHANGES"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function BookEditorModal({
  mode,
  book,
  divisions,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  mode: "create" | "edit";
  book?: CatalogueBook;
  divisions: string[];
  onClose: () => void;
  onSaved: (
    savedBook: CatalogueBook,
    mode: "create" | "edit",
    previousId?: string,
  ) => void;
  onUnauthorized?: () => void;
}) {
  const titleId = useId();
  const [isSaving, setIsSaving] = useState(false);

  return (
    <ModalDialog
      open
      onClose={onClose}
      labelledBy={titleId}
      closedBy={isSaving ? "none" : "any"}
      preventClose={isSaving}
      className="catalogue-dialog--editor"
    >
      <BookEditorForm
        mode={mode}
        book={book}
        divisions={divisions}
        titleId={titleId}
        onClose={onClose}
        onSaved={onSaved}
        onUnauthorized={onUnauthorized}
        isSaving={isSaving}
        setIsSaving={setIsSaving}
      />
    </ModalDialog>
  );
}
