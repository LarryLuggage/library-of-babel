import fullShelfCatalogue from "../../shelf_catalog_full.json";

type CatalogueBook = {
  author: string;
  edition: string;
  position: string;
  shelf: number;
  sub_category: string | null;
  title: string;
  top_category: string | null;
};

const books = fullShelfCatalogue as CatalogueBook[];
const titleCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareEntries(first: CatalogueBook, second: CatalogueBook) {
  return (
    titleCollator.compare(first.author, second.author) ||
    titleCollator.compare(first.title, second.title) ||
    first.shelf - second.shelf
  );
}

function getInitial(author: string) {
  return author.match(/[a-z]/i)?.[0].toLocaleUpperCase("en-US") ?? "#";
}

function getDivision(book: CatalogueBook) {
  return book.sub_category ?? book.top_category ?? "Unclassified";
}

const catalogueEntries = [...books].sort(compareEntries).map((book, index) => ({
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

      <section className="catalogue-ledger" aria-labelledby="ledger-title">
        <div className="catalogue-ledger-heading">
          <p>Complete shelf ledger</p>
          <h2 id="ledger-title">Entries by author</h2>
        </div>

        {[...catalogueByInitial.entries()].map(([initial, entries]) => (
          <section
            className="catalogue-letter"
            id={`author-${initial}`}
            key={initial}
          >
            <h3>{initial}</h3>
            <ol>
              {entries.map((book) => (
                <li className="catalogue-entry" key={book.number}>
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
    </main>
  );
}
