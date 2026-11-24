import {
  getBookKey,
  READING_STATUS_VALUES,
  type CatalogueBook,
  type ReadingStatus,
} from "./catalogue";
import type { ReadingList } from "./lists";
import type { TriageFilter } from "./triage";

export type CatalogueViewTab =
  | "ledger"
  | "shelves"
  | "timeline"
  | "lists"
  | "commonplace";

export type CatalogueStatusFilter = "" | ReadingStatus | "loaned";

export type CatalogueUrlState = {
  view: CatalogueViewTab;
  book: string | null;
  list: string | null;
  q: string;
  division: string;
  tag: string;
  shelf: string;
  status: CatalogueStatusFilter;
  triage: TriageFilter;
  author: string;
};

export const DEFAULT_CATALOGUE_URL_STATE: CatalogueUrlState = {
  view: "ledger",
  book: null,
  list: null,
  q: "",
  division: "",
  tag: "",
  shelf: "",
  status: "",
  triage: "",
  author: "",
};

const VALID_VIEWS: ReadonlySet<CatalogueViewTab> = new Set([
  "ledger",
  "shelves",
  "timeline",
  "lists",
  "commonplace",
]);

const VALID_STATUSES: ReadonlySet<Exclude<CatalogueStatusFilter, "">> = new Set([
  ...READING_STATUS_VALUES,
  "loaned",
]);

const VALID_TRIAGE_FILTERS: ReadonlySet<Exclude<TriageFilter, "">> = new Set([
  "missing_any",
  "missing_summary",
  "missing_year",
  "missing_tags",
  "duplicates",
]);

const MAX_BOOK_PARAM_LENGTH = 160;
const MAX_LIST_PARAM_LENGTH = 120;
const MAX_QUERY_PARAM_LENGTH = 200;
const MAX_DIVISION_PARAM_LENGTH = 120;
const MAX_TAG_PARAM_LENGTH = 120;
const DEFAULT_DESCRIPTION =
  "A descriptive shelf catalogue, commonplace book, and reading ledger for the Library of Babel.";

type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

