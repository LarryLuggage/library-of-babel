import { filterDisplayTags } from "@/lib/books/catalogue";

export type LookupCandidate = {
  title: string;
  author: string;
  edition: string;
  publish_year: number | null;
  summary: string | null;
  tags: string[];
  isbn: string | null;
  source: "open_library" | "google_books";
};

export type OpenLibraryDoc = {
  key?: unknown;
  title?: unknown;
  author_name?: unknown;
  publisher?: unknown;
  first_publish_year?: unknown;
  subject?: unknown;
  isbn?: unknown;
};

export type OpenLibraryWork = {
  description?: unknown;
  subjects?: unknown;
};

export type GoogleBooksVolumeItem = {
  volumeInfo?: {
    title?: unknown;
    authors?: unknown;
    publisher?: unknown;
    publishedDate?: unknown;
    description?: unknown;
    categories?: unknown;
    industryIdentifiers?: unknown;
  };
};

const OPEN_LIBRARY_USER_AGENT = "LibraryOfBabel/1.0";
const SEARCH_TIMEOUT_MS = 6000;
const WORK_TIMEOUT_MS = 3500;
const MAX_CANDIDATES = 6;
const MAX_TAGS = 10;
const MAX_WORK_ENRICHMENTS = 3;

function stripHtmlAndDecode(raw: string): string {
  const withoutTags = raw.replace(/<[^>]+>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    });

  return decoded.replace(/\s+/g, " ").trim();
}

function extractDescriptionText(description: unknown): string | null {
  let rawText = "";

  if (typeof description === "string") {
    rawText = description;
  } else if (
    typeof description === "object" &&
    description !== null &&
    "value" in description &&
    typeof description.value === "string"
  ) {
    rawText = description.value;
  }

  const cleaned = stripHtmlAndDecode(rawText);
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeTagCandidates(rawTags: readonly unknown[]): string[] {
  const cleanedRaw = rawTags
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"))
    .filter((item) => item.length > 0);

  return filterDisplayTags(cleanedRaw).slice(0, MAX_TAGS);
}

function normalizeComparisonText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildDedupeKey(candidate: Pick<LookupCandidate, "title" | "author">): string {
  return `${normalizeComparisonText(candidate.title)}\u0000${normalizeComparisonText(candidate.author)}`;
}

function pickPreferredIsbn(rawIsbns: unknown): string | null {
  if (!Array.isArray(rawIsbns)) {
    return null;
  }

  const candidates = rawIsbns
    .filter((value): value is string => typeof value === "string")
    .map((value) => detectIsbn(value))
    .filter((value): value is string => value !== null);

  if (candidates.length === 0) {
    return null;
  }

  const isbn13 = candidates.find((value) => value.length === 13);
  return isbn13 ?? candidates[0];
}

function parsePublishYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value >= -3000 && value <= 2100 ? value : null;
  }

  if (typeof value === "string") {
    const match = /\b(\d{4})\b/.exec(value);
    if (match) {
      const year = Number.parseInt(match[1], 10);
      return year >= 1000 && year <= 2100 ? year : null;
    }
  }

  return null;
}

/**
 * Extracts and normalizes an ISBN-10 or ISBN-13 (978/979) from a search string.
 */
export function detectIsbn(query: string): string | null {
  const withoutPrefix = query.trim().replace(/^isbn[:\s-]*/i, "");
  const compact = withoutPrefix.replace(/[\s-]+/g, "").toUpperCase();

  if (/^(?:978|979)\d{10}$/.test(compact)) {
    return compact;
  }

  if (/^\d{9}[\dX]$/.test(compact)) {
    return compact;
  }

  return null;
}

/**
 * Normalizes raw Open Library search docs (and optional work payloads) into LookupCandidates.
 */
