import {
  type CatalogueBook,
  filterDisplayTags,
  getAuthorSortKey,
  getBookKey,
  type ReadingStatus,
} from "./catalogue";
import type { UpdateBookInput } from "./validation";

export type TriageFilter =
  | ""
  | "missing_any"
  | "missing_summary"
  | "missing_year"
  | "missing_tags"
  | "duplicates";

export type MissingMetadataReason = "summary" | "publish_year" | "tags";

export type DuplicateGroup = {
  key: string;
  reason: string;
  books: CatalogueBook[];
};

export type TriageSummary = {
  missing_any: number;
  missing_summary: number;
  missing_year: number;
  missing_tags: number;
  duplicates: number;
  duplicateGroups: DuplicateGroup[];
};

export type BulkBookPatch = {
  reading_status?: ReadingStatus;
  shelf?: number;
  top_category?: string | null;
  add_tags?: string[];
  remove_tags?: string[];
};

const MAX_TAGS = 20;

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

const NON_PERSONAL_AUTHORS = new Set([
  "unknown",
  "anonymous",
  "various",
  "multiple authors",
]);

const ROMAN_VOLUME_VALUES: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
  xiii: 13,
  xiv: 14,
  xv: 15,
  xvi: 16,
  xvii: 17,
  xviii: 18,
  xix: 19,
  xx: 20,
};

const WORD_VOLUME_VALUES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function foldAsciiAlnum(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalizeVolumeKind(rawKind: string): string {
  const lower = rawKind.toLocaleLowerCase("en-US");
  if (lower.startsWith("vol")) return "vol";
  if (lower.startsWith("p")) return "part";
  if (lower.startsWith("b")) return "book";
  if (lower.startsWith("t")) return "tome";
  return "no";
}

function parseVolumeIndexToken(token: string, allowLetter: boolean): string | null {
  const clean = token.toLocaleLowerCase("en-US");
  if (/^\d+$/.test(clean)) {
    return String(Number.parseInt(clean, 10));
  }
  if (clean in ROMAN_VOLUME_VALUES) {
    return String(ROMAN_VOLUME_VALUES[clean]);
  }
  if (clean in WORD_VOLUME_VALUES) {
    return String(WORD_VOLUME_VALUES[clean]);
  }
  if (allowLetter && /^[a-f]$/.test(clean)) {
    return clean;
  }
  return null;
}

function extractAndStripVolumeMarkers(text: string): {
  stripped: string;
  markers: string[];
} {
  const markers: string[] = [];
  let working = text;

  const keywordVolumePattern =
    /\b(vol(?:ume)?|part|pt|book|bk|tome|no|number)(?:\.\s*|\s+)([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-f])(?=$|[\s),.;:\]—–-])/gi;

  working = working.replace(
    keywordVolumePattern,
    (fullMatch, rawKind: string, rawToken: string) => {
      const kind = canonicalizeVolumeKind(rawKind);
      const allowLetter = kind === "vol" || kind === "part";
      const parsed = parseVolumeIndexToken(rawToken, allowLetter);
      if (!parsed) {
        return fullMatch;
      }
      const marker = `${kind} ${parsed}`;
      if (!markers.includes(marker)) {
        markers.push(marker);
      }
      return " ";
    },
  );

  working = working.replace(/#\s*(\d+)\b/g, (_fullMatch, num: string) => {
    const marker = `no ${Number.parseInt(num, 10)}`;
    if (!markers.includes(marker)) {
      markers.push(marker);
    }
    return " ";
  });

  return { stripped: working, markers };
}

function stripTrailingBracketAnnotations(text: string): string {
  return text.replace(/(?:\s*(?:\([^)]*\)|\[[^\]]*\]))+\s*$/g, " ").trim();
}

function stripSubtitleWithMinPrefix(text: string): string {
  const delimiterPattern = /(?::\s+|\s+[-—–]\s+)/g;
  for (const match of text.matchAll(delimiterPattern)) {
    const index = match.index;
    if (index === undefined) continue;
    const prefix = text.slice(0, index);
    const alnumCount = prefix.replace(/[^a-z0-9]/gi, "").length;
    if (alnumCount >= 4) {
      return prefix.trim();
    }
  }
  return text;
}

/**
 * Normalizes a book title for duplicate clustering while preserving volume/part numbers.
 */
function normalizeDuplicateTitle(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .trim();

  if (!base) {
    return "";
  }

  const { stripped: withoutVols, markers } = extractAndStripVolumeMarkers(base);
  let candidate = stripTrailingBracketAnnotations(withoutVols);
  candidate = stripSubtitleWithMinPrefix(candidate);
  candidate = stripTrailingBracketAnnotations(candidate);

  let collapsed = candidate
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!collapsed) {
    collapsed = foldAsciiAlnum(base).replace(/^(?:the|a|an)\s+/i, "").trim();
    return collapsed;
  }

  for (const marker of markers) {
    if (!collapsed.includes(marker)) {
      collapsed = `${collapsed} ${marker}`.trim();
    }
  }

  return collapsed;
}

