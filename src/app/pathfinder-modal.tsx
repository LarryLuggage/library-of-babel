"use client";

import { useState, useMemo } from "react";
import {
  getBookKey,
  getCatalogueConnection,
  compareCatalogueBooks,
  getDivision,
  type CatalogueBook,
} from "@/lib/books/catalogue";

interface PathfinderModalProps<T extends CatalogueBook = CatalogueBook> {
  books: T[];
  initialSource?: T | null;
  isObscured?: boolean;
  onClose: () => void;
  onBookClick: (book: T) => void;
}

export function PathfinderModal<T extends CatalogueBook>({
  books,
  initialSource = null,
  isObscured = false,
  onClose,
  onBookClick,
}: PathfinderModalProps<T>) {
  // State for search query and selected books
  const [sourceSearch, setSourceSearch] = useState(
    initialSource ? `${initialSource.author}: ${initialSource.title}` : "",
  );
  const [targetSearch, setTargetSearch] = useState("");

  const [sourceBook, setSourceBook] = useState<T | null>(initialSource);
  const [targetBook, setTargetBook] = useState<T | null>(null);

  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showTargetDropdown, setShowTargetDropdown] = useState(false);

  const [pathResult, setPathResult] = useState<T[] | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Sort books for easy searching
  const sortedBooks = useMemo(() => {
    return [...books].sort(compareCatalogueBooks);
  }, [books]);

  // Filter books based on search input
  const filteredSourceBooks = useMemo(() => {
    if (!sourceSearch.trim()) return sortedBooks.slice(0, 12);
    const q = sourceSearch.toLowerCase();
    return sortedBooks.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [sortedBooks, sourceSearch]);

  const filteredTargetBooks = useMemo(() => {
    if (!targetSearch.trim()) return sortedBooks.slice(0, 12);
    const q = targetSearch.toLowerCase();
    return sortedBooks.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q)
    ).slice(0, 12);
  }, [sortedBooks, targetSearch]);

  // Pathfinder BFS Logic
  const handleFindPath = () => {
    if (!sourceBook || !targetBook) {
      setErrorMsg("Please select both a source volume and a target volume.");
      return;
    }

    const sourceKey = getBookKey(sourceBook);
    const targetKey = getBookKey(targetBook);

    if (sourceKey === targetKey) {
      setPathResult([sourceBook]);
      setHasSearched(true);
      setErrorMsg("");
      return;
    }

    // Standard BFS
    const queue: { current: T; path: T[] }[] = [
      { current: sourceBook, path: [sourceBook] },
    ];
    const visited = new Set<string>([sourceKey]);
    let foundPath: T[] | null = null;

    while (queue.length > 0) {
      const { current, path } = queue.shift()!;
      const currentKey = getBookKey(current);

      if (currentKey === targetKey) {
        foundPath = path;
        break;
      }

      // Find all connected books
      const neighbors: { book: T; score: number }[] = [];
      for (const b of books) {
        if (getBookKey(b) === getBookKey(current)) continue;
        const connection = getCatalogueConnection(current, b);
        if (connection && connection.score > 0) {
          neighbors.push({ book: b, score: connection.score });
        }
      }

      // Sort neighbors to explore stronger connections first
      neighbors.sort((a, b) => b.score - a.score);

      for (const neighbor of neighbors) {
        const nKey = getBookKey(neighbor.book);
        if (!visited.has(nKey)) {
          visited.add(nKey);
          queue.push({
            current: neighbor.book,
            path: [...path, neighbor.book],
          });
        }
      }
    }

    if (foundPath) {
      setPathResult(foundPath);
      setErrorMsg("");
    } else {
      setPathResult(null);
      setErrorMsg("No conceptual path could be traced between these two volumes.");
    }
    setHasSearched(true);
  };

  const swapSourceTarget = () => {
    const temp = sourceBook;
    setSourceBook(targetBook);
    setTargetBook(temp);
    setSourceSearch(targetBook ? `${targetBook.author}: ${targetBook.title}` : "");
    setTargetSearch(temp ? `${temp.author}: ${temp.title}` : "");
    setPathResult(null);
    setHasSearched(false);
  };

  const selectRandomBooks = () => {
    if (books.length < 2) return;
    const idx1 = Math.floor(Math.random() * books.length);
    let idx2 = Math.floor(Math.random() * books.length);
    while (idx1 === idx2) {
      idx2 = Math.floor(Math.random() * books.length);
    }
    const b1 = books[idx1];
    const b2 = books[idx2];
    setSourceBook(b1);
    setTargetBook(b2);
    setSourceSearch(`${b1.author}: ${b1.title}`);
    setTargetSearch(`${b2.author}: ${b2.title}`);
    setPathResult(null);
    setHasSearched(false);
  };

  // Pre-calculate path step details (the connections between consecutive books)
  const pathSteps = useMemo(() => {
    if (!pathResult || pathResult.length <= 1) return [];
    const steps = [];
    for (let i = 0; i < pathResult.length - 1; i++) {
      const from = pathResult[i];
      const to = pathResult[i + 1];
      const connection = getCatalogueConnection(from, to);
      steps.push({
        from,
        to,
        score: connection?.score || 0,
        reasons: connection?.reasons || ["Direct proximity in catalog shelves."],
      });
    }
    return steps;
  }, [pathResult]);

  return (
    <div
      className={`catalogue-modal-overlay ${isObscured ? "catalogue-modal-obscured" : ""}`}
      onClick={onClose}
      aria-hidden={isObscured || undefined}
    >
      <div
        className="catalogue-pathfinder-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pathfinder-title"
      >
        {/* Close slip */}
        <button className="card-close-slip" onClick={onClose} aria-label="Close Pathfinder">
          <span className="slip-cancel">Close</span>
          <span className="slip-stamp font-mono">DISMISS</span>
        </button>

        <header className="pathfinder-card-header">
          <span className="card-rubric-tag font-mono">relational index</span>
          <h2 id="pathfinder-title">Pathfinder of Babel</h2>
          <p className="pathfinder-subtitle">
            Trace the conceptual bridges and shelf connections between any two volumes in the library.
          </p>
        </header>

        {/* Control panel */}
        <div className="pathfinder-selectors">
          <div className="selector-field">
            <label htmlFor="source-select">Source Volume</label>
            <div className="searchable-select-container">
              <input
                id="source-select"
                type="text"
                placeholder="Search source volume..."
                value={sourceSearch}
                role="combobox"
                aria-autocomplete="list"
                aria-controls="source-volume-options"
                aria-expanded={showSourceDropdown}
                onChange={(e) => {
                  setSourceSearch(e.target.value);
                  setSourceBook(null);
                  setShowSourceDropdown(true);
                }}
                onFocus={() => setShowSourceDropdown(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setShowSourceDropdown(false);
                }}
              />
              {showSourceDropdown && (
                <ul className="select-dropdown-list" id="source-volume-options" role="listbox">
                  {filteredSourceBooks.map((b) => (
                    <li key={getBookKey(b)} role="none">
                      <button
                        type="button"
                        role="option"
                        aria-selected={Boolean(sourceBook) && getBookKey(sourceBook ?? b) === getBookKey(b)}
                        onClick={() => {
                          setSourceBook(b);
                          setSourceSearch(`${b.author}: ${b.title}`);
                          setShowSourceDropdown(false);
                          setErrorMsg("");
                        }}
                      >
                        <strong>{b.author}</strong> — <span>{b.title}</span>
                      </button>
                    </li>
                  ))}
                  {filteredSourceBooks.length === 0 && (
                    <li className="no-matches" role="option" aria-disabled="true" aria-selected="false">No volumes match</li>
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

          <div className="selector-field">
            <label htmlFor="target-select">Target Volume</label>
            <div className="searchable-select-container">
              <input
                id="target-select"
                type="text"
                placeholder="Search target volume..."
                value={targetSearch}
                role="combobox"
                aria-autocomplete="list"
                aria-controls="target-volume-options"
                aria-expanded={showTargetDropdown}
                onChange={(e) => {
                  setTargetSearch(e.target.value);
                  setTargetBook(null);
                  setShowTargetDropdown(true);
                }}
                onFocus={() => setShowTargetDropdown(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setShowTargetDropdown(false);
                }}
              />
              {showTargetDropdown && (
                <ul className="select-dropdown-list" id="target-volume-options" role="listbox">
                  {filteredTargetBooks.map((b) => (
                    <li key={getBookKey(b)} role="none">
                      <button
                        type="button"
                        role="option"
                        aria-selected={Boolean(targetBook) && getBookKey(targetBook ?? b) === getBookKey(b)}
                        onClick={() => {
                          setTargetBook(b);
                          setTargetSearch(`${b.author}: ${b.title}`);
                          setShowTargetDropdown(false);
                          setErrorMsg("");
                        }}
                      >
                        <strong>{b.author}</strong> — <span>{b.title}</span>
                      </button>
                    </li>
                  ))}
                  {filteredTargetBooks.length === 0 && (
                    <li className="no-matches" role="option" aria-disabled="true" aria-selected="false">No volumes match</li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Global click handlers to close custom dropdowns */}
        {(showSourceDropdown || showTargetDropdown) && (
          <div
            className="dropdown-dismiss-overlay"
            onClick={() => {
              setShowSourceDropdown(false);
              setShowTargetDropdown(false);
            }}
          />
        )}

        <div className="pathfinder-actions">
          <button type="button" className="pathfinder-btn btn-secondary font-mono" onClick={selectRandomBooks}>
            RANDOM VOLUMES
          </button>
          <button type="button" className="pathfinder-btn btn-primary font-mono" onClick={handleFindPath}>
            CONSULT PATHFINDER
          </button>
        </div>

        {/* Error message */}
        {errorMsg && <p className="pathfinder-error font-mono">{errorMsg}</p>}

        {/* Results output */}
        {hasSearched && pathResult && (
          <div className="pathfinder-results">
            <div className="pathfinder-summary-stats font-mono">
              <span>Path Length: {pathResult.length} books</span>
              <span>•</span>
              <span>Conceptual Hops: {pathSteps.length}</span>
            </div>

            <div className="pathfinder-timeline">
              {/* Start node */}
              <div className="pathfinder-step-book source-node">
                <div className="node-marker font-mono">START</div>
                <button className="book-details" onClick={() => onBookClick(pathResult[0])} type="button">
                  <h4>{pathResult[0].title}</h4>
                  <p>{pathResult[0].author} • <span className="text-green-800">{getDivision(pathResult[0])}</span> • Shelf {pathResult[0].shelf}</p>
                </button>
              </div>

              {/* Steps and Intermediate nodes */}
              {pathSteps.map((step, idx) => (
                <div key={idx} className="pathfinder-step-container">
                  {/* The conceptual bridge */}
                  <div className="pathfinder-bridge-card">
                    <div className="bridge-header font-mono">
                      <span>Concept Bridge {idx + 1}</span>
                      <span className="bridge-score">Relational Score: {step.score}</span>
                    </div>
                    <ul className="bridge-reasons">
                      {step.reasons.map((r, rIdx) => (
                        <li key={rIdx}>{r}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Destination volume */}
                  <div className={`pathfinder-step-book ${idx === pathSteps.length - 1 ? 'target-node' : 'intermediate-node'}`}>
                    <div className="node-marker font-mono">
                      {idx === pathSteps.length - 1 ? "END" : `STEP ${idx + 1}`}
                    </div>
                    <button className="book-details" onClick={() => onBookClick(step.to)} type="button">
                      <h4>{step.to.title}</h4>
                      <p>{step.to.author} • <span className="text-green-800">{getDivision(step.to)}</span> • Shelf {step.to.shelf}</p>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
