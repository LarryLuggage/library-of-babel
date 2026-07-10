"use client";

import { useEffect, useMemo, useState } from "react";
import fullShelfCatalogue from "../../shelf_catalog_full.json";
import { CatalogueConstellation } from "./catalogue-constellation";
import { CatalogueLedger } from "./catalogue-ledger";
import { BookDetailCard } from "./book-detail-card";
import { TagMatchesOverlay } from "./tag-matches-overlay";
import { ChronologicalScroll } from "./chronological-scroll";
import { PathfinderModal } from "./pathfinder-modal";
import {
  compareCatalogueBooks,
  getBookKey,
  type CatalogueBook,
} from "@/lib/books/catalogue";

const books = fullShelfCatalogue as CatalogueBook[];

function getInitial(author: string) {
  const searchableAuthor = author
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return searchableAuthor.match(/[a-z]/i)?.[0].toLocaleUpperCase("en-US") ?? "#";
}

const catalogueEntries = [...books]
  .sort(compareCatalogueBooks)
  .map((book, index) => ({
    ...book,
    number: index + 1,
  }));

const catalogueByInitial = Map.groupBy(catalogueEntries, (book) =>
  getInitial(book.author),
);

const shelfCount = new Set(books.map((book) => book.shelf)).size;

const divisions = Object.entries(
  Object.groupBy(books, (book) => book.top_category ?? "Unclassified"),
)
  .map(([name, divisionBooks]) => ({
    count: divisionBooks?.length ?? 0,
    name,
  }))
  .sort((first, second) => second.count - first.count);

const tagFrequency = new Map<string, number>();
for (const book of books) {
  for (const tag of book.tags ?? []) {
    tagFrequency.set(tag, (tagFrequency.get(tag) ?? 0) + 1);
  }
}

const catalogueTags = [...tagFrequency.entries()]
  .sort(
    ([firstTag, firstCount], [secondTag, secondCount]) =>
      secondCount - firstCount || firstTag.localeCompare(secondTag),
  )
  .slice(0, 100)
  .map(([tag]) => tag);

const catalogueShelves = [...new Set(books.map((book) => book.shelf))].sort(
  (first, second) => first - second,
);

function getSearchText(book: CatalogueBook) {
  return [
    book.author,
    book.title,
    book.edition,
    book.position,
    book.shelf,
    book.top_category,
    book.sub_category,
    ...(book.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US");
}

// Simple typewriter helper for the Aleph overlay
function TypewriterText({ text, speed = 25 }: { text: string; speed?: number }) {
  const [characterCount, setCharacterCount] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion || characterCount >= text.length) return;
    const timeout = window.setTimeout(
      () => setCharacterCount((count) => Math.min(count + 1, text.length)),
      speed,
    );
    return () => window.clearTimeout(timeout);
  }, [characterCount, prefersReducedMotion, speed, text.length]);

  const visibleCharacterCount = prefersReducedMotion ? text.length : characterCount;

  return (
    <>
      <p className="aleph-text font-mono" aria-hidden="true">
        {text.slice(0, visibleCharacterCount)}
        {visibleCharacterCount < text.length && <span className="aleph-cursor">_</span>}
      </p>
      <p className="sr-only">{text}</p>
    </>
  );
}