function stripAuthorEditorialRoles(author: string): string {
  return author
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/,\s*et\s+al\.?$/i, "")
    .replace(
      /,?\s*\b(?:editors?|eds?\.?|translators?|trans\.?|comp\.?|edited\s+by|translated\s+by|compiled\s+by)\s*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDuplicateAuthor(author: string): {
  normAuthor: string;
  normSurname: string;
} {
  const stripped = stripAuthorEditorialRoles(author);
  const normAuthor = foldAsciiAlnum(stripped);

  if (!normAuthor || NON_PERSONAL_AUTHORS.has(normAuthor)) {
    return { normAuthor, normSurname: "" };
  }

  const sortKey = getAuthorSortKey(stripped);
  if (!sortKey || sortKey === "#") {
    return { normAuthor, normSurname: "" };
  }

  const surnamePart = sortKey.split(",")[0]?.trim() ?? "";
  const normSurname = foldAsciiAlnum(surnamePart);

  if (!normSurname || NON_PERSONAL_AUTHORS.has(normSurname)) {
    return { normAuthor, normSurname: "" };
  }

  return { normAuthor, normSurname };
}

class UnionFind {
  private readonly parent: number[];
  private readonly reason: Array<string | null>;

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.reason = Array.from({ length: size }, () => null);
  }

  find(node: number): number {
    let root = node;
    while (this.parent[root] !== root) {
      root = this.parent[root];
    }
    let current = node;
    while (current !== root) {
      const next = this.parent[current];
      this.parent[current] = root;
      current = next;
    }
    return root;
  }

  union(first: number, second: number, edgeReason: string): void {
    const rootA = this.find(first);
    const rootB = this.find(second);
    if (rootA === rootB) {
      return;
    }

    const [keep, merge] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
    this.parent[merge] = keep;
    this.reason[keep] = edgeReason;
  }

  getReason(node: number): string {
    return this.reason[this.find(node)] ?? "Potential duplicate";
  }
}

function unionBuckets(
  buckets: ReadonlyMap<string, number[]>,
  uf: UnionFind,
  reason: string,
): void {
  for (const indices of buckets.values()) {
    if (indices.length < 2) {
      continue;
    }
    const anchor = indices[0];
    for (let i = 1; i < indices.length; i += 1) {
      uf.union(anchor, indices[i], reason);
    }
  }
}

/**
 * Returns the metadata fields missing from a book record.
 */
export function getMissingMetadataReasons(
  book: CatalogueBook,
): MissingMetadataReason[] {
  const reasons: MissingMetadataReason[] = [];

  if (!book.summary?.trim()) {
    reasons.push("summary");
  }
  if (book.publish_year === null || book.publish_year === undefined) {
    reasons.push("publish_year");
  }
  if (filterDisplayTags(book.tags).length === 0) {
    reasons.push("tags");
  }

  return reasons;
}

/**
 * Clusters potential duplicate catalogue entries across three prioritized matching
 * passes without double-reporting overlapping pairs.
 */
