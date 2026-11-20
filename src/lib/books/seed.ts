import {
  createBookId,
  filterDisplayTags,
  READING_STATUS_VALUES,
  type ReadingStatus,
} from "@/lib/books/catalogue";
import type { Database } from "@/lib/database.types";

type SeedBook = Database["public"]["Tables"]["books"]["Insert"];

type BookPayload = Record<string, unknown>;

type ParsedBookRow = { book: SeedBook } | { issue: string };

const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UNCATEGORIZED_CATEGORY = "Uncategorized";
const MIN_PUBLISH_YEAR = -3000;
const MAX_PUBLISH_YEAR = 2100;

export class SeedPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedPayloadError";
  }
}

export type ParsedSeedPayload = {
  books: SeedBook[];
  duplicatesRemoved: number;
  issues: string[];
  received: number;
  rejected: number;
};

function isRecord(value: unknown): value is BookPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function optionalStringField(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

function parseSpineColor(value: unknown) {
  const parsed = optionalStringField(value);
  if (!parsed.ok) {
    return null;
  }

  if (!parsed.value) {
    return undefined;
  }

  return HEX_COLOR_PATTERN.test(parsed.value) ? parsed.value : null;
}

function parseShelfRow(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function parsePublishYear(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PUBLISH_YEAR &&
    value <= MAX_PUBLISH_YEAR
  ) {
    return { ok: true, value };
  }

  return { ok: false };
}

function parseTags(
  value: unknown,
): { ok: true; value: string[] } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: [] };
  }

  if (
    !Array.isArray(value) ||
    !value.every((tag) => typeof tag === "string")
  ) {
    return { ok: false };
  }

  return { ok: true, value: filterDisplayTags(value) };
}

function parseReadingStatus(
  value: unknown,
): { ok: true; value: ReadingStatus } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: "unread" };
  }

  if (
    typeof value === "string" &&
    (READING_STATUS_VALUES as readonly string[]).includes(value)
  ) {
    return { ok: true, value: value as ReadingStatus };
  }

  return { ok: false };
}

function parseRating(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  ) {
    return { ok: true, value };
  }

  return { ok: false };
}

function parseIsoDate(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  const match = ISO_DATE_PATTERN.exec(trimmed);
  if (!match) {
    return { ok: false };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    month < 1 ||
    month > 12 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false };
  }

  return { ok: true, value: trimmed };
}

function getCategory(row: BookPayload) {
  return (
    requiredText(row.category) ??
    requiredText(row.sub_category) ??
    requiredText(row.top_category) ??
    UNCATEGORIZED_CATEGORY
  );
}

function getShelfRowValue(row: BookPayload) {
  return row.shelf_row ?? row.shelf;
}

function getPayloadRows(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (isRecord(payload) && Array.isArray(payload.books)) {
    return payload.books;
  }

  throw new SeedPayloadError(
    "Expected an array of books or an object with a books array.",
  );
}