export default function Home() {
  const [activeBook, setActiveBook] = useState<(CatalogueBook & { number: number }) | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [shelfFilter, setShelfFilter] = useState("");
  const [authorInitial, setAuthorInitial] = useState("");

  // Layout View Tabs State
  const [mapMode, setMapMode] = useState<"similarity" | "tag">("similarity");
  const [bottomView, setBottomView] = useState<"ledger" | "timeline">("ledger");

  // Modals / Overlays State
  const [isPathfinderOpen, setIsPathfinderOpen] = useState(false);
  const [isAlephOpen, setIsAlephOpen] = useState(false);
  const [pathfinderSourceKey, setPathfinderSourceKey] = useState<string | null>(null);

  // Aleph quotes selection state
  const alephQuotes = [
    "I saw the populous sea, saw dawn and sunset, saw the multitudes of the Americas, saw a silvery cobweb in the center of a black pyramid, saw a splintered labyrinth (it was London), saw close-up endless eyes looking at me as though in a mirror, saw all the mirrors on earth and none of them reflected me...",
    "I saw the Aleph from all points, I saw in the Aleph the earth and in the earth the Aleph once more and in the Aleph the earth, I saw my own face and my own entrails, saw your face, and I felt dizzy and wept, because my eyes had seen that conjectural and secret object whose name men usurp, but which no man has looked upon: the inconceivable universe.",
    "The Library of Babel is infinite, periodic, and eternal. In its galleries, shelves, and volumes, all combinations of the orthographic symbols are registered. To consult the Aleph is to peer into the center of this vast library, where every volume is simultaneously present."
  ];
  const [quoteIndex, setQuoteIndex] = useState(0);

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
      if (divisionFilter && book.top_category !== divisionFilter) return false;
      if (tagFilter && !book.tags?.includes(tagFilter)) return false;
      if (shelfFilter && book.shelf !== Number(shelfFilter)) return false;
      if (authorInitial && getInitial(book.author) !== authorInitial) return false;
      return true;
    });
  }, [authorInitial, catalogueQuery, divisionFilter, shelfFilter, tagFilter]);

  const hasCatalogueFilters = Boolean(
    catalogueQuery || divisionFilter || tagFilter || shelfFilter || authorInitial,
  );

  const clearCatalogueFilters = () => {
    setCatalogueQuery("");
    setDivisionFilter("");
    setTagFilter("");
    setShelfFilter("");
    setAuthorInitial("");
  };

  const openPathfinder = (sourceBook?: CatalogueBook & { number: number }) => {
    setPathfinderSourceKey(sourceBook ? getBookKey(sourceBook) : null);
    setIsPathfinderOpen(true);
  };

  const filterByTag = (tag: string) => {
    setActiveBook(null);
    setActiveTag(null);
    setTagFilter(tag);
    setBottomView("ledger");
    window.requestAnimationFrame(() => {
      document.getElementById("catalogue-search")?.scrollIntoView({ behavior: "smooth" });
    });
  };

  return (
    <main className="catalogue-page">
      <header className="catalogue-masthead">
        <p className="catalogue-kicker">Printed for private circulation</p>
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
        </dl>
      </header>

      {/* Labyrinth Babel Toolbar */}
      <section className="catalogue-toolbar-section">
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
            className="toolbar-btn btn-aleph font-mono"
            onClick={() => {
              setQuoteIndex(Math.floor(Math.random() * alephQuotes.length));
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
            Find a volume by title, author, subject, shelf, or catalogue detail.
          </p>
        </div>

        <div className="catalogue-search-controls">
          <label className="catalogue-search-query">
            <span>Title, author, or keyword</span>
            <input
              type="search"
              value={catalogueQuery}
              onChange={(event) => setCatalogueQuery(event.target.value)}
              placeholder="Try Borges, poetry, or Penguin Classics"
            />
          </label>

          <label>
            <span>Division</span>
            <select
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
          </label>

          <label>
            <span>Popular subject</span>
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="">All subjects</option>
              {catalogueTags.map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Shelf</span>
            <select value={shelfFilter} onChange={(event) => setShelfFilter(event.target.value)}>
              <option value="">All shelves</option>
              {catalogueShelves.map((shelf) => (
                <option key={shelf} value={shelf}>Shelf {shelf}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="catalogue-search-status" aria-live="polite">
          <p>
            <strong>{filteredCatalogueEntries.length}</strong>{" "}
            {filteredCatalogueEntries.length === 1 ? "volume" : "volumes"} found
            {authorInitial && <> under author index {authorInitial}</>}.
          </p>
          {hasCatalogueFilters && (
            <button type="button" onClick={clearCatalogueFilters}>Clear search</button>
          )}
        </div>
      </section>

      <section className="catalogue-frontmatter" aria-label="Catalogue guide">
        <div className="catalogue-divisions">
          <h2>Principal divisions</h2>
          <ul>
            {divisions.map((division) => (
              <li key={division.name}>
                <span>{division.name}</span>
                <strong>{division.count}</strong>
              </li>
            ))}
          </ul>
        </div>

        <nav className="catalogue-alphabet" aria-label="Author index">
          <h2>Author index</h2>
          <ol>
            <li>
              <a
                href="#ledger-title"
                aria-current={!authorInitial ? "location" : undefined}
                onClick={() => setAuthorInitial("")}
              >
                All
              </a>
            </li>
            {[...catalogueByInitial.keys()].map((initial) => (
              <li key={initial}>
                <a
                  href="#ledger-title"
                  aria-current={authorInitial === initial ? "location" : undefined}
                  onClick={() => setAuthorInitial(initial)}
                >
                  {initial}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </section>

      {/* Map Tabs View Selector */}
      <div className="view-tabs-container">
        <div className="view-tabs">
          <button
            className={`view-tab font-mono ${mapMode === "similarity" ? "active" : ""}`}
            onClick={() => setMapMode("similarity")}
          >
            SIMILARITY MAP
          </button>
          <button
            className={`view-tab font-mono ${mapMode === "tag" ? "active" : ""}`}
            onClick={() => setMapMode("tag")}
          >
            SUBJECT TAG MAP
          </button>
        </div>
      </div>

      <CatalogueConstellation
        books={catalogueEntries}
        onTagClick={setActiveTag}
        onBookClick={setActiveBook}
        mode={mapMode}
      />

      {/* Bottom Tabs View Selector */}
      <div className="view-tabs-container bottom-tabs-container">
        <div className="view-tabs">
          <button
            className={`view-tab font-mono ${bottomView === "ledger" ? "active" : ""}`}
            onClick={() => setBottomView("ledger")}
          >
            SHELF LEDGER
          </button>
          <button
            className={`view-tab font-mono ${bottomView === "timeline" ? "active" : ""}`}
            onClick={() => setBottomView("timeline")}
          >
            DECADAL TIMELINE
          </button>
        </div>
      </div>

      {bottomView === "ledger" ? (
        <CatalogueLedger
          key={[catalogueQuery, divisionFilter, tagFilter, shelfFilter, authorInitial].join("|")}
          entries={filteredCatalogueEntries}
          onBookClick={setActiveBook}
        />
      ) : (
        <ChronologicalScroll books={catalogueEntries} onBookClick={setActiveBook} />
      )}

      {/* Pathfinder Overlay */}
      {isPathfinderOpen && (
        <PathfinderModal
          key={pathfinderSourceKey ?? "blank-pathfinder"}
          books={catalogueEntries}
          initialSource={
            catalogueEntries.find((book) => getBookKey(book) === pathfinderSourceKey) ?? null
          }
          isObscured={Boolean(activeBook || activeTag)}
          onClose={() => setIsPathfinderOpen(false)}
          onBookClick={setActiveBook}
        />
      )}

      {/* Tag search matches overlay */}
      {activeTag && (
        <TagMatchesOverlay
          tag={activeTag}
          books={catalogueEntries}
          onClose={() => setActiveTag(null)}
          onBookClick={setActiveBook}
        />
      )}

      {/* Book details overlay. It follows Pathfinder so it can sit above it. */}
      {activeBook && (
        <BookDetailCard
          book={activeBook}
          books={catalogueEntries}
          onBookClick={setActiveBook}
          onClose={() => setActiveBook(null)}
          onStartPath={() => {
            const sourceBook = activeBook;
            setActiveBook(null);
            openPathfinder(sourceBook);
          }}
          onTagClick={filterByTag}
        />
      )}

      {/* Aleph Overlay Modal */}
      {isAlephOpen && (
        <div className="catalogue-modal-overlay aleph-overlay" onClick={() => setIsAlephOpen(false)}>
          <div
            className="aleph-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="aleph-title"
          >
            <button
              className="card-close-slip aleph-close-slip"
              onClick={() => setIsAlephOpen(false)}
              aria-label="Close the Aleph"
            >
              <span className="slip-cancel">Close</span>
              <span className="slip-stamp font-mono">DISMISS</span>
            </button>

            <div className="aleph-sphere-outer">
              <div className="aleph-sphere-glow" />
              <div className="aleph-sphere-inner">
                <div className="aleph-eye">👁</div>
              </div>
            </div>

            <div className="aleph-cardstock">
              <span className="card-rubric-tag font-mono text-center block mb-2">speculum mundi</span>
              <h2 id="aleph-title" className="aleph-heading font-serif text-center italic text-3xl">The Aleph of Babel</h2>
              
              <div className="aleph-typewriter-box">
                <TypewriterText key={quoteIndex} text={alephQuotes[quoteIndex]} />
              </div>

              <div className="aleph-actions">
                <button
                  type="button"
                  className="aleph-btn font-mono"
                  onClick={() => {
                    // Cycles through quotes
                    setQuoteIndex((prev) => (prev + 1) % alephQuotes.length);
                  }}
                >
                  PEER AGAIN
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
