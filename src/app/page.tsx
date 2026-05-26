"use client";

import { useState, useEffect } from "react";
import fullShelfCatalogue from "../../shelf_catalog_full.json";
import { CatalogueConstellation } from "./catalogue-constellation";
import { CatalogueLedger } from "./catalogue-ledger";
import { BookDetailCard } from "./book-detail-card";
import { TagMatchesOverlay } from "./tag-matches-overlay";
import { ChronologicalScroll } from "./chronological-scroll";
import { PathfinderModal } from "./pathfinder-modal";
import {
  compareCatalogueBooks,
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

// Simple typewriter helper for the Aleph overlay
function TypewriterText({ text, speed = 25 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState("");
  const [prevText, setPrevText] = useState(text);

  if (text !== prevText) {
    setPrevText(text);
    setDisplayed("");
  }

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      setDisplayed((prev) => prev + text.charAt(index));
      index++;
      if (index >= text.length) {
        clearInterval(interval);
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <p className="aleph-text font-mono">
      {displayed}
      <span className="aleph-cursor">_</span>
    </p>
  );
}

export default function Home() {
  const [activeBook, setActiveBook] = useState<(CatalogueBook & { number: number }) | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Layout View Tabs State
  const [mapMode, setMapMode] = useState<"similarity" | "tag">("similarity");
  const [bottomView, setBottomView] = useState<"ledger" | "timeline">("ledger");

  // Modals / Overlays State
  const [isPathfinderOpen, setIsPathfinderOpen] = useState(false);
  const [isAlephOpen, setIsAlephOpen] = useState(false);

  // Aleph quotes selection state
  const alephQuotes = [
    "I saw the populous sea, saw dawn and sunset, saw the multitudes of the Americas, saw a silvery cobweb in the center of a black pyramid, saw a splintered labyrinth (it was London), saw close-up endless eyes looking at me as though in a mirror, saw all the mirrors on earth and none of them reflected me...",
    "I saw the Aleph from all points, I saw in the Aleph the earth and in the earth the Aleph once more and in the Aleph the earth, I saw my own face and my own entrails, saw your face, and I felt dizzy and wept, because my eyes had seen that conjectural and secret object whose name men usurp, but which no man has looked upon: the inconceivable universe.",
    "The Library of Babel is infinite, periodic, and eternal. In its galleries, shelves, and volumes, all combinations of the orthographic symbols are registered. To consult the Aleph is to peer into the center of this vast library, where every volume is simultaneously present."
  ];
  const [quoteIndex, setQuoteIndex] = useState(0);

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
            onClick={() => setIsPathfinderOpen(true)}
          >
            ❖ CONSULT THE PATHFINDER
          </button>
          <button
            type="button"
            className="toolbar-btn btn-aleph font-mono"
            onClick={() => {
              setQuoteIndex(Math.floor(Math.random() * alephQuotes.length));
              setIsAlephOpen(true);
            }}
          >
            👁 CONSULT THE ALEPH
          </button>
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
            {[...catalogueByInitial.keys()].map((initial) => (
              <li key={initial}>
                <a href={`#author-${initial}`}>{initial}</a>
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
        <CatalogueLedger entries={catalogueEntries} onBookClick={setActiveBook} />
      ) : (
        <ChronologicalScroll books={catalogueEntries} onBookClick={setActiveBook} />
      )}

      {/* Book details overlay */}
      {activeBook && (
        <BookDetailCard
          book={activeBook}
          onClose={() => setActiveBook(null)}
          onTagClick={setActiveTag}
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

      {/* Pathfinder Overlay */}
      {isPathfinderOpen && (
        <PathfinderModal
          books={catalogueEntries}
          onClose={() => setIsPathfinderOpen(false)}
          onBookClick={setActiveBook}
        />
      )}

      {/* Aleph Overlay Modal */}
      {isAlephOpen && (
        <div className="catalogue-modal-overlay aleph-overlay" onClick={() => setIsAlephOpen(false)}>
          <div className="aleph-container" onClick={(e) => e.stopPropagation()}>
            <button className="card-close-slip aleph-close-slip" onClick={() => setIsAlephOpen(false)}>
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
              <h2 className="aleph-heading font-serif text-center italic text-3xl">The Aleph of Babel</h2>
              
              <div className="aleph-typewriter-box">
                <TypewriterText text={alephQuotes[quoteIndex]} />
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
