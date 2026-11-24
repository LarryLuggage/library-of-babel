import {
  READING_STATUS_VALUES,
  type ReadingStatus,
} from "./catalogue";
import type { BulkBookPatch } from "./triage";

export type CreateBookInput = {
  title: string;
  author: string;
  edition: string;
  shelf: number;
  position: string;
  top_category: string | null;
  sub_category: string | null;
  summary: string | null;
  tags: string[];
  publish_year: number | null;
  reading_status: ReadingStatus;
  rating: number | null;
  date_started: string | null;
  date_finished: string | null;
  personal_notes: string | null;
  loaned_to: string | null;
};

export type UpdateBookInput = Partial<CreateBookInput>;

export type BulkBooksInput = {
  ids: string[];
  patch: BulkBookPatch;
};

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; errors: string[] };

const MAX_TAGS_COUNT = 20;
const MAX_BULK_BOOK_IDS = 200;
const MIN_PUBLISH_YEAR = -3000;
const MAX_PUBLISH_YEAR = 2100;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ALLOWED_BULK_PATCH_KEYS = new Set([
  "reading_status",
  "shelf",
  "top_category",
  "add_tags",
  "remove_tags",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequiredString(
  value: unknown,
  fieldName: string,
  errors: string[],
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${fieldName} is required and must be a non-empty string.`);
    return "";
  }
  return value.trim();
}

function parseDefaultEmptyString(
  value: unknown,
  fieldName: string,
  errors: string[],
): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a string.`);
    return "";
  }
  return value.trim();
}

function parseNullableString(
  value: unknown,
  fieldName: string,
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
  return trimmed.length > 0 ? trimmed : null;
}

function parseShelf(value: unknown, errors: string[]): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    errors.push("shelf must be a non-negative integer.");
    return 0;
  }
  return value;
}

function parsePublishYear(value: unknown, errors: string[]): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_PUBLISH_YEAR ||
    value > MAX_PUBLISH_YEAR
  ) {
    errors.push(
      `publish_year must be null or an integer between ${MIN_PUBLISH_YEAR} and ${MAX_PUBLISH_YEAR}.`,
    );
    return null;
  }
  return value;
}

function parseTags(
  value: unknown,
  errors: string[],
  fieldName = "tags",
): string[] {
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
    errors.push(
      `${fieldName} must be an array of strings or a comma-separated string.`,
    );
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

  if (normalized.length > MAX_TAGS_COUNT) {
    errors.push(
      `${fieldName} must contain at most ${MAX_TAGS_COUNT} unique entries.`,
    );
    return [];
  }

  return normalized;
}

function parseReadingStatus(value: unknown, errors: string[]): ReadingStatus {
  if (value === undefined) {
    return "unread";
  }
  if (
    typeof value !== "string" ||
    !(READING_STATUS_VALUES as readonly string[]).includes(value)
  ) {
    errors.push(
      `reading_status must be one of: ${READING_STATUS_VALUES.join(", ")}.`,
    );
    return "unread";
  }
  return value as ReadingStatus;
}

function parseRating(value: unknown, errors: string[]): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 5
  ) {
    errors.push("rating must be null or an integer between 1 and 5.");
    return null;
  }
  return value;
}

function parseIsoDate(
  value: unknown,
  fieldName: string,
  errors: string[],
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    errors.push(`${fieldName} must be null or a valid YYYY-MM-DD date.`);
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = ISO_DATE_PATTERN.exec(trimmed);
  if (!match) {
    errors.push(`${fieldName} must be null or a valid YYYY-MM-DD date.`);
    return null;
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
    errors.push(`${fieldName} must be null or a valid YYYY-MM-DD date.`);
    return null;
  }

  return trimmed;
}

function buildResult<T>(data: T, errors: string[]): ValidationResult<T> {
  if (errors.length > 0) {
    return {
      ok: false,
      error: errors[0],
      errors,
    };
  }

  return {
    ok: true,
    data,
  };
}

/**
 * Validates and normalizes the payload for creating a new catalogue book.
 */
export function validateCreateBookInput(
  payload: unknown,
): ValidationResult<CreateBookInput> {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, errors: [message] };
  }

  const errors: string[] = [];

  const data: CreateBookInput = {
    title: parseRequiredString(payload.title, "title", errors),
    author: parseRequiredString(payload.author, "author", errors),
    edition: parseDefaultEmptyString(payload.edition, "edition", errors),
    shelf: parseShelf(payload.shelf, errors),
    position: parseDefaultEmptyString(payload.position, "position", errors),
    top_category: parseNullableString(
      payload.top_category,
      "top_category",
      errors,
    ),
    sub_category: parseNullableString(
      payload.sub_category,
      "sub_category",
      errors,
    ),
    summary: parseNullableString(payload.summary, "summary", errors),
    tags: parseTags(payload.tags, errors),
    publish_year: parsePublishYear(payload.publish_year, errors),
    reading_status: parseReadingStatus(payload.reading_status, errors),
    rating: parseRating(payload.rating, errors),
    date_started: parseIsoDate(payload.date_started, "date_started", errors),
    date_finished: parseIsoDate(
      payload.date_finished,
      "date_finished",
      errors,
    ),
    personal_notes: parseNullableString(
      payload.personal_notes,
      "personal_notes",
      errors,
    ),
    loaned_to: parseNullableString(payload.loaned_to, "loaned_to", errors),
  };

  return buildResult(data, errors);
}

