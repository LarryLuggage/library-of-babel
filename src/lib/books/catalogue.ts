import {
  buildEditorialConnectionMap,
  CONNECTION_TYPE_LABELS,
  type EditorialConnection,
  normalizeConnectionPairKey,
} from "./connections";

export type ReadingStatus = "unread" | "reading" | "finished" | "dnf";

export type StorageMode = "supabase" | "local";

export const READING_STATUS_VALUES: readonly ReadingStatus[] = [
  "unread",
  "reading",
  "finished",
  "dnf",
];

export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Finished",
  dnf: "DNF",
};

export type CatalogueBook = {
  id: string;
  author: string;
  title: string;
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

export type LedgerBook = CatalogueBook & { number: number };

export type CatalogueConnection = {
  book: CatalogueBook;
  reasons: string[];
  score: number;
};

export interface TimelineBucket {
  key: string;
  label: string;
  sortOrder: number;
}

export const MIN_PUBLISH_YEAR = -3000;
export const MAX_PUBLISH_YEAR = 2100;

export const NOISE_TAGS: ReadonlySet<string> = new Set([
  "literature",
  "philosophy theory",
  "history reference",
  "large type books",
  "translations into english",
  "english translations",
  "in english",
  "new york times reviewed",
  "new york times bestseller",
  "nyt",
  "amerikanisches englisch",
  "roman",
  "romans nouvelles",
  "spanish language books",
  "protected daisy",
  "in library",
  "accessible book",
  "borrowable books",
  "open library staff picks",
  "classic",
  "classics",
  "classic fiction",
  "classic literature",
  "short stories single author",
  "fictional works",
  "fiction general",
]);

const SURNAME_PARTICLES = new Set([
  "da",
  "de",
  "del",
  "della",
  "di",
  "du",
  "la",
  "le",
  "san",
  "st.",
  "van",
  "von",
]);

const NAME_SUFFIX_PATTERN = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;

const titleCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function fnv1a32(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Generates a deterministic, URL-safe book ID from its copy identity.
 */
export function createBookId(
  book: Pick<CatalogueBook, "author" | "title" | "shelf" | "position">,
): string {
  const identity = [
    book.author.trim().toLocaleLowerCase("en-US"),
    book.title.trim().toLocaleLowerCase("en-US"),
    String(book.shelf),
    book.position.trim().toLocaleLowerCase("en-US"),
  ].join("\u0000");

  const high = fnv1a32(identity, 0x811c9dc5).toString(16).padStart(8, "0");
  const low = fnv1a32(`${identity}\u0001`, 0x9e3779b9)
    .toString(16)
    .padStart(8, "0");
  const slug = book.title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);

  return slug ? `bk_${high}${low}_${slug}` : `bk_${high}${low}`;
}

export function getBookKey(
  book: Pick<CatalogueBook, "author" | "title" | "shelf" | "position"> & {
    id?: string;
  },
): string {
  return book.id && book.id.length > 0 ? book.id : createBookId(book);
}

export function filterDisplayTags(
  tags: readonly string[] | null | undefined,
): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const rawTag of tags) {
    const tag = String(rawTag ?? "").trim();
    if (!tag) continue;
    const normalized = tag.toLocaleLowerCase("en-US");
    if (NOISE_TAGS.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    cleaned.push(tag);
  }

  return cleaned;
}

