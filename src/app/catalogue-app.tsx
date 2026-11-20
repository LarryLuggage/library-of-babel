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
import { CatalogueConstellation } from "./catalogue-constellation";
import { CatalogueLedger } from "./catalogue-ledger";
import { BookDetailCard, type BookUpdatePatch } from "./book-detail-card";
import { BookEditorModal } from "./book-editor-modal";
import { TagMatchesOverlay } from "./tag-matches-overlay";
import { ChronologicalScroll } from "./chronological-scroll";
import { PathfinderModal } from "./pathfinder-modal";
import { ModalDialog, useDialogClose } from "./modal-dialog";

type StatusFilterValue = "" | ReadingStatus | "loaned";

const ALEPH_QUOTES = [
  "I saw the populous sea, saw dawn and sunset, saw the multitudes of the Americas, saw a silvery cobweb in the center of a black pyramid, saw a splintered labyrinth (it was London), saw close-up endless eyes looking at me as though in a mirror, saw all the mirrors on earth and none of them reflected me...",
  "I saw the Aleph from all points, I saw in the Aleph the earth and in the earth the Aleph once more and in the Aleph the earth, I saw my own face and my own entrails, saw your face, and I felt dizzy and wept, because my eyes had seen that conjectural and secret object whose name men usurp, but which no man has looked upon: the inconceivable universe.",
  "The Library of Babel is infinite, periodic, and eternal. In its galleries, shelves, and volumes, all combinations of the orthographic symbols are registered. To consult the Aleph is to peer into the center of this vast library, where every volume is simultaneously present.",
];

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
  quoteIndex,
  onNextQuote,
  onClose,
}: {
  quoteIndex: number;
  onNextQuote: () => void;
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
          speculum mundi
        </span>
        <h2 id="aleph-title" className="aleph-heading">
          The Aleph of Babel
        </h2>

        <div className="aleph-typewriter-box">
          <TypewriterText key={quoteIndex} text={ALEPH_QUOTES[quoteIndex]} />
        </div>

        <div className="aleph-actions">
          <button
            type="button"
            className="aleph-btn font-mono"
            onClick={onNextQuote}
          >
            PEER AGAIN
          </button>
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

export function CatalogueApp({
  initialBooks,
  storageMode,
}: {
  initialBooks: CatalogueBook[];
  storageMode: StorageMode;
}) {
  const [books, setBooks] = useState<CatalogueBook[]>(initialBooks);
  const [prevInitialBooks, setPrevInitialBooks] = useState(initialBooks);
  if (initialBooks !== prevInitialBooks) {
    setPrevInitialBooks(initialBooks);
    setBooks(initialBooks);
  }

  // Filters
  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [shelfFilter, setShelfFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("");
  const [authorInitial, setAuthorInitial] = useState("");

  // Tabs
  const [mapMode, setMapMode] = useState<"similarity" | "tag">("similarity");
  const [bottomView, setBottomView] = useState<"ledger" | "timeline">("ledger");

  const similarityTabRef = useRef<HTMLButtonElement>(null);
  const tagTabRef = useRef<HTMLButtonElement>(null);
  const ledgerTabRef = useRef<HTMLButtonElement>(null);
  const timelineTabRef = useRef<HTMLButtonElement>(null);

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

  const catalogueEntries = useMemo<LedgerBook[]>(
    () =>
      [...books].sort(compareCatalogueBooks).map((book, index) => ({
        ...book,
        number: index + 1,
      })),
    [books],
  );

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
      return true;
    });
  }, [
    authorInitial,
    catalogueEntries,
    catalogueQuery,
    divisionFilter,
    shelfFilter,
    statusFilter,
    tagFilter,
  ]);

  const hasCatalogueFilters = Boolean(
    catalogueQuery ||
      divisionFilter ||
      tagFilter ||
      shelfFilter ||
      statusFilter ||
      authorInitial,
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
    return chips;
  }, [
    authorInitial,
    catalogueQuery,
    divisionFilter,
    shelfFilter,
    statusFilter,
    tagFilter,
  ]);

  const clearCatalogueFilters = () => {
    setCatalogueQuery("");
    setDivisionFilter("");
    setTagFilter("");
    setShelfFilter("");
    setStatusFilter("");
    setAuthorInitial("");
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

    if (!response.ok || !data.book) {
      const msg = data.error || "Could not update volume.";
      showToast("error", msg);
      throw new Error(msg);
    }

    const updated = data.book;
    setBooks((prev) =>
      prev.map((candidate) => (candidate.id === bookId ? updated : candidate)),
    );
    if (activeBookId === bookId) {
      setActiveBookId(getBookKey(updated));
    }
    return updated;
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

    if (!response.ok || !data.deleted) {
      const msg = data.error || "Could not remove volume.";
      showToast("error", msg);
      throw new Error(msg);
    }

    setBooks((prev) => prev.filter((candidate) => candidate.id !== bookId));
    setActiveBookId((prev) => (prev === bookId ? null : prev));
    setPathfinderSourceId((prev) => (prev === bookId ? null : prev));
    showToast("success", `Removed "${bookTitle}" from the catalogue.`);
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

  const handleResultsTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    let nextView: "ledger" | "timeline" | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      nextView = bottomView === "ledger" ? "timeline" : "ledger";
    } else if (event.key === "Home") {
      nextView = "ledger";
    } else if (event.key === "End") {
      nextView = "timeline";
    }
    if (!nextView) return;
    event.preventDefault();
    setBottomView(nextView);
    if (nextView === "ledger") {
      ledgerTabRef.current?.focus();
    } else {
      timelineTabRef.current?.focus();
    }
  };

  const resultsSection = (
    <section
      id="catalogue-results"
      className="catalogue-results-section"
      aria-label="Catalogue volume views"
    >
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
            onClick={() => setBottomView("ledger")}
            onKeyDown={handleResultsTabKeyDown}
          >
            SHELF LEDGER
          </button>
          <button
            ref={timelineTabRef}
            id="results-tab-timeline"
            type="button"
            role="tab"
            aria-selected={bottomView === "timeline"}
            tabIndex={bottomView === "timeline" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => setBottomView("timeline")}
            onKeyDown={handleResultsTabKeyDown}
          >
            DECADAL TIMELINE
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
            ].join("|")}
            entries={filteredCatalogueEntries}
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
        <p className="catalogue-kicker">
          Printed for private circulation ·{" "}
          <span className="catalogue-storage-note">
            {storageMode === "supabase" ? "Supabase synced" : "Local catalogue"}
          </span>
        </p>
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
            onClick={() => setEditorState({ mode: "create" })}
          >
            <span aria-hidden="true">＋</span>
            <span className="toolbar-btn-copy">
              <strong>Add volume</strong>
              <small>Enter a new shelf accession</small>
            </span>
          </button>

          <button
            type="button"
            className="toolbar-btn btn-aleph font-mono"
            onClick={() => {
              setQuoteIndex(Math.floor(Math.random() * ALEPH_QUOTES.length));
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
          initialSource={pathfinderSourceBook}
          onClose={() => setIsPathfinderOpen(false)}
          onBookClick={(book) => setActiveBookId(getBookKey(book))}
        />
      )}

      {activeBook && (
        <BookDetailCard
          key={getBookKey(activeBook)}
          book={activeBook}
          books={catalogueEntries}
          onBookClick={(book) => setActiveBookId(getBookKey(book))}
          onClose={() => setActiveBookId(null)}
          onStartPath={() => {
            const sourceBook = activeBook;
            setActiveBookId(null);
            openPathfinder(sourceBook);
          }}
          onTagClick={setActiveTag}
          onEditBook={() =>
            setEditorState({ mode: "edit", book: activeBook })
          }
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
        />
      )}

      {isAlephOpen && (
        <ModalDialog
          open
          onClose={() => setIsAlephOpen(false)}
          labelledBy="aleph-title"
          className="catalogue-dialog--aleph"
        >
          <AlephModalContent
            quoteIndex={quoteIndex}
            onNextQuote={() =>
              setQuoteIndex((prev) => (prev + 1) % ALEPH_QUOTES.length)
            }
            onClose={() => setIsAlephOpen(false)}
          />
        </ModalDialog>
      )}
    </main>
  );
}