export function normalizeOpenLibraryDocs(
  docs: readonly OpenLibraryDoc[],
  workDetailsByKey?: ReadonlyMap<string, OpenLibraryWork>,
): LookupCandidate[] {
  const candidates: LookupCandidate[] = [];

  for (const doc of docs) {
    const title = typeof doc.title === "string" ? doc.title.trim() : "";
    if (!title) {
      continue;
    }

    const authors = Array.isArray(doc.author_name)
      ? doc.author_name
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
    const author = authors.length > 0 ? authors.slice(0, 3).join(", ") : "Unknown";

    const publishers = Array.isArray(doc.publisher)
      ? doc.publisher
          .filter((pub): pub is string => typeof pub === "string")
          .map((pub) => pub.trim())
          .filter(Boolean)
      : [];
    const edition = publishers[0] ?? "";

    const workKey = typeof doc.key === "string" ? doc.key.trim() : "";
    const work = workKey ? workDetailsByKey?.get(workKey) : undefined;

    const rawSubjects: unknown[] = [
      ...(Array.isArray(doc.subject) ? doc.subject : []),
      ...(Array.isArray(work?.subjects) ? work.subjects : []),
    ];

    candidates.push({
      title,
      author,
      edition,
      publish_year: parsePublishYear(doc.first_publish_year),
      summary: extractDescriptionText(work?.description),
      tags: normalizeTagCandidates(rawSubjects),
      isbn: pickPreferredIsbn(doc.isbn),
      source: "open_library",
    });
  }

  return candidates;
}

/**
 * Normalizes raw Google Books volume items into LookupCandidates.
 */
export function normalizeGoogleBooksItems(
  items: readonly GoogleBooksVolumeItem[],
): LookupCandidate[] {
  const candidates: LookupCandidate[] = [];

  for (const item of items) {
    const info = item?.volumeInfo;
    if (!info || typeof info !== "object") {
      continue;
    }

    const title = typeof info.title === "string" ? info.title.trim() : "";
    if (!title) {
      continue;
    }

    const authors = Array.isArray(info.authors)
      ? info.authors
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
    const author = authors.length > 0 ? authors.slice(0, 3).join(", ") : "Unknown";

    const edition =
      typeof info.publisher === "string" ? info.publisher.trim() : "";

    const rawCategories: string[] = [];
    if (Array.isArray(info.categories)) {
      for (const category of info.categories) {
        if (typeof category !== "string") continue;
        for (const segment of category.split(/\s*\/\s*|\s*&\s*/)) {
          if (segment.trim()) {
            rawCategories.push(segment.trim());
          }
        }
      }
    }

    let isbn: string | null = null;
    if (Array.isArray(info.industryIdentifiers)) {
      const identifiers = info.industryIdentifiers
        .filter(
          (entry): entry is { type?: unknown; identifier?: unknown } =>
            typeof entry === "object" && entry !== null,
        )
        .map((entry) => ({
          type: typeof entry.type === "string" ? entry.type : "",
          isbn:
            typeof entry.identifier === "string"
              ? detectIsbn(entry.identifier)
              : null,
        }))
        .filter((entry): entry is { type: string; isbn: string } =>
          Boolean(entry.isbn),
        );

      const isbn13 = identifiers.find((entry) => entry.type === "ISBN_13");
      isbn = isbn13?.isbn ?? identifiers[0]?.isbn ?? null;
    }

    candidates.push({
      title,
      author,
      edition,
      publish_year: parsePublishYear(info.publishedDate),
      summary: extractDescriptionText(info.description),
      tags: normalizeTagCandidates(rawCategories),
      isbn,
      source: "google_books",
    });
  }

  return candidates;
}