function isReadingStatus(value: unknown): value is ReadingStatus {
  return (
    typeof value === "string" &&
    (READING_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function normalizeCatalogueBook(
  raw: Record<string, unknown>,
): CatalogueBook {
  const author = String(raw.author ?? "").trim();
  const title = String(raw.title ?? "").trim();
  const edition = String(raw.edition ?? "").trim();
  const shelf =
    typeof raw.shelf === "number" && Number.isFinite(raw.shelf)
      ? Math.trunc(raw.shelf)
      : Number.isFinite(Number(raw.shelf))
        ? Math.trunc(Number(raw.shelf))
        : 0;
  const position = String(raw.position ?? "").trim();

  const id =
    typeof raw.id === "string" && raw.id.trim().length > 0
      ? raw.id.trim()
      : createBookId({ author, title, shelf, position });

  const publishYear =
    typeof raw.publish_year === "number" && Number.isInteger(raw.publish_year)
      ? raw.publish_year
      : null;

  const rating =
    typeof raw.rating === "number" &&
    Number.isInteger(raw.rating) &&
    raw.rating >= 1 &&
    raw.rating <= 5
      ? raw.rating
      : null;

  return {
    id,
    author,
    title,
    edition,
    shelf,
    position,
    top_category:
      typeof raw.top_category === "string" && raw.top_category.trim()
        ? raw.top_category.trim()
        : null,
    sub_category:
      typeof raw.sub_category === "string" && raw.sub_category.trim()
        ? raw.sub_category.trim()
        : null,
    summary:
      typeof raw.summary === "string" && raw.summary.trim()
        ? raw.summary.trim()
        : null,
    tags: filterDisplayTags(raw.tags as string[] | undefined),
    publish_year: publishYear,
    reading_status: isReadingStatus(raw.reading_status)
      ? raw.reading_status
      : "unread",
    rating,
    date_started:
      typeof raw.date_started === "string" && raw.date_started.trim()
        ? raw.date_started.trim()
        : null,
    date_finished:
      typeof raw.date_finished === "string" && raw.date_finished.trim()
        ? raw.date_finished.trim()
        : null,
    personal_notes:
      typeof raw.personal_notes === "string" && raw.personal_notes.trim()
        ? raw.personal_notes.trim()
        : null,
    loaned_to:
      typeof raw.loaned_to === "string" && raw.loaned_to.trim()
        ? raw.loaned_to.trim()
        : null,
  };
}

/**
 * Returns a surname-first sort key for author alphabetical indexing and ledger ordering.
 * E.g. "Jorge Luis Borges" -> "Borges, Jorge Luis", "J.W. von Goethe" -> "Goethe, J.W. von".
 */
export function getAuthorSortKey(author: string): string {
  const withoutParens = author
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutParens) {
    return "#";
  }

  // Take primary author before "/" or ";"
  let primary = withoutParens.split(/[;/]/)[0].trim();

  // Strip trailing ", et al."
  primary = primary.replace(/,\s*et\s+al\.?$/i, "").trim();

  // Handle commas: either "Last, First" / "Adorno, Benjamin, ..." / "Alex Hochuli, George Hoare"
  if (primary.includes(",")) {
    const parts = primary
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const firstPartTokens = parts[0].split(/\s+/);
      if (firstPartTokens.length === 1) {
        // Already surname-first or a comma-separated list of surnames ("Adorno, Benjamin, ...")
        return parts.length === 2 ? `${parts[0]}, ${parts[1]}` : parts[0];
      }
      // Multiple full names separated by comma ("Alex Hochuli, George Hoare")
      primary = parts[0];
    }
  }

  // Handle "A & B" or "A and B"
  const multiAuthorMatch = primary.split(/\s+(?:&|and)\s+/i);
  if (multiAuthorMatch.length > 1) {
    primary = multiAuthorMatch[0].trim();
  }

  const tokens = primary.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return primary;
  }

  const suffixes: string[] = [];
  while (
    tokens.length > 1 &&
    NAME_SUFFIX_PATTERN.test(tokens[tokens.length - 1])
  ) {
    suffixes.unshift(tokens.pop()!);
  }

  if (tokens.length <= 1) {
    return [tokens[0] ?? primary, ...suffixes].join(" ");
  }

  const surname = tokens.pop()!;
  // Keep any leading lowercase particles (von, de, del, di...) in the given part
  // so Goethe files under G, Montaigne under M, Cervantes under C, etc.
  const givenTokens = [...tokens];
  const leadingParticles: string[] = [];
  while (
    givenTokens.length > 1 &&
    SURNAME_PARTICLES.has(givenTokens[givenTokens.length - 1].toLocaleLowerCase("en-US"))
  ) {
    leadingParticles.unshift(givenTokens.pop()!);
  }

  const givenPart = [...givenTokens, ...leadingParticles, ...suffixes]
    .join(" ")
    .trim();

  return givenPart ? `${surname}, ${givenPart}` : surname;
}

export function getAuthorInitial(author: string): string {
  const sortKey = getAuthorSortKey(author)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return sortKey.match(/[a-z]/i)?.[0].toLocaleUpperCase("en-US") ?? "#";
}

export function compareCatalogueBooks(
  first: CatalogueBook,
  second: CatalogueBook,
): number {
  return (
    titleCollator.compare(
      getAuthorSortKey(first.author),
      getAuthorSortKey(second.author),
    ) ||
    titleCollator.compare(first.author, second.author) ||
    titleCollator.compare(first.title, second.title) ||
    first.shelf - second.shelf ||
    titleCollator.compare(first.position, second.position)
  );
}

export function getDivision(book: CatalogueBook): string {
  return book.sub_category ?? book.top_category ?? "Unclassified";
}

/**
 * Formats an integer publication year for display, converting negative years
 * to BCE notation (e.g., `-375` -> `"375 BCE"`).
 */
export function formatPublishYear(year: number | null | undefined): string {
  if (year === null || year === undefined || !Number.isFinite(year)) {
    return "";
  }

  const whole = Math.trunc(year);
  if (whole < 0) {
    return `${Math.abs(whole)} BCE`;
  }

  return `${whole}`;
}

/**
 * Maps a publication year to an ordered timeline column/decade bucket so
 * Antiquity (BCE), Medieval & Early CE, modern decades, and Undated sort cleanly.
 */
export function getTimelineBucket(
  year: number | null | undefined,
): TimelineBucket {
  if (year === null || year === undefined || !Number.isFinite(year)) {
    return {
      key: "Undated",
      label: "Undated",
      sortOrder: Number.MAX_SAFE_INTEGER,
    };
  }

  const whole = Math.trunc(year);
  if (whole < 0) {
    return {
      key: "Antiquity (BCE)",
      label: "Antiquity (BCE)",
      sortOrder: -10000,
    };
  }

  if (whole < 1500) {
    return {
      key: "Medieval & Early CE",
      label: "Medieval & Early CE",
      sortOrder: 0,
    };
  }

  const decadeStart = Math.floor(whole / 10) * 10;
  return {
    key: `${decadeStart}s`,
    label: `${decadeStart}s`,
    sortOrder: decadeStart,
  };
}