function parseBook(row: BookPayload, index: number): ParsedBookRow {
  const title = requiredText(row.title);
  const author = requiredText(row.author);
  const category = getCategory(row);
  const edition = optionalStringField(row.edition);
  const notes = optionalStringField(row.notes);
  const position = optionalStringField(row.position);
  const topCategory = optionalStringField(row.top_category);
  const subCategory = optionalStringField(row.sub_category);
  const summary = optionalStringField(row.summary);
  const personalNotes = optionalStringField(row.personal_notes);
  const loanedTo = optionalStringField(row.loaned_to);
  const shelfRow = parseShelfRow(getShelfRowValue(row));
  const spineColor = parseSpineColor(row.spine_color);
  const tags = parseTags(row.tags);
  const publishYear = parsePublishYear(row.publish_year);
  const readingStatus = parseReadingStatus(row.reading_status);
  const rating = parseRating(row.rating);
  const dateStarted = parseIsoDate(row.date_started);
  const dateFinished = parseIsoDate(row.date_finished);

  if (!title || !author) {
    return {
      issue: `Row ${index} is missing a non-empty title or author.`,
    };
  }

  if (!edition.ok) {
    return { issue: `Row ${index} has an invalid edition.` };
  }

  if (!notes.ok) {
    return { issue: `Row ${index} has invalid notes.` };
  }

  if (!position.ok) {
    return { issue: `Row ${index} has an invalid position.` };
  }

  if (!topCategory.ok) {
    return { issue: `Row ${index} has an invalid top_category.` };
  }

  if (!subCategory.ok) {
    return { issue: `Row ${index} has an invalid sub_category.` };
  }

  if (!summary.ok) {
    return { issue: `Row ${index} has an invalid summary.` };
  }

  if (!personalNotes.ok) {
    return { issue: `Row ${index} has invalid personal_notes.` };
  }

  if (!loanedTo.ok) {
    return { issue: `Row ${index} has an invalid loaned_to.` };
  }

  if (shelfRow === null) {
    return { issue: `Row ${index} has an invalid shelf_row or shelf.` };
  }

  if (spineColor === null) {
    return { issue: `Row ${index} has an invalid spine_color.` };
  }

  if (!tags.ok) {
    return { issue: `Row ${index} has invalid tags.` };
  }

  if (!publishYear.ok) {
    return { issue: `Row ${index} has an invalid publish_year.` };
  }

  if (!readingStatus.ok) {
    return { issue: `Row ${index} has an invalid reading_status.` };
  }

  if (!rating.ok) {
    return { issue: `Row ${index} has an invalid rating.` };
  }

  if (!dateStarted.ok) {
    return { issue: `Row ${index} has an invalid date_started.` };
  }

  if (!dateFinished.ok) {
    return { issue: `Row ${index} has an invalid date_finished.` };
  }

  let bookKey: string;
  if (row.book_key !== undefined && row.book_key !== null) {
    const explicitKey = requiredText(row.book_key);
    if (!explicitKey) {
      return { issue: `Row ${index} has an invalid book_key.` };
    }
    bookKey = explicitKey;
  } else {
    bookKey = createBookId({
      author,
      title,
      shelf: shelfRow ?? 0,
      position: position.value ?? "",
    });
  }

  return {
    book: {
      author,
      book_key: bookKey,
      category,
      date_finished: dateFinished.value,
      date_started: dateStarted.value,
      edition: edition.value,
      loaned_to: loanedTo.value,
      notes: notes.value,
      personal_notes: personalNotes.value,
      position: position.value,
      publish_year: publishYear.value,
      rating: rating.value,
      reading_status: readingStatus.value,
      shelf_row: shelfRow,
      spine_color: spineColor,
      sub_category: subCategory.value,
      summary: summary.value,
      tags: tags.value,
      title,
      top_category: topCategory.value,
    } satisfies SeedBook,
  };
}

function getBookIdentity(book: SeedBook) {
  return [
    book.title.toLocaleLowerCase("en-US"),
    book.author.toLocaleLowerCase("en-US"),
    String(book.shelf_row ?? -1),
    (book.position ?? "").trim().toLocaleLowerCase("en-US"),
  ].join("\u0000");
}

export function parseBookSeedPayload(payload: unknown): ParsedSeedPayload {
  const rows = getPayloadRows(payload);
  const booksByIdentity = new Map<string, SeedBook>();
  const issues: string[] = [];
  let duplicatesRemoved = 0;

  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      issues.push(`Row ${index} is not an object.`);
      return;
    }

    const parsed = parseBook(row, index);

    if ("issue" in parsed) {
      issues.push(parsed.issue);
      return;
    }

    const identity = getBookIdentity(parsed.book);

    if (booksByIdentity.has(identity)) {
      duplicatesRemoved += 1;
    }

    booksByIdentity.set(identity, parsed.book);
  });

  return {
    books: [...booksByIdentity.values()],
    duplicatesRemoved,
    issues,
    received: rows.length,
    rejected: issues.length,
  };
}