function readRawParam(input: SearchParamsInput, key: string): string | null {
  if (!input) {
    return null;
  }

  if (input instanceof URLSearchParams) {
    return input.get(key);
  }

  const value = input[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return null;
}

function parseBoundedNullable(
  raw: string | null | undefined,
  maxLength: number,
): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function parseBoundedString(
  raw: string | null | undefined,
  maxLength: number,
): string {
  if (typeof raw !== "string") {
    return "";
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.slice(0, maxLength);
}

function parseShelfParam(raw: string | null | undefined): string {
  if (typeof raw !== "string") {
    return "";
  }
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? trimmed : "";
}

function parseStatusParam(
  raw: string | null | undefined,
): CatalogueStatusFilter {
  if (typeof raw !== "string") {
    return "";
  }
  const normalized = raw.trim().toLowerCase();
  if (
    VALID_STATUSES.has(normalized as Exclude<CatalogueStatusFilter, "">)
  ) {
    return normalized as CatalogueStatusFilter;
  }
  return "";
}

function parseTriageParam(raw: string | null | undefined): TriageFilter {
  if (typeof raw !== "string") {
    return "";
  }
  const normalized = raw.trim().toLowerCase();
  if (VALID_TRIAGE_FILTERS.has(normalized as Exclude<TriageFilter, "">)) {
    return normalized as TriageFilter;
  }
  return "";
}

function parseAuthorParam(raw: string | null | undefined): string {
  if (typeof raw !== "string") {
    return "";
  }
  const normalized = raw.trim().toUpperCase();
  return /^(?:[A-Z]|#)$/.test(normalized) ? normalized : "";
}

function parseViewParam(
  raw: string | null | undefined,
  hasList: boolean,
): CatalogueViewTab {
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (VALID_VIEWS.has(normalized as CatalogueViewTab)) {
      return normalized as CatalogueViewTab;
    }
  }
  return hasList ? "lists" : "ledger";
}

export function parseCatalogueSearchParams(
  input: SearchParamsInput,
): CatalogueUrlState {
  const list = parseBoundedNullable(
    readRawParam(input, "list"),
    MAX_LIST_PARAM_LENGTH,
  );
  const view = parseViewParam(readRawParam(input, "view"), list !== null);
  const book = parseBoundedNullable(
    readRawParam(input, "book"),
    MAX_BOOK_PARAM_LENGTH,
  );
  const q = parseBoundedString(
    readRawParam(input, "q"),
    MAX_QUERY_PARAM_LENGTH,
  );
  const division = parseBoundedString(
    readRawParam(input, "division"),
    MAX_DIVISION_PARAM_LENGTH,
  );
  const tag = parseBoundedString(
    readRawParam(input, "tag"),
    MAX_TAG_PARAM_LENGTH,
  );
  const shelf = parseShelfParam(readRawParam(input, "shelf"));
  const status = parseStatusParam(readRawParam(input, "status"));
  const triage = parseTriageParam(readRawParam(input, "triage"));
  const author = parseAuthorParam(readRawParam(input, "author"));

  return {
    view,
    book,
    list,
    q,
    division,
    tag,
    shelf,
    status,
    triage,
    author,
  };
}

export function serializeCatalogueUrlState(
  state: Partial<CatalogueUrlState>,
): string {
  const merged: CatalogueUrlState = {
    ...DEFAULT_CATALOGUE_URL_STATE,
    ...state,
  };

  const view = parseViewParam(merged.view, false);
  const book = parseBoundedNullable(merged.book, MAX_BOOK_PARAM_LENGTH);
  const list =
    view === "lists"
      ? parseBoundedNullable(merged.list, MAX_LIST_PARAM_LENGTH)
      : null;
  const q = parseBoundedString(merged.q, MAX_QUERY_PARAM_LENGTH);
  const division = parseBoundedString(
    merged.division,
    MAX_DIVISION_PARAM_LENGTH,
  );
  const tag = parseBoundedString(merged.tag, MAX_TAG_PARAM_LENGTH);
  const shelf = parseShelfParam(merged.shelf);
  const status = parseStatusParam(merged.status);
  const triage = parseTriageParam(merged.triage);
  const author = parseAuthorParam(merged.author);

  const params = new URLSearchParams();

  if (view !== "ledger") {
    params.set("view", view);
  }
  if (book) {
    params.set("book", book);
  }
  if (list) {
    params.set("list", list);
  }
  if (q) {
    params.set("q", q);
  }
  if (division) {
    params.set("division", division);
  }
  if (tag) {
    params.set("tag", tag);
  }
  if (shelf) {
    params.set("shelf", shelf);
  }
  if (status) {
    params.set("status", status);
  }
  if (triage) {
    params.set("triage", triage);
  }
  if (author) {
    params.set("author", author);
  }

  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export function buildShareUrl(
  origin: string,
  pathname: string,
  state: Partial<CatalogueUrlState>,
): string {
  const cleanOrigin = origin.trim().replace(/\/+$/, "");
  const cleanPathname = pathname.trim()
    ? pathname.trim().startsWith("/")
      ? pathname.trim()
      : `/${pathname.trim()}`
    : "/";
  const query = serializeCatalogueUrlState(state);
  return `${cleanOrigin}${cleanPathname}${query}`;
}

function findMatchingBook(
  bookParam: string | null,
  books: readonly CatalogueBook[],
): CatalogueBook | undefined {
  if (!bookParam) {
    return undefined;
  }
  return books.find(
    (book) => getBookKey(book) === bookParam || book.id === bookParam,
  );
}

function findMatchingList(
  listParam: string | null,
  lists: readonly ReadingList[],
): ReadingList | undefined {
  if (!listParam) {
    return undefined;
  }
  return lists.find(
    (list) => list.slug === listParam || list.id === listParam,
  );
}

function truncateDescription(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildDynamicPageTitle(
  state: CatalogueUrlState,
  books: readonly CatalogueBook[],
  lists: readonly ReadingList[],
): string {
  const matchedBook = findMatchingBook(state.book, books);
  if (matchedBook) {
    return `${matchedBook.title} by ${matchedBook.author} | Library of Babel`;
  }

  if (state.view === "lists" && state.list) {
    const matchedList = findMatchingList(state.list, lists);
    if (matchedList) {
      return `${matchedList.name} | Library of Babel`;
    }
  }

  if (state.view === "commonplace") {
    return "Commonplace Book | Library of Babel";
  }

  if (state.view === "lists") {
    return "Reading Lists | Library of Babel";
  }

  if (state.view === "shelves" && state.shelf) {
    return `Shelf ${state.shelf} | Library of Babel`;
  }

  if (state.view === "shelves") {
    return "Physical Shelves | Library of Babel";
  }

  if (state.view === "timeline") {
    return "Decadal Timeline | Library of Babel";
  }

  if (state.shelf) {
    return `Shelf ${state.shelf} | Library of Babel`;
  }

  if (state.division) {
    return `${state.division} | Library of Babel`;
  }

  return "Library of Babel";
}

export function buildDynamicPageDescription(
  state: CatalogueUrlState,
  books: readonly CatalogueBook[],
  lists: readonly ReadingList[],
): string {
  const matchedBook = findMatchingBook(state.book, books);
  if (matchedBook) {
    const summary = matchedBook.summary?.trim();
    if (summary) {
      return truncateDescription(summary);
    }
    const location = matchedBook.position
      ? `Shelf ${matchedBook.shelf} (${matchedBook.position})`
      : `Shelf ${matchedBook.shelf}`;
    const division = matchedBook.top_category
      ? ` · ${matchedBook.top_category}`
      : "";
    return truncateDescription(
      `${matchedBook.title} by ${matchedBook.author} — ${location}${division} in the Library of Babel.`,
    );
  }

  if (state.view === "lists" && state.list) {
    const matchedList = findMatchingList(state.list, lists);
    if (matchedList) {
      const countLabel = `${matchedList.items.length} ${
        matchedList.items.length === 1 ? "volume" : "volumes"
      }`;
      const description = matchedList.description?.trim();
      if (description) {
        return truncateDescription(`${description} (${countLabel})`);
      }
      return truncateDescription(
        `Curated reading list "${matchedList.name}" with ${countLabel} in the Library of Babel.`,
      );
    }
  }

  if (state.view === "commonplace") {
    return "Saved quotes, marginalia, and literary passages from the Library of Babel.";
  }

  if (state.view === "lists") {
    return "Curated reading lists and ranked Up Next queue for the Library of Babel.";
  }

  if (state.view === "shelves" && state.shelf) {
    return `Physical shelf elevation for Shelf ${state.shelf} in the Library of Babel.`;
  }

  if (state.view === "shelves") {
    return "Physical shelf elevation and spine atlas for the Library of Babel.";
  }

  if (state.view === "timeline") {
    return "Chronological decadal timeline of volumes in the Library of Babel.";
  }

  if (state.shelf) {
    return `Volumes catalogued on Shelf ${state.shelf} in the Library of Babel.`;
  }

  if (state.division) {
    return `Volumes catalogued under ${state.division} in the Library of Babel.`;
  }

  return DEFAULT_DESCRIPTION;
}
