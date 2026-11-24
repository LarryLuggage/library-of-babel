"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  compareCatalogueBooks,
  filterDisplayTags,
  formatPublishYear,
  getBookKey,
  getNearestConnections,
  READING_STATUS_LABELS,
  READING_STATUS_VALUES,
  type CatalogueBook,
  type LedgerBook,
  type ReadingStatus,
} from "@/lib/books/catalogue";
import {
  CONNECTION_TYPES,
  CONNECTION_TYPE_LABELS,
  type ConnectionType,
  type EditorialConnection,
} from "@/lib/books/connections";
import type { BookQuote, CreateQuoteInput } from "@/lib/books/commonplace";
import {
  getListsForBook,
  sortReadingLists,
  type ReadingList,
} from "@/lib/books/lists";
import type { LookupCandidate } from "@/lib/books/lookup";
import { ModalDialog, useDialogClose } from "./modal-dialog";

function formatLookupSource(
  source: LookupCandidate["source"] | string,
): string {
  switch (source) {
    case "open_library":
      return "Open Library";
    case "google_books":
      return "Google Books";
    case "wikipedia":
      return "Wikipedia";
    default:
      return source;
  }
}

type EnrichFieldKey = "summary" | "publish_year" | "tags" | "edition";

type EnrichFieldSelection = Record<EnrichFieldKey, boolean>;

function getDefaultEnrichSelection(
  book: LedgerBook,
  displayTags: readonly string[],
  candidate: LookupCandidate | undefined,
): EnrichFieldSelection {
  if (!candidate) {
    return {
      summary: false,
      publish_year: false,
      tags: false,
      edition: false,
    };
  }

  return {
    summary: !book.summary?.trim() && Boolean(candidate.summary?.trim()),
    publish_year: book.publish_year === null && candidate.publish_year !== null,
    tags: displayTags.length === 0 && candidate.tags.length > 0,
    edition: !book.edition.trim() && Boolean(candidate.edition.trim()),
  };
}

function candidateHasAnyEnrichableField(
  candidate: LookupCandidate | undefined,
): boolean {
  if (!candidate) {
    return false;
  }
  return Boolean(
    candidate.summary?.trim() ||
      candidate.publish_year !== null ||
      candidate.tags.length > 0 ||
      candidate.edition.trim(),
  );
}

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
    | "edition"
    | "summary"
    | "publish_year"
    | "tags"
    | "reading_status"
    | "rating"
    | "date_started"
    | "date_finished"
    | "personal_notes"
    | "loaned_to"
  >
>;

export type CreateEditorialConnectionInput = {
  source_book_id: string;
  target_book_id: string;
  connection_type: ConnectionType;
  description: string | null;
  weight?: number;
};