export function findPotentialDuplicateGroups(
  books: readonly CatalogueBook[],
): DuplicateGroup[] {
  if (books.length < 2) {
    return [];
  }

  const normalized = books.map((book) => {
    const normTitle = normalizeDuplicateTitle(book.title);
    const { normAuthor, normSurname } = normalizeDuplicateAuthor(book.author);
    return { book, normTitle, normAuthor, normSurname };
  });

  const authorBuckets = new Map<string, number[]>();
  const surnameBuckets = new Map<string, number[]>();
  const shelfBuckets = new Map<string, number[]>();

  const pushBucket = (
    map: Map<string, number[]>,
    key: string,
    index: number,
  ) => {
    const list = map.get(key);
    if (list) {
      list.push(index);
    } else {
      map.set(key, [index]);
    }
  };

  for (let i = 0; i < normalized.length; i += 1) {
    const { book, normTitle, normAuthor, normSurname } = normalized[i];

    if (
      normTitle.length >= 4 &&
      normAuthor.length > 0 &&
      normAuthor !== "unknown"
    ) {
      pushBucket(authorBuckets, `${normTitle}\u0000${normAuthor}`, i);
    }

    if (normTitle.length >= 6 && normSurname.length >= 3) {
      pushBucket(surnameBuckets, `${normTitle}\u0000${normSurname}`, i);
    }

    if (normTitle.length >= 5) {
      pushBucket(shelfBuckets, `${normTitle}\u0000${book.shelf}`, i);
    }
  }

  const uf = new UnionFind(books.length);
  unionBuckets(authorBuckets, uf, "Same title & author");
  unionBuckets(surnameBuckets, uf, "Same title & matching surname");

  for (const indices of shelfBuckets.values()) {
    if (indices.length < 2) {
      continue;
    }

    for (let a = 0; a < indices.length; a += 1) {
      const idxA = indices[a];
      const surnameA = normalized[idxA].normSurname;
      for (let b = a + 1; b < indices.length; b += 1) {
        const idxB = indices[b];
        const surnameB = normalized[idxB].normSurname;
        if (!surnameA || !surnameB || surnameA === surnameB) {
          uf.union(idxA, idxB, "Same shelf & title");
        }
      }
    }
  }

  const componentIndices = new Map<number, number[]>();
  for (let i = 0; i < books.length; i += 1) {
    const root = uf.find(i);
    const list = componentIndices.get(root);
    if (list) {
      list.push(i);
    } else {
      componentIndices.set(root, [i]);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const [root, indices] of componentIndices.entries()) {
    if (indices.length < 2) {
      continue;
    }

    const sortedBooks = indices
      .map((index) => books[index])
      .sort(
        (first, second) =>
          first.shelf - second.shelf ||
          collator.compare(first.position, second.position) ||
          collator.compare(first.id, second.id),
      );

    const normTitle = normalized[root].normTitle;
    const key = `dup:${normTitle}:${sortedBooks.map((book) => getBookKey(book)).join("|")}`;

    groups.push({
      key,
      reason: uf.getReason(root),
      books: sortedBooks,
    });
  }

  groups.sort(
    (first, second) =>
      collator.compare(first.books[0].title, second.books[0].title) ||
      collator.compare(first.books[0].author, second.books[0].author) ||
      first.key.localeCompare(second.key),
  );

  return groups;
}

/**
 * Returns the set of canonical book IDs appearing across any duplicate group.
 */
export function getDuplicateBookIdSet(
  groups: readonly DuplicateGroup[],
): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const book of group.books) {
      const key = getBookKey(book);
      if (key) {
        ids.add(key);
      }
      if (book.id) {
        ids.add(book.id);
      }
    }
  }
  return ids;
}

/**
 * Summarizes missing-metadata counts and potential duplicate clusters across the catalogue.
 */
export function computeTriageCounts(
  books: readonly CatalogueBook[],
): TriageSummary {
  let missingAny = 0;
  let missingSummary = 0;
  let missingYear = 0;
  let missingTags = 0;

  for (const book of books) {
    const reasons = getMissingMetadataReasons(book);
    if (reasons.length === 0) {
      continue;
    }
    missingAny += 1;
    if (reasons.includes("summary")) {
      missingSummary += 1;
    }
    if (reasons.includes("publish_year")) {
      missingYear += 1;
    }
    if (reasons.includes("tags")) {
      missingTags += 1;
    }
  }

  const duplicateGroups = findPotentialDuplicateGroups(books);
  const duplicates = getDuplicateBookIdSet(duplicateGroups).size;

  return {
    missing_any: missingAny,
    missing_summary: missingSummary,
    missing_year: missingYear,
    missing_tags: missingTags,
    duplicates,
    duplicateGroups,
  };
}

function normalizeTagToken(rawTag: string): string {
  return rawTag.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/**
 * Computes a single-book `UpdateBookInput` from a `BulkBookPatch`, computing tag additions
 * and removals deterministically with deduplication and the 20-tag cap.
 */
export function computeBulkUpdatePatch(
  book: CatalogueBook,
  patch: BulkBookPatch,
): UpdateBookInput {
  const next: UpdateBookInput = {};

  if (patch.reading_status !== undefined) {
    next.reading_status = patch.reading_status;
  }
  if (patch.shelf !== undefined) {
    next.shelf = patch.shelf;
  }
  if (patch.top_category !== undefined) {
    next.top_category = patch.top_category;
  }

  const addTags = (patch.add_tags ?? [])
    .map(normalizeTagToken)
    .filter(Boolean);
  const removeTagSet = new Set(
    (patch.remove_tags ?? []).map(normalizeTagToken).filter(Boolean),
  );

  if (addTags.length > 0 || removeTagSet.size > 0) {
    const seen = new Set<string>();
    const mergedTags: string[] = [];

    for (const rawExisting of book.tags) {
      const normalized = normalizeTagToken(rawExisting);
      if (!normalized || removeTagSet.has(normalized) || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      mergedTags.push(normalized);
    }

    for (const tagToAdd of addTags) {
      if (seen.has(tagToAdd)) {
        continue;
      }
      seen.add(tagToAdd);
      mergedTags.push(tagToAdd);
    }

    next.tags = mergedTags.slice(0, MAX_TAGS);
  }

  return next;
}
