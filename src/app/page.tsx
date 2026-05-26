"use client";

import { useState } from "react";
import fullShelfCatalogue from "../../shelf_catalog_full.json";
import { CatalogueConstellation } from "./catalogue-constellation";
import { CatalogueLedger } from "./catalogue-ledger";
import { BookDetailCard } from "./book-detail-card";
import { TagMatchesOverlay } from "./tag-matches-overlay";
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

export default function Home() {
  const [activeBook, setActiveBook] = useState<(CatalogueBook & { number: number }) | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

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

      <CatalogueConstellation books={catalogueEntries} onTagClick={setActiveTag} />

      <CatalogueLedger entries={catalogueEntries} onBookClick={setActiveBook} />

      {activeBook && (
        <BookDetailCard
          book={activeBook}
          onClose={() => setActiveBook(null)}
          onTagClick={setActiveTag}
        />
      )}

      {activeTag && (
        <TagMatchesOverlay
          tag={activeTag}
          books={catalogueEntries}
          onClose={() => setActiveTag(null)}
          onBookClick={setActiveBook}
        />
      )}
    </main>
  );
}
