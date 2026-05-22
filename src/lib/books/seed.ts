import type { Database } from "@/lib/database.types";

type SeedBook = Database["public"]["Tables"]["books"]["Insert"];

type BookPayload = Record<string, unknown>;

type ParsedBookRow = { book: SeedBook } | { issue: string };

const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;
const UNCATEGORIZED_CATEGORY = "Uncategorized";

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

function optionalText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  return requiredText(value);
}

function parseSpineColor(value: unknown) {
  const spineColor = optionalText(value);

  if (!spineColor) {
    return undefined;
  }

  return HEX_COLOR_PATTERN.test(spineColor) ? spineColor : null;
}

function parseShelfRow(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
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
  const edition = optionalText(row.edition);
  const notes = optionalText(row.notes);
  const shelfRow = parseShelfRow(getShelfRowValue(row));
  const spineColor = parseSpineColor(row.spine_color);

  if (!title || !author) {
    return {
      issue: `Row ${index} is missing a non-empty title or author.`,
    };
  }

  if (row.edition !== undefined && row.edition !== null && !edition) {
    return { issue: `Row ${index} has an invalid edition.` };
  }

  if (row.notes !== undefined && row.notes !== null && !notes) {
    return { issue: `Row ${index} has invalid notes.` };
  }

  if (shelfRow === null) {
    return { issue: `Row ${index} has an invalid shelf_row or shelf.` };
  }

  if (spineColor === null) {
    return { issue: `Row ${index} has an invalid spine_color.` };
  }

  return {
    book: {
      author,
      category,
      edition,
      notes,
      shelf_row: shelfRow,
      spine_color: spineColor,
      title,
    } satisfies SeedBook,
  };
}

function getBookIdentity(book: SeedBook) {
  return `${book.title.toLocaleLowerCase("en-US")}\u0000${book.author.toLocaleLowerCase("en-US")}`;
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