/**
 * Validates and normalizes a partial patch payload for updating an existing book.
 */
export function validateUpdateBookInput(
  payload: unknown,
): ValidationResult<UpdateBookInput> {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, errors: [message] };
  }

  const errors: string[] = [];
  const data: UpdateBookInput = {};

  if (payload.title !== undefined) {
    data.title = parseRequiredString(payload.title, "title", errors);
  }
  if (payload.author !== undefined) {
    data.author = parseRequiredString(payload.author, "author", errors);
  }
  if (payload.edition !== undefined) {
    data.edition = parseDefaultEmptyString(payload.edition, "edition", errors);
  }
  if (payload.shelf !== undefined) {
    data.shelf = parseShelf(payload.shelf, errors);
  }
  if (payload.position !== undefined) {
    data.position = parseDefaultEmptyString(
      payload.position,
      "position",
      errors,
    );
  }
  if (payload.top_category !== undefined) {
    data.top_category = parseNullableString(
      payload.top_category,
      "top_category",
      errors,
    );
  }
  if (payload.sub_category !== undefined) {
    data.sub_category = parseNullableString(
      payload.sub_category,
      "sub_category",
      errors,
    );
  }
  if (payload.summary !== undefined) {
    data.summary = parseNullableString(payload.summary, "summary", errors);
  }
  if (payload.tags !== undefined) {
    data.tags = parseTags(payload.tags, errors);
  }
  if (payload.publish_year !== undefined) {
    data.publish_year = parsePublishYear(payload.publish_year, errors);
  }
  if (payload.reading_status !== undefined) {
    data.reading_status = parseReadingStatus(payload.reading_status, errors);
  }
  if (payload.rating !== undefined) {
    data.rating = parseRating(payload.rating, errors);
  }
  if (payload.date_started !== undefined) {
    data.date_started = parseIsoDate(
      payload.date_started,
      "date_started",
      errors,
    );
  }
  if (payload.date_finished !== undefined) {
    data.date_finished = parseIsoDate(
      payload.date_finished,
      "date_finished",
      errors,
    );
  }
  if (payload.personal_notes !== undefined) {
    data.personal_notes = parseNullableString(
      payload.personal_notes,
      "personal_notes",
      errors,
    );
  }
  if (payload.loaned_to !== undefined) {
    data.loaned_to = parseNullableString(
      payload.loaned_to,
      "loaned_to",
      errors,
    );
  }

  if (errors.length === 0 && Object.keys(data).length === 0) {
    errors.push("At least one updatable field must be provided.");
  }

  return buildResult(data, errors);
}

function parseBulkBookIds(value: unknown, errors: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(
      `ids must be an array of 1 to ${MAX_BULK_BOOK_IDS} non-empty strings.`,
    );
    return [];
  }

  if (value.length > MAX_BULK_BOOK_IDS) {
    errors.push(`ids may contain at most ${MAX_BULK_BOOK_IDS} entries.`);
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const rawId of value) {
    if (typeof rawId !== "string" || rawId.trim().length === 0) {
      errors.push("Each entry in ids must be a non-empty string.");
      return [];
    }
    const trimmed = rawId.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      ids.push(trimmed);
    }
  }

  return ids;
}

/**
 * Validates and normalizes a bulk book update request (`{ ids, patch }`).
 */
export function validateBulkBooksInput(
  payload: unknown,
): ValidationResult<BulkBooksInput> {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, errors: [message] };
  }

  const errors: string[] = [];
  const ids = parseBulkBookIds(payload.ids, errors);
  const patchData: BulkBookPatch = {};

  if (!isPlainRecord(payload.patch)) {
    errors.push("patch must be a JSON object.");
  } else {
    const rawPatch = payload.patch;

    for (const key of Object.keys(rawPatch)) {
      if (!ALLOWED_BULK_PATCH_KEYS.has(key)) {
        errors.push(`Unsupported bulk patch field: ${key}.`);
      }
    }

    if (rawPatch.reading_status !== undefined) {
      patchData.reading_status = parseReadingStatus(
        rawPatch.reading_status,
        errors,
      );
    }
    if (rawPatch.shelf !== undefined) {
      patchData.shelf = parseShelf(rawPatch.shelf, errors);
    }
    if (rawPatch.top_category !== undefined) {
      patchData.top_category = parseNullableString(
        rawPatch.top_category,
        "top_category",
        errors,
      );
    }
    if (rawPatch.add_tags !== undefined) {
      const addTags = parseTags(rawPatch.add_tags, errors, "add_tags");
      if (addTags.length > 0) {
        patchData.add_tags = addTags;
      }
    }
    if (rawPatch.remove_tags !== undefined) {
      const removeTags = parseTags(
        rawPatch.remove_tags,
        errors,
        "remove_tags",
      );
      if (removeTags.length > 0) {
        patchData.remove_tags = removeTags;
      }
    }

    if (errors.length === 0 && Object.keys(patchData).length === 0) {
      errors.push("At least one bulk update field must be provided.");
    }
  }

  return buildResult({ ids, patch: patchData }, errors);
}
