"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  buildTagFrequencyMap,
  compareCatalogueBooks,
  filterDisplayTags,
  getAuthorInitial,
  getBookKey,
  READING_STATUS_LABELS,
  READING_STATUS_VALUES,
  type CatalogueBook,
  type LedgerBook,
  type ReadingStatus,
  type StorageMode,
} from "@/lib/books/catalogue";
import type { CuratorAuthState } from "@/lib/auth/curator";
import {
  normalizeConnectionPairKey,
  type EditorialConnection,
} from "@/lib/books/connections";
import {
  buildAlephMeditationPool,
  type AlephMeditation,
  type BookQuote,
  type CreateQuoteInput,
} from "@/lib/books/commonplace";
import type { CreateReadingListInput, ReadingList } from "@/lib/books/lists";
import {
  computeTriageCounts,
  getDuplicateBookIdSet,
  getMissingMetadataReasons,
  type BulkBookPatch,
  type TriageFilter,
} from "@/lib/books/triage";
import { CatalogueConstellation } from "./catalogue-constellation";
import { CatalogueLedger } from "./catalogue-ledger";
import { CommonplaceView } from "./commonplace-view";
import { CuratorTriagePanel } from "./curator-triage-panel";
import {
  BookDetailCard,
  type BookUpdatePatch,
  type CreateEditorialConnectionInput,
} from "./book-detail-card";
import { BookEditorModal } from "./book-editor-modal";
import { CuratorAuthModal } from "./curator-auth-modal";
import { TagMatchesOverlay } from "./tag-matches-overlay";
import { ChronologicalScroll } from "./chronological-scroll";
import { PhysicalShelfView } from "./physical-shelf-view";
import { PathfinderModal } from "./pathfinder-modal";
import { ReadingListsView } from "./reading-lists-view";
import { ReadingStatsModal } from "./reading-stats-modal";
import { ReadNextModal } from "./read-next-modal";
import { ModalDialog, useDialogClose } from "./modal-dialog";

type StatusFilterValue = "" | ReadingStatus | "loaned";

