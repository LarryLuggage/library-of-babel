import type { ValidationResult } from "./validation";

export type ReadingListItem = {
  id: string;
  list_id: string;
  book_id: string;
  position: number;
  note: string | null;
  added_at: string;
};

export type ReadingList = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_queue: boolean;
  created_at: string;
  updated_at: string;
  items: ReadingListItem[];
};

export type CreateReadingListInput = {
  name: string;
  description?: string | null;
  is_queue?: boolean;
};

export type UpdateReadingListInput = {
  name?: string;
  description?: string | null;
  is_queue?: boolean;
};

export type AddListItemInput = {
  book_id: string;
  note?: string | null;
};

export type ReorderListItemsInput = {
  book_ids: string[];
};

const MAX_LIST_NAME_LENGTH = 80;
const MAX_LIST_DESCRIPTION_LENGTH = 500;
const MAX_ITEM_NOTE_LENGTH = 500;
const MAX_REORDER_BOOK_IDS = 500;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseListName(value: unknown, errors: string[]): string {
  if (typeof value !== "string") {
    errors.push("name is required and must be a non-empty string.");
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    errors.push("name is required and must be a non-empty string.");
    return "";
  }
  if (trimmed.length > MAX_LIST_NAME_LENGTH) {
    errors.push(`name must be at most ${MAX_LIST_NAME_LENGTH} characters.`);
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

/**
 * Generates a URL-safe ASCII slug from a reading list name.
 */
export function slugifyListName(name: string): string {
  const folded = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return folded || "reading-list";
}

/**
 * Sorts reading lists with pinned queues (`is_queue: true`) first, then alphabetically by name.
 */
export function sortReadingLists(lists: readonly ReadingList[]): ReadingList[] {
  return [...lists].sort((a, b) => {
    if (a.is_queue !== b.is_queue) {
      return a.is_queue ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "en-US", { sensitivity: "base" });
  });
}

/**
 * Returns all reading lists containing the given book ID, sorted with queues first.
 */
export function getListsForBook(
  lists: readonly ReadingList[],
  bookId: string,
): ReadingList[] {
  return sortReadingLists(
    lists.filter((list) => list.items.some((item) => item.book_id === bookId)),
  );
}

/**
 * Moves a book ID one slot up or down within an ordered list of book IDs.
 */
export function reorderItemIds(
  currentIds: readonly string[],
  bookId: string,
  direction: "up" | "down",
): string[] {
  const index = currentIds.indexOf(bookId);
  if (index === -1) {
    return [...currentIds];
  }

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= currentIds.length) {
    return [...currentIds];
  }

  const next = [...currentIds];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

/**
 * Validates and normalizes a payload for creating a reading list.
 */
export function validateCreateListInput(
  payload: unknown,
): ValidationResult<CreateReadingListInput> {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, errors: [message] };
  }

  const errors: string[] = [];
  const name = parseListName(payload.name, errors);
  const description = parseOptionalBoundedString(
    payload.description,
    "description",
    MAX_LIST_DESCRIPTION_LENGTH,
    errors,
  );

  let isQueue = false;
  if (payload.is_queue !== undefined) {
    if (typeof payload.is_queue !== "boolean") {
      errors.push("is_queue must be a boolean.");
    } else {
      isQueue = payload.is_queue;
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors[0], errors };
  }

  return {
    ok: true,
    data: {
      name,
      description,
      is_queue: isQueue,
    },
  };
}

/**
 * Validates and normalizes a partial patch payload for updating a reading list.
 */
export function validateUpdateListInput(
  payload: unknown,
): ValidationResult<UpdateReadingListInput> {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, errors: [message] };
  }

  const errors: string[] = [];
  const data: UpdateReadingListInput = {};

  if (payload.name !== undefined) {
    data.name = parseListName(payload.name, errors);
  }
  if (payload.description !== undefined) {
    data.description = parseOptionalBoundedString(
      payload.description,
      "description",
      MAX_LIST_DESCRIPTION_LENGTH,
      errors,
    );
  }
  if (payload.is_queue !== undefined) {
    if (typeof payload.is_queue !== "boolean") {
      errors.push("is_queue must be a boolean.");
    } else {
      data.is_queue = payload.is_queue;
    }
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
 * Validates and normalizes a payload for adding a book to a reading list.
 */
export function validateAddListItemInput(
  payload: unknown,
): ValidationResult<AddListItemInput> {
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

  const note = parseOptionalBoundedString(
    payload.note,
    "note",
    MAX_ITEM_NOTE_LENGTH,
    errors,
  );

  if (errors.length > 0) {
    return { ok: false, error: errors[0], errors };
  }

  return {
    ok: true,
    data: {
      book_id: bookId,
      note,
    },
  };
}

/**
 * Validates and normalizes a payload for reordering items in a reading list.
 */
export function validateReorderListItemsInput(
  payload: unknown,
): ValidationResult<ReorderListItemsInput> {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, errors: [message] };
  }

  const errors: string[] = [];
  const rawIds = payload.book_ids;

  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    errors.push(
      `book_ids must be an array of 1 to ${MAX_REORDER_BOOK_IDS} non-empty strings.`,
    );
    return { ok: false, error: errors[0], errors };
  }

  if (rawIds.length > MAX_REORDER_BOOK_IDS) {
    errors.push(
      `book_ids may contain at most ${MAX_REORDER_BOOK_IDS} entries.`,
    );
    return { ok: false, error: errors[0], errors };
  }

  const seen = new Set<string>();
  const bookIds: string[] = [];

  for (const rawId of rawIds) {
    if (typeof rawId !== "string" || rawId.trim().length === 0) {
      errors.push("Each entry in book_ids must be a non-empty string.");
      return { ok: false, error: errors[0], errors };
    }
    const trimmed = rawId.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      bookIds.push(trimmed);
    }
  }

  return {
    ok: true,
    data: {
      book_ids: bookIds,
    },
  };
}
