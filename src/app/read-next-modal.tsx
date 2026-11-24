"use client";

import { useId, useMemo, useRef, useState } from "react";
import {
  formatPublishYear,
  getBookKey,
  getDivision,
  type CatalogueBook,
  type LedgerBook,
} from "@/lib/books/catalogue";
import type { EditorialConnection } from "@/lib/books/connections";
import {
  getShelfRecommendations,
  type RecommenderEra,
  type RecommenderMode,
} from "@/lib/books/recommender";
import {
  runLocalLibrarianQuery,
  type LibrarianMessage,
  type LibrarianResponse,
} from "@/lib/books/librarian";
import { ModalDialog, useDialogClose } from "./modal-dialog";

type ReadNextTab = "recommender" | "librarian";

const READ_NEXT_TABS: readonly ReadNextTab[] = ["recommender", "librarian"];

const MODE_OPTIONS: ReadonlyArray<{
  value: RecommenderMode;
  label: string;
  description: string;
}> = [
  {
    value: "best_match",
    label: "Best Match",
    description: "Closest fit to your ratings, finished shelves, and links",
  },
  {
    value: "stretch",
    label: "Stretch Picks",
    description: "Adjacent divisions and unexpected bridges",
  },
  {
    value: "same_authors",
    label: "Favorite Authors",
    description: "Unread works by authors you already prize",
  },
];

const ERA_OPTIONS: ReadonlyArray<{ value: RecommenderEra; label: string }> = [
  { value: "", label: "All eras" },
  { value: "antiquity", label: "Antiquity (BCE)" },
  { value: "early_ce", label: "Medieval & Early CE" },
  { value: "1500_1899", label: "1500–1899" },
  { value: "1900_1969", label: "1900–1969" },
  { value: "1970_plus", label: "1970+" },
];

const STARTER_PROMPTS: readonly string[] = [
  "Unread 19th-century European novels",
  "Classical philosophy I haven't read yet",
  "Something philosophical linked to Borges or Kafka",
];

type ThreadEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; response: LibrarianResponse };

export interface ReadNextModalProps {
  isOpen: boolean;
  onClose: () => void;
  books: LedgerBook[];
  connections: EditorialConnection[];
  divisions: string[];
  initialSeedBookId?: string | null;
  librarianEnabled: boolean;
  canEdit: boolean;
  onRequireAuth: (reason: string) => void;
  onInspectBook: (book: CatalogueBook) => void;
  onStartReading: (book: CatalogueBook) => Promise<void>;
  onQueueUpNext?: (book: CatalogueBook) => Promise<void>;
  queuedBookIds?: ReadonlySet<string>;
}

