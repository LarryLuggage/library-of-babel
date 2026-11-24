"use client";

import { useId, useMemo, useState } from "react";
import {
  compareCatalogueBooks,
  getBookKey,
  type LedgerBook,
} from "@/lib/books/catalogue";
import {
  buildQuoteTagList,
  filterQuotes,
  type BookQuote,
  type CreateQuoteInput,
} from "@/lib/books/commonplace";

export interface CommonplaceViewProps {
  quotes: BookQuote[];
  books: LedgerBook[];
  canEdit: boolean;
  onRequireAuth: (reason: string) => void;
  onInspectBook: (book: LedgerBook) => void;
  onCreateQuote: (input: CreateQuoteInput) => Promise<BookQuote>;
  onDeleteQuote: (quoteId: string) => Promise<void>;
}

function parseTagInput(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const segment of raw.split(",")) {
    const cleaned = segment.trim().replace(/\s+/g, " ");
    const key = cleaned.toLocaleLowerCase("en-US");
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

export function CommonplaceView({
  quotes,
  books,
  canEdit,
  onRequireAuth,
  onInspectBook,
  onCreateQuote,
  onDeleteQuote,
}: CommonplaceViewProps) {
  const idPrefix = useId();
  const searchInputId = `${idPrefix}-search`;
  const tagSelectId = `${idPrefix}-tag`;
  const addFormId = `${idPrefix}-add-form`;
  const bookSelectId = `${idPrefix}-book`;
  const quoteTextId = `${idPrefix}-quote-text`;
  const pageInputId = `${idPrefix}-page`;
  const chapterInputId = `${idPrefix}-chapter`;
  const tagsInputId = `${idPrefix}-tags`;
  const noteInputId = `${idPrefix}-note`;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  // Add Quote form state
  const [bookId, setBookId] = useState("");
  const [quoteText, setQuoteText] = useState("");
  const [pageNumber, setPageNumber] = useState("");
  const [chapter, setChapter] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 2-step delete confirmation state
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);

  const sortedBooks = useMemo(
    () => [...books].sort(compareCatalogueBooks),
    [books],
  );

  const booksById = useMemo(() => {
    const map = new Map<string, LedgerBook>();
    for (const book of books) {
      map.set(book.id, book);
      map.set(getBookKey(book), book);
    }
    return map;
  }, [books]);

  const availableTags = useMemo(() => buildQuoteTagList(quotes), [quotes]);

  const filteredQuotes = useMemo(
    () =>
      filterQuotes(quotes, booksById, {
        query: searchQuery.trim() || undefined,
        tag: selectedTag || undefined,
      }),
    [booksById, quotes, searchQuery, selectedTag],
  );

  const hasFilters = Boolean(searchQuery.trim() || selectedTag);

  const handleToggleAddForm = () => {
    if (!canEdit) {
      onRequireAuth(
        "Sign in as curator to save passages to the Commonplace Book.",
      );
      return;
    }
    setFormError(null);
    setShowAddForm((prev) => !prev);
  };

  const handleSubmitQuote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!bookId) {
      setFormError("Please select a volume from the catalogue.");
      return;
    }
    if (!quoteText.trim()) {
      setFormError("Please enter a quote passage.");
      return;
    }

    setIsSaving(true);
    try {
      await onCreateQuote({
        book_id: bookId,
        quote_text: quoteText.trim(),
        page_number: pageNumber.trim() || null,
        chapter: chapter.trim() || null,
        note: note.trim() || null,
        tags: parseTagInput(tagsRaw),
      });
      setBookId("");
      setQuoteText("");
      setPageNumber("");
      setChapter("");
      setTagsRaw("");
      setNote("");
      setShowAddForm(false);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not save passage.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async (quoteId: string) => {
    setDeletingQuoteId(quoteId);
    try {
      await onDeleteQuote(quoteId);
      setConfirmingDeleteId(null);
    } catch {
      // Error toast is handled by parent
    } finally {
      setDeletingQuoteId(null);
    }
  };

  return (
    <section
      className="commonplace-view"
      aria-labelledby={`${idPrefix}-heading`}
    >
      <header className="commonplace-header">
        <div className="commonplace-heading-copy">
          <p className="commonplace-kicker">Excerpts &amp; marginalia</p>
          <h2 id={`${idPrefix}-heading`}>Commonplace Book</h2>
          <p className="commonplace-count font-mono">
            {quotes.length}{" "}
            {quotes.length === 1 ? "saved passage" : "saved passages"}
            {hasFilters &&
              ` · showing ${filteredQuotes.length} matching`}
          </p>
        </div>

        <button
          type="button"
          className="pathfinder-btn btn-primary font-mono commonplace-add-toggle"
          aria-expanded={canEdit && showAddForm}
          aria-controls={addFormId}
          onClick={handleToggleAddForm}
        >
          {canEdit && showAddForm ? "Close form" : "+ Add quote"}
        </button>
      </header>

      {canEdit && showAddForm && (
        <form
          id={addFormId}
          className="commonplace-form"
          onSubmit={handleSubmitQuote}
          noValidate
        >
          <h3 className="commonplace-form-title">Record a passage</h3>

          <div className="commonplace-form-field">
            <label htmlFor={bookSelectId}>
              Volume <span aria-hidden="true">*</span>
            </label>
            <select
              id={bookSelectId}
              value={bookId}
              onChange={(event) => setBookId(event.target.value)}
              required
            >
              <option value="">Select a catalogue volume...</option>
              {sortedBooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.author} — {book.title} (Shelf {book.shelf})
                </option>
              ))}
            </select>
          </div>

          <div className="commonplace-form-field">
            <label htmlFor={quoteTextId}>
              Quote passage <span aria-hidden="true">*</span>
            </label>
            <textarea
              id={quoteTextId}
              rows={4}
              value={quoteText}
              onChange={(event) => setQuoteText(event.target.value)}
              placeholder="Transcribe a memorable sentence, epigraph, or passage..."
              required
            />
          </div>

          <div className="commonplace-form-grid">
            <div className="commonplace-form-field">
              <label htmlFor={pageInputId}>Page</label>
              <input
                id={pageInputId}
                type="text"
                value={pageNumber}
                onChange={(event) => setPageNumber(event.target.value)}
                placeholder="e.g. 42 or 118–119"
              />
            </div>

            <div className="commonplace-form-field">
              <label htmlFor={chapterInputId}>Chapter</label>
              <input
                id={chapterInputId}
                type="text"
                value={chapter}
                onChange={(event) => setChapter(event.target.value)}
                placeholder="e.g. Chapter IV"
              />
            </div>

            <div className="commonplace-form-field commonplace-form-field--wide">
              <label htmlFor={tagsInputId}>Tags (comma-separated)</label>
              <input
                id={tagsInputId}
                type="text"
                value={tagsRaw}
                onChange={(event) => setTagsRaw(event.target.value)}
                placeholder="memory, labyrinth, metaphysics"
              />
            </div>
          </div>

          <div className="commonplace-form-field">
            <label htmlFor={noteInputId}>Reflection / Marginalia</label>
            <textarea
              id={noteInputId}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Personal commentary or cross-reference..."
            />
          </div>

          {formError && (
            <p className="tracker-feedback tracker-feedback--error" role="alert">
              {formError}
            </p>
          )}

          <div className="commonplace-form-actions">
            <button
              type="submit"
              className="btn-tracker-save"
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save quote"}
            </button>
            <button
              type="button"
              className="btn-action-secondary"
              disabled={isSaving}
              onClick={() => {
                setShowAddForm(false);
                setFormError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="commonplace-controls">
        <div className="commonplace-filter-field commonplace-filter-field--search">
          <label htmlFor={searchInputId}>Search passages</label>
          <input
            id={searchInputId}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search quotes, authors, notes..."
          />
        </div>

        <div className="commonplace-filter-field">
          <label htmlFor={tagSelectId}>Filter by tag</label>
          <select
            id={tagSelectId}
            value={selectedTag}
            onChange={(event) => setSelectedTag(event.target.value)}
          >
            <option value="">All tags</option>
            {selectedTag && !availableTags.includes(selectedTag) && (
              <option value={selectedTag}>{selectedTag}</option>
            )}
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <div className="commonplace-filter-clear">
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => {
                setSearchQuery("");
                setSelectedTag("");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {quotes.length === 0 ? (
        <div className="commonplace-empty">
          <p>
            Your Commonplace Book is ready for its first transcription. Save a
            passage from any volume&apos;s detail card or add one directly here.
          </p>
          <button
            type="button"
            className="pathfinder-btn btn-primary font-mono"
            onClick={handleToggleAddForm}
          >
            + Add your first quote
          </button>
        </div>
      ) : filteredQuotes.length === 0 ? (
        <div className="commonplace-empty">
          <p>No saved passages match the current search or tag filter.</p>
          <button
            type="button"
            className="clear-search-btn"
            onClick={() => {
              setSearchQuery("");
              setSelectedTag("");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ol className="commonplace-list">
          {filteredQuotes.map((quote) => {
            const book = booksById.get(quote.book_id) ?? null;
            const bookLabel = book ? book.title : "volume";
            const isConfirming = confirmingDeleteId === quote.id;
            const isDeleting = deletingQuoteId === quote.id;

            return (
              <li key={quote.id} className="commonplace-card">
                <figure className="commonplace-figure">
                  <blockquote className="commonplace-blockquote">
                    <p>{quote.quote_text}</p>
                  </blockquote>
                  <figcaption className="commonplace-citation font-mono">
                    {book ? (
                      <>
                        <cite>{book.title}</cite> · {book.author} · Shelf{" "}
                        {book.shelf}
                      </>
                    ) : (
                      <span>Catalogue volume ({quote.book_id})</span>
                    )}
                    {quote.page_number && <> · p. {quote.page_number}</>}
                    {quote.chapter && <> · {quote.chapter}</>}
                  </figcaption>
                </figure>

                {quote.note && (
                  <p className="commonplace-note">{quote.note}</p>
                )}

                {quote.tags.length > 0 && (
                  <div
                    className="commonplace-tags"
                    aria-label="Passage tags"
                  >
                    {quote.tags.map((tag) => {
                      const isActive = selectedTag === tag;
                      return (
                        <button
                          key={tag}
                          type="button"
                          className="commonplace-tag-pill font-mono"
                          aria-pressed={isActive}
                          onClick={() =>
                            setSelectedTag((prev) =>
                              prev === tag ? "" : tag,
                            )
                          }
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="commonplace-actions">
                  {book && (
                    <button
                      type="button"
                      className="btn-action-secondary commonplace-action-btn"
                      onClick={() => onInspectBook(book)}
                      aria-label={`Inspect ${book.title} by ${book.author}`}
                    >
                      Inspect volume
                    </button>
                  )}

                  {canEdit &&
                    (isConfirming ? (
                      <div className="commonplace-delete-confirm">
                        <button
                          type="button"
                          className="btn-action-danger commonplace-action-btn"
                          disabled={isDeleting}
                          onClick={() => void handleConfirmDelete(quote.id)}
                          aria-label={`Confirm delete quote from ${bookLabel}`}
                        >
                          {isDeleting ? "Deleting..." : "Confirm delete"}
                        </button>
                        <button
                          type="button"
                          className="btn-action-secondary commonplace-action-btn"
                          disabled={isDeleting}
                          onClick={() => setConfirmingDeleteId(null)}
                          aria-label="Cancel deleting quote"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-action-danger-outline commonplace-action-btn"
                        onClick={() => setConfirmingDeleteId(quote.id)}
                        aria-label={`Delete quote from ${bookLabel}`}
                      >
                        Delete
                      </button>
                    ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