function BookDetailContent({
  book,
  books,
  canEdit,
  onRequireAuth,
  connections,
  onCreateConnection,
  onDeleteConnection,
  quotes = [],
  lists = [],
  onCreateQuote,
  onDeleteQuote,
  onAddBookToList,
  onRemoveBookFromList,
  onQueueUpNext,
  titleId,
  onBookClick,
  onClose,
  onStartPath,
  onRecommendSimilar,
  onTagClick,
  onEditBook,
  onUpdateBook,
  onDeleteBook,
}: {
  book: LedgerBook;
  books: LedgerBook[];
  canEdit: boolean;
  onRequireAuth: () => void;
  connections: EditorialConnection[];
  onCreateConnection: (
    input: CreateEditorialConnectionInput,
  ) => Promise<EditorialConnection>;
  onDeleteConnection: (connectionId: string) => Promise<void>;
  quotes?: BookQuote[];
  lists?: ReadingList[];
  onCreateQuote?: (input: CreateQuoteInput) => Promise<BookQuote>;
  onDeleteQuote?: (quoteId: string) => Promise<void>;
  onAddBookToList?: (listId: string, bookId: string) => Promise<ReadingList>;
  onRemoveBookFromList?: (listId: string, bookId: string) => Promise<ReadingList>;
  onQueueUpNext?: (book: CatalogueBook) => Promise<void>;
  titleId: string;
  onBookClick: (book: LedgerBook) => void;
  onClose: () => void;
  onStartPath: () => void;
  onRecommendSimilar?: () => void;
  onTagClick: (tag: string) => void;
  onEditBook: () => void;
  onUpdateBook: (bookId: string, patch: BookUpdatePatch) => Promise<CatalogueBook>;
  onDeleteBook: (bookId: string, bookTitle: string) => Promise<void>;
}) {
  const closeDialog = useDialogClose() ?? onClose;
  const idPrefix = useId();
  const dateFinishedId = `${idPrefix}-date-finished`;
  const loanedToId = `${idPrefix}-loaned-to`;
  const personalNotesId = `${idPrefix}-personal-notes`;
  const addLinkFormId = `${idPrefix}-add-link-form`;
  const targetPickerId = `${idPrefix}-link-target`;
  const targetListboxId = `${idPrefix}-link-target-options`;
  const connectionTypeId = `${idPrefix}-link-type`;
  const connectionNoteId = `${idPrefix}-link-note`;
  const enrichPanelId = `${idPrefix}-enrich-panel`;
  const enrichSummaryCheckId = `${idPrefix}-enrich-summary`;
  const enrichYearCheckId = `${idPrefix}-enrich-year`;
  const enrichTagsCheckId = `${idPrefix}-enrich-tags`;
  const enrichEditionCheckId = `${idPrefix}-enrich-edition`;
  const addToListSelectId = `${idPrefix}-add-to-list`;
  const addQuoteFormId = `${idPrefix}-add-quote-form`;
  const quoteTextId = `${idPrefix}-quote-text`;
  const quotePageId = `${idPrefix}-quote-page`;
  const quoteTagsId = `${idPrefix}-quote-tags`;
  const quoteNoteId = `${idPrefix}-quote-note`;

  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const targetPickerRef = useRef<HTMLDivElement>(null);
  const enrichAbortRef = useRef<AbortController | null>(null);
  const latestBookIdRef = useRef(book.id);

  useEffect(() => {
    latestBookIdRef.current = book.id;
    return () => {
      enrichAbortRef.current?.abort();
      enrichAbortRef.current = null;
    };
  }, [book.id]);

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

  // Curated editorial link form state
  const [showAddLinkForm, setShowAddLinkForm] = useState(false);
  const [targetSearch, setTargetSearch] = useState("");
  const [selectedTargetBook, setSelectedTargetBook] =
    useState<LedgerBook | null>(null);
  const [showTargetDropdown, setShowTargetDropdown] = useState(false);
  const [targetHighlight, setTargetHighlight] = useState(-1);
  const [connectionType, setConnectionType] =
    useState<ConnectionType>("paired_reading");
  const [connectionNote, setConnectionNote] = useState("");
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [deletingConnectionId, setDeletingConnectionId] = useState<
    string | null
  >(null);
  const [linkStatus, setLinkStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  // Reading lists & Commonplace quotes state
  const [selectedListToAdd, setSelectedListToAdd] = useState("");
  const [isUpdatingList, setIsUpdatingList] = useState(false);
  const [isQueueingUpNext, setIsQueueingUpNext] = useState(false);
  const [listFeedback, setListFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const [showAddQuoteForm, setShowAddQuoteForm] = useState(false);
  const [quoteText, setQuoteText] = useState("");
  const [quotePage, setQuotePage] = useState("");
  const [quoteTagsRaw, setQuoteTagsRaw] = useState("");
  const [quoteNote, setQuoteNote] = useState("");
  const [isSavingQuote, setIsSavingQuote] = useState(false);
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);
  const [quoteFeedback, setQuoteFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  // 1-Click Enrich via Lookup state
  const [syncedEnrichBookId, setSyncedEnrichBookId] = useState(book.id);
  const [isEnrichOpen, setIsEnrichOpen] = useState(false);
  const [isFetchingEnrich, setIsFetchingEnrich] = useState(false);
  const [hasFetchedEnrich, setHasFetchedEnrich] = useState(false);
  const [enrichCandidates, setEnrichCandidates] = useState<LookupCandidate[]>(
    [],
  );
  const [enrichCandidateIndex, setEnrichCandidateIndex] = useState(0);
  const [selectedEnrichFields, setSelectedEnrichFields] =
    useState<EnrichFieldSelection>({
      summary: false,
      publish_year: false,
      tags: false,
      edition: false,
    });
  const [isApplyingEnrich, setIsApplyingEnrich] = useState(false);
  const [enrichError, setEnrichError] = useState("");
  const [enrichNotice, setEnrichNotice] = useState("");

  if (syncedEnrichBookId !== book.id) {
    setSyncedEnrichBookId(book.id);
    setIsEnrichOpen(false);
    setIsFetchingEnrich(false);
    setHasFetchedEnrich(false);
    setEnrichCandidates([]);
    setEnrichCandidateIndex(0);
    setSelectedEnrichFields({
      summary: false,
      publish_year: false,
      tags: false,
      edition: false,
    });
    setIsApplyingEnrich(false);
    setEnrichError("");
    setEnrichNotice("");
  }

  const displayTags = useMemo(
    () => filterDisplayTags(book.tags),
    [book.tags],
  );

  const isMissingEnrichableMetadata =
    !book.summary?.trim() ||
    book.publish_year === null ||
    displayTags.length === 0;

  const currentBookKey = getBookKey(book);

  const booksByKey = useMemo(() => {
    const map = new Map<string, LedgerBook>();
    for (const candidate of books) {
      map.set(getBookKey(candidate), candidate);
      if (candidate.id) {
        map.set(candidate.id, candidate);
      }
    }
    return map;
  }, [books]);

  const relatedBooks = useMemo(
    () =>
      getNearestConnections(book, books, 3, undefined, connections)
        .map((connection) => booksByKey.get(getBookKey(connection.book)))
        .filter((candidate): candidate is LedgerBook => Boolean(candidate)),
    [book, books, booksByKey, connections],
  );

  const editorialLinks = useMemo(() => {
    return connections
      .filter(
        (conn) =>
          conn.source_book_id === book.id ||
          conn.target_book_id === book.id ||
          conn.source_book_id === currentBookKey ||
          conn.target_book_id === currentBookKey,
      )
      .map((conn) => {
        const isSource =
          conn.source_book_id === book.id ||
          conn.source_book_id === currentBookKey;
        const otherId = isSource ? conn.target_book_id : conn.source_book_id;
        const otherBook = booksByKey.get(otherId) ?? null;
        return { conn, otherBook, otherId };
      });
  }, [book.id, booksByKey, connections, currentBookKey]);

  const candidateTargetBooks = useMemo(() => {
    const sorted = [...books]
      .filter(
        (candidate) =>
          candidate.id !== book.id && getBookKey(candidate) !== currentBookKey,
      )
      .sort(compareCatalogueBooks);

    const query = targetSearch.trim().toLocaleLowerCase("en-US");
    if (!query) return sorted.slice(0, 10);

    return sorted
      .filter(
        (candidate) =>
          candidate.title.toLocaleLowerCase("en-US").includes(query) ||
          candidate.author.toLocaleLowerCase("en-US").includes(query),
      )
      .slice(0, 10);
  }, [book.id, books, currentBookKey, targetSearch]);

  useEffect(() => {
    if (!showTargetDropdown) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        targetPickerRef.current &&
        target &&
        !targetPickerRef.current.contains(target)
      ) {
        setShowTargetDropdown(false);
        setTargetHighlight(-1);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showTargetDropdown]);

  const selectTargetBook = (candidate: LedgerBook) => {
    setSelectedTargetBook(candidate);
    setTargetSearch(`${candidate.author}: ${candidate.title}`);
    setShowTargetDropdown(false);
    setTargetHighlight(-1);
    setLinkStatus(null);
  };

  const handleTargetKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!showTargetDropdown) {
        setShowTargetDropdown(true);
        setTargetHighlight(candidateTargetBooks.length > 0 ? 0 : -1);
      } else if (candidateTargetBooks.length > 0) {
        setTargetHighlight((prev) =>
          prev < candidateTargetBooks.length - 1 ? prev + 1 : 0,
        );
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!showTargetDropdown) {
        setShowTargetDropdown(true);
        setTargetHighlight(candidateTargetBooks.length - 1);
      } else if (candidateTargetBooks.length > 0) {
        setTargetHighlight((prev) =>
          prev > 0 ? prev - 1 : candidateTargetBooks.length - 1,
        );
      }
    } else if (
      event.key === "Enter" &&
      showTargetDropdown &&
      targetHighlight >= 0 &&
      candidateTargetBooks[targetHighlight]
    ) {
      event.preventDefault();
      selectTargetBook(candidateTargetBooks[targetHighlight]);
    } else if (event.key === "Escape" && showTargetDropdown) {
      event.preventDefault();
      event.stopPropagation();
      setShowTargetDropdown(false);
      setTargetHighlight(-1);
    }
  };

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

  const handleSaveConnection = async (event: React.FormEvent) => {
    event.preventDefault();
    setLinkStatus(null);

    if (!selectedTargetBook) {
      setLinkStatus({
        kind: "error",
        message: "Please select a linked volume from the list.",
      });
      return;
    }

    setIsSavingConnection(true);
    try {
      await onCreateConnection({
        source_book_id: book.id,
        target_book_id: selectedTargetBook.id,
        connection_type: connectionType,
        description: connectionNote.trim() || null,
        weight: 2,
      });
      setSelectedTargetBook(null);
      setTargetSearch("");
      setConnectionNote("");
      setShowAddLinkForm(false);
      setLinkStatus({
        kind: "success",
        message: "Editorial link saved.",
      });
    } catch (error) {
      setLinkStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not save editorial link.",
      });
    } finally {
      setIsSavingConnection(false);
    }
  };

  const handleRemoveConnection = async (connectionId: string) => {
    setDeletingConnectionId(connectionId);
    setLinkStatus(null);
    try {
      await onDeleteConnection(connectionId);
      setLinkStatus({
        kind: "success",
        message: "Editorial link removed.",
      });
    } catch (error) {
      setLinkStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not remove editorial link.",
      });
    } finally {
      setDeletingConnectionId(null);
    }
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

  const runEnrichLookup = async () => {
    enrichAbortRef.current?.abort();
    const controller = new AbortController();
    enrichAbortRef.current = controller;
    const requestBookId = book.id;

    setIsFetchingEnrich(true);
    setEnrichError("");
    setEnrichNotice("");

    try {
      const query = `${book.title} ${book.author}`.trim();
      const response = await fetch(
        `/api/books/lookup?q=${encodeURIComponent(query)}&enrich=1`,
        { signal: controller.signal },
      );
      const data = (await response.json().catch(() => ({}))) as {
        candidates?: LookupCandidate[];
        error?: string;
      };

      if (controller.signal.aborted || latestBookIdRef.current !== requestBookId) {
        return;
      }

      if (!response.ok) {
        setEnrichError(
          data.error || "Could not reach bibliographic enrichment service.",
        );
        setEnrichCandidates([]);
        setHasFetchedEnrich(true);
        return;
      }

      const list = Array.isArray(data.candidates) ? data.candidates : [];
      const preferredIndex = list.findIndex((candidate) => {
        const defaults = getDefaultEnrichSelection(book, displayTags, candidate);
        return (
          defaults.summary ||
          defaults.publish_year ||
          defaults.tags ||
          defaults.edition
        );
      });
      const initialIndex = preferredIndex >= 0 ? preferredIndex : 0;

      setEnrichCandidates(list);
      setEnrichCandidateIndex(initialIndex);
      setSelectedEnrichFields(
        getDefaultEnrichSelection(book, displayTags, list[initialIndex]),
      );
      setHasFetchedEnrich(true);
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      setEnrichError("Network error while fetching metadata candidates.");
      setEnrichCandidates([]);
      setHasFetchedEnrich(true);
    } finally {
      if (!controller.signal.aborted && latestBookIdRef.current === requestBookId) {
        setIsFetchingEnrich(false);
      }
    }
  };

  const handleToggleEnrichPanel = () => {
    if (isEnrichOpen) {
      setIsEnrichOpen(false);
      return;
    }
    setIsEnrichOpen(true);
    setEnrichNotice("");
    if ((!hasFetchedEnrich || (enrichError && enrichCandidates.length === 0)) && !isFetchingEnrich) {
      void runEnrichLookup();
    }
  };

  const handleSwitchEnrichCandidate = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= enrichCandidates.length) {
      return;
    }
    setEnrichCandidateIndex(nextIndex);
    setSelectedEnrichFields(
      getDefaultEnrichSelection(book, displayTags, enrichCandidates[nextIndex]),
    );
    setEnrichError("");
  };

  const activeEnrichCandidate = enrichCandidates[enrichCandidateIndex];
  const anyCandidateEnrichable = enrichCandidates.some(
    candidateHasAnyEnrichableField,
  );
  const selectedEnrichCount = activeEnrichCandidate
    ? (selectedEnrichFields.summary && Boolean(activeEnrichCandidate.summary?.trim())
        ? 1
        : 0) +
      (selectedEnrichFields.publish_year &&
      activeEnrichCandidate.publish_year !== null
        ? 1
        : 0) +
      (selectedEnrichFields.tags && activeEnrichCandidate.tags.length > 0
        ? 1
        : 0) +
      (selectedEnrichFields.edition &&
      Boolean(activeEnrichCandidate.edition.trim())
        ? 1
        : 0)
    : 0;

  const handleApplyEnrich = async () => {
    if (!activeEnrichCandidate || selectedEnrichCount === 0) {
      return;
    }

    const patch: BookUpdatePatch = {};

    if (
      selectedEnrichFields.summary &&
      activeEnrichCandidate.summary?.trim()
    ) {
      patch.summary = activeEnrichCandidate.summary.trim();
    }
    if (
      selectedEnrichFields.publish_year &&
      activeEnrichCandidate.publish_year !== null
    ) {
      patch.publish_year = activeEnrichCandidate.publish_year;
    }
    if (selectedEnrichFields.tags && activeEnrichCandidate.tags.length > 0) {
      const mergedTags: string[] = [];
      const seen = new Set<string>();
      for (const rawTag of [...book.tags, ...activeEnrichCandidate.tags]) {
        const cleaned = rawTag.trim().replace(/\s+/g, " ");
        const normalizedKey = cleaned.toLocaleLowerCase("en-US");
        if (!cleaned || seen.has(normalizedKey)) {
          continue;
        }
        seen.add(normalizedKey);
        mergedTags.push(cleaned);
        if (mergedTags.length >= 20) {
          break;
        }
      }
      patch.tags = mergedTags;
    }
    if (selectedEnrichFields.edition && activeEnrichCandidate.edition.trim()) {
      patch.edition = activeEnrichCandidate.edition.trim();
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    setIsApplyingEnrich(true);
    setEnrichError("");
    setEnrichNotice("");

    try {
      await onUpdateBook(book.id, patch);
      setIsEnrichOpen(false);
      setEnrichNotice("Applied selected metadata to this volume.");
    } catch (error) {
      setEnrichError(
        error instanceof Error
          ? error.message
          : "Could not apply enriched metadata.",
      );
    } finally {
      setIsApplyingEnrich(false);
    }
  };

  const formattedPublishYear = formatPublishYear(book.publish_year);

  const sortedAllLists = useMemo(() => sortReadingLists(lists), [lists]);
  const bookLists = useMemo(
    () => getListsForBook(sortedAllLists, book.id),
    [book.id, sortedAllLists],
  );
  const availableListsToAdd = useMemo(() => {
    const memberIds = new Set(bookLists.map((list) => list.id));
    return sortedAllLists.filter((list) => !memberIds.has(list.id));
  }, [bookLists, sortedAllLists]);
  const isInQueueList = useMemo(
    () => bookLists.some((list) => list.is_queue),
    [bookLists],
  );
  const bookQuotes = useMemo(
    () =>
      quotes.filter(
        (quote) =>
          quote.book_id === book.id || quote.book_id === currentBookKey,
      ),
    [book.id, currentBookKey, quotes],
  );

  const handleQueueUpNextClick = async () => {
    if (!onQueueUpNext) return;
    setListFeedback(null);
    setIsQueueingUpNext(true);
    try {
      await onQueueUpNext(book);
      setListFeedback({ kind: "success", message: "Added to Up Next queue." });
    } catch (error) {
      setListFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not add volume to Up Next.",
      });
    } finally {
      setIsQueueingUpNext(false);
    }
  };

  const handleAddToListSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!onAddBookToList || !selectedListToAdd) return;
    setListFeedback(null);
    setIsUpdatingList(true);
    try {
      await onAddBookToList(selectedListToAdd, book.id);
      setSelectedListToAdd("");
      setListFeedback({ kind: "success", message: "Added to reading list." });
    } catch (error) {
      setListFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not add volume to list.",
      });
    } finally {
      setIsUpdatingList(false);
    }
  };

  const handleRemoveFromListClick = async (listId: string) => {
    if (!onRemoveBookFromList) return;
    setListFeedback(null);
    setIsUpdatingList(true);
    try {
      await onRemoveBookFromList(listId, book.id);
      setListFeedback({
        kind: "success",
        message: "Removed from reading list.",
      });
    } catch (error) {
      setListFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not remove volume from list.",
      });
    } finally {
      setIsUpdatingList(false);
    }
  };

  const handleSaveQuoteSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!onCreateQuote) return;
    setQuoteFeedback(null);

    if (!quoteText.trim()) {
      setQuoteFeedback({
        kind: "error",
        message: "Please enter a passage to save.",
      });
      return;
    }

    const parsedTags = quoteTagsRaw
      .split(",")
      .map((tag) => tag.trim().replace(/\s+/g, " "))
      .filter(Boolean);

    setIsSavingQuote(true);
    try {
      await onCreateQuote({
        book_id: book.id,
        quote_text: quoteText.trim(),
        page_number: quotePage.trim() || null,
        note: quoteNote.trim() || null,
        tags: parsedTags,
      });
      setQuoteText("");
      setQuotePage("");
      setQuoteTagsRaw("");
      setQuoteNote("");
      setShowAddQuoteForm(false);
      setQuoteFeedback({
        kind: "success",
        message: "Passage saved to Commonplace Book.",
      });
    } catch (error) {
      setQuoteFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not save passage.",
      });
    } finally {
      setIsSavingQuote(false);
    }
  };

  const handleDeleteQuoteClick = async (quoteId: string) => {
    if (!onDeleteQuote) return;
    setQuoteFeedback(null);
    setDeletingQuoteId(quoteId);
    try {
      await onDeleteQuote(quoteId);
      setQuoteFeedback({
        kind: "success",
        message: "Passage removed.",
      });
    } catch (error) {
      setQuoteFeedback({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Could not remove passage.",
      });
    } finally {
      setDeletingQuoteId(null);
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
          {formattedPublishYear && (
            <div>
              <strong>Published:</strong> {formattedPublishYear}
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

        {canEdit && (isMissingEnrichableMetadata || enrichNotice) && (
          <section
            className="detail-enrich-panel"
            aria-label="1-Click Enrich via Lookup"
          >
            <div className="detail-enrich-header">
              <div className="detail-enrich-heading">
                <h4>1-Click Enrich via Lookup</h4>
                {isMissingEnrichableMetadata && (
                  <p className="detail-enrich-caption">
                    Missing{" "}
                    {[
                      !book.summary?.trim() && "summary",
                      book.publish_year === null && "publish year",
                      displayTags.length === 0 && "subjects",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    .
                  </p>
                )}
              </div>
              {isMissingEnrichableMetadata && (
                <button
                  type="button"
                  className="btn-link-toggle font-mono"
                  aria-expanded={isEnrichOpen}
                  aria-controls={enrichPanelId}
                  disabled={isApplyingEnrich || isDeleting}
                  onClick={handleToggleEnrichPanel}
                >
                  {isEnrichOpen
                    ? "Hide enrich"
                    : "Enrich Missing Metadata"}
                </button>
              )}
            </div>

            {enrichNotice && !isEnrichOpen && (
              <p
                className="tracker-feedback tracker-feedback--success"
                role="status"
              >
                {enrichNotice}
              </p>
            )}

            <div
              id={enrichPanelId}
              className="detail-enrich-body"
              hidden={!isEnrichOpen}
            >
              {isEnrichOpen && (
                <>
                  {isFetchingEnrich && (
                    <p className="detail-enrich-loading">
                      Searching bibliographic sources for missing metadata…
                    </p>
                  )}

                  {enrichError && (
                    <div className="detail-enrich-error-row">
                      <p
                        className="tracker-feedback tracker-feedback--error"
                        role="alert"
                      >
                        {enrichError}
                      </p>
                      {enrichCandidates.length === 0 && !isFetchingEnrich && (
                        <button
                          type="button"
                          className="btn-link-toggle font-mono"
                          onClick={() => void runEnrichLookup()}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}

                  {!isFetchingEnrich &&
                    hasFetchedEnrich &&
                    !enrichError &&
                    !anyCandidateEnrichable && (
                      <p className="detail-enrich-empty" role="status">
                        No enrichable metadata fields were found for this
                        volume.
                      </p>
                    )}

                  {!isFetchingEnrich &&
                    hasFetchedEnrich &&
                    anyCandidateEnrichable &&
                    activeEnrichCandidate && (
                      <div className="detail-enrich-diff">
                        <div className="detail-enrich-candidate-bar">
                          <div className="detail-enrich-candidate-title">
                            <cite>{activeEnrichCandidate.title}</cite>
                            <span>
                              {activeEnrichCandidate.author} ·{" "}
                              <strong className="font-mono">
                                {formatLookupSource(
                                  activeEnrichCandidate.source,
                                )}
                              </strong>
                            </span>
                          </div>
                          {enrichCandidates.length > 1 && (
                            <div className="detail-enrich-pager">
                              <button
                                type="button"
                                className="btn-link-toggle font-mono"
                                disabled={
                                  enrichCandidateIndex === 0 || isApplyingEnrich
                                }
                                onClick={() =>
                                  handleSwitchEnrichCandidate(
                                    enrichCandidateIndex - 1,
                                  )
                                }
                              >
                                Prev
                              </button>
                              <span className="detail-enrich-page-label font-mono">
                                {enrichCandidateIndex + 1} /{" "}
                                {enrichCandidates.length}
                              </span>
                              <button
                                type="button"
                                className="btn-link-toggle font-mono"
                                disabled={
                                  enrichCandidateIndex >=
                                    enrichCandidates.length - 1 ||
                                  isApplyingEnrich
                                }
                                onClick={() =>
                                  handleSwitchEnrichCandidate(
                                    enrichCandidateIndex + 1,
                                  )
                                }
                              >
                                Next
                              </button>
                            </div>
                          )}
                        </div>

                        {!candidateHasAnyEnrichableField(
                          activeEnrichCandidate,
                        ) ? (
                          <p className="detail-enrich-empty">
                            This candidate carries no summary, publish year,
                            tags, or edition fields. Switch to another candidate
                            to compare.
                          </p>
                        ) : (
                          <ul className="detail-enrich-fields">
                            {activeEnrichCandidate.summary?.trim() && (
                              <li className="detail-enrich-field-row">
                                <div className="detail-enrich-check-row">
                                  <input
                                    id={enrichSummaryCheckId}
                                    type="checkbox"
                                    checked={selectedEnrichFields.summary}
                                    disabled={isApplyingEnrich}
                                    onChange={(event) =>
                                      setSelectedEnrichFields((prev) => ({
                                        ...prev,
                                        summary: event.target.checked,
                                      }))
                                    }
                                  />
                                  <label htmlFor={enrichSummaryCheckId}>
                                    Summary
                                    {!book.summary?.trim() && (
                                      <span className="detail-enrich-missing-tag font-mono">
                                        missing
                                      </span>
                                    )}
                                  </label>
                                </div>
                                <p className="detail-enrich-preview">
                                  {activeEnrichCandidate.summary.trim()}
                                </p>
                              </li>
                            )}

                            {activeEnrichCandidate.publish_year !== null && (
                              <li className="detail-enrich-field-row">
                                <div className="detail-enrich-check-row">
                                  <input
                                    id={enrichYearCheckId}
                                    type="checkbox"
                                    checked={selectedEnrichFields.publish_year}
                                    disabled={isApplyingEnrich}
                                    onChange={(event) =>
                                      setSelectedEnrichFields((prev) => ({
                                        ...prev,
                                        publish_year: event.target.checked,
                                      }))
                                    }
                                  />
                                  <label htmlFor={enrichYearCheckId}>
                                    Publish year
                                    {book.publish_year === null && (
                                      <span className="detail-enrich-missing-tag font-mono">
                                        missing
                                      </span>
                                    )}
                                  </label>
                                </div>
                                <p className="detail-enrich-preview">
                                  {formatPublishYear(
                                    activeEnrichCandidate.publish_year,
                                  )}
                                  {book.publish_year !== null &&
                                    ` (current: ${formatPublishYear(book.publish_year)})`}
                                </p>
                              </li>
                            )}

                            {activeEnrichCandidate.tags.length > 0 && (
                              <li className="detail-enrich-field-row">
                                <div className="detail-enrich-check-row">
                                  <input
                                    id={enrichTagsCheckId}
                                    type="checkbox"
                                    checked={selectedEnrichFields.tags}
                                    disabled={isApplyingEnrich}
                                    onChange={(event) =>
                                      setSelectedEnrichFields((prev) => ({
                                        ...prev,
                                        tags: event.target.checked,
                                      }))
                                    }
                                  />
                                  <label htmlFor={enrichTagsCheckId}>
                                    Tags
                                    {displayTags.length === 0 && (
                                      <span className="detail-enrich-missing-tag font-mono">
                                        missing
                                      </span>
                                    )}
                                  </label>
                                </div>
                                <p className="detail-enrich-preview">
                                  {activeEnrichCandidate.tags.join(", ")}
                                </p>
                              </li>
                            )}

                            {activeEnrichCandidate.edition.trim() && (
                              <li className="detail-enrich-field-row">
                                <div className="detail-enrich-check-row">
                                  <input
                                    id={enrichEditionCheckId}
                                    type="checkbox"
                                    checked={selectedEnrichFields.edition}
                                    disabled={isApplyingEnrich}
                                    onChange={(event) =>
                                      setSelectedEnrichFields((prev) => ({
                                        ...prev,
                                        edition: event.target.checked,
                                      }))
                                    }
                                  />
                                  <label htmlFor={enrichEditionCheckId}>
                                    Edition
                                    {!book.edition.trim() && (
                                      <span className="detail-enrich-missing-tag font-mono">
                                        missing
                                      </span>
                                    )}
                                  </label>
                                </div>
                                <p className="detail-enrich-preview">
                                  {activeEnrichCandidate.edition.trim()}
                                  {book.edition.trim() &&
                                    ` (current: ${book.edition.trim()})`}
                                </p>
                              </li>
                            )}
                          </ul>
                        )}

                        <div className="detail-enrich-actions">
                          <button
                            type="button"
                            className="btn-tracker-save"
                            disabled={
                              isApplyingEnrich || selectedEnrichCount === 0
                            }
                            onClick={() => void handleApplyEnrich()}
                          >
                            {isApplyingEnrich
                              ? "Applying..."
                              : "Apply selected"}
                          </button>
                          <button
                            type="button"
                            className="btn-action-secondary"
                            disabled={isApplyingEnrich}
                            onClick={() => setIsEnrichOpen(false)}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                </>
              )}
            </div>
          </section>
        )}

        <section
          className="card-reading-ledger"
          aria-label="Reading Ledger tracker"
        >
          <h4>Reading Ledger</h4>

          {canEdit ? (
            <>
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
                      name="date_finished"
                      type="date"
                      value={dateFinished}
                      onChange={(event) => setDateFinished(event.target.value)}
                    />
                  </div>
                  <div className="reading-field">
                    <label htmlFor={loanedToId}>Loaned to</label>
                    <input
                      id={loanedToId}
                      name="loaned_to"
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
                    name="personal_notes"
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
            </>
          ) : (
            <div className="reading-ledger-readonly">
              <dl className="reading-readonly-list">
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span
                      className={`ledger-badge ledger-badge--status ledger-badge--${book.reading_status}`}
                    >
                      {READING_STATUS_LABELS[book.reading_status]}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Rating</dt>
                  <dd>
                    {book.rating !== null ? (
                      <span className="reading-readonly-stars">
                        {"★".repeat(book.rating)}
                        {"☆".repeat(5 - book.rating)} ({book.rating}/5)
                      </span>
                    ) : (
                      "Unrated"
                    )}
                  </dd>
                </div>
                {book.date_finished && (
                  <div>
                    <dt>Date finished</dt>
                    <dd>{book.date_finished}</dd>
                  </div>
                )}
                {book.loaned_to && (
                  <div>
                    <dt>Loaned to</dt>
                    <dd>{book.loaned_to}</dd>
                  </div>
                )}
                {book.personal_notes && (
                  <div className="reading-readonly-notes">
                    <dt>Personal notes</dt>
                    <dd>{book.personal_notes}</dd>
                  </div>
                )}
              </dl>
              <button
                type="button"
                className="btn-action-secondary curator-signin-inline-btn"
                onClick={onRequireAuth}
              >
                Sign in as curator to edit ledger &amp; links
              </button>
            </div>
          )}
        </section>

        <section
          className="detail-lists-strip"
          aria-label="Reading Lists"
        >
          <div className="editorial-links-header">
            <h4>Reading Lists</h4>
            {canEdit && onQueueUpNext && (
              <button
                type="button"
                className="btn-link-toggle font-mono"
                disabled={isInQueueList || isQueueingUpNext || isDeleting}
                onClick={() => void handleQueueUpNextClick()}
              >
                {isQueueingUpNext
                  ? "Queueing..."
                  : isInQueueList
                    ? "In Up Next ✓"
                    : "Add to Up Next"}
              </button>
            )}
          </div>

          {bookLists.length === 0 ? (
            <p className="card-empty-note">
              Not assigned to any reading list yet.
            </p>
          ) : (
            <div className="detail-list-pills">
              {bookLists.map((list) => (
                <span key={list.id} className="detail-list-pill font-mono">
                  <span>
                    {list.name}
                    {list.is_queue ? " · Queue" : ""}
                  </span>
                  {canEdit && onRemoveBookFromList && (
                    <button
                      type="button"
                      className="detail-list-pill-remove"
                      disabled={isUpdatingList || isDeleting}
                      onClick={() => void handleRemoveFromListClick(list.id)}
                      aria-label={`Remove ${book.title} from ${list.name}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {canEdit && onAddBookToList && availableListsToAdd.length > 0 && (
            <form
              className="detail-list-add-form"
              onSubmit={handleAddToListSubmit}
            >
              <label htmlFor={addToListSelectId} className="sr-only">
                Add to reading list
              </label>
              <select
                id={addToListSelectId}
                value={selectedListToAdd}
                onChange={(event) => setSelectedListToAdd(event.target.value)}
                disabled={isUpdatingList || isDeleting}
              >
                <option value="">Add to a reading list...</option>
                {availableListsToAdd.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                    {list.is_queue ? " (Queue)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="btn-link-toggle font-mono"
                disabled={!selectedListToAdd || isUpdatingList || isDeleting}
              >
                {isUpdatingList ? "Adding..." : "Add"}
              </button>
            </form>
          )}

          {listFeedback && (
            <p
              className={`tracker-feedback tracker-feedback--${listFeedback.kind}`}
              role={listFeedback.kind === "error" ? "alert" : "status"}
            >
              {listFeedback.message}
            </p>
          )}
        </section>

        <section
          className="detail-quotes-section"
          aria-label="Commonplace Quotes"
        >
          <div className="editorial-links-header">
            <h4>
              Commonplace Quotes
              {bookQuotes.length > 0 ? ` (${bookQuotes.length})` : ""}
            </h4>
            {canEdit && onCreateQuote && (
              <button
                type="button"
                className="btn-link-toggle font-mono"
                aria-expanded={showAddQuoteForm}
                aria-controls={addQuoteFormId}
                onClick={() => {
                  setShowAddQuoteForm((prev) => !prev);
                  setQuoteFeedback(null);
                }}
              >
                {showAddQuoteForm ? "Cancel" : "+ Save a passage"}
              </button>
            )}
          </div>

          {bookQuotes.length === 0 ? (
            <p className="card-empty-note">
              No passages saved from this volume yet.
            </p>
          ) : (
            <ul className="detail-quote-list">
              {bookQuotes.map((quote) => (
                <li key={quote.id} className="detail-quote-card">
                  <blockquote className="commonplace-blockquote detail-quote-blockquote">
                    <p>{quote.quote_text}</p>
                  </blockquote>
                  <div className="detail-quote-meta-row">
                    <span className="detail-quote-meta font-mono">
                      {[
                        quote.page_number ? `p. ${quote.page_number}` : null,
                        quote.chapter,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Saved passage"}
                    </span>
                    {canEdit && onDeleteQuote && (
                      <button
                        type="button"
                        className="btn-editorial-remove font-mono"
                        disabled={deletingQuoteId === quote.id}
                        onClick={() => void handleDeleteQuoteClick(quote.id)}
                        aria-label={`Delete quote from ${book.title}`}
                      >
                        {deletingQuoteId === quote.id
                          ? "Removing..."
                          : "Delete"}
                      </button>
                    )}
                  </div>
                  {quote.note && (
                    <p className="detail-quote-note">{quote.note}</p>
                  )}
                  {quote.tags.length > 0 && (
                    <div className="detail-quote-tags">
                      {quote.tags.map((tag) => (
                        <span key={tag} className="detail-quote-tag font-mono">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {quoteFeedback && !showAddQuoteForm && (
            <p
              className={`tracker-feedback tracker-feedback--${quoteFeedback.kind}`}
              role={quoteFeedback.kind === "error" ? "alert" : "status"}
            >
              {quoteFeedback.message}
            </p>
          )}

          {canEdit && onCreateQuote && showAddQuoteForm && (
            <form
              id={addQuoteFormId}
              className="detail-quote-form"
              onSubmit={handleSaveQuoteSubmit}
              noValidate
            >
              <div className="reading-field">
                <label htmlFor={quoteTextId}>
                  Quote <span aria-hidden="true">*</span>
                </label>
                <textarea
                  id={quoteTextId}
                  rows={3}
                  value={quoteText}
                  onChange={(event) => setQuoteText(event.target.value)}
                  placeholder="Transcribe a passage from this volume..."
                  required
                />
              </div>

              <div className="reading-notes-grid">
                <div className="reading-field">
                  <label htmlFor={quotePageId}>Page</label>
                  <input
                    id={quotePageId}
                    type="text"
                    value={quotePage}
                    onChange={(event) => setQuotePage(event.target.value)}
                    placeholder="e.g. 42"
                  />
                </div>
                <div className="reading-field">
                  <label htmlFor={quoteTagsId}>Tags</label>
                  <input
                    id={quoteTagsId}
                    type="text"
                    value={quoteTagsRaw}
                    onChange={(event) => setQuoteTagsRaw(event.target.value)}
                    placeholder="memory, fate"
                  />
                </div>
              </div>

              <div className="reading-field">
                <label htmlFor={quoteNoteId}>Note</label>
                <textarea
                  id={quoteNoteId}
                  rows={2}
                  value={quoteNote}
                  onChange={(event) => setQuoteNote(event.target.value)}
                  placeholder="Optional reflection or marginalia..."
                />
              </div>

              <div className="reading-notes-actions">
                <button
                  type="submit"
                  className="btn-tracker-save"
                  disabled={isSavingQuote}
                >
                  {isSavingQuote ? "Saving..." : "Save passage"}
                </button>
                {quoteFeedback && (
                  <p
                    className={`tracker-feedback tracker-feedback--${quoteFeedback.kind}`}
                    role={quoteFeedback.kind === "error" ? "alert" : "status"}
                  >
                    {quoteFeedback.message}
                  </p>
                )}
              </div>
            </form>
          )}
        </section>

        <section
          className="card-editorial-links"
          aria-label="Curated Editorial Links"
        >
          <div className="editorial-links-header">
            <h4>Curated Editorial Links</h4>
            {canEdit && (
              <button
                type="button"
                className="btn-link-toggle font-mono"
                aria-expanded={showAddLinkForm}
                aria-controls={addLinkFormId}
                onClick={() => {
                  setShowAddLinkForm((prev) => !prev);
                  setLinkStatus(null);
                }}
              >
                {showAddLinkForm ? "Cancel" : "Add editorial link"}
              </button>
            )}
          </div>

          {editorialLinks.length === 0 ? (
            <p className="card-empty-note">
              No curated editorial links recorded for this volume yet.
            </p>
          ) : (
            <ul className="editorial-links-list">
              {editorialLinks.map(({ conn, otherBook, otherId }) => (
                <li key={conn.id} className="editorial-link-item">
                  <div className="editorial-link-row">
                    <span className="editorial-link-type font-mono">
                      {CONNECTION_TYPE_LABELS[conn.connection_type]}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        className="btn-editorial-remove font-mono"
                        disabled={deletingConnectionId === conn.id}
                        onClick={() => void handleRemoveConnection(conn.id)}
                        aria-label={`Remove editorial link with ${otherBook?.title ?? otherId}`}
                      >
                        {deletingConnectionId === conn.id
                          ? "Removing..."
                          : "Remove"}
                      </button>
                    )}
                  </div>

                  {otherBook ? (
                    <button
                      type="button"
                      className="editorial-link-book-btn"
                      onClick={() => onBookClick(otherBook)}
                    >
                      <cite>{otherBook.title}</cite>
                      <span>
                        {otherBook.author} · Shelf {otherBook.shelf}
                      </span>
                    </button>
                  ) : (
                    <span className="editorial-link-fallback">
                      Linked volume ({otherId})
                    </span>
                  )}

                  {conn.description && (
                    <p className="editorial-link-description">
                      {conn.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {linkStatus && !showAddLinkForm && (
            <p
              className={`tracker-feedback tracker-feedback--${linkStatus.kind}`}
              role={linkStatus.kind === "error" ? "alert" : "status"}
            >
              {linkStatus.message}
            </p>
          )}

          {canEdit && showAddLinkForm && (
            <form
              id={addLinkFormId}
              className="editorial-link-form"
              onSubmit={handleSaveConnection}
              noValidate
            >
              <div className="reading-field" ref={targetPickerRef}>
                <label htmlFor={targetPickerId}>
                  Linked volume <span aria-hidden="true">*</span>
                </label>
                <div className="searchable-select-container">
                  <input
                    id={targetPickerId}
                    type="text"
                    placeholder="Search title or author..."
                    value={targetSearch}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls={targetListboxId}
                    aria-expanded={showTargetDropdown}
                    aria-activedescendant={
                      showTargetDropdown &&
                      targetHighlight >= 0 &&
                      candidateTargetBooks[targetHighlight]
                        ? `${targetListboxId}-opt-${targetHighlight}`
                        : undefined
                    }
                    onChange={(event) => {
                      setTargetSearch(event.target.value);
                      setSelectedTargetBook(null);
                      setShowTargetDropdown(true);
                      setTargetHighlight(-1);
                    }}
                    onFocus={() => setShowTargetDropdown(true)}
                    onKeyDown={handleTargetKeyDown}
                  />
                  {showTargetDropdown && (
                    <ul
                      id={targetListboxId}
                      role="listbox"
                      className="select-dropdown-list"
                    >
                      {candidateTargetBooks.map((candidate, index) => {
                        const key = getBookKey(candidate);
                        const isHighlighted = index === targetHighlight;
                        const isSelected =
                          Boolean(selectedTargetBook) &&
                          getBookKey(selectedTargetBook ?? candidate) === key;
                        return (
                          <li key={key} role="none">
                            <button
                              type="button"
                              id={`${targetListboxId}-opt-${index}`}
                              role="option"
                              tabIndex={-1}
                              data-highlighted={isHighlighted}
                              aria-selected={isHighlighted || isSelected}
                              onMouseEnter={() => setTargetHighlight(index)}
                              onClick={() => selectTargetBook(candidate)}
                            >
                              <strong>{candidate.author}</strong> —{" "}
                              <span>{candidate.title}</span>
                            </button>
                          </li>
                        );
                      })}
                      {candidateTargetBooks.length === 0 && (
                        <li
                          className="no-matches"
                          role="option"
                          aria-disabled="true"
                          aria-selected="false"
                        >
                          No volumes match
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </div>

              <div className="reading-field">
                <label htmlFor={connectionTypeId}>Relationship type</label>
                <select
                  id={connectionTypeId}
                  name="connection_type"
                  value={connectionType}
                  onChange={(event) =>
                    setConnectionType(event.target.value as ConnectionType)
                  }
                >
                  {CONNECTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {CONNECTION_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="reading-field">
                <label htmlFor={connectionNoteId}>
                  Editorial note (optional)
                </label>
                <input
                  id={connectionNoteId}
                  name="description"
                  type="text"
                  maxLength={500}
                  value={connectionNote}
                  onChange={(event) => setConnectionNote(event.target.value)}
                  placeholder="Why these two volumes converse..."
                />
              </div>

              <div className="reading-notes-actions">
                <button
                  type="submit"
                  className="btn-tracker-save"
                  disabled={isSavingConnection}
                >
                  {isSavingConnection ? "Saving..." : "Save link"}
                </button>
                {linkStatus && (
                  <p
                    className={`tracker-feedback tracker-feedback--${linkStatus.kind}`}
                    role={linkStatus.kind === "error" ? "alert" : "status"}
                  >
                    {linkStatus.message}
                  </p>
                )}
              </div>
            </form>
          )}
        </section>

        <div className="card-primary-actions card-action-bar">
          <div className="card-primary-action-row">
            <button
              type="button"
              className="btn-action-primary"
              onClick={onStartPath}
              disabled={isDeleting}
            >
              Start a path from this volume
            </button>
            {onRecommendSimilar && (
              <button
                type="button"
                className="btn-action-secondary"
                onClick={onRecommendSimilar}
                disabled={isDeleting}
              >
                Similar unread
              </button>
            )}
          </div>
          {canEdit && (
            <>
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
            </>
          )}
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
  canEdit,
  onRequireAuth,
  connections,
  onCreateConnection,
  onDeleteConnection,
  quotes,
  lists,
  onCreateQuote,
  onDeleteQuote,
  onAddBookToList,
  onRemoveBookFromList,
  onQueueUpNext,
  onBookClick,
  onClose,
  onStartPath,
  onRecommendSimilar,
  onTagClick,
  onEditBook,
  onUpdateBook,
  onDeleteBook,
}: {
  book: LedgerBook;
  books: LedgerBook[];
  canEdit: boolean;
  authRequired?: boolean;
  onRequireAuth: () => void;
  connections: EditorialConnection[];
  onCreateConnection: (
    input: CreateEditorialConnectionInput,
  ) => Promise<EditorialConnection>;
  onDeleteConnection: (connectionId: string) => Promise<void>;
  quotes?: BookQuote[];
  lists?: ReadingList[];
  onCreateQuote?: (input: CreateQuoteInput) => Promise<BookQuote>;
  onDeleteQuote?: (quoteId: string) => Promise<void>;
  onAddBookToList?: (listId: string, bookId: string) => Promise<ReadingList>;
  onRemoveBookFromList?: (listId: string, bookId: string) => Promise<ReadingList>;
  onQueueUpNext?: (book: CatalogueBook) => Promise<void>;
  onBookClick: (book: LedgerBook) => void;
  onClose: () => void;
  onStartPath: () => void;
  onRecommendSimilar?: () => void;
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
        canEdit={canEdit}
        onRequireAuth={onRequireAuth}
        connections={connections}
        onCreateConnection={onCreateConnection}
        onDeleteConnection={onDeleteConnection}
        quotes={quotes}
        lists={lists}
        onCreateQuote={onCreateQuote}
        onDeleteQuote={onDeleteQuote}
        onAddBookToList={onAddBookToList}
        onRemoveBookFromList={onRemoveBookFromList}
        onQueueUpNext={onQueueUpNext}
        titleId={titleId}
        onBookClick={onBookClick}
        onClose={onClose}
        onStartPath={onStartPath}
        onRecommendSimilar={onRecommendSimilar}
        onTagClick={onTagClick}
        onEditBook={onEditBook}
        onUpdateBook={onUpdateBook}
        onDeleteBook={onDeleteBook}
      />
    </ModalDialog>
  );
}
