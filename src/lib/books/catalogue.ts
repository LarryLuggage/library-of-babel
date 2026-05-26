export type CatalogueBook = {
  author: string;
  edition: string;
  position: string;
  shelf: number;
  sub_category: string | null;
  title: string;
  top_category: string | null;
};

export type CatalogueConnection = {
  book: CatalogueBook;
  reasons: string[];
  score: number;
};

const titleCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function addDivisionConnection(
  focus: CatalogueBook,
  candidate: CatalogueBook,
  reasons: string[],
) {
  if (focus.sub_category && focus.sub_category === candidate.sub_category) {
    reasons.push(`Both shelved as ${focus.sub_category}.`);
    return 8;
  }

  if (focus.top_category && focus.top_category === candidate.top_category) {
    reasons.push(`Same ${focus.top_category} division.`);
    return 2;
  }

  return 0;
}

function addShelfConnection(
  focus: CatalogueBook,
  candidate: CatalogueBook,
  reasons: string[],
) {
  const shelfGap = Math.abs(focus.shelf - candidate.shelf);

  if (shelfGap === 0) {
    reasons.push(`Both recorded on Shelf ${focus.shelf}.`);
    return 4;
  }

  if (shelfGap === 1) {
    reasons.push(`Neighboring shelves ${focus.shelf} and ${candidate.shelf}.`);
    return 3;
  }

  if (shelfGap === 2) {
    reasons.push(`Two shelves apart in the physical catalogue.`);
    return 1;
  }

  return 0;
}

export function compareCatalogueBooks(
  first: CatalogueBook,
  second: CatalogueBook,
) {
  return (
    titleCollator.compare(first.author, second.author) ||
    titleCollator.compare(first.title, second.title) ||
    first.shelf - second.shelf
  );
}

export function getBookKey(book: CatalogueBook) {
  return JSON.stringify([book.author, book.title, book.shelf, book.position]);
}

export function getDivision(book: CatalogueBook) {
  return book.sub_category ?? book.top_category ?? "Unclassified";
}

export function getCatalogueConnection(
  focus: CatalogueBook,
  candidate: CatalogueBook,
) {
  if (getBookKey(focus) === getBookKey(candidate)) {
    return null;
  }

  const reasons: string[] = [];
  let score = addDivisionConnection(focus, candidate, reasons);

  if (focus.author === candidate.author && focus.author !== "Various") {
    reasons.unshift(`Another work by ${focus.author}.`);
    score += 12;
  }

  score += addShelfConnection(focus, candidate, reasons);

  return score > 0
    ? {
        book: candidate,
        reasons,
        score,
      }
    : null;
}

export function getNearestConnections(
  focus: CatalogueBook,
  books: CatalogueBook[],
  limit: number,
) {
  return books
    .map((book) => getCatalogueConnection(focus, book))
    .filter((connection): connection is CatalogueConnection =>
      Boolean(connection),
    )
    .sort(
      (first, second) =>
        second.score - first.score ||
        first.reasons.length - second.reasons.length ||
        compareCatalogueBooks(first.book, second.book),
    )
    .slice(0, limit);
}
