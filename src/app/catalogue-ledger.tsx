"use client";

import { useMemo, useState } from "react";
import { getDivision, type CatalogueBook } from "@/lib/books/catalogue";

function getInitial(author: string) {
  const searchableAuthor = author
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return searchableAuthor.match(/[a-z]/i)?.[0].toLocaleUpperCase("en-US") ?? "#";
}

type LedgerBook = CatalogueBook & { number: number };

export function CatalogueLedger({
  entries,
}: {
  entries: LedgerBook[];
}) {
  const [activeBook, setActiveBook] = useState<LedgerBook | null>(null);

  const entriesByInitial = useMemo(() => {
    const groups = new Map<string, LedgerBook[]>();
    for (const entry of entries) {
      const initial = getInitial(entry.author);
      if (!groups.has(initial)) {
        groups.set(initial, []);
      }
      groups.get(initial)!.push(entry);
    }
    return groups;
  }, [entries]);

  return (
    <>
      <section className="catalogue-ledger" aria-labelledby="ledger-title">
        <div className="catalogue-ledger-heading">
          <p>Complete shelf ledger</p>
          <h2 id="ledger-title">Entries by author</h2>
        </div>

        {[...entriesByInitial.entries()].map(([initial, groupEntries]) => (
          <section
            className="catalogue-letter"
            id={`author-${initial}`}
            key={initial}
          >
            <h3>{initial}</h3>
            <ol>
              {groupEntries.map((book) => (
                <li
                  className="catalogue-entry catalogue-entry-interactive"
                  key={book.number}
                  onClick={() => setActiveBook(book)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveBook(book);
                    }
                  }}
                  aria-haspopup="dialog"
                >
                  <span className="catalogue-entry-number">{book.number}</span>
                  <p>
                    <span className="catalogue-author">{book.author}.</span>{" "}
                    <cite>{book.title}.</cite>{" "}
                    <span className="catalogue-edition">{book.edition}.</span>
                    <span className="catalogue-division">
                      {getDivision(book)}.
                    </span>
                  </p>
                  <span className="catalogue-location">
                    Shelf {book.shelf}. {book.position}.
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </section>

      {activeBook && (
        <div
          className="catalogue-modal-overlay"
          onClick={() => setActiveBook(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="card-title"
        >
          <div
            className="catalogue-catalog-card"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Call Number / Location in top-left */}
            <div className="card-call-number">
              <span>Sh. {activeBook.shelf}</span>
              <span>Pos. {activeBook.position}</span>
            </div>

            {/* Division Stamp in top-right */}
            {activeBook.top_category && (
              <div className="card-stamp">
                {activeBook.top_category}
              </div>
            )}

            {/* Card Body */}
            <div className="card-body">
              <span className="card-entry-number">Vol. {activeBook.number}</span>
              <h3 id="card-title" className="card-title">
                {activeBook.title}
              </h3>
              <p className="card-author">by {activeBook.author}</p>

              <div className="card-meta-list">
                <div>
                  <strong>Edition:</strong> {activeBook.edition}
                </div>
                {activeBook.sub_category && (
                  <div>
                    <strong>Sub-Category:</strong> {activeBook.sub_category}
                  </div>
                )}
                <div>
                  <strong>Location:</strong> Shelf {activeBook.shelf}, {activeBook.position}
                </div>
              </div>

              {activeBook.summary && (
                <div className="card-summary">
                  <p>{activeBook.summary}</p>
                </div>
              )}

              {activeBook.tags && activeBook.tags.length > 0 && (
                <div className="card-tags" aria-label="Tags">
                  {activeBook.tags.map((tag) => (
                    <span key={tag} className="card-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Rod Hole at the bottom */}
            <div className="card-rod-hole" aria-hidden="true">
              <div className="card-rod-ring"></div>
            </div>

            {/* Close Button styled as a stamp or tab */}
            <button
              className="card-close-btn"
              onClick={() => setActiveBook(null)}
              type="button"
            >
              Close Volume
            </button>
          </div>
        </div>
      )}
    </>
  );
}
