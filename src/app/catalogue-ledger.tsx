"use client";

import { useMemo } from "react";
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
  onBookClick,
}: {
  entries: LedgerBook[];
  onBookClick: (book: LedgerBook) => void;
}) {
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
                onClick={() => onBookClick(book)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onBookClick(book);
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
  );
}