async function fetchOpenLibraryWork(
  workKey: string,
  fetchImpl: typeof fetch,
): Promise<OpenLibraryWork | null> {
  const response = await fetchImpl(`https://openlibrary.org${workKey}.json`, {
    headers: { "User-Agent": OPEN_LIBRARY_USER_AGENT },
    signal: AbortSignal.timeout(WORK_TIMEOUT_MS),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as OpenLibraryWork;
}

function mergeCandidates(
  primaryCandidates: readonly LookupCandidate[],
  secondaryCandidates: readonly LookupCandidate[],
): LookupCandidate[] {
  const mergedByKey = new Map<string, LookupCandidate>();

  const upsert = (candidate: LookupCandidate) => {
    const key = buildDedupeKey(candidate);
    const existing = mergedByKey.get(key);

    if (!existing) {
      mergedByKey.set(key, { ...candidate, tags: [...candidate.tags] });
      return;
    }

    mergedByKey.set(key, {
      ...existing,
      edition: existing.edition || candidate.edition,
      publish_year: existing.publish_year ?? candidate.publish_year,
      summary: existing.summary ?? candidate.summary,
      isbn: existing.isbn ?? candidate.isbn,
      tags: normalizeTagCandidates([...existing.tags, ...candidate.tags]),
    });
  };

  for (const candidate of primaryCandidates) {
    upsert(candidate);
  }
  for (const candidate of secondaryCandidates) {
    upsert(candidate);
  }

  return [...mergedByKey.values()].slice(0, MAX_CANDIDATES);
}

/**
 * Queries Open Library (and optionally Google Books when GOOGLE_BOOKS_API_KEY is set)
 * for normalized, deduplicated bibliographic candidates.
 */
export async function lookupBibliographicCandidates(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LookupCandidate[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return [];
  }

  const isbn = detectIsbn(trimmedQuery);
  const openLibraryUrl = new URL("https://openlibrary.org/search.json");
  if (isbn) {
    openLibraryUrl.searchParams.set("isbn", isbn);
  } else {
    openLibraryUrl.searchParams.set("q", trimmedQuery);
  }
  openLibraryUrl.searchParams.set("limit", String(MAX_CANDIDATES));
  openLibraryUrl.searchParams.set(
    "fields",
    "key,title,author_name,publisher,first_publish_year,subject,isbn",
  );

  const googleApiKey = process.env.GOOGLE_BOOKS_API_KEY?.trim() ?? "";
  const googleBooksPromise = googleApiKey
    ? (async (): Promise<GoogleBooksVolumeItem[]> => {
        const googleUrl = new URL("https://www.googleapis.com/books/v1/volumes");
        googleUrl.searchParams.set(
          "q",
          isbn ? `isbn:${isbn}` : trimmedQuery,
        );
        googleUrl.searchParams.set("maxResults", "4");
        googleUrl.searchParams.set("printType", "books");
        googleUrl.searchParams.set("key", googleApiKey);

        const response = await fetchImpl(googleUrl.toString(), {
          signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`Google Books lookup failed (${response.status}).`);
        }

        const payload = (await response.json()) as {
          items?: GoogleBooksVolumeItem[];
        };
        return Array.isArray(payload.items) ? payload.items : [];
      })()
    : null;

  const openLibraryPromise = (async (): Promise<OpenLibraryDoc[]> => {
    const response = await fetchImpl(openLibraryUrl.toString(), {
      headers: { "User-Agent": OPEN_LIBRARY_USER_AGENT },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Open Library lookup failed (${response.status}).`);
    }

    const payload = (await response.json()) as { docs?: OpenLibraryDoc[] };
    return Array.isArray(payload.docs) ? payload.docs : [];
  })();

  const [olSettled, googleSettled] = await Promise.allSettled([
    openLibraryPromise,
    googleBooksPromise ?? Promise.resolve([]),
  ]);

  const olFailed = olSettled.status === "rejected";
  const googleFailed = googleApiKey ? googleSettled.status === "rejected" : true;

  if (olFailed && googleFailed) {
    throw olSettled.reason;
  }

  const olDocs = olSettled.status === "fulfilled" ? olSettled.value : [];
  const googleItems =
    googleSettled.status === "fulfilled" ? googleSettled.value : [];

  const workKeys = olDocs
    .map((doc) => (typeof doc.key === "string" ? doc.key.trim() : ""))
    .filter((key) => key.startsWith("/works/"))
    .slice(0, MAX_WORK_ENRICHMENTS);

  const workDetailsByKey = new Map<string, OpenLibraryWork>();
  if (workKeys.length > 0) {
    const workResults = await Promise.allSettled(
      workKeys.map(async (workKey) => ({
        workKey,
        work: await fetchOpenLibraryWork(workKey, fetchImpl),
      })),
    );

    for (const result of workResults) {
      if (result.status === "fulfilled" && result.value.work) {
        workDetailsByKey.set(result.value.workKey, result.value.work);
      }
    }
  }

  const olCandidates = normalizeOpenLibraryDocs(olDocs, workDetailsByKey);
  const googleCandidates = normalizeGoogleBooksItems(googleItems);

  return mergeCandidates(olCandidates, googleCandidates);
}
