import type { CatalogueBook } from "./catalogue";
import type { ValidationResult } from "./validation";

export type BookQuote = {
  id: string;
  book_id: string;
  quote_text: string;
  page_number: string | null;
  chapter: string | null;
  note: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type CreateQuoteInput = {
  book_id: string;
  quote_text: string;
  page_number?: string | null;
  chapter?: string | null;
  note?: string | null;
  tags?: string[];
};

export type UpdateQuoteInput = Partial<
  Pick<BookQuote, "quote_text" | "page_number" | "chapter" | "note" | "tags">
>;

export type AlephMeditation = {
  text: string;
  sourceLabel: string;
  bookId?: string;
  isUserQuote: boolean;
};

const CLASSIC_BORGES_SOURCE_LABEL =
  "Jorge Luis Borges · The Aleph / Library of Babel";

export const CLASSIC_ALEPH_MEDITATIONS: readonly AlephMeditation[] = [
  {
    text: "I saw the populous sea, saw dawn and sunset, saw the multitudes of the Americas, saw a silvery cobweb in the center of a black pyramid, saw a splintered labyrinth (it was London), saw close-up endless eyes looking at me as though in a mirror, saw all the mirrors on earth and none of them reflected me...",
    sourceLabel: CLASSIC_BORGES_SOURCE_LABEL,
    isUserQuote: false,
  },
  {
    text: "I saw the Aleph from all points, I saw in the Aleph the earth and in the earth the Aleph once more and in the Aleph the earth, I saw my own face and my own entrails, saw your face, and I felt dizzy and wept, because my eyes had seen that conjectural and secret object whose name men usurp, but which no man has looked upon: the inconceivable universe.",
    sourceLabel: CLASSIC_BORGES_SOURCE_LABEL,
    isUserQuote: false,
  },
  {
    text: "The Library of Babel is infinite, periodic, and eternal. In its galleries, shelves, and volumes, all combinations of the orthographic symbols are registered. To consult the Aleph is to peer into the center of this vast library, where every volume is simultaneously present.",
    sourceLabel: CLASSIC_BORGES_SOURCE_LABEL,
    isUserQuote: false,
  },
];

const MAX_QUOTE_TEXT_LENGTH = 3000;
const MAX_PAGE_NUMBER_LENGTH = 40;
const MAX_CHAPTER_LENGTH = 120;
const MAX_NOTE_LENGTH = 1500;
const MAX_QUOTE_TAGS = 12;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQuoteText(value: unknown, errors: string[]): string {
  if (typeof value !== "string") {
    errors.push("quote_text is required and must be a non-empty string.");
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    errors.push("quote_text is required and must be a non-empty string.");
    return "";
  }
  if (trimmed.length > MAX_QUOTE_TEXT_LENGTH) {
    errors.push(
      `quote_text must be at most ${MAX_QUOTE_TEXT_LENGTH} characters.`,
    );
    return "";
  }
  return trimmed;
}

function parseOptionalBoundedString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  errors: string[],
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a string or null.`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength) {
    errors.push(`${fieldName} must be at most ${maxLength} characters.`);
    return null;
  }
  return trimmed;
}

function parseQuoteTags(value: unknown, errors: string[]): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  let rawItems: string[];
  if (typeof value === "string") {
    rawItems = value.split(",");
  } else if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  ) {
    rawItems = value;
  } else {
    errors.push("tags must be an array of strings or a comma-separated string.");
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of rawItems) {
    const tag = item.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    normalized.push(tag);
  }

  if (normalized.length > MAX_QUOTE_TAGS) {
    errors.push(`tags must contain at most ${MAX_QUOTE_TAGS} unique entries.`);
    return [];
  }

  return normalized;
}

/**
 * Validates and normalizes a payload for creating a commonplace quote.
 */
export function validateCreateQuoteInput(
  payload: unknown,
): ValidationResult<CreateQuoteInput> {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, errors: [message] };
  }

  const errors: string[] = [];

  const bookId =
    typeof payload.book_id === "string" ? payload.book_id.trim() : "";
  if (!bookId) {
    errors.push("book_id is required and must be a non-empty string.");
  }

  const quoteText = parseQuoteText(payload.quote_text, errors);
  const pageNumber = parseOptionalBoundedString(
    payload.page_number,
    "page_number",
    MAX_PAGE_NUMBER_LENGTH,
    errors,
  );
  const chapter = parseOptionalBoundedString(
    payload.chapter,
    "chapter",
    MAX_CHAPTER_LENGTH,
    errors,
  );
  const note = parseOptionalBoundedString(
    payload.note,
    "note",
    MAX_NOTE_LENGTH,
    errors,
  );
  const tags = parseQuoteTags(payload.tags, errors);

  if (errors.length > 0) {
    return { ok: false, error: errors[0], errors };
  }

  return {
    ok: true,
    data: {
      book_id: bookId,
      quote_text: quoteText,
      page_number: pageNumber,
      chapter,
      note,
      tags,
    },
  };
}

/**
 * Validates and normalizes a partial patch payload for updating a commonplace quote.
 */
export function validateUpdateQuoteInput(
  payload: unknown,
): ValidationResult<UpdateQuoteInput> {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, errors: [message] };
  }

  const errors: string[] = [];
  const data: UpdateQuoteInput = {};

  if (payload.quote_text !== undefined) {
    data.quote_text = parseQuoteText(payload.quote_text, errors);
  }
  if (payload.page_number !== undefined) {
    data.page_number = parseOptionalBoundedString(
      payload.page_number,
      "page_number",
      MAX_PAGE_NUMBER_LENGTH,
      errors,
    );
  }
  if (payload.chapter !== undefined) {
    data.chapter = parseOptionalBoundedString(
      payload.chapter,
      "chapter",
      MAX_CHAPTER_LENGTH,
      errors,
    );
  }
  if (payload.note !== undefined) {
    data.note = parseOptionalBoundedString(
      payload.note,
      "note",
      MAX_NOTE_LENGTH,
      errors,
    );
  }
  if (payload.tags !== undefined) {
    data.tags = parseQuoteTags(payload.tags, errors);
  }

  if (errors.length === 0 && Object.keys(data).length === 0) {
    errors.push("At least one updatable field must be provided.");
  }

  if (errors.length > 0) {
    return { ok: false, error: errors[0], errors };
  }

  return { ok: true, data };
}

/**
 * Filters commonplace quotes by free-text query, tag, and/or referenced book ID.
 */
export function filterQuotes(
  quotes: readonly BookQuote[],
  booksById: ReadonlyMap<string, CatalogueBook>,
  options?: { query?: string; tag?: string; bookId?: string },
): BookQuote[] {
  const bookIdFilter = options?.bookId?.trim() ?? "";
  const tagFilter = options?.tag
    ? options.tag.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
    : "";
  const queryTokens = options?.query
    ? options.query
        .trim()
        .toLocaleLowerCase("en-US")
        .split(/\s+/)
        .filter(Boolean)
    : [];

  return quotes.filter((quote) => {
    if (bookIdFilter && quote.book_id !== bookIdFilter) {
      return false;
    }

    if (
      tagFilter &&
      !quote.tags.some((t) => t.toLocaleLowerCase("en-US") === tagFilter)
    ) {
      return false;
    }

    if (queryTokens.length > 0) {
      const book = booksById.get(quote.book_id);
      const haystack = [
        quote.quote_text,
        quote.note ?? "",
        quote.chapter ?? "",
        quote.page_number ?? "",
        quote.tags.join(" "),
        book?.title ?? "",
        book?.author ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("en-US");

      for (const token of queryTokens) {
        if (!haystack.includes(token)) {
          return false;
        }
      }
    }

    return true;
  });
}

/**
 * Returns all unique quote tags sorted by descending frequency, then alphabetically.
 */
export function buildQuoteTagList(quotes: readonly BookQuote[]): string[] {
  const counts = new Map<string, number>();

  for (const quote of quotes) {
    for (const rawTag of quote.tags) {
      const tag = rawTag.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
      if (!tag) {
        continue;
      }
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0], "en-US");
    })
    .map(([tag]) => tag);
}

/**
 * Builds the Aleph meditation pool: the 3 classic Borges meditations followed by saved user quotes.
 */
export function buildAlephMeditationPool(
  quotes: readonly BookQuote[],
  booksById: ReadonlyMap<string, CatalogueBook>,
): AlephMeditation[] {
  const pool: AlephMeditation[] = CLASSIC_ALEPH_MEDITATIONS.map((item) => ({
    ...item,
  }));

  for (const quote of quotes) {
    const book = booksById.get(quote.book_id);
    const baseLabel = book
      ? `${book.title} · ${book.author}`
      : "Saved Passage";
    const sourceLabel = quote.page_number
      ? `${baseLabel} · p. ${quote.page_number}`
      : baseLabel;

    pool.push({
      text: quote.quote_text,
      sourceLabel,
      bookId: quote.book_id,
      isUserQuote: true,
    });
  }

  return pool;
}
