"use client";

import { useId, useRef, useState } from "react";
import {
  READING_STATUS_LABELS,
  READING_STATUS_VALUES,
  type CatalogueBook,
  type ReadingStatus,
} from "@/lib/books/catalogue";
import { ModalDialog, useDialogClose } from "./modal-dialog";

function BookEditorForm({
  mode,
  book,
  divisions,
  titleId,
  onClose,
  onSaved,
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
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
}) {
  const closeDialog = useDialogClose() ?? onClose;
  const formPrefix = useId();
  const divisionListId = `${formPrefix}-divisions`;

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg("");

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMsg("Title is required.");
      titleRef.current?.focus();
      return;
    }

    const trimmedAuthor = author.trim();
    if (!trimmedAuthor) {
      setErrorMsg("Author is required.");
      authorRef.current?.focus();
      return;
    }

    const parsedShelf = Number.parseInt(shelf.trim(), 10);
    if (!Number.isInteger(parsedShelf) || parsedShelf < 0) {
      setErrorMsg("Shelf must be a whole number (0 or greater).");
      shelfRef.current?.focus();
      return;
    }

    let parsedYear: number | null = null;
    if (publishYear.trim()) {
      const yearNum = Number(publishYear.trim());
      if (!Number.isInteger(yearNum) || yearNum < -3000 || yearNum > 2100) {
        setErrorMsg("Publish year must be a valid integer year.");
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
        issues?: Array<string | { message?: string; path?: Array<string | number> }>;
      };

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

      <form className="editor-form" onSubmit={handleSubmit} noValidate>
        <div className="editor-grid">
          <div className="editor-field editor-field--wide">
            <label htmlFor={`${formPrefix}-title`}>
              Title <span aria-hidden="true">*</span>
            </label>
            <input
              ref={titleRef}
              id={`${formPrefix}-title`}
              type="text"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
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
              type="text"
              required
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              placeholder="e.g., Jorge Luis Borges"
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-edition`}>Edition</label>
            <input
              id={`${formPrefix}-edition`}
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
              type="number"
              min={-3000}
              max={2100}
              step={1}
              value={publishYear}
              onChange={(event) => setPublishYear(event.target.value)}
              placeholder="e.g., 1962"
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-shelf`}>
              Shelf <span aria-hidden="true">*</span>
            </label>
            <input
              ref={shelfRef}
              id={`${formPrefix}-shelf`}
              type="number"
              min={0}
              step={1}
              required
              value={shelf}
              onChange={(event) => setShelf(event.target.value)}
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-position`}>Position</label>
            <input
              id={`${formPrefix}-position`}
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
              type="date"
              value={dateFinished}
              onChange={(event) => setDateFinished(event.target.value)}
            />
          </div>

          <div className="editor-field">
            <label htmlFor={`${formPrefix}-loaned`}>Loaned to</label>
            <input
              id={`${formPrefix}-loaned`}
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
        isSaving={isSaving}
        setIsSaving={setIsSaving}
      />
    </ModalDialog>
  );
}