function ReadNextContent({
  books,
  connections,
  divisions,
  initialSeedBookId = null,
  librarianEnabled,
  canEdit,
  titleId,
  onClose,
  onRequireAuth,
  onInspectBook,
  onStartReading,
  onQueueUpNext,
  queuedBookIds,
}: Omit<ReadNextModalProps, "isOpen"> & { titleId: string }) {
  const closeDialog = useDialogClose() ?? onClose;
  const idPrefix = useId();

  // Tab IDs & refs
  const recommenderTabId = `${idPrefix}-tab-recommender`;
  const librarianTabId = `${idPrefix}-tab-librarian`;
  const recommenderPanelId = `${idPrefix}-panel-recommender`;
  const librarianPanelId = `${idPrefix}-panel-librarian`;
  const recommenderTabRef = useRef<HTMLButtonElement>(null);
  const librarianTabRef = useRef<HTMLButtonElement>(null);

  // Form control IDs
  const divisionSelectId = `${idPrefix}-division`;
  const eraSelectId = `${idPrefix}-era`;
  const hideLoanedId = `${idPrefix}-hide-loaned`;
  const librarianPromptId = `${idPrefix}-librarian-prompt`;

  // Tab state
  const [activeTab, setActiveTab] = useState<ReadNextTab>("recommender");

  // Recommender state
  const [mode, setMode] = useState<RecommenderMode>("best_match");
  const [division, setDivision] = useState("");
  const [era, setEra] = useState<RecommenderEra>("");
  const [excludeLoaned, setExcludeLoaned] = useState(false);
  const [seedBookId, setSeedBookId] = useState<string | null>(
    initialSeedBookId ?? null,
  );
  const [prevInitialSeedBookId, setPrevInitialSeedBookId] = useState<
    string | null
  >(initialSeedBookId ?? null);

  if ((initialSeedBookId ?? null) !== prevInitialSeedBookId) {
    setPrevInitialSeedBookId(initialSeedBookId ?? null);
    setSeedBookId(initialSeedBookId ?? null);
    setActiveTab("recommender");
  }

  const [startingBookId, setStartingBookId] = useState<string | null>(null);
  const [queueingBookId, setQueueingBookId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Librarian state
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [promptInput, setPromptInput] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [librarianError, setLibrarianError] = useState<string | null>(null);
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);

  const recommendationResult = useMemo(
    () =>
      getShelfRecommendations(books, connections, {
        mode,
        division: division || undefined,
        era,
        excludeLoaned,
        seedBookId,
        limit: 12,
      }),
    [books, connections, division, era, excludeLoaned, mode, seedBookId],
  );

  const { profile, recommendations, totalUnreadPool, seedBook } =
    recommendationResult;

  const hasActiveFilters = Boolean(
    division || era || excludeLoaned || seedBookId || mode !== "best_match",
  );

  const selectTab = (nextTab: ReadNextTab, moveFocus = false) => {
    setActiveTab(nextTab);
    if (moveFocus) {
      const target =
        nextTab === "recommender"
          ? recommenderTabRef.current
          : librarianTabRef.current;
      target?.focus();
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = READ_NEXT_TABS.indexOf(activeTab);
    let nextIndex = -1;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % READ_NEXT_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + READ_NEXT_TABS.length) % READ_NEXT_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = READ_NEXT_TABS.length - 1;
    }
    if (nextIndex < 0) return;
    event.preventDefault();
    selectTab(READ_NEXT_TABS[nextIndex], true);
  };

  const handleResetFilters = () => {
    setMode("best_match");
    setDivision("");
    setEra("");
    setExcludeLoaned(false);
    setSeedBookId(null);
  };

  const handleStartReadingClick = async (book: CatalogueBook) => {
    setActionError(null);
    if (!canEdit) {
      onRequireAuth(
        "Sign in as curator to mark volumes as currently reading.",
      );
      return;
    }
    setStartingBookId(book.id);
    try {
      await onStartReading(book);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not mark this volume as currently reading.",
      );
    } finally {
      setStartingBookId(null);
    }
  };

  const handleQueueUpNextClick = async (book: CatalogueBook) => {
    if (!onQueueUpNext) return;
    setActionError(null);
    if (!canEdit) {
      onRequireAuth("Sign in as curator to add volumes to your Up Next queue.");
      return;
    }
    setQueueingBookId(book.id);
    try {
      await onQueueUpNext(book);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not add this volume to Up Next.",
      );
    } finally {
      setQueueingBookId(null);
    }
  };

  const appendLocalAnswer = (trimmedPrompt: string) => {
    const localResponse = runLocalLibrarianQuery(
      books,
      connections,
      trimmedPrompt,
    );
    const stamp = Date.now();
    setThread((prev) => [
      ...prev,
      { id: `user-${stamp}`, role: "user", text: trimmedPrompt },
      { id: `assistant-${stamp + 1}`, role: "assistant", response: localResponse },
    ]);
    setPromptInput("");
    setLibrarianError(null);
    setFailedPrompt(null);
  };

  const submitLibrarianPrompt = async (rawPrompt: string) => {
    const trimmedPrompt = rawPrompt.trim();
    if (!trimmedPrompt || isAsking) {
      return;
    }

    setLibrarianError(null);
    setFailedPrompt(null);

    // Public visitors when Gemini is configured get instant local shelf answers without hitting 401
    if (librarianEnabled && !canEdit) {
      appendLocalAnswer(trimmedPrompt);
      return;
    }

    const history: LibrarianMessage[] = thread.map((entry) =>
      entry.role === "user"
        ? { role: "user", text: entry.text }
        : { role: "assistant", text: entry.response.reply },
    );

    const stamp = Date.now();
    const userEntryId = `user-${stamp}`;
    setThread((prev) => [
      ...prev,
      { id: userEntryId, role: "user", text: trimmedPrompt },
    ]);
    setPromptInput("");
    setIsAsking(true);

    try {
      const response = await fetch("/api/librarian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmedPrompt, history }),
      });

      const data = (await response.json().catch(() => ({}))) as Partial<
        LibrarianResponse
      > & { error?: string };

      if (response.status === 401) {
        setThread((prev) => prev.filter((item) => item.id !== userEntryId));
        setPromptInput(trimmedPrompt);
        const msg =
          data.error ||
          "Sign in as curator to use the Gemini AI Librarian.";
        setLibrarianError(msg);
        setFailedPrompt(trimmedPrompt);
        onRequireAuth(msg);
        return;
      }

      if (response.status === 429) {
        setThread((prev) => prev.filter((item) => item.id !== userEntryId));
        setPromptInput(trimmedPrompt);
        setLibrarianError(
          data.error ||
            "The AI Librarian is temporarily rate-limited. Try again shortly or use Local Shelf Search.",
        );
        setFailedPrompt(trimmedPrompt);
        return;
      }

      if (
        !response.ok ||
        typeof data.reply !== "string" ||
        !Array.isArray(data.recommendations)
      ) {
        setThread((prev) => prev.filter((item) => item.id !== userEntryId));
        setPromptInput(trimmedPrompt);
        setLibrarianError(
          data.error ||
            "The Librarian could not complete that request right now.",
        );
        setFailedPrompt(trimmedPrompt);
        return;
      }

      const librarianResponse: LibrarianResponse = {
        mode: data.mode === "gemini" ? "gemini" : "local",
        model: data.model,
        reply: data.reply,
        recommendations: data.recommendations,
      };

      setThread((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          response: librarianResponse,
        },
      ]);
    } catch {
      setThread((prev) => prev.filter((item) => item.id !== userEntryId));
      setPromptInput(trimmedPrompt);
      setLibrarianError(
        "Network error while consulting the Librarian. You can run an instant Local Shelf Search instead.",
      );
      setFailedPrompt(trimmedPrompt);
    } finally {
      setIsAsking(false);
    }
  };

  const handleLibrarianSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitLibrarianPrompt(promptInput);
  };

  const handlePromptKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submitLibrarianPrompt(promptInput);
    }
  };

  const profileHighlights = [
    ...profile.topDivisions.slice(0, 2),
    ...profile.topTags.slice(0, 3),
  ];

  return (
    <div className="catalogue-read-next-card">
      <button
        type="button"
        className="card-close-slip"
        onClick={closeDialog}
        aria-label="Close Read Next & AI Librarian"
      >
        <span className="slip-cancel">Close</span>
        <span className="slip-stamp font-mono">DISMISS</span>
      </button>

      <header className="pathfinder-card-header">
        <span className="card-rubric-tag font-mono">
          reader&apos;s advisory
        </span>
        <h2 id={titleId}>What to Read Next</h2>
        <p className="pathfinder-subtitle">
          Discover unread volumes from your shelves via taste-profile ranking or
          consult the catalogue-grounded Librarian.
        </p>
      </header>

      <div className="read-next-tabs-wrap">
        <div
          className="view-tabs read-next-tabs"
          role="tablist"
          aria-label="Recommendation mode"
        >
          <button
            ref={recommenderTabRef}
            id={recommenderTabId}
            type="button"
            role="tab"
            aria-selected={activeTab === "recommender"}
            aria-controls={recommenderPanelId}
            tabIndex={activeTab === "recommender" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => selectTab("recommender")}
            onKeyDown={handleTabKeyDown}
          >
            Shelf Recommender
          </button>
          <button
            ref={librarianTabRef}
            id={librarianTabId}
            type="button"
            role="tab"
            aria-selected={activeTab === "librarian"}
            aria-controls={librarianPanelId}
            tabIndex={activeTab === "librarian" ? 0 : -1}
            className="view-tab font-mono"
            onClick={() => selectTab("librarian")}
            onKeyDown={handleTabKeyDown}
          >
            AI Librarian
          </button>
        </div>
      </div>

      {/* Tab 1: Shelf Recommender */}
      <div
        role="tabpanel"
        id={recommenderPanelId}
        aria-labelledby={recommenderTabId}
        hidden={activeTab !== "recommender"}
        className="read-next-panel"
      >
        <section
          className="read-next-profile"
          aria-label="Reading taste profile"
        >
          <div className="read-next-profile-main">
            <p className="read-next-profile-heading">
              {profile.isPersonalized
                ? `Tailored to ${profile.ratedCount} rated & ${profile.finishedCount} finished volumes`
                : "Catalogue Highlights — rate or finish books to personalize picks"}
            </p>
            <span className="read-next-pool-note font-mono">
              {totalUnreadPool}{" "}
              {totalUnreadPool === 1 ? "unread volume" : "unread volumes"} in
              pool
            </span>
          </div>

          {profile.isPersonalized && profileHighlights.length > 0 && (
            <div
              className="read-next-profile-tags"
              aria-label="Top divisions and themes"
            >
              {profileHighlights.map((item) => (
                <span key={item} className="read-next-profile-pill font-mono">
                  {item}
                </span>
              ))}
            </div>
          )}

          {seedBook && (
            <div className="read-next-anchor-bar">
              <span className="read-next-anchor-chip">
                <strong>Anchored to:</strong> <cite>{seedBook.title}</cite> by{" "}
                {seedBook.author}
              </span>
              <button
                type="button"
                className="read-next-anchor-clear font-mono"
                onClick={() => setSeedBookId(null)}
              >
                Clear anchor
              </button>
            </div>
          )}
        </section>

        <div className="read-next-controls">
          <div
            className="read-next-mode-group"
            role="group"
            aria-label="Recommendation strategy"
          >
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="status-pill-btn read-next-mode-btn"
                aria-pressed={mode === option.value}
                title={option.description}
                onClick={() => setMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="read-next-filters">
            <div className="read-next-filter-field">
              <label htmlFor={divisionSelectId}>Division</label>
              <select
                id={divisionSelectId}
                value={division}
                onChange={(event) => setDivision(event.target.value)}
              >
                <option value="">All divisions</option>
                {divisions.map((divName) => (
                  <option key={divName} value={divName}>
                    {divName}
                  </option>
                ))}
              </select>
            </div>

            <div className="read-next-filter-field">
              <label htmlFor={eraSelectId}>Era</label>
              <select
                id={eraSelectId}
                value={era}
                onChange={(event) =>
                  setEra(event.target.value as RecommenderEra)
                }
              >
                {ERA_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="read-next-checkbox-row">
              <input
                id={hideLoanedId}
                type="checkbox"
                checked={excludeLoaned}
                onChange={(event) => setExcludeLoaned(event.target.checked)}
              />
              <label htmlFor={hideLoanedId}>Hide loaned volumes</label>
            </div>
          </div>
        </div>

        {actionError && (
          <p className="read-next-alert" role="alert">
            {actionError}
          </p>
        )}

        {recommendations.length === 0 ? (
          <div className="read-next-empty">
            <p>
              {hasActiveFilters
                ? "No unread volumes match this combination of filters."
                : "Every volume in the catalogue is already started or finished."}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                className="pathfinder-btn btn-secondary font-mono"
                onClick={handleResetFilters}
              >
                Reset filters
              </button>
            )}
          </div>
        ) : (
          <ol className="read-next-list">
            {recommendations.map((rec, index) => {
              const { book, reasons } = rec;
              const yearLabel = formatPublishYear(book.publish_year);
              const isStarting = startingBookId === book.id;
              const isQueueing = queueingBookId === book.id;
              const isQueued = Boolean(queuedBookIds?.has(book.id));
              return (
                <li key={getBookKey(book)} className="read-next-card">
                  <div className="read-next-card-head">
                    <span
                      className="read-next-rank font-mono"
                      aria-label={`Rank ${index + 1}`}
                    >
                      #{index + 1}
                    </span>
                    <div className="read-next-card-titles">
                      <h3>
                        <cite>{book.title}</cite>
                      </h3>
                      <p className="read-next-card-author">{book.author}</p>
                    </div>
                  </div>

                  <p className="read-next-card-meta font-mono">
                    {yearLabel && <span>{yearLabel}</span>}
                    <span>
                      Shelf {book.shelf}
                      {book.position ? ` · ${book.position}` : ""}
                    </span>
                    <span>{getDivision(book)}</span>
                    {book.loaned_to && (
                      <span className="read-next-loaned-badge">
                        Loaned to {book.loaned_to}
                      </span>
                    )}
                  </p>

                  {reasons.length > 0 && (
                    <div
                      className="read-next-reasons"
                      aria-label="Why this pick"
                    >
                      <span className="read-next-reasons-label font-mono">
                        Why this pick:
                      </span>
                      {reasons.map((reason) => (
                        <span key={reason} className="read-next-reason-pill">
                          {reason}
                        </span>
                      ))}
                    </div>
                  )}

                  {book.summary && (
                    <p className="read-next-summary">{book.summary}</p>
                  )}

                  <div className="read-next-card-actions">
                    <button
                      type="button"
                      className="btn-action-secondary read-next-action-btn"
                      onClick={() => onInspectBook(book)}
                      aria-label={`Inspect ${book.title} by ${book.author}`}
                    >
                      Inspect
                    </button>
                    {onQueueUpNext && (
                      <button
                        type="button"
                        className="btn-action-secondary read-next-action-btn font-mono"
                        disabled={isQueued || isQueueing}
                        onClick={() => void handleQueueUpNextClick(book)}
                        aria-label={
                          isQueued
                            ? `${book.title} is already in Up Next`
                            : `Add ${book.title} to Up Next queue`
                        }
                      >
                        {isQueueing
                          ? "Queueing..."
                          : isQueued
                            ? "In Up Next ✓"
                            : "Queue Up Next"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="pathfinder-btn btn-primary read-next-action-btn font-mono"
                      disabled={isStarting}
                      onClick={() => void handleStartReadingClick(book)}
                      aria-label={`Mark ${book.title} as currently reading`}
                    >
                      {isStarting ? "Updating..." : "Start reading"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Tab 2: AI Librarian */}
      <div
        role="tabpanel"
        id={librarianPanelId}
        aria-labelledby={librarianTabId}
        hidden={activeTab !== "librarian"}
        className="read-next-panel"
      >
        <div
          className={`librarian-banner ${
            librarianEnabled && canEdit
              ? "librarian-banner--gemini"
              : "librarian-banner--local"
          }`}
        >
          <div className="librarian-banner-copy">
            {librarianEnabled && canEdit ? (
              <p className="font-mono">
                Gemini AI Librarian active · Grounded strictly in your catalogue
              </p>
            ) : librarianEnabled && !canEdit ? (
              <>
                <p className="font-mono">
                  Gemini AI requires Curator Sign In
                </p>
                <p className="librarian-banner-sub">
                  Queries below still work instantly in{" "}
                  <strong>Local Shelf Search</strong> mode, or sign in to unlock
                  Gemini AI synthesis.
                </p>
              </>
            ) : (
              <p className="font-mono">
                Local Shelf Search mode · Add GEMINI_API_KEY on the server to
                unlock Gemini AI synthesis
              </p>
            )}
          </div>
          {librarianEnabled && !canEdit && (
            <button
              type="button"
              className="curator-status-btn font-mono"
              onClick={() =>
                onRequireAuth(
                  "Sign in with the curator passphrase to unlock Gemini AI Librarian synthesis.",
                )
              }
            >
              Curator Sign In
            </button>
          )}
        </div>

        <div
          className="librarian-starters"
          role="group"
          aria-label="Starter prompts"
        >
          <span className="librarian-starters-label font-mono">
            Try asking:
          </span>
          <div className="librarian-starter-chips">
            {STARTER_PROMPTS.map((starter) => (
              <button
                key={starter}
                type="button"
                className="librarian-starter-chip"
                disabled={isAsking}
                onClick={() => void submitLibrarianPrompt(starter)}
              >
                {starter}
              </button>
            ))}
          </div>
        </div>

        {thread.length > 0 && (
          <div
            className="librarian-thread"
            aria-label="Librarian conversation"
            aria-live="polite"
          >
            {thread.map((entry) =>
              entry.role === "user" ? (
                <div
                  key={entry.id}
                  className="librarian-entry librarian-entry--user"
                >
                  <span className="librarian-entry-role font-mono">You</span>
                  <p className="librarian-entry-text">{entry.text}</p>
                </div>
              ) : (
                <div
                  key={entry.id}
                  className="librarian-entry librarian-entry--assistant"
                >
                  <div className="librarian-entry-header">
                    <span className="librarian-entry-role font-mono">
                      Librarian
                    </span>
                    <span className="librarian-mode-badge font-mono">
                      {entry.response.mode === "gemini"
                        ? `Gemini AI${entry.response.model ? ` · ${entry.response.model}` : ""}`
                        : "Local Shelf Search"}
                    </span>
                  </div>
                  <p className="librarian-entry-text">{entry.response.reply}</p>

                  {entry.response.recommendations.length > 0 && (
                    <ul className="librarian-picks">
                      {entry.response.recommendations.map((pick) => {
                        const isQueued = Boolean(
                          queuedBookIds?.has(pick.book.id),
                        );
                        const isQueueing = queueingBookId === pick.book.id;
                        return (
                          <li
                            key={getBookKey(pick.book)}
                            className="librarian-pick-card"
                          >
                            <button
                              type="button"
                              className="librarian-pick-btn"
                              onClick={() => onInspectBook(pick.book)}
                              aria-label={`Inspect ${pick.book.title} by ${pick.book.author}`}
                            >
                              <span className="librarian-pick-top">
                                <cite>{pick.book.title}</cite>
                                <span className="librarian-pick-shelf font-mono">
                                  Shelf {pick.book.shelf}
                                  {pick.book.position
                                    ? ` · Pos. ${pick.book.position}`
                                    : ""}
                                </span>
                              </span>
                              <span className="librarian-pick-author">
                                {pick.book.author}
                              </span>
                              <span className="librarian-pick-pitch">
                                {pick.pitch}
                              </span>
                              {pick.shelfNote && (
                                <span className="librarian-pick-note font-mono">
                                  {pick.shelfNote}
                                </span>
                              )}
                            </button>
                            {onQueueUpNext && (
                              <div className="librarian-pick-footer">
                                <button
                                  type="button"
                                  className="btn-action-secondary read-next-action-btn font-mono"
                                  disabled={isQueued || isQueueing}
                                  onClick={() =>
                                    void handleQueueUpNextClick(pick.book)
                                  }
                                  aria-label={
                                    isQueued
                                      ? `${pick.book.title} is already in Up Next`
                                      : `Add ${pick.book.title} to Up Next queue`
                                  }
                                >
                                  {isQueueing
                                    ? "Queueing..."
                                    : isQueued
                                      ? "In Up Next ✓"
                                      : "Queue Up Next"}
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ),
            )}
          </div>
        )}

        {isAsking && (
          <p className="librarian-loading font-mono" role="status">
            Consulting the shelves...
          </p>
        )}

        {librarianError && (
          <div className="librarian-error-box" role="alert">
            <p>{librarianError}</p>
            {failedPrompt && (
              <button
                type="button"
                className="btn-action-secondary"
                onClick={() => appendLocalAnswer(failedPrompt)}
              >
                Use Local Shelf Search instead
              </button>
            )}
          </div>
        )}

        <form className="librarian-form" onSubmit={handleLibrarianSubmit}>
          <div className="librarian-form-field">
            <label htmlFor={librarianPromptId}>Ask the Librarian</label>
            <textarea
              id={librarianPromptId}
              rows={2}
              value={promptInput}
              onChange={(event) => setPromptInput(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="Ask for a mood, era, theme, or companion to a favorite volume..."
              disabled={isAsking}
            />
          </div>
          <div className="librarian-form-actions">
            <button
              type="submit"
              className="pathfinder-btn btn-primary font-mono"
              disabled={isAsking || !promptInput.trim()}
            >
              {isAsking ? "Consulting..." : "Ask Librarian"}
            </button>
            {thread.length > 0 && (
              <button
                type="button"
                className="pathfinder-btn btn-secondary font-mono"
                disabled={isAsking}
                onClick={() => {
                  setThread([]);
                  setLibrarianError(null);
                  setFailedPrompt(null);
                }}
              >
                Clear thread
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Native modal dialog providing Taste-Profile Shelf Recommendations and the Catalogue-Grounded AI Librarian.
 */
export function ReadNextModal({
  isOpen,
  onClose,
  books,
  connections,
  divisions,
  initialSeedBookId = null,
  librarianEnabled,
  canEdit,
  onRequireAuth,
  onInspectBook,
  onStartReading,
  onQueueUpNext,
  queuedBookIds,
}: ReadNextModalProps) {
  const titleId = useId();

  return (
    <ModalDialog
      open={isOpen}
      onClose={onClose}
      labelledBy={titleId}
      className="catalogue-dialog--read-next"
    >
      <ReadNextContent
        books={books}
        connections={connections}
        divisions={divisions}
        initialSeedBookId={initialSeedBookId}
        librarianEnabled={librarianEnabled}
        canEdit={canEdit}
        titleId={titleId}
        onClose={onClose}
        onRequireAuth={onRequireAuth}
        onInspectBook={onInspectBook}
        onStartReading={onStartReading}
        onQueueUpNext={onQueueUpNext}
        queuedBookIds={queuedBookIds}
      />
    </ModalDialog>
  );
}