function subscribeReducedMotion(callback: () => void) {
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReducedMotionServerSnapshot() {
  return false;
}

function TypewriterText({ text, speed = 25 }: { text: string; speed?: number }) {
  const [characterCount, setCharacterCount] = useState(0);
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  useEffect(() => {
    if (prefersReducedMotion || characterCount >= text.length) return;
    const timeout = window.setTimeout(
      () => setCharacterCount((count) => Math.min(count + 1, text.length)),
      speed,
    );
    return () => window.clearTimeout(timeout);
  }, [characterCount, prefersReducedMotion, speed, text.length]);

  const visibleCharacterCount = prefersReducedMotion
    ? text.length
    : characterCount;

  return (
    <>
      <p className="aleph-text font-mono" aria-hidden="true">
        {text.slice(0, visibleCharacterCount)}
        {visibleCharacterCount < text.length && (
          <span className="aleph-cursor">_</span>
        )}
      </p>
      <p className="sr-only">{text}</p>
    </>
  );
}

function AlephModalContent({
  meditation,
  quoteIndex,
  onNextQuote,
  onInspectBook,
  onClose,
}: {
  meditation: AlephMeditation;
  quoteIndex: number;
  onNextQuote: () => void;
  onInspectBook?: (bookId: string) => void;
  onClose: () => void;
}) {
  const closeDialog = useDialogClose() ?? onClose;

  return (
    <div className="aleph-container">
      <button
        type="button"
        className="card-close-slip aleph-close-slip"
        onClick={closeDialog}
        aria-label="Close the Aleph"
      >
        <span className="slip-cancel">Close</span>
        <span className="slip-stamp font-mono">DISMISS</span>
      </button>

      <div className="aleph-sphere-outer" aria-hidden="true">
        <div className="aleph-sphere-glow" />
        <div className="aleph-sphere-inner">
          <div className="aleph-eye">👁</div>
        </div>
      </div>

      <div className="aleph-cardstock">
        <span className="card-rubric-tag font-mono aleph-kicker">
          {meditation.isUserQuote ? "commonplace resonance" : "speculum mundi"}
        </span>
        <h2 id="aleph-title" className="aleph-heading">
          The Aleph of Babel
        </h2>

        <div className="aleph-typewriter-box">
          <TypewriterText
            key={`${quoteIndex}-${meditation.text.slice(0, 24)}`}
            text={meditation.text}
          />
          <p className="aleph-source font-mono">{meditation.sourceLabel}</p>
        </div>

        <div className="aleph-actions">
          <button
            type="button"
            className="aleph-btn font-mono"
            onClick={onNextQuote}
          >
            PEER AGAIN
          </button>
          {meditation.isUserQuote && meditation.bookId && onInspectBook && (
            <button
              type="button"
              className="aleph-btn aleph-btn--secondary font-mono"
              onClick={() => onInspectBook(meditation.bookId!)}
            >
              INSPECT VOLUME
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function getSearchText(book: CatalogueBook): string {
  return [
    book.author,
    book.title,
    book.edition,
    book.position,
    book.shelf,
    book.top_category,
    book.sub_category,
    book.loaned_to,
    book.personal_notes,
    ...filterDisplayTags(book.tags),
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US");
}

const RESULTS_TABS = [
  "ledger",
  "shelves",
  "timeline",
  "lists",
  "commonplace",
] as const;
type ResultsTab = (typeof RESULTS_TABS)[number];

const TRIAGE_FILTER_CHIP_LABELS: Record<Exclude<TriageFilter, "">, string> = {
  missing_any: "Triage: Missing any metadata",
  missing_summary: "Triage: Missing summary",
  missing_year: "Triage: Missing publish year",
  missing_tags: "Triage: Missing subjects",
  duplicates: "Triage: Possible duplicates",
};

export function CatalogueApp({
  initialBooks,
  initialConnections,
  initialQuotes = [],
  initialLists = [],
  storageMode,
  initialAuth,
  librarianEnabled = false,
}: {
  initialBooks: CatalogueBook[];
  initialConnections: EditorialConnection[];
  initialQuotes?: BookQuote[];
  initialLists?: ReadingList[];
  storageMode: StorageMode;
  initialAuth: CuratorAuthState;
  librarianEnabled?: boolean;
}) {
  const [books, setBooks] = useState<CatalogueBook[]>(initialBooks);
  const [prevInitialBooks, setPrevInitialBooks] = useState(initialBooks);
  if (initialBooks !== prevInitialBooks) {
    setPrevInitialBooks(initialBooks);
    setBooks(initialBooks);
  }

  const [connections, setConnections] =
    useState<EditorialConnection[]>(initialConnections);
  const [prevInitialConnections, setPrevInitialConnections] =
    useState(initialConnections);
  if (initialConnections !== prevInitialConnections) {
    setPrevInitialConnections(initialConnections);
    setConnections(initialConnections);
  }

  const [quotes, setQuotes] = useState<BookQuote[]>(initialQuotes);
  const [prevInitialQuotes, setPrevInitialQuotes] = useState(initialQuotes);
  if (initialQuotes !== prevInitialQuotes) {
    setPrevInitialQuotes(initialQuotes);
    setQuotes(initialQuotes);
  }

  const [lists, setLists] = useState<ReadingList[]>(initialLists);
  const [prevInitialLists, setPrevInitialLists] = useState(initialLists);
  if (initialLists !== prevInitialLists) {
    setPrevInitialLists(initialLists);
    setLists(initialLists);
  }

  const [authState, setAuthState] = useState<CuratorAuthState>(initialAuth);
  const [prevInitialAuth, setPrevInitialAuth] = useState(initialAuth);
  if (
    initialAuth.authRequired !== prevInitialAuth.authRequired ||
    initialAuth.isCurator !== prevInitialAuth.isCurator
  ) {
    setPrevInitialAuth(initialAuth);
    setAuthState(initialAuth);
  }

  const canEdit = !authState.authRequired || authState.isCurator;

  // Filters
  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [shelfFilter, setShelfFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("");
  const [authorInitial, setAuthorInitial] = useState("");
  const [triageFilter, setTriageFilter] = useState<TriageFilter>("");

  // Bulk Curator Mode
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);

  // Tabs
  const [mapMode, setMapMode] = useState<"similarity" | "tag">("similarity");
  const [bottomView, setBottomView] = useState<ResultsTab>("ledger");

  const similarityTabRef = useRef<HTMLButtonElement>(null);
  const tagTabRef = useRef<HTMLButtonElement>(null);
  const ledgerTabRef = useRef<HTMLButtonElement>(null);
  const shelvesTabRef = useRef<HTMLButtonElement>(null);
  const timelineTabRef = useRef<HTMLButtonElement>(null);
  const listsTabRef = useRef<HTMLButtonElement>(null);
  const commonplaceTabRef = useRef<HTMLButtonElement>(null);

  // Modals / Overlays
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [isPathfinderOpen, setIsPathfinderOpen] = useState(false);
  const [pathfinderSourceId, setPathfinderSourceId] = useState<string | null>(
    null,
  );
  const [editorState, setEditorState] = useState<{
    mode: "create" | "edit";
    book?: CatalogueBook;
  } | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isReadNextOpen, setIsReadNextOpen] = useState(false);
  const [readNextSeedBookId, setReadNextSeedBookId] = useState<string | null>(
    null,
  );
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const pendingAuthActionRef = useRef<(() => void) | null>(null);
  const justAuthenticatedRef = useRef(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isAlephOpen, setIsAlephOpen] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);

  // Polite live toast
  const [statusToast, setStatusToast] = useState<{
    id: number;
    kind: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!statusToast) return;
    const timeout = window.setTimeout(() => {
      setStatusToast((current) =>
        current?.id === statusToast.id ? null : current,
      );
    }, 5500);
    return () => window.clearTimeout(timeout);
  }, [statusToast]);

  const showToast = (kind: "success" | "error", message: string) => {
    setStatusToast({ id: Date.now(), kind, message });
  };

  // Search control IDs
  const searchIdPrefix = useId();
  const queryInputId = `${searchIdPrefix}-query`;
  const divisionSelectId = `${searchIdPrefix}-division`;
  const subjectSelectId = `${searchIdPrefix}-subject`;
  const shelfSelectId = `${searchIdPrefix}-shelf`;
  const statusSelectId = `${searchIdPrefix}-status`;
  const triageSelectId = `${searchIdPrefix}-triage`;

  const triageSummary = useMemo(() => computeTriageCounts(books), [books]);
  const duplicateIdSet = useMemo(
    () => getDuplicateBookIdSet(triageSummary.duplicateGroups),
    [triageSummary.duplicateGroups],
  );

  const catalogueEntries = useMemo<LedgerBook[]>(
    () =>
      [...books].sort(compareCatalogueBooks).map((book, index) => ({
        ...book,
        number: index + 1,
      })),
    [books],
  );

  const booksById = useMemo(() => {
    const map = new Map<string, LedgerBook>();
    for (const book of catalogueEntries) {
      map.set(book.id, book);
      map.set(getBookKey(book), book);
    }
    return map;
  }, [catalogueEntries]);

  const alephPool = useMemo(
    () => buildAlephMeditationPool(quotes, booksById),
    [booksById, quotes],
  );

  const queuedBookIds = useMemo<ReadonlySet<string>>(() => {
    const ids = new Set<string>();
    for (const list of lists) {
      if (list.is_queue) {
        for (const item of list.items) {
          ids.add(item.book_id);
        }
      }
    }
    return ids;
  }, [lists]);

  const catalogueByInitial = useMemo(() => {
    const groups = new Map<string, LedgerBook[]>();
    for (const book of catalogueEntries) {
      const initial = getAuthorInitial(book.author);
      const list = groups.get(initial);
      if (list) {
        list.push(book);
      } else {
        groups.set(initial, [book]);
      }
    }
    return groups;
  }, [catalogueEntries]);

  const shelfCount = useMemo(
    () => new Set(books.map((book) => book.shelf)).size,
    [books],
  );

  const finishedCount = useMemo(
    () => books.filter((book) => book.reading_status === "finished").length,
    [books],
  );

  const readingCount = useMemo(
    () => books.filter((book) => book.reading_status === "reading").length,
    [books],
  );

  const divisions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const book of books) {
      const name = book.top_category ?? "Unclassified";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [books]);

  const catalogueTags = useMemo(() => {
    const tagFrequency = buildTagFrequencyMap(books);
    return [...tagFrequency.entries()]
      .sort(
        ([firstTag, firstCount], [secondTag, secondCount]) =>
          secondCount - firstCount || firstTag.localeCompare(secondTag),
      )
      .slice(0, 100)
      .map(([tag]) => tag);
  }, [books]);

  const catalogueShelves = useMemo(
    () =>
      [...new Set(books.map((book) => book.shelf))].sort(
        (first, second) => first - second,
      ),
    [books],
  );

  const filteredCatalogueEntries = useMemo(() => {
    const normalizedQuery = catalogueQuery
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en-US");

    return catalogueEntries.filter((book) => {
      if (normalizedQuery && !getSearchText(book).includes(normalizedQuery)) {
        return false;
      }
      if (
        divisionFilter &&
        (book.top_category ?? "Unclassified") !== divisionFilter
      ) {
        return false;
      }
      if (tagFilter && !filterDisplayTags(book.tags).includes(tagFilter)) {
        return false;
      }
      if (shelfFilter && book.shelf !== Number(shelfFilter)) {
        return false;
      }
      if (statusFilter === "loaned") {
        if (!book.loaned_to || !book.loaned_to.trim()) return false;
      } else if (statusFilter && book.reading_status !== statusFilter) {
        return false;
      }
      if (authorInitial && getAuthorInitial(book.author) !== authorInitial) {
        return false;
      }
      if (triageFilter) {
        if (triageFilter === "duplicates") {
          if (
            !duplicateIdSet.has(book.id) &&
            !duplicateIdSet.has(getBookKey(book))
          ) {
            return false;
          }
        } else {
          const missingReasons = getMissingMetadataReasons(book);
          if (triageFilter === "missing_any" && missingReasons.length === 0) {
            return false;
          }
          if (
            triageFilter === "missing_summary" &&
            !missingReasons.includes("summary")
          ) {
            return false;
          }
          if (
            triageFilter === "missing_year" &&
            !missingReasons.includes("publish_year")
          ) {
            return false;
          }
          if (
            triageFilter === "missing_tags" &&
            !missingReasons.includes("tags")
          ) {
            return false;
          }
        }
      }
      return true;
    });
  }, [
    authorInitial,
    catalogueEntries,
    catalogueQuery,
    divisionFilter,
    duplicateIdSet,
    shelfFilter,
    statusFilter,
    tagFilter,
    triageFilter,
  ]);

  const hasCatalogueFilters = Boolean(
    catalogueQuery ||
      divisionFilter ||
      tagFilter ||
      shelfFilter ||
      statusFilter ||
      authorInitial ||
      triageFilter,
  );

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (catalogueQuery.trim()) {
      chips.push({
        key: "query",
        label: `Search: "${catalogueQuery.trim()}"`,
        clear: () => setCatalogueQuery(""),
      });
    }
    if (divisionFilter) {
      chips.push({
        key: "division",
        label: `Division: ${divisionFilter}`,
        clear: () => setDivisionFilter(""),
      });
    }
    if (tagFilter) {
      chips.push({
        key: "subject",
        label: `Subject: ${tagFilter}`,
        clear: () => setTagFilter(""),
      });
    }
    if (shelfFilter) {
      chips.push({
        key: "shelf",
        label: `Shelf ${shelfFilter}`,
        clear: () => setShelfFilter(""),
      });
    }
    if (statusFilter) {
      chips.push({
        key: "status",
        label: `Status: ${
          statusFilter === "loaned"
            ? "Loaned out"
            : READING_STATUS_LABELS[statusFilter]
        }`,
        clear: () => setStatusFilter(""),
      });
    }
    if (authorInitial) {
      chips.push({
        key: "author",
        label: `Author: ${authorInitial}`,
        clear: () => setAuthorInitial(""),
      });
    }
    if (triageFilter) {
      chips.push({
        key: "triage",
        label: TRIAGE_FILTER_CHIP_LABELS[triageFilter],
        clear: () => setTriageFilter(""),
      });
    }
    return chips;
  }, [
    authorInitial,
    catalogueQuery,
    divisionFilter,
    shelfFilter,
    statusFilter,
    tagFilter,
    triageFilter,
  ]);

  const clearCatalogueFilters = () => {
    setCatalogueQuery("");
    setDivisionFilter("");
    setTagFilter("");
    setShelfFilter("");
    setStatusFilter("");
    setAuthorInitial("");
    setTriageFilter("");
  };

  const activeBook = useMemo(() => {
    if (!activeBookId) return null;
    return (
      catalogueEntries.find(
        (book) => getBookKey(book) === activeBookId || book.id === activeBookId,
      ) ?? null
    );
  }, [activeBookId, catalogueEntries]);

  const pathfinderSourceBook = useMemo(() => {
    if (!pathfinderSourceId) return null;
    return (
      catalogueEntries.find(
        (book) =>
          getBookKey(book) === pathfinderSourceId ||
          book.id === pathfinderSourceId,
      ) ?? null
    );
  }, [catalogueEntries, pathfinderSourceId]);

  const openPathfinder = (sourceBook?: LedgerBook) => {
    setPathfinderSourceId(sourceBook ? getBookKey(sourceBook) : null);
    setIsPathfinderOpen(true);
  };

  const filterByTag = (tag: string) => {
    setActiveBookId(null);
    setActiveTag(null);
    setIsPathfinderOpen(false);
    setTagFilter(tag);
    setBottomView("ledger");
    window.requestAnimationFrame(() => {
      document
        .getElementById("catalogue-search")
        ?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const handleBookSaved = (
    savedBook: CatalogueBook,
    mode: "create" | "edit",
    previousId?: string,
  ) => {
    if (mode === "create") {
      setBooks((prev) => [...prev, savedBook]);
      showToast(
        "success",
        `Added "${savedBook.title}" to Shelf ${savedBook.shelf}.`,
      );
      return;
    }

    const matchId = previousId ?? savedBook.id;
    setBooks((prev) =>
      prev.map((candidate) =>
        candidate.id === matchId || getBookKey(candidate) === matchId
          ? savedBook
          : candidate,
      ),
    );
    if (activeBookId === matchId) {
      setActiveBookId(getBookKey(savedBook));
    }
    showToast("success", `Updated "${savedBook.title}".`);
  };

  const requireCuratorAuth = (reason?: string, afterAuth?: () => void) => {
    justAuthenticatedRef.current = false;
    pendingAuthActionRef.current = afterAuth ?? null;
    setAuthPromptReason(reason ?? null);
    setIsAuthModalOpen(true);
  };

  const handleUnauthorized = (reason?: string) => {
    setAuthState({ authRequired: true, isCurator: false });
    setIsBulkMode(false);
    requireCuratorAuth(
      reason ?? "Your curator session has expired. Please sign in to continue.",
    );
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const response = await fetch("/api/auth/session", { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as {
        authRequired?: boolean;
        isCurator?: boolean;
        error?: string;
      };
      if (!response.ok) {
        showToast("error", data.error || "Could not sign out.");
        return;
      }
      setAuthState({
        authRequired: data.authRequired ?? authState.authRequired,
        isCurator: Boolean(data.isCurator),
      });
      setIsBulkMode(false);
      setSelectedBookIds(new Set());
      showToast("success", "Signed out of curator mode.");
    } catch {
      showToast("error", "Network error while signing out.");
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleUpdateBook = async (
    bookId: string,
    patch: BookUpdatePatch,
  ): Promise<CatalogueBook> => {
    const response = await fetch(
      `/api/books/${encodeURIComponent(bookId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );

    const data = (await response.json().catch(() => ({}))) as {
      book?: CatalogueBook;
      error?: string;
    };

    if (response.status === 401) {
      const msg = data.error || "Curator sign-in required to update volumes.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.book) {
      const msg = data.error || "Could not update volume.";
      showToast("error", msg);
      throw new Error(msg);
    }

    const updated = data.book;
    setBooks((prev) =>
      prev.map((candidate) =>
        candidate.id === bookId ||
        getBookKey(candidate) === bookId ||
        candidate.id === updated.id
          ? updated
          : candidate,
      ),
    );
    if (activeBookId === bookId || activeBookId === getBookKey(updated)) {
      setActiveBookId(getBookKey(updated));
    }
    return updated;
  };

  const handleToggleBulkMode = () => {
    if (isBulkMode) {
      setIsBulkMode(false);
      setSelectedBookIds(new Set());
      return;
    }
    if (!canEdit) {
      requireCuratorAuth(
        "Curator sign-in is required before making bulk catalogue changes.",
        () => setIsBulkMode(true),
      );
      return;
    }
    setIsBulkMode(true);
  };

  const handleToggleSelect = (bookId: string) => {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) {
        next.delete(bookId);
      } else {
        next.add(bookId);
      }
      return next;
    });
  };

  const handleSelectVisible = (visibleBooks: readonly LedgerBook[]) => {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      for (const book of visibleBooks) {
        next.add(book.id);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedBookIds(new Set());
  };

  const handleBulkUpdate = async (patch: BulkBookPatch) => {
    const validBookIds = new Set(books.map((book) => book.id));
    const ids = [...selectedBookIds].filter((id) => validBookIds.has(id));
    if (ids.length === 0) {
      return;
    }

    setIsApplyingBulk(true);
    try {
      const response = await fetch("/api/books/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, patch }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        updated?: CatalogueBook[];
        skipped?: Array<{ id: string; reason: string }>;
        error?: string;
      };

      if (response.status === 401) {
        const msg =
          data.error || "Curator sign-in required to apply bulk updates.";
        handleUnauthorized(msg);
        throw new Error(msg);
      }

      if (!response.ok || !Array.isArray(data.updated)) {
        const msg = data.error || "Could not apply bulk catalogue updates.";
        showToast("error", msg);
        throw new Error(msg);
      }

      const updatedList = data.updated;
      const skippedList = Array.isArray(data.skipped) ? data.skipped : [];
      const updatedById = new Map<string, CatalogueBook>();
      for (const updated of updatedList) {
        updatedById.set(updated.id, updated);
        updatedById.set(getBookKey(updated), updated);
      }

      setBooks((prev) =>
        prev.map(
          (candidate) =>
            updatedById.get(candidate.id) ??
            updatedById.get(getBookKey(candidate)) ??
            candidate,
        ),
      );

      setSelectedBookIds(new Set());
      const skippedNote =
        skippedList.length > 0 ? ` (${skippedList.length} skipped)` : "";
      showToast(
        "success",
        `Updated ${updatedList.length} ${updatedList.length === 1 ? "volume" : "volumes"}${skippedNote}.`,
      );
    } finally {
      setIsApplyingBulk(false);
    }
  };

  const handleDeleteBook = async (bookId: string, bookTitle: string) => {
    const response = await fetch(
      `/api/books/${encodeURIComponent(bookId)}`,
      {
        method: "DELETE",
      },
    );

    const data = (await response.json().catch(() => ({}))) as {
      deleted?: boolean;
      id?: string;
      error?: string;
    };

    if (response.status === 401) {
      const msg = data.error || "Curator sign-in required to remove volumes.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.deleted) {
      const msg = data.error || "Could not remove volume.";
      showToast("error", msg);
      throw new Error(msg);
    }

    setBooks((prev) => prev.filter((candidate) => candidate.id !== bookId));
    setSelectedBookIds((prev) => {
      if (!prev.has(bookId)) return prev;
      const next = new Set(prev);
      next.delete(bookId);
      return next;
    });
    setConnections((prev) =>
      prev.filter(
        (conn) =>
          conn.source_book_id !== bookId && conn.target_book_id !== bookId,
      ),
    );
    setQuotes((prev) => prev.filter((quote) => quote.book_id !== bookId));
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        items: list.items.filter((item) => item.book_id !== bookId),
      })),
    );
    setActiveBookId((prev) => (prev === bookId ? null : prev));
    setPathfinderSourceId((prev) => (prev === bookId ? null : prev));
    setReadNextSeedBookId((prev) => (prev === bookId ? null : prev));
    showToast("success", `Removed "${bookTitle}" from the catalogue.`);
  };

  const handleCreateConnection = async (
    input: CreateEditorialConnectionInput,
  ): Promise<EditorialConnection> => {
    const response = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_book_id: input.source_book_id,
        target_book_id: input.target_book_id,
        connection_type: input.connection_type,
        description: input.description,
        weight: input.weight ?? 2,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      connection?: EditorialConnection;
      error?: string;
    };

    if (response.status === 401) {
      const msg =
        data.error || "Curator sign-in required to create editorial links.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.connection) {
      const msg = data.error || "Could not save editorial link.";
      showToast("error", msg);
      throw new Error(msg);
    }

    const saved = data.connection;
    const savedPair = normalizeConnectionPairKey(
      saved.source_book_id,
      saved.target_book_id,
    );
    setConnections((prev) => [
      saved,
      ...prev.filter(
        (item) =>
          item.id !== saved.id &&
          normalizeConnectionPairKey(
            item.source_book_id,
            item.target_book_id,
          ) !== savedPair,
      ),
    ]);
    showToast("success", "Editorial connection saved.");
    return saved;
  };

  const handleDeleteConnection = async (connectionId: string) => {
    const response = await fetch(
      `/api/connections/${encodeURIComponent(connectionId)}`,
      {
        method: "DELETE",
      },
    );

    const data = (await response.json().catch(() => ({}))) as {
      deleted?: boolean;
      id?: string;
      error?: string;
    };

    if (response.status === 401) {
      const msg =
        data.error || "Curator sign-in required to remove editorial links.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.deleted) {
      const msg = data.error || "Could not remove editorial link.";
      showToast("error", msg);
      throw new Error(msg);
    }

    setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
    showToast("success", "Editorial connection removed.");
  };

  const handleCreateQuote = async (
    input: CreateQuoteInput,
  ): Promise<BookQuote> => {
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const data = (await response.json().catch(() => ({}))) as {
      quote?: BookQuote;
      error?: string;
    };

    if (response.status === 401) {
      const msg =
        data.error ||
        "Curator sign-in required to save passages to the Commonplace Book.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.quote) {
      const msg = data.error || "Could not save passage.";
      showToast("error", msg);
      throw new Error(msg);
    }

    const savedQuote = data.quote;
    setQuotes((prev) => [savedQuote, ...prev]);
    showToast("success", "Saved passage to Commonplace Book.");
    return savedQuote;
  };

  const handleDeleteQuote = async (quoteId: string) => {
    const response = await fetch(
      `/api/quotes/${encodeURIComponent(quoteId)}`,
      {
        method: "DELETE",
      },
    );

    const data = (await response.json().catch(() => ({}))) as {
      deleted?: boolean;
      id?: string;
      error?: string;
    };

    if (response.status === 401) {
      const msg = data.error || "Curator sign-in required to delete passages.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.deleted) {
      const msg = data.error || "Could not delete passage.";
      showToast("error", msg);
      throw new Error(msg);
    }

    setQuotes((prev) => prev.filter((quote) => quote.id !== quoteId));
    showToast("success", "Removed passage from Commonplace Book.");
  };

  const handleCreateList = async (
    input: CreateReadingListInput,
  ): Promise<ReadingList> => {
    const response = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    const data = (await response.json().catch(() => ({}))) as {
      list?: ReadingList;
      error?: string;
    };

    if (response.status === 401) {
      const msg =
        data.error || "Curator sign-in required to create reading lists.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.list) {
      const msg = data.error || "Could not create reading list.";
      showToast("error", msg);
      throw new Error(msg);
    }

    const createdList = data.list;
    setLists((prev) => [...prev, createdList]);
    showToast("success", `Created reading list "${createdList.name}".`);
    return createdList;
  };

  const handleDeleteList = async (listId: string) => {
    const response = await fetch(`/api/lists/${encodeURIComponent(listId)}`, {
      method: "DELETE",
    });

    const data = (await response.json().catch(() => ({}))) as {
      deleted?: boolean;
      id?: string;
      error?: string;
    };

    if (response.status === 401) {
      const msg =
        data.error || "Curator sign-in required to delete reading lists.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.deleted) {
      const msg = data.error || "Could not delete reading list.";
      showToast("error", msg);
      throw new Error(msg);
    }

    setLists((prev) => prev.filter((list) => list.id !== listId));
    showToast("success", "Reading list deleted.");
  };

  const handleAddBookToList = async (
    listId: string,
    bookId: string,
  ): Promise<ReadingList> => {
    const response = await fetch(
      `/api/lists/${encodeURIComponent(listId)}/items`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId }),
      },
    );

    const data = (await response.json().catch(() => ({}))) as {
      list?: ReadingList;
      error?: string;
    };

    if (response.status === 401) {
      const msg =
        data.error || "Curator sign-in required to update reading lists.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.list) {
      const msg = data.error || "Could not add volume to reading list.";
      showToast("error", msg);
      throw new Error(msg);
    }

    const updatedList = data.list;
    setLists((prev) =>
      prev.map((candidate) =>
        candidate.id === updatedList.id ? updatedList : candidate,
      ),
    );
    const addedBook = booksById.get(bookId);
    showToast(
      "success",
      addedBook
        ? `Added "${addedBook.title}" to ${updatedList.name}.`
        : `Added volume to ${updatedList.name}.`,
    );
    return updatedList;
  };

  const handleReorderList = async (
    listId: string,
    bookIds: string[],
  ): Promise<ReadingList> => {
    const response = await fetch(
      `/api/lists/${encodeURIComponent(listId)}/items`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_ids: bookIds }),
      },
    );

    const data = (await response.json().catch(() => ({}))) as {
      list?: ReadingList;
      error?: string;
    };

    if (response.status === 401) {
      const msg =
        data.error || "Curator sign-in required to reorder reading lists.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.list) {
      const msg = data.error || "Could not reorder reading list.";
      showToast("error", msg);
      throw new Error(msg);
    }

    const updatedList = data.list;
    setLists((prev) =>
      prev.map((candidate) =>
        candidate.id === updatedList.id ? updatedList : candidate,
      ),
    );
    return updatedList;
  };

  const handleRemoveBookFromList = async (
    listId: string,
    bookId: string,
  ): Promise<ReadingList> => {
    const response = await fetch(
      `/api/lists/${encodeURIComponent(listId)}/items?book_id=${encodeURIComponent(bookId)}`,
      {
        method: "DELETE",
      },
    );

    const data = (await response.json().catch(() => ({}))) as {
      list?: ReadingList;
      deleted?: boolean;
      error?: string;
    };

    if (response.status === 401) {
      const msg =
        data.error ||
        "Curator sign-in required to remove volumes from reading lists.";
      handleUnauthorized(msg);
      throw new Error(msg);
    }

    if (!response.ok || !data.list) {
      const msg = data.error || "Could not remove volume from reading list.";
      showToast("error", msg);
      throw new Error(msg);
    }

    const updatedList = data.list;
    setLists((prev) =>
      prev.map((candidate) =>
        candidate.id === updatedList.id ? updatedList : candidate,
      ),
    );
    showToast("success", `Removed volume from ${updatedList.name}.`);
    return updatedList;
  };

  const handleQueueUpNext = async (book: CatalogueBook): Promise<void> => {
    let queueList = lists.find((list) => list.is_queue);
    if (!queueList) {
      queueList = await handleCreateList({
        name: "Up Next",
        description: "Ranked volumes queued to read next.",
        is_queue: true,
      });
    }

    if (queueList.items.some((item) => item.book_id === book.id)) {
      showToast("success", `Already in ${queueList.name}.`);
      return;
    }

    await handleAddBookToList(queueList.id, book.id);
  };

  const handleMapTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextMode: "similarity" | "tag" | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      nextMode = mapMode === "similarity" ? "tag" : "similarity";
    } else if (event.key === "Home") {
      nextMode = "similarity";
    } else if (event.key === "End") {
      nextMode = "tag";
    }
    if (!nextMode) return;
    event.preventDefault();
    setMapMode(nextMode);
    if (nextMode === "similarity") {
      similarityTabRef.current?.focus();
    } else {
      tagTabRef.current?.focus();
    }
  };

  const selectResultsTab = (nextView: ResultsTab, moveFocus = false) => {
    setBottomView(nextView);
    const targetRef =
      nextView === "ledger"
        ? ledgerTabRef.current
        : nextView === "shelves"
          ? shelvesTabRef.current
          : nextView === "timeline"
            ? timelineTabRef.current
            : nextView === "lists"
              ? listsTabRef.current
              : commonplaceTabRef.current;
    if (moveFocus) {
      targetRef?.focus();
    }
    targetRef?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const handleResultsTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    const currentIndex = RESULTS_TABS.indexOf(bottomView);
    let nextIndex = -1;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % RESULTS_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + RESULTS_TABS.length) % RESULTS_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = RESULTS_TABS.length - 1;
    }
    if (nextIndex < 0) return;
    event.preventDefault();
    selectResultsTab(RESULTS_TABS[nextIndex], true);
  };

  const resultsSection = (
    <section
      id="catalogue-results"
      className="catalogue-results-section"
      aria-label="Catalogue volume views"
    >
      {triageFilter && (
        <CuratorTriagePanel
          triageFilter={triageFilter}
          duplicateGroups={triageSummary.duplicateGroups}
          triageSummary={triageSummary}
          canEdit={canEdit}
          onInspectBook={(book) => setActiveBookId(getBookKey(book))}
          onDeleteBook={handleDeleteBook}
          onRequestAuth={requireCuratorAuth}
          onClearTriage={() => setTriageFilter("")}
        />
      )}

      <div className="view-tabs-container bottom-tabs-container">
        <div
          className="view-tabs"
          role="tablist"
          aria-label="Catalogue listing format"
        >
          <button
            ref={ledgerTabRef}
            id="results-tab-ledger"
            type="button"
            role="tab"
            aria-selected={bottomView === "ledger"}
            tabIndex={bottomView === "ledger" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => selectResultsTab("ledger")}
            onKeyDown={handleResultsTabKeyDown}
          >
            SHELF LEDGER
          </button>
          <button
            ref={shelvesTabRef}
            id="results-tab-shelves"
            type="button"
            role="tab"
            aria-selected={bottomView === "shelves"}
            tabIndex={bottomView === "shelves" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => selectResultsTab("shelves")}
            onKeyDown={handleResultsTabKeyDown}
          >
            PHYSICAL SHELVES
          </button>
          <button
            ref={timelineTabRef}
            id="results-tab-timeline"
            type="button"
            role="tab"
            aria-selected={bottomView === "timeline"}
            tabIndex={bottomView === "timeline" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => selectResultsTab("timeline")}
            onKeyDown={handleResultsTabKeyDown}
          >
            DECADAL TIMELINE
          </button>
          <button
            ref={listsTabRef}
            id="results-tab-lists"
            type="button"
            role="tab"
            aria-selected={bottomView === "lists"}
            tabIndex={bottomView === "lists" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => selectResultsTab("lists")}
            onKeyDown={handleResultsTabKeyDown}
          >
            READING LISTS
          </button>
          <button
            ref={commonplaceTabRef}
            id="results-tab-commonplace"
            type="button"
            role="tab"
            aria-selected={bottomView === "commonplace"}
            tabIndex={bottomView === "commonplace" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => selectResultsTab("commonplace")}
            onKeyDown={handleResultsTabKeyDown}
          >
            COMMONPLACE
          </button>
        </div>
      </div>

      <div
        role="tabpanel"
        id="results-panel-ledger"
        aria-labelledby="results-tab-ledger"
        hidden={bottomView !== "ledger"}
      >
        {bottomView === "ledger" && (
          <CatalogueLedger
            key={[
              catalogueQuery,
              divisionFilter,
              tagFilter,
              shelfFilter,
              statusFilter,
              authorInitial,
              triageFilter,
            ].join("|")}
            entries={filteredCatalogueEntries}
            onBookClick={(book) => setActiveBookId(getBookKey(book))}
            isBulkMode={isBulkMode}
            onToggleBulkMode={handleToggleBulkMode}
            selectedIds={selectedBookIds}
            onToggleSelect={handleToggleSelect}
            onSelectVisible={handleSelectVisible}
            onClearSelection={handleClearSelection}
            divisions={divisions
              .map((division) => division.name)
              .filter((name) => name !== "Unclassified")}
            onApplyBulkUpdate={handleBulkUpdate}
            isApplyingBulk={isApplyingBulk}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="results-panel-shelves"
        aria-labelledby="results-tab-shelves"
        hidden={bottomView !== "shelves"}
      >
        {bottomView === "shelves" && (
          <PhysicalShelfView
            books={filteredCatalogueEntries}
            onBookClick={(book) => setActiveBookId(getBookKey(book))}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="results-panel-timeline"
        aria-labelledby="results-tab-timeline"
        hidden={bottomView !== "timeline"}
      >
        {bottomView === "timeline" && (
          <ChronologicalScroll
            books={filteredCatalogueEntries}
            onBookClick={(book) => setActiveBookId(getBookKey(book))}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="results-panel-lists"
        aria-labelledby="results-tab-lists"
        hidden={bottomView !== "lists"}
      >
        {bottomView === "lists" && (
          <ReadingListsView
            lists={lists}
            books={catalogueEntries}
            canEdit={canEdit}
            onRequireAuth={(reason) => requireCuratorAuth(reason)}
            onInspectBook={(book) => setActiveBookId(getBookKey(book))}
            onStartReading={async (book) => {
              await handleUpdateBook(book.id, { reading_status: "reading" });
              showToast("success", `Marked "${book.title}" as Reading.`);
            }}
            onCreateList={handleCreateList}
            onDeleteList={handleDeleteList}
            onAddBookToList={handleAddBookToList}
            onReorderList={handleReorderList}
            onRemoveBookFromList={handleRemoveBookFromList}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id="results-panel-commonplace"
        aria-labelledby="results-tab-commonplace"
        hidden={bottomView !== "commonplace"}
      >
        {bottomView === "commonplace" && (
          <CommonplaceView
            quotes={quotes}
            books={catalogueEntries}
            canEdit={canEdit}
            onRequireAuth={(reason) => requireCuratorAuth(reason)}
            onInspectBook={(book) => setActiveBookId(getBookKey(book))}
            onCreateQuote={handleCreateQuote}
            onDeleteQuote={handleDeleteQuote}
          />
        )}
      </div>
    </section>
  );

  return (
    <main className="catalogue-page">
      <div
        className="catalogue-toast-region"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusToast && (
          <div className={`catalogue-toast catalogue-toast--${statusToast.kind}`}>
            <span>{statusToast.message}</span>
            <button
              type="button"
              className="catalogue-toast-dismiss"
              onClick={() => setStatusToast(null)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        )}
      </div>

      <header className="catalogue-masthead">
        <div className="catalogue-kicker-row">
          <p className="catalogue-kicker">
            Printed for private circulation ·{" "}
            <span className="catalogue-storage-note">
              {storageMode === "supabase" ? "Supabase synced" : "Local catalogue"}
            </span>
          </p>
          {authState.authRequired && (
            <button
              type="button"
              className={`curator-status-btn font-mono ${authState.isCurator ? "is-curator" : ""}`}
              disabled={isSigningOut}
              onClick={() => {
                if (authState.isCurator) {
                  void handleSignOut();
                } else {
                  requireCuratorAuth(
                    "Sign in with the curator passphrase to add volumes, edit reading logs, or manage editorial links.",
                  );
                }
              }}
            >
              {authState.isCurator
                ? isSigningOut
                  ? "Signing out..."
                  : "Curator Mode · Sign Out"
                : "Curator Sign In"}
            </button>
          )}
        </div>
        <h1>Catalogue</h1>
        <p className="catalogue-dek">
          A descriptive register of the volumes presently entered in the Library
          of Babel, arranged by author and noting the shelf upon which each work
          may be consulted.
        </p>

        <dl className="catalogue-totals" aria-label="Catalogue totals">
          <div>
            <dt>Volumes</dt>
            <dd>{books.length}</dd>
          </div>
          <div>
            <dt>Shelves</dt>
            <dd>{shelfCount}</dd>
          </div>
          <div>
            <dt>Divisions</dt>
            <dd>{divisions.length}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{finishedCount}</dd>
          </div>
          <div>
            <dt>Reading</dt>
            <dd>{readingCount}</dd>
          </div>
        </dl>
      </header>

      <section className="catalogue-toolbar-section" aria-label="Catalogue actions">
        <div className="catalogue-toolbar">
          <button
            type="button"
            className="toolbar-btn font-mono"
            onClick={() => {
              setReadNextSeedBookId(null);
              setIsReadNextOpen(true);
            }}
          >
            <span aria-hidden="true">✦</span>
            <span className="toolbar-btn-copy">
              <strong>Read Next</strong>
              <small>Shelf picks &amp; Librarian</small>
            </span>
          </button>

          <button
            type="button"
            className="toolbar-btn font-mono"
            onClick={() => openPathfinder()}
          >
            <span aria-hidden="true">❖</span>
            <span className="toolbar-btn-copy">
              <strong>Find a connection</strong>
              <small>Trace a path between two books</small>
            </span>
          </button>

          <button
            type="button"
            className="toolbar-btn font-mono"
            onClick={() => {
              if (!canEdit) {
                requireCuratorAuth(
                  "Curator sign-in is required before adding a new volume to the catalogue.",
                  () => setEditorState({ mode: "create" }),
                );
                return;
              }
              setEditorState({ mode: "create" });
            }}
          >
            <span aria-hidden="true">＋</span>
            <span className="toolbar-btn-copy">
              <strong>Add volume</strong>
              <small>Enter a new shelf accession</small>
            </span>
          </button>

          <button
            type="button"
            className="toolbar-btn font-mono"
            onClick={() => setIsStatsOpen(true)}
          >
            <span aria-hidden="true">▤</span>
            <span className="toolbar-btn-copy">
              <strong>Stats &amp; Export</strong>
              <small>Reading progress, loans &amp; data</small>
            </span>
          </button>

          <button
            type="button"
            className="toolbar-btn btn-aleph font-mono"
            onClick={() => {
              setQuoteIndex(
                alephPool.length > 0
                  ? Math.floor(Math.random() * alephPool.length)
                  : 0,
              );
              setIsAlephOpen(true);
            }}
          >
            <span aria-hidden="true">👁</span>
            <span className="toolbar-btn-copy">
              <strong>The Aleph</strong>
              <small>Reveal a catalogue meditation</small>
            </span>
          </button>
        </div>
      </section>

      <section
        className="catalogue-search-panel"
        id="catalogue-search"
        aria-labelledby="catalogue-search-title"
      >
        <div className="catalogue-search-heading">
          <p>Public finding aid</p>
          <h2 id="catalogue-search-title">Search the catalogue</h2>
          <p>
            Find a volume by title, author, subject, shelf, reading status, or
            catalogue detail.
          </p>
        </div>

        <search>
          <div className="catalogue-search-controls">
            <div className="catalogue-search-field catalogue-search-query">
              <label htmlFor={queryInputId}>Title, author, or keyword</label>
              <input
                id={queryInputId}
                type="search"
                value={catalogueQuery}
                onChange={(event) => setCatalogueQuery(event.target.value)}
                placeholder="Try Borges, poetry, or Penguin Classics"
              />
            </div>

            <div className="catalogue-search-field">
              <label htmlFor={divisionSelectId}>Division</label>
              <select
                id={divisionSelectId}
                value={divisionFilter}
                onChange={(event) => setDivisionFilter(event.target.value)}
              >
                <option value="">All divisions</option>
                {divisions.map((division) => (
                  <option key={division.name} value={division.name}>
                    {division.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="catalogue-search-field">
              <label htmlFor={subjectSelectId}>Subject</label>
              <select
                id={subjectSelectId}
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
              >
                <option value="">All subjects</option>
                {tagFilter && !catalogueTags.includes(tagFilter) && (
                  <option value={tagFilter}>{tagFilter}</option>
                )}
                {catalogueTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>

            <div className="catalogue-search-field">
              <label htmlFor={shelfSelectId}>Shelf</label>
              <select
                id={shelfSelectId}
                value={shelfFilter}
                onChange={(event) => setShelfFilter(event.target.value)}
              >
                <option value="">All shelves</option>
                {catalogueShelves.map((shelf) => (
                  <option key={shelf} value={shelf}>
                    Shelf {shelf}
                  </option>
                ))}
              </select>
            </div>

            <div className="catalogue-search-field">
              <label htmlFor={statusSelectId}>Reading status</label>
              <select
                id={statusSelectId}
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilterValue)
                }
              >
                <option value="">All statuses</option>
                {READING_STATUS_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {READING_STATUS_LABELS[status]}
                  </option>
                ))}
                <option value="loaned">Loaned out</option>
              </select>
            </div>

            <div className="catalogue-search-field">
              <label htmlFor={triageSelectId}>Curator triage</label>
              <select
                id={triageSelectId}
                value={triageFilter}
                onChange={(event) =>
                  setTriageFilter(event.target.value as TriageFilter)
                }
              >
                <option value="">All records</option>
                <option value="missing_any">
                  Missing any metadata ({triageSummary.missing_any})
                </option>
                <option value="missing_summary">
                  Missing summary ({triageSummary.missing_summary})
                </option>
                <option value="missing_year">
                  Missing publish year ({triageSummary.missing_year})
                </option>
                <option value="missing_tags">
                  Missing subjects ({triageSummary.missing_tags})
                </option>
                <option value="duplicates">
                  Possible duplicates ({triageSummary.duplicates})
                </option>
              </select>
            </div>
          </div>
        </search>

        <div className="catalogue-search-status" aria-live="polite">
          <div className="catalogue-search-summary">
            <p>
              <strong>{filteredCatalogueEntries.length}</strong>{" "}
              {filteredCatalogueEntries.length === 1 ? "volume" : "volumes"}{" "}
              found
              {authorInitial && <> under author index {authorInitial}</>}.
            </p>
            {activeFilterChips.length > 0 && (
              <div
                className="active-filter-chips"
                aria-label="Active search filters"
              >
                {activeFilterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className="filter-chip"
                    onClick={chip.clear}
                    aria-label={`Remove ${chip.label} filter`}
                  >
                    <span>{chip.label}</span>
                    <span className="filter-chip-close" aria-hidden="true">
                      ×
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {hasCatalogueFilters && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={clearCatalogueFilters}
            >
              Clear search
            </button>
          )}
        </div>
      </section>

      {hasCatalogueFilters && resultsSection}

      <section className="catalogue-frontmatter" aria-label="Catalogue guide">
        <div className="catalogue-divisions">
          <h2>Principal divisions</h2>
          <ul>
            {divisions.map((division) => {
              const isSelected = divisionFilter === division.name;
              return (
                <li key={division.name}>
                  <button
                    type="button"
                    className="division-toggle-btn"
                    aria-pressed={isSelected}
                    onClick={() =>
                      setDivisionFilter((prev) =>
                        prev === division.name ? "" : division.name,
                      )
                    }
                  >
                    <span>{division.name}</span>
                    <strong>{division.count}</strong>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <nav className="catalogue-alphabet" aria-label="Author index">
          <h2>Author index</h2>
          <ol>
            <li>
              <a
                href="#catalogue-results"
                aria-current={!authorInitial ? "location" : undefined}
                onClick={() => setAuthorInitial("")}
              >
                All
              </a>
            </li>
            {[...catalogueByInitial.keys()].map((initial) => (
              <li key={initial}>
                <a
                  href="#catalogue-results"
                  aria-current={
                    authorInitial === initial ? "location" : undefined
                  }
                  onClick={() => setAuthorInitial(initial)}
                >
                  {initial}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </section>

      <div className="view-tabs-container">
        <div
          className="view-tabs"
          role="tablist"
          aria-label="Relational map mode"
        >
          <button
            ref={similarityTabRef}
            id="map-tab-similarity"
            type="button"
            role="tab"
            aria-selected={mapMode === "similarity"}
            tabIndex={mapMode === "similarity" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => setMapMode("similarity")}
            onKeyDown={handleMapTabKeyDown}
          >
            SIMILARITY MAP
          </button>
          <button
            ref={tagTabRef}
            id="map-tab-tag"
            type="button"
            role="tab"
            aria-selected={mapMode === "tag"}
            tabIndex={mapMode === "tag" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => setMapMode("tag")}
            onKeyDown={handleMapTabKeyDown}
          >
            SUBJECT TAG MAP
          </button>
        </div>
      </div>

      <div
        role="tabpanel"
        id="map-panel-similarity"
        aria-labelledby="map-tab-similarity"
        hidden={mapMode !== "similarity"}
      >
        <CatalogueConstellation
          books={catalogueEntries}
          editorialConnections={connections}
          onTagClick={setActiveTag}
          onBookClick={(book) => setActiveBookId(getBookKey(book))}
          mode="similarity"
        />
      </div>

      <div
        role="tabpanel"
        id="map-panel-tag"
        aria-labelledby="map-tab-tag"
        hidden={mapMode !== "tag"}
      >
        <CatalogueConstellation
          books={catalogueEntries}
          editorialConnections={connections}
          onTagClick={setActiveTag}
          onBookClick={(book) => setActiveBookId(getBookKey(book))}
          mode="tag"
        />
      </div>

      {!hasCatalogueFilters && resultsSection}

      {isPathfinderOpen && (
        <PathfinderModal
          key={pathfinderSourceId ?? "blank-pathfinder"}
          books={catalogueEntries}
          editorialConnections={connections}
          initialSource={pathfinderSourceBook}
          onClose={() => setIsPathfinderOpen(false)}
          onBookClick={(book) => setActiveBookId(getBookKey(book))}
        />
      )}

      {isStatsOpen && (
        <ReadingStatsModal
          books={catalogueEntries}
          onClose={() => setIsStatsOpen(false)}
          onBookClick={(book) => setActiveBookId(getBookKey(book))}
        />
      )}

      {isReadNextOpen && (
        <ReadNextModal
          isOpen={isReadNextOpen}
          onClose={() => setIsReadNextOpen(false)}
          books={catalogueEntries}
          connections={connections}
          divisions={divisions
            .map((division) => division.name)
            .filter((name) => name !== "Unclassified")}
          initialSeedBookId={readNextSeedBookId}
          librarianEnabled={librarianEnabled}
          canEdit={canEdit}
          onRequireAuth={(reason) => requireCuratorAuth(reason)}
          onInspectBook={(book) => {
            setIsReadNextOpen(false);
            setActiveBookId(getBookKey(book));
          }}
          onStartReading={async (book) => {
            await handleUpdateBook(book.id, { reading_status: "reading" });
            showToast("success", `Marked "${book.title}" as Reading.`);
          }}
          onQueueUpNext={handleQueueUpNext}
          queuedBookIds={queuedBookIds}
        />
      )}

      {activeBook && (
        <BookDetailCard
          key={getBookKey(activeBook)}
          book={activeBook}
          books={catalogueEntries}
          canEdit={canEdit}
          authRequired={authState.authRequired}
          onRequireAuth={() =>
            requireCuratorAuth(
              "Sign in as curator to edit the reading ledger or manage editorial connections.",
            )
          }
          connections={connections}
          onCreateConnection={handleCreateConnection}
          onDeleteConnection={handleDeleteConnection}
          quotes={quotes}
          lists={lists}
          onCreateQuote={handleCreateQuote}
          onDeleteQuote={handleDeleteQuote}
          onAddBookToList={handleAddBookToList}
          onRemoveBookFromList={handleRemoveBookFromList}
          onQueueUpNext={handleQueueUpNext}
          onBookClick={(book) => setActiveBookId(getBookKey(book))}
          onClose={() => setActiveBookId(null)}
          onStartPath={() => {
            const sourceBook = activeBook;
            setActiveBookId(null);
            openPathfinder(sourceBook);
          }}
          onRecommendSimilar={() => {
            const seedBook = activeBook;
            setActiveBookId(null);
            setReadNextSeedBookId(seedBook.id);
            setIsReadNextOpen(true);
          }}
          onTagClick={setActiveTag}
          onEditBook={() => {
            if (!canEdit) {
              const bookToEdit = activeBook;
              requireCuratorAuth(
                "Sign in as curator to amend volume records.",
                () => setEditorState({ mode: "edit", book: bookToEdit }),
              );
              return;
            }
            setEditorState({ mode: "edit", book: activeBook });
          }}
          onUpdateBook={handleUpdateBook}
          onDeleteBook={handleDeleteBook}
        />
      )}

      {activeTag && (
        <TagMatchesOverlay
          tag={activeTag}
          books={catalogueEntries}
          onClose={() => setActiveTag(null)}
          onBookClick={(book) => setActiveBookId(getBookKey(book))}
          onFilterByTag={filterByTag}
        />
      )}

      {editorState && (
        <BookEditorModal
          key={
            editorState.mode === "edit" && editorState.book
              ? `edit-${editorState.book.id}`
              : "create-book"
          }
          mode={editorState.mode}
          book={editorState.book}
          divisions={divisions.map((division) => division.name)}
          onClose={() => setEditorState(null)}
          onSaved={handleBookSaved}
          onUnauthorized={() =>
            handleUnauthorized(
              "Curator sign-in is required before saving volume changes.",
            )
          }
        />
      )}

      {isAlephOpen && alephPool.length > 0 && (
        <ModalDialog
          open
          onClose={() => setIsAlephOpen(false)}
          labelledBy="aleph-title"
          className="catalogue-dialog--aleph"
        >
          <AlephModalContent
            meditation={alephPool[quoteIndex % alephPool.length]}
            quoteIndex={quoteIndex}
            onNextQuote={() =>
              setQuoteIndex((prev) => (prev + 1) % alephPool.length)
            }
            onInspectBook={(bookId) => {
              const target = booksById.get(bookId);
              setIsAlephOpen(false);
              if (target) {
                setActiveBookId(getBookKey(target));
              }
            }}
            onClose={() => setIsAlephOpen(false)}
          />
        </ModalDialog>
      )}

      {isAuthModalOpen && (
        <CuratorAuthModal
          promptReason={authPromptReason}
          onClose={() => {
            if (!justAuthenticatedRef.current) {
              pendingAuthActionRef.current = null;
            }
            justAuthenticatedRef.current = false;
            setIsAuthModalOpen(false);
            setAuthPromptReason(null);
          }}
          onAuthenticated={(nextState) => {
            justAuthenticatedRef.current = true;
            const deferredAction = pendingAuthActionRef.current;
            pendingAuthActionRef.current = null;
            setIsAuthModalOpen(false);
            setAuthState(nextState);
            setAuthPromptReason(null);
            showToast("success", "Curator mode unlocked.");
            deferredAction?.();
          }}
        />
      )}
    </main>
  );
}
