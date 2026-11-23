import {
  type CatalogueBook,
  compareCatalogueBooks,
  getTimelineBucket,
  type ReadingStatus,
} from "@/lib/books/catalogue";

export type RatingValue = 1 | 2 | 3 | 4 | 5;

export type RatingHistogram = Record<RatingValue, number>;

export type FinishedYearEntry = {
  year: number;
  count: number;
};

export type DivisionBreakdownEntry = {
  name: string;
  total: number;
  finished: number;
  reading: number;
  unread: number;
  dnf: number;
};

export type DecadeBreakdownEntry = {
  decade: string;
  count: number;
};

export type TopAuthorEntry = {
  author: string;
  count: number;
  finished: number;
};

export type CatalogueStats<T extends CatalogueBook = CatalogueBook> = {
  totalBooks: number;
  statusCounts: Record<ReadingStatus, number>;
  completionPercent: number;
  loanedCount: number;
  loanedBooks: T[];
  ratedCount: number;
  averageRating: number | null;
  ratingHistogram: RatingHistogram;
  finishedByYear: FinishedYearEntry[];
  divisionBreakdown: DivisionBreakdownEntry[];
  decadeBreakdown: DecadeBreakdownEntry[];
  topAuthors: TopAuthorEntry[];
};

const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/;
const CSV_NEEDS_QUOTES = /[",\n\r]/;

const CSV_HEADERS = [
  "id",
  "title",
  "author",
  "edition",
  "shelf",
  "position",
  "top_category",
  "sub_category",
  "publish_year",
  "reading_status",
  "rating",
  "date_started",
  "date_finished",
  "loaned_to",
  "tags",
  "summary",
  "personal_notes",
] as const;

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Computes reading tracker progress, rating analytics, division coverage,
 * decade distribution, and top authors across a collection of books.
 */
export function computeCatalogueStats<T extends CatalogueBook>(
  books: readonly T[],
): CatalogueStats<T> {
  const statusCounts: Record<ReadingStatus, number> = {
    unread: 0,
    reading: 0,
    finished: 0,
    dnf: 0,
  };

  const loanedBooks: T[] = [];
  const ratingHistogram: RatingHistogram = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  let ratedCount = 0;
  let ratingSum = 0;

  const finishedYearCounts = new Map<number, number>();
  const divisionBuckets = new Map<string, DivisionBreakdownEntry>();
  const decadeBuckets = new Map<
    string,
    { label: string; sortOrder: number; count: number }
  >();
  const authorBuckets = new Map<string, TopAuthorEntry>();

  for (const book of books) {
    statusCounts[book.reading_status] += 1;

    if (book.loaned_to && book.loaned_to.trim().length > 0) {
      loanedBooks.push(book);
    }

    if (
      typeof book.rating === "number" &&
      Number.isInteger(book.rating) &&
      book.rating >= 1 &&
      book.rating <= 5
    ) {
      const rating = book.rating as RatingValue;
      ratedCount += 1;
      ratingSum += rating;
      ratingHistogram[rating] += 1;
    }

    if (book.date_finished) {
      const yearMatch = /^(\d{4})-\d{2}-\d{2}$/.exec(book.date_finished.trim());
      if (yearMatch) {
        const year = Number.parseInt(yearMatch[1], 10);
        finishedYearCounts.set(year, (finishedYearCounts.get(year) ?? 0) + 1);
      }
    }

    const divisionName = book.top_category?.trim() || "Unclassified";
    let divisionEntry = divisionBuckets.get(divisionName);
    if (!divisionEntry) {
      divisionEntry = {
        name: divisionName,
        total: 0,
        finished: 0,
        reading: 0,
        unread: 0,
        dnf: 0,
      };
      divisionBuckets.set(divisionName, divisionEntry);
    }
    divisionEntry.total += 1;
    divisionEntry[book.reading_status] += 1;

    const bucket = getTimelineBucket(book.publish_year);
    const decadeEntry = decadeBuckets.get(bucket.key);
    if (decadeEntry) {
      decadeEntry.count += 1;
    } else {
      decadeBuckets.set(bucket.key, {
        label: bucket.label,
        sortOrder: bucket.sortOrder,
        count: 1,
      });
    }

    const authorName = book.author.trim();
    if (authorName && authorName.toLocaleLowerCase("en-US") !== "various") {
      let authorEntry = authorBuckets.get(authorName);
      if (!authorEntry) {
        authorEntry = { author: authorName, count: 0, finished: 0 };
        authorBuckets.set(authorName, authorEntry);
      }
      authorEntry.count += 1;
      if (book.reading_status === "finished") {
        authorEntry.finished += 1;
      }
    }
  }

  loanedBooks.sort(compareCatalogueBooks);

  const totalBooks = books.length;
  const completionPercent =
    totalBooks === 0 ? 0 : roundOneDecimal((statusCounts.finished / totalBooks) * 100);
  const averageRating =
    ratedCount === 0 ? null : roundOneDecimal(ratingSum / ratedCount);

  const finishedByYear: FinishedYearEntry[] = [...finishedYearCounts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((first, second) => second.year - first.year);

  const divisionBreakdown: DivisionBreakdownEntry[] = [
    ...divisionBuckets.values(),
  ].sort(
    (first, second) =>
      second.total - first.total ||
      first.name.localeCompare(second.name),
  );

  const decadeBreakdown: DecadeBreakdownEntry[] = [...decadeBuckets.values()]
    .sort((first, second) => first.sortOrder - second.sortOrder)
    .map(({ label, count }) => ({ decade: label, count }));

  const topAuthors: TopAuthorEntry[] = [...authorBuckets.values()]
    .sort(
      (first, second) =>
        second.count - first.count || first.author.localeCompare(second.author),
    )
    .slice(0, 10);

  return {
    totalBooks,
    statusCounts,
    completionPercent,
    loanedCount: loanedBooks.length,
    loanedBooks,
    ratedCount,
    averageRating,
    ratingHistogram,
    finishedByYear,
    divisionBreakdown,
    decadeBreakdown,
    topAuthors,
  };
}

/**
 * Serializes catalogue books as formatted JSON for portable backups.
 */
export function serializeBooksToJson(books: readonly CatalogueBook[]): string {
  return `${JSON.stringify(books, null, 2)}\n`;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  const safeValue = FORMULA_INJECTION_PREFIX.test(value) ? `'${value}` : value;

  if (CSV_NEEDS_QUOTES.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }

  return safeValue;
}

/**
 * Serializes catalogue books as RFC-4180 CSV with formula-injection neutralization.
 */
export function serializeBooksToCsv(books: readonly CatalogueBook[]): string {
  const lines: string[] = [CSV_HEADERS.join(",")];

  for (const book of books) {
    const row = [
      escapeCsvCell(book.id),
      escapeCsvCell(book.title),
      escapeCsvCell(book.author),
      escapeCsvCell(book.edition),
      escapeCsvCell(book.shelf),
      escapeCsvCell(book.position),
      escapeCsvCell(book.top_category),
      escapeCsvCell(book.sub_category),
      escapeCsvCell(book.publish_year),
      escapeCsvCell(book.reading_status),
      escapeCsvCell(book.rating),
      escapeCsvCell(book.date_started),
      escapeCsvCell(book.date_finished),
      escapeCsvCell(book.loaned_to),
      escapeCsvCell(book.tags.join(", ")),
      escapeCsvCell(book.summary),
      escapeCsvCell(book.personal_notes),
    ];
    lines.push(row.join(","));
  }

  return `${lines.join("\n")}\n`;
}
