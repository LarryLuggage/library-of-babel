"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  compareCatalogueBooks,
  getBookKey,
  getDivision,
  type CatalogueBook,
} from "@/lib/books/catalogue";
import type { EditorialConnection } from "@/lib/books/connections";
import {
  buildCatalogueGraph,
  getPathfinderConnection,
} from "@/lib/books/relations";
import { ModalDialog, useDialogClose } from "./modal-dialog";

interface PathfinderModalProps<T extends CatalogueBook = CatalogueBook> {
  books: T[];
  editorialConnections?: EditorialConnection[];
  initialSource?: T | null;
  onClose: () => void;
  onBookClick: (book: T) => void;
}

type ResolvedPathStep<T extends CatalogueBook> = {
  book: T;
  reasons: string[];
  score: number;
};

function PathfinderContent<T extends CatalogueBook>({
  books,
  editorialConnections,
  initialSource = null,
  titleId,
  onClose,
  onBookClick,
}: PathfinderModalProps<T> & { titleId: string }) {
  const closeDialog = useDialogClose() ?? onClose;
  const idPrefix = useId();
  const sourceInputId = `${idPrefix}-source`;
  const sourceListboxId = `${idPrefix}-source-options`;
  const targetInputId = `${idPrefix}-target`;
  const targetListboxId = `${idPrefix}-target-options`;

  const sourcePickerRef = useRef<HTMLDivElement>(null);
  const targetPickerRef = useRef<HTMLDivElement>(null);

  const [sourceSearch, setSourceSearch] = useState(
    initialSource ? `${initialSource.author}: ${initialSource.title}` : "",
  );
  const [targetSearch, setTargetSearch] = useState("");

  const [sourceBook, setSourceBook] = useState<T | null>(initialSource);
  const [targetBook, setTargetBook] = useState<T | null>(null);

  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showTargetDropdown, setShowTargetDropdown] = useState(false);
  const [sourceHighlight, setSourceHighlight] = useState(-1);
  const [targetHighlight, setTargetHighlight] = useState(-1);

  const [pathResult, setPathResult] = useState<ResolvedPathStep<T>[] | null>(
    null,
  );
  const [hasSearched, setHasSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const booksByKey = useMemo(
    () => new Map(books.map((book) => [getBookKey(book), book])),
    [books],
  );

  const catalogueGraph = useMemo(
    () => buildCatalogueGraph(books, editorialConnections),
    [books, editorialConnections],
  );

  const sortedBooks = useMemo(
    () => [...books].sort(compareCatalogueBooks),
    [books],
  );

  const filteredSourceBooks = useMemo(() => {
    const query = sourceSearch.trim().toLocaleLowerCase("en-US");
    if (!query) return sortedBooks.slice(0, 12);
    return sortedBooks
      .filter(
        (book) =>
          book.title.toLocaleLowerCase("en-US").includes(query) ||
          book.author.toLocaleLowerCase("en-US").includes(query),
      )
      .slice(0, 12);
  }, [sortedBooks, sourceSearch]);

  const filteredTargetBooks = useMemo(() => {
    const query = targetSearch.trim().toLocaleLowerCase("en-US");
    if (!query) return sortedBooks.slice(0, 12);
    return sortedBooks
      .filter(
        (book) =>
          book.title.toLocaleLowerCase("en-US").includes(query) ||
          book.author.toLocaleLowerCase("en-US").includes(query),
      )
      .slice(0, 12);
  }, [sortedBooks, targetSearch]);

  useEffect(() => {
    if (!showSourceDropdown && !showTargetDropdown) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        showSourceDropdown &&
        sourcePickerRef.current &&
        target &&
        !sourcePickerRef.current.contains(target)
      ) {
        setShowSourceDropdown(false);
        setSourceHighlight(-1);
      }
      if (
        showTargetDropdown &&
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
  }, [showSourceDropdown, showTargetDropdown]);

  const selectSourceBook = (book: T) => {
    setSourceBook(book);
    setSourceSearch(`${book.author}: ${book.title}`);
    setShowSourceDropdown(false);
    setSourceHighlight(-1);
    setErrorMsg("");
  };

  const selectTargetBook = (book: T) => {
    setTargetBook(book);
    setTargetSearch(`${book.author}: ${book.title}`);
    setShowTargetDropdown(false);
    setTargetHighlight(-1);
    setErrorMsg("");
  };

  const handleSourceKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!showSourceDropdown) {
        setShowSourceDropdown(true);
        setSourceHighlight(filteredSourceBooks.length > 0 ? 0 : -1);
      } else if (filteredSourceBooks.length > 0) {
        setSourceHighlight((prev) =>
          prev < filteredSourceBooks.length - 1 ? prev + 1 : 0,
        );
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!showSourceDropdown) {
        setShowSourceDropdown(true);
        setSourceHighlight(filteredSourceBooks.length - 1);
      } else if (filteredSourceBooks.length > 0) {
        setSourceHighlight((prev) =>
          prev > 0 ? prev - 1 : filteredSourceBooks.length - 1,
        );
      }
    } else if (
      event.key === "Enter" &&
      showSourceDropdown &&
      sourceHighlight >= 0 &&
      filteredSourceBooks[sourceHighlight]
    ) {
      event.preventDefault();
      selectSourceBook(filteredSourceBooks[sourceHighlight]);
    } else if (event.key === "Escape" && showSourceDropdown) {
      event.preventDefault();
      event.stopPropagation();
      setShowSourceDropdown(false);
      setSourceHighlight(-1);
    }
  };

  const handleTargetKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!showTargetDropdown) {
        setShowTargetDropdown(true);
        setTargetHighlight(filteredTargetBooks.length > 0 ? 0 : -1);
      } else if (filteredTargetBooks.length > 0) {
        setTargetHighlight((prev) =>
          prev < filteredTargetBooks.length - 1 ? prev + 1 : 0,
        );
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!showTargetDropdown) {
        setShowTargetDropdown(true);
        setTargetHighlight(filteredTargetBooks.length - 1);
      } else if (filteredTargetBooks.length > 0) {
        setTargetHighlight((prev) =>
          prev > 0 ? prev - 1 : filteredTargetBooks.length - 1,
        );
      }
    } else if (
      event.key === "Enter" &&
      showTargetDropdown &&
      targetHighlight >= 0 &&
      filteredTargetBooks[targetHighlight]
    ) {
      event.preventDefault();
      selectTargetBook(filteredTargetBooks[targetHighlight]);
    } else if (event.key === "Escape" && showTargetDropdown) {
      event.preventDefault();
      event.stopPropagation();
      setShowTargetDropdown(false);
      setTargetHighlight(-1);
    }
  };

  const handleFindPath = () => {
    if (!sourceBook || !targetBook) {
      setErrorMsg("Please select both a source volume and a target volume.");
      return;
    }

    const rawPath = getPathfinderConnection(
      sourceBook,
      targetBook,
      books,
      catalogueGraph,
      editorialConnections,
    );

    if (rawPath && rawPath.length > 0) {
      const resolvedPath: ResolvedPathStep<T>[] = rawPath.map((step) => ({
        book: booksByKey.get(getBookKey(step.book)) ?? (step.book as T),
        reasons: step.reasons,
        score: step.score,
      }));
      setPathResult(resolvedPath);
      setErrorMsg("");
    } else {
      setPathResult(null);
      setErrorMsg(
        "No conceptual path could be traced between these two volumes.",
      );
    }
    setHasSearched(true);
  };

  const swapSourceTarget = () => {
    const prevSource = sourceBook;
    setSourceBook(targetBook);
    setTargetBook(prevSource);
    setSourceSearch(
      targetBook ? `${targetBook.author}: ${targetBook.title}` : "",
    );
    setTargetSearch(
      prevSource ? `${prevSource.author}: ${prevSource.title}` : "",
    );
    setPathResult(null);
    setHasSearched(false);
    setErrorMsg("");
  };

  const selectRandomBooks = () => {
    if (books.length < 2) return;
    const idx1 = Math.floor(Math.random() * books.length);
    let idx2 = Math.floor(Math.random() * books.length);
    while (idx1 === idx2) {
      idx2 = Math.floor(Math.random() * books.length);
    }
    const first = books[idx1];
    const second = books[idx2];
    setSourceBook(first);
    setTargetBook(second);
    setSourceSearch(`${first.author}: ${first.title}`);
    setTargetSearch(`${second.author}: ${second.title}`);
    setShowSourceDropdown(false);
    setShowTargetDropdown(false);
    setPathResult(null);
    setHasSearched(false);
    setErrorMsg("");
  };

  const startStep = pathResult?.[0];
  const hopSteps = pathResult ? pathResult.slice(1) : [];

  return (
    <div className="catalogue-pathfinder-card">
      <button
        type="button"
        className="card-close-slip"
        onClick={closeDialog}
        aria-label="Close Pathfinder"
      >
        <span className="slip-cancel">Close</span>
        <span className="slip-stamp font-mono">DISMISS</span>
      </button>

      <header className="pathfinder-card-header">
        <span className="card-rubric-tag font-mono">relational index</span>
        <h2 id={titleId}>Pathfinder of Babel</h2>
        <p className="pathfinder-subtitle">
          Trace the conceptual bridges and shelf connections between any two
          volumes in the library.
        </p>
      </header>

      <div className="pathfinder-selectors">
        <div className="selector-field" ref={sourcePickerRef}>
          <label htmlFor={sourceInputId}>Source Volume</label>
          <div className="searchable-select-container">
            <input
              id={sourceInputId}
              type="text"
              placeholder="Search source volume..."
              value={sourceSearch}
              role="combobox"
              aria-autocomplete="list"
              aria-controls={sourceListboxId}
              aria-expanded={showSourceDropdown}
              aria-activedescendant={
                showSourceDropdown &&
                sourceHighlight >= 0 &&
                filteredSourceBooks[sourceHighlight]
                  ? `${sourceListboxId}-opt-${sourceHighlight}`
                  : undefined
              }
              onChange={(event) => {
                setSourceSearch(event.target.value);
                setSourceBook(null);
                setShowSourceDropdown(true);
                setSourceHighlight(-1);
              }}
              onFocus={() => setShowSourceDropdown(true)}
              onKeyDown={handleSourceKeyDown}
            />
            {showSourceDropdown && (
              <ul
                className="select-dropdown-list"
                id={sourceListboxId}
                role="listbox"
              >
                {filteredSourceBooks.map((book, index) => {
                  const key = getBookKey(book);
                  const isHighlighted = index === sourceHighlight;
                  const isSelected =
                    Boolean(sourceBook) &&
                    getBookKey(sourceBook ?? book) === key;
                  return (
                    <li key={key} role="none">
                      <button
                        type="button"
                        id={`${sourceListboxId}-opt-${index}`}
                        role="option"
                        tabIndex={-1}
                        data-highlighted={isHighlighted}
                        aria-selected={isHighlighted || isSelected}
                        onMouseEnter={() => setSourceHighlight(index)}
                        onClick={() => selectSourceBook(book)}
                      >
                        <strong>{book.author}</strong> —{" "}
                        <span>{book.title}</span>
                      </button>
                    </li>
                  );
                })}
                {filteredSourceBooks.length === 0 && (
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

        <button
          type="button"
          className="swap-button"
          onClick={swapSourceTarget}
          title="Swap Source and Target"
          aria-label="Swap Source and Target"
        >
          ⇄
        </button>

        <div className="selector-field" ref={targetPickerRef}>
          <label htmlFor={targetInputId}>Target Volume</label>
          <div className="searchable-select-container">
            <input
              id={targetInputId}
              type="text"
              placeholder="Search target volume..."
              value={targetSearch}
              role="combobox"
              aria-autocomplete="list"
              aria-controls={targetListboxId}
              aria-expanded={showTargetDropdown}
              aria-activedescendant={
                showTargetDropdown &&
                targetHighlight >= 0 &&
                filteredTargetBooks[targetHighlight]
                  ? `${targetListboxId}-opt-${targetHighlight}`
                  : undefined
              }
              onChange={(event) => {
                setTargetSearch(event.target.value);
                setTargetBook(null);
                setShowTargetDropdown(true);
                setTargetHighlight(-1);
              }}
              onFocus={() => setShowTargetDropdown(true)}
              onKeyDown={handleTargetKeyDown}
            />
            {showTargetDropdown && (
              <ul
                className="select-dropdown-list"
                id={targetListboxId}
                role="listbox"
              >
                {filteredTargetBooks.map((book, index) => {
                  const key = getBookKey(book);
                  const isHighlighted = index === targetHighlight;
                  const isSelected =
                    Boolean(targetBook) &&
                    getBookKey(targetBook ?? book) === key;
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
                        onClick={() => selectTargetBook(book)}
                      >
                        <strong>{book.author}</strong> —{" "}
                        <span>{book.title}</span>
                      </button>
                    </li>
                  );
                })}
                {filteredTargetBooks.length === 0 && (
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
      </div>

      <div className="pathfinder-actions">
        <button
          type="button"
          className="pathfinder-btn btn-secondary font-mono"
          onClick={selectRandomBooks}
          disabled={books.length < 2}
        >
          RANDOM VOLUMES
        </button>
        <button
          type="button"
          className="pathfinder-btn btn-primary font-mono"
          onClick={handleFindPath}
        >
          CONSULT PATHFINDER
        </button>
      </div>

      {errorMsg && (
        <p className="pathfinder-error font-mono" role="alert">
          {errorMsg}
        </p>
      )}

      {hasSearched && startStep && (
        <div className="pathfinder-results">
          <div className="pathfinder-summary-stats font-mono">
            <span>
              Path Length: {pathResult!.length}{" "}
              {pathResult!.length === 1 ? "book" : "books"}
            </span>
            <span aria-hidden="true">•</span>
            <span>Conceptual Hops: {hopSteps.length}</span>
          </div>

          <div className="pathfinder-timeline">
            <div className="pathfinder-step-book source-node">
              <div className="node-marker font-mono">START</div>
              <button
                className="book-details"
                onClick={() => onBookClick(startStep.book)}
                type="button"
              >
                <h4>{startStep.book.title}</h4>
                <p>
                  {startStep.book.author} •{" "}
                  <span className="pathfinder-division">
                    {getDivision(startStep.book)}
                  </span>{" "}
                  • Shelf {startStep.book.shelf}
                </p>
              </button>
            </div>

            {hopSteps.map((step, idx) => (
              <div
                key={getBookKey(step.book)}
                className="pathfinder-step-container"
              >
                <div className="pathfinder-bridge-card">
                  <div className="bridge-header font-mono">
                    <span>Concept Bridge {idx + 1}</span>
                    <span className="bridge-score">
                      Relational Score: {step.score}
                    </span>
                  </div>
                  <ul className="bridge-reasons">
                    {(step.reasons.length > 0
                      ? step.reasons
                      : ["Direct proximity in catalog shelves."]
                    ).map((reason, reasonIdx) => (
                      <li key={reasonIdx}>{reason}</li>
                    ))}
                  </ul>
                </div>

                <div
                  className={`pathfinder-step-book ${
                    idx === hopSteps.length - 1
                      ? "target-node"
                      : "intermediate-node"
                  }`}
                >
                  <div className="node-marker font-mono">
                    {idx === hopSteps.length - 1 ? "END" : `STEP ${idx + 1}`}
                  </div>
                  <button
                    className="book-details"
                    onClick={() => onBookClick(step.book)}
                    type="button"
                  >
                    <h4>{step.book.title}</h4>
                    <p>
                      {step.book.author} •{" "}
                      <span className="pathfinder-division">
                        {getDivision(step.book)}
                      </span>{" "}
                      • Shelf {step.book.shelf}
                    </p>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PathfinderModal<T extends CatalogueBook>({
  books,
  editorialConnections,
  initialSource = null,
  onClose,
  onBookClick,
}: PathfinderModalProps<T>) {
  const titleId = useId();

  return (
    <ModalDialog
      open
      onClose={onClose}
      labelledBy={titleId}
      className="catalogue-dialog--pathfinder"
    >
      <PathfinderContent
        books={books}
        editorialConnections={editorialConnections}
        initialSource={initialSource}
        titleId={titleId}
        onClose={onClose}
        onBookClick={onBookClick}
      />
    </ModalDialog>
  );
}
