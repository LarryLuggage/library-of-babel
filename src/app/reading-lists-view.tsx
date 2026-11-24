"use client";

import { useId, useMemo, useRef, useState } from "react";
import {
  compareCatalogueBooks,
  getBookKey,
  READING_STATUS_LABELS,
  type LedgerBook,
} from "@/lib/books/catalogue";
import {
  reorderItemIds,
  sortReadingLists,
  type CreateReadingListInput,
  type ReadingList,
} from "@/lib/books/lists";

export interface ReadingListsViewProps {
  lists: ReadingList[];
  books: LedgerBook[];
  canEdit: boolean;
  onRequireAuth: (reason: string) => void;
  onInspectBook: (book: LedgerBook) => void;
  onStartReading: (book: LedgerBook) => Promise<void>;
  onCreateList: (input: CreateReadingListInput) => Promise<ReadingList>;
  onDeleteList: (listId: string) => Promise<void>;
  onAddBookToList: (listId: string, bookId: string) => Promise<ReadingList>;
  onReorderList: (listId: string, bookIds: string[]) => Promise<ReadingList>;
  onRemoveBookFromList: (listId: string, bookId: string) => Promise<ReadingList>;
}

export function ReadingListsView({
  lists,
  books,
  canEdit,
  onRequireAuth,
  onInspectBook,
  onStartReading,
  onCreateList,
  onDeleteList,
  onAddBookToList,
  onReorderList,
  onRemoveBookFromList,
}: ReadingListsViewProps) {
  const idPrefix = useId();
  const createFormId = `${idPrefix}-create-form`;
  const listNameId = `${idPrefix}-list-name`;
  const listDescId = `${idPrefix}-list-desc`;
  const listQueueId = `${idPrefix}-list-queue`;
  const addBookSelectId = `${idPrefix}-add-book`;

  const sortedLists = useMemo(() => sortReadingLists(lists), [lists]);
  const hasQueueList = useMemo(
    () => sortedLists.some((list) => list.is_queue),
    [sortedLists],
  );

  const [selectedListId, setSelectedListId] = useState<string | null>(
    () => sortedLists[0]?.id ?? null,
  );
  const tabRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  const activeList = useMemo(() => {
    if (sortedLists.length === 0) return null;
    return (
      sortedLists.find((list) => list.id === selectedListId) ?? sortedLists[0]
    );
  }, [selectedListId, sortedLists]);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIsQueue, setNewIsQueue] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingQueue, setIsCreatingQueue] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Active list actions state
  const [selectedBookToAdd, setSelectedBookToAdd] = useState("");
  const [isAddingBook, setIsAddingBook] = useState(false);
  const [addBookError, setAddBookError] = useState<string | null>(null);
  const [confirmingDeleteListId, setConfirmingDeleteListId] = useState<
    string | null
  >(null);
  const [isDeletingList, setIsDeletingList] = useState(false);
  const [busyItemBookId, setBusyItemBookId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);

  const booksById = useMemo(() => {
    const map = new Map<string, LedgerBook>();
    for (const book of books) {
      map.set(book.id, book);
      map.set(getBookKey(book), book);
    }
    return map;
  }, [books]);

  const orderedItems = useMemo(() => {
    if (!activeList) return [];
    return [...activeList.items].sort((a, b) => a.position - b.position);
  }, [activeList]);

  const orderedBookIds = useMemo(
    () => orderedItems.map((item) => item.book_id),
    [orderedItems],
  );

  const availableBooksToAdd = useMemo(() => {
    const existingIds = new Set(orderedBookIds);
    return [...books]
      .filter((book) => !existingIds.has(book.id))
      .sort(compareCatalogueBooks);
  }, [books, orderedBookIds]);

  const handleToggleCreateForm = () => {
    if (!canEdit) {
      onRequireAuth("Sign in as curator to create reading lists or queues.");
      return;
    }
    setCreateError(null);
    setShowCreateForm((prev) => !prev);
  };

  const handleQuickCreateQueue = async () => {
    if (!canEdit) {
      onRequireAuth("Sign in as curator to create the Up Next queue.");
      return;
    }
    setIsCreatingQueue(true);
    try {
      const created = await onCreateList({
        name: "Up Next",
        description: "Ranked volumes queued to read next.",
        is_queue: true,
      });
      setSelectedListId(created.id);
    } catch {
      // Error toast is handled by parent
    } finally {
      setIsCreatingQueue(false);
    }
  };

  const handleCreateListSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setCreateError(null);

    if (!newName.trim()) {
      setCreateError("Please enter a name for the reading list.");
      return;
    }

    setIsCreating(true);
    try {
      const created = await onCreateList({
        name: newName.trim(),
        description: newDescription.trim() || null,
        is_queue: newIsQueue,
      });
      setNewName("");
      setNewDescription("");
      setNewIsQueue(false);
      setShowCreateForm(false);
      setSelectedListId(created.id);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Could not create list.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleListTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (sortedLists.length <= 1) return;
    let nextIndex = -1;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % sortedLists.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + sortedLists.length) % sortedLists.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = sortedLists.length - 1;
    }
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextList = sortedLists[nextIndex];
    setSelectedListId(nextList.id);
    setConfirmingDeleteListId(null);
    setAddBookError(null);
    tabRefs.current.get(nextList.id)?.focus();
  };

  const handleAddBookSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!activeList) return;
    setAddBookError(null);

    if (!selectedBookToAdd) {
      setAddBookError("Please choose a volume to add.");
      return;
    }

    setIsAddingBook(true);
    try {
      await onAddBookToList(activeList.id, selectedBookToAdd);
      setSelectedBookToAdd("");
    } catch (error) {
      setAddBookError(
        error instanceof Error
          ? error.message
          : "Could not add volume to list.",
      );
    } finally {
      setIsAddingBook(false);
    }
  };

  const handleConfirmDeleteList = async (listId: string) => {
    setIsDeletingList(true);
    try {
      await onDeleteList(listId);
      setConfirmingDeleteListId(null);
      if (selectedListId === listId) {
        setSelectedListId(null);
      }
    } catch {
      // Error toast is handled by parent
    } finally {
      setIsDeletingList(false);
    }
  };

  const handleMoveItem = async (bookId: string, direction: "up" | "down") => {
    if (!activeList) return;
    const nextIds = reorderItemIds(orderedBookIds, bookId, direction);
    setIsReordering(true);
    try {
      await onReorderList(activeList.id, nextIds);
    } catch {
      // Error toast is handled by parent
    } finally {
      setIsReordering(false);
    }
  };

  const handleRemoveItem = async (bookId: string) => {
    if (!activeList) return;
    setBusyItemBookId(bookId);
    try {
      await onRemoveBookFromList(activeList.id, bookId);
    } catch {
      // Error toast is handled by parent
    } finally {
      setBusyItemBookId(null);
    }
  };

  const handleStartReadingItem = async (book: LedgerBook) => {
    if (!canEdit) {
      onRequireAuth("Sign in as curator to mark volumes as currently reading.");
      return;
    }
    setBusyItemBookId(book.id);
    try {
      await onStartReading(book);
    } catch {
      // Error toast is handled by parent
    } finally {
      setBusyItemBookId(null);
    }
  };

  return (
    <section
      className="reading-lists-view"
      aria-labelledby={`${idPrefix}-heading`}
    >
      <header className="reading-lists-header">
        <div className="reading-lists-heading-copy">
          <p className="commonplace-kicker">Curated shelves &amp; syllabi</p>
          <h2 id={`${idPrefix}-heading`}>Reading Lists &amp; Queues</h2>
          <p className="commonplace-count font-mono">
            {sortedLists.length}{" "}
            {sortedLists.length === 1 ? "reading list" : "reading lists"}
          </p>
        </div>

        <div className="reading-lists-header-actions">
          {!hasQueueList && (
            <button
              type="button"
              className="btn-action-secondary font-mono reading-lists-header-btn"
              disabled={isCreatingQueue}
              onClick={() => void handleQuickCreateQueue()}
            >
              {isCreatingQueue ? "Creating..." : "+ Create Up Next queue"}
            </button>
          )}
          <button
            type="button"
            className="pathfinder-btn btn-primary font-mono reading-lists-header-btn"
            aria-expanded={canEdit && showCreateForm}
            aria-controls={createFormId}
            onClick={handleToggleCreateForm}
          >
            {canEdit && showCreateForm ? "Close form" : "+ New reading list"}
          </button>
        </div>
      </header>

      {canEdit && showCreateForm && (
        <form
          id={createFormId}
          className="reading-list-form"
          onSubmit={handleCreateListSubmit}
          noValidate
        >
          <h3 className="commonplace-form-title">Create a reading list</h3>

          <div className="commonplace-form-field">
            <label htmlFor={listNameId}>
              List name <span aria-hidden="true">*</span>
            </label>
            <input
              id={listNameId}
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="e.g. Autumn Philosophy, Up Next, Borgesian Labyrinths"
              required
            />
          </div>

          <div className="commonplace-form-field">
            <label htmlFor={listDescId}>Description</label>
            <textarea
              id={listDescId}
              rows={2}
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder="Optional theme, syllabus notes, or reading goals..."
            />
          </div>

          <div className="reading-list-checkbox-row">
            <input
              id={listQueueId}
              type="checkbox"
              checked={newIsQueue}
              onChange={(event) => setNewIsQueue(event.target.checked)}
            />
            <label htmlFor={listQueueId}>
              Ranked queue (e.g., Up Next)
            </label>
          </div>

          {createError && (
            <p className="tracker-feedback tracker-feedback--error" role="alert">
              {createError}
            </p>
          )}

          <div className="commonplace-form-actions">
            <button
              type="submit"
              className="btn-tracker-save"
              disabled={isCreating}
            >
              {isCreating ? "Creating..." : "Create list"}
            </button>
            <button
              type="button"
              className="btn-action-secondary"
              disabled={isCreating}
              onClick={() => {
                setShowCreateForm(false);
                setCreateError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {sortedLists.length === 0 ? (
        <div className="commonplace-empty">
          <p>
            No reading lists or queues have been created yet. Start an{" "}
            <strong>Up Next</strong> queue or assemble a thematic reading list.
          </p>
          <div className="reading-lists-empty-actions">
            <button
              type="button"
              className="pathfinder-btn btn-primary font-mono"
              disabled={isCreatingQueue}
              onClick={() => void handleQuickCreateQueue()}
            >
              + Create Up Next queue
            </button>
            <button
              type="button"
              className="btn-action-secondary font-mono"
              onClick={handleToggleCreateForm}
            >
              + New reading list
            </button>
          </div>
        </div>
      ) : (
        <div className="reading-lists-body">
          <div
            className="reading-list-pills"
            role="tablist"
            aria-label="Select reading list"
          >
            {sortedLists.map((list, index) => {
              const isSelected = activeList?.id === list.id;
              return (
                <button
                  key={list.id}
                  ref={(node) => {
                    tabRefs.current.set(list.id, node);
                  }}
                  id={`${idPrefix}-list-tab-${list.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls={`${idPrefix}-list-panel-${list.id}`}
                  tabIndex={isSelected ? 0 : -1}
                  className="reading-list-pill"
                  onClick={() => {
                    setSelectedListId(list.id);
                    setConfirmingDeleteListId(null);
                    setAddBookError(null);
                  }}
                  onKeyDown={(event) => handleListTabKeyDown(event, index)}
                >
                  <span className="reading-list-pill-name">{list.name}</span>
                  {list.is_queue && (
                    <span className="reading-list-queue-badge font-mono">
                      Queue
                    </span>
                  )}
                  <span className="reading-list-pill-count font-mono">
                    {list.items.length}
                  </span>
                </button>
              );
            })}
          </div>

          {activeList && (
            <div
              role="tabpanel"
              id={`${idPrefix}-list-panel-${activeList.id}`}
              aria-labelledby={`${idPrefix}-list-tab-${activeList.id}`}
              className="reading-list-panel"
            >
              <div className="reading-list-panel-head">
                <div className="reading-list-panel-title-wrap">
                  <div className="reading-list-panel-title-row">
                    <h3>{activeList.name}</h3>
                    {activeList.is_queue && (
                      <span className="reading-list-queue-badge font-mono">
                        Ranked Queue
                      </span>
                    )}
                  </div>
                  {activeList.description && (
                    <p className="reading-list-panel-desc">
                      {activeList.description}
                    </p>
                  )}
                </div>

                {canEdit && (
                  <div className="reading-list-panel-delete">
                    {confirmingDeleteListId === activeList.id ? (
                      <div className="commonplace-delete-confirm">
                        <button
                          type="button"
                          className="btn-action-danger commonplace-action-btn"
                          disabled={isDeletingList}
                          onClick={() =>
                            void handleConfirmDeleteList(activeList.id)
                          }
                          aria-label={`Confirm delete reading list ${activeList.name}`}
                        >
                          {isDeletingList ? "Deleting..." : "Confirm delete"}
                        </button>
                        <button
                          type="button"
                          className="btn-action-secondary commonplace-action-btn"
                          disabled={isDeletingList}
                          onClick={() => setConfirmingDeleteListId(null)}
                          aria-label={`Cancel deleting reading list ${activeList.name}`}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-action-danger-outline commonplace-action-btn"
                        onClick={() =>
                          setConfirmingDeleteListId(activeList.id)
                        }
                        aria-label={`Delete reading list ${activeList.name}`}
                      >
                        Delete list
                      </button>
                    )}
                  </div>
                )}
              </div>

              {canEdit && (
                <form
                  className="reading-list-add-form"
                  onSubmit={handleAddBookSubmit}
                  noValidate
                >
                  <div className="commonplace-form-field reading-list-add-select-wrap">
                    <label htmlFor={addBookSelectId}>
                      Add volume to list
                    </label>
                    <select
                      id={addBookSelectId}
                      value={selectedBookToAdd}
                      onChange={(event) => {
                        setSelectedBookToAdd(event.target.value);
                        setAddBookError(null);
                      }}
                      disabled={
                        isAddingBook || availableBooksToAdd.length === 0
                      }
                    >
                      <option value="">
                        {availableBooksToAdd.length === 0
                          ? "All catalogue volumes are already in this list"
                          : "Choose a volume to add..."}
                      </option>
                      {availableBooksToAdd.map((book) => (
                        <option key={book.id} value={book.id}>
                          {book.author} — {book.title} (Shelf {book.shelf})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="btn-tracker-save reading-list-add-submit"
                    disabled={
                      isAddingBook ||
                      !selectedBookToAdd ||
                      availableBooksToAdd.length === 0
                    }
                  >
                    {isAddingBook ? "Adding..." : "Add volume"}
                  </button>
                  {addBookError && (
                    <p
                      className="tracker-feedback tracker-feedback--error reading-list-add-error"
                      role="alert"
                    >
                      {addBookError}
                    </p>
                  )}
                </form>
              )}

              {orderedItems.length === 0 ? (
                <div className="commonplace-empty">
                  <p>
                    This {activeList.is_queue ? "queue" : "list"} has no volumes
                    yet.
                    {canEdit
                      ? " Choose a volume above or queue picks from Read Next."
                      : " Sign in as curator to add volumes."}
                  </p>
                </div>
              ) : (
                <ol className="reading-list-items">
                  {orderedItems.map((item, index) => {
                    const book = booksById.get(item.book_id) ?? null;
                    const titleLabel = book ? book.title : item.book_id;
                    const isFirst = index === 0;
                    const isLast = index === orderedItems.length - 1;
                    const isBusy =
                      isReordering || busyItemBookId === item.book_id;

                    return (
                      <li key={item.id} className="reading-list-item-row">
                        <span
                          className={`reading-list-rank font-mono ${
                            activeList.is_queue
                              ? "reading-list-rank--queue"
                              : ""
                          }`}
                          aria-label={`Position ${index + 1}`}
                        >
                          #{index + 1}
                        </span>

                        <div className="reading-list-item-main">
                          {book ? (
                            <>
                              <h4 className="reading-list-item-title">
                                <cite>{book.title}</cite>
                              </h4>
                              <p className="reading-list-item-author">
                                {book.author}
                              </p>
                              <div className="reading-list-item-meta font-mono">
                                <span>
                                  Shelf {book.shelf} · Pos.{" "}
                                  {book.position || "—"}
                                </span>
                                <span
                                  className={`ledger-badge ledger-badge--status ledger-badge--${book.reading_status}`}
                                >
                                  {READING_STATUS_LABELS[book.reading_status]}
                                </span>
                              </div>
                            </>
                          ) : (
                            <p className="reading-list-item-title">
                              Volume ({item.book_id})
                            </p>
                          )}
                          {item.note && (
                            <p className="reading-list-item-note">
                              {item.note}
                            </p>
                          )}
                        </div>

                        <div className="reading-list-item-actions">
                          {book && (
                            <button
                              type="button"
                              className="btn-action-secondary commonplace-action-btn"
                              onClick={() => onInspectBook(book)}
                              aria-label={`Inspect ${book.title} by ${book.author}`}
                            >
                              Inspect
                            </button>
                          )}

                          {book && book.reading_status === "unread" && (
                            <button
                              type="button"
                              className="pathfinder-btn btn-primary commonplace-action-btn font-mono"
                              disabled={isBusy}
                              onClick={() => void handleStartReadingItem(book)}
                              aria-label={`Mark ${book.title} as currently reading`}
                            >
                              Start reading
                            </button>
                          )}

                          {canEdit && (
                            <>
                              <button
                                type="button"
                                className="btn-link-toggle font-mono reading-list-move-btn"
                                disabled={isFirst || isBusy}
                                onClick={() =>
                                  void handleMoveItem(item.book_id, "up")
                                }
                                aria-label={`Move ${titleLabel} up in ${activeList.name}`}
                              >
                                Move up
                              </button>
                              <button
                                type="button"
                                className="btn-link-toggle font-mono reading-list-move-btn"
                                disabled={isLast || isBusy}
                                onClick={() =>
                                  void handleMoveItem(item.book_id, "down")
                                }
                                aria-label={`Move ${titleLabel} down in ${activeList.name}`}
                              >
                                Move down
                              </button>
                              <button
                                type="button"
                                className="btn-action-danger-outline commonplace-action-btn"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleRemoveItem(item.book_id)
                                }
                                aria-label={`Remove ${titleLabel} from ${activeList.name}`}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