export function buildTagFrequencyMap(
  books: readonly CatalogueBook[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const book of books) {
    for (const tag of filterDisplayTags(book.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return counts;
}

function addDivisionConnection(
  focus: CatalogueBook,
  candidate: CatalogueBook,
  reasons: string[],
): number {
  if (focus.sub_category && focus.sub_category === candidate.sub_category) {
    reasons.push(`Both shelved as ${focus.sub_category}.`);
    return 6;
  }

  return 0;
}

function addShelfConnection(
  focus: CatalogueBook,
  candidate: CatalogueBook,
  reasons: string[],
): number {
  const shelfGap = Math.abs(focus.shelf - candidate.shelf);

  if (shelfGap === 0) {
    reasons.push(`Both recorded on Shelf ${focus.shelf}.`);
    return 4;
  }

  if (shelfGap === 1) {
    reasons.push(`Neighboring shelves ${focus.shelf} and ${candidate.shelf}.`);
    return 2;
  }

  return 0;
}

function addTagConnection(
  focus: CatalogueBook,
  candidate: CatalogueBook,
  reasons: string[],
  tagFrequency?: ReadonlyMap<string, number>,
): number {
  const candidateTags = new Set(filterDisplayTags(candidate.tags));
  const sharedTags = filterDisplayTags(focus.tags).filter((tag) =>
    candidateTags.has(tag),
  );

  if (sharedTags.length === 0) {
    return 0;
  }

  // Sort shared tags by rarity (ascending document frequency) so distinct themes surface first
  const sortedShared = tagFrequency
    ? [...sharedTags].sort(
        (first, second) =>
          (tagFrequency.get(first) ?? 999) - (tagFrequency.get(second) ?? 999) ||
          first.localeCompare(second),
      )
    : sharedTags;

  let points = 0;
  for (const tag of sortedShared) {
    const freq = tagFrequency?.get(tag) ?? 20;
    if (freq <= 10) {
      points += 5;
    } else if (freq <= 30) {
      points += 4;
    } else if (freq <= 80) {
      points += 3;
    } else {
      points += 2;
    }
  }

  const visibleTags = sortedShared.slice(0, 3).join(", ");
  reasons.push(`Shared catalogue tags: ${visibleTags}.`);

  return Math.min(points, 14);
}

export type EditorialConnectionSource =
  | ReadonlyMap<string, EditorialConnection>
  | readonly EditorialConnection[];

export function resolveEditorialConnectionMap(
  editorialConnections?: EditorialConnectionSource,
): ReadonlyMap<string, EditorialConnection> | undefined {
  if (!editorialConnections) {
    return undefined;
  }

  if (Array.isArray(editorialConnections)) {
    return editorialConnections.length > 0
      ? buildEditorialConnectionMap(editorialConnections)
      : undefined;
  }

  const map = editorialConnections as ReadonlyMap<string, EditorialConnection>;
  return map.size > 0 ? map : undefined;
}

export function getCatalogueConnection(
  focus: CatalogueBook,
  candidate: CatalogueBook,
  tagFrequency?: ReadonlyMap<string, number>,
  editorialConnections?: EditorialConnectionSource,
): CatalogueConnection | null {
  const focusKey = getBookKey(focus);
  const candidateKey = getBookKey(candidate);

  if (focusKey === candidateKey) {
    return null;
  }

  const reasons: string[] = [];
  let score = addDivisionConnection(focus, candidate, reasons);

  score += addTagConnection(focus, candidate, reasons, tagFrequency);

  if (focus.author === candidate.author && focus.author !== "Various") {
    reasons.unshift(`Another work by ${focus.author}.`);
    score += 14;
  }

  score += addShelfConnection(focus, candidate, reasons);

  const editorialMap = resolveEditorialConnectionMap(editorialConnections);
  const editorial = editorialMap?.get(
    normalizeConnectionPairKey(focusKey, candidateKey),
  );
  if (editorial) {
    const clampedWeight = Math.min(3, Math.max(1, Math.trunc(editorial.weight)));
    score += 18 + (clampedWeight - 1) * 3;
    const label = CONNECTION_TYPE_LABELS[editorial.connection_type];
    reasons.unshift(
      editorial.description
        ? `Curator link (${label}): ${editorial.description}`
        : `Curator link (${label}).`,
    );
  }

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
  books: readonly CatalogueBook[],
  limit: number,
  tagFrequency?: ReadonlyMap<string, number>,
  editorialConnections?: EditorialConnectionSource,
): CatalogueConnection[] {
  const resolvedFrequency = tagFrequency ?? buildTagFrequencyMap(books);
  const resolvedEditorialMap = resolveEditorialConnectionMap(editorialConnections);

  return books
    .map((book) =>
      getCatalogueConnection(
        focus,
        book,
        resolvedFrequency,
        resolvedEditorialMap,
      ),
    )
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
