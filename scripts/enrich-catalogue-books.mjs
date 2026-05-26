import { readFile, writeFile } from "node:fs/promises";
import catalogue from "../shelf_catalog_full.json" with { type: "json" };

const DEFAULT_OUTPUT_PATH =
  "/private/tmp/library-of-babel-book-enrichment.json";
const DEFAULT_DELAY_MS = 130;
const OPEN_LIBRARY_FIELDS = [
  "key",
  "title",
  "author_name",
  "subject",
  "first_publish_year",
].join(",");
const MAX_TAGS = 14;
const TAG_BLOCKLIST = new Set([
  "accessible book",
  "bibliography",
  "book club editions",
  "book reviews",
  "books and reading",
  "borrowable books",
  "classic",
  "english",
  "english language",
  "fiction",
  "general",
  "in library",
  "internet archive wishlist",
  "open library staff picks",
  "protected daisy",
  "readers",
  "vfiction",
]);
const TAG_PHRASE_BLOCKLIST = [
  "criticism and interpretation",
  "fictional works by one author",
  "long now",
  "manual for civilization",
  "open syllabus",
];

function parseArgs(argv) {
  const options = {
    delayMs: DEFAULT_DELAY_MS,
    force: false,
    limit: null,
    offset: 0,
    outputPath: DEFAULT_OUTPUT_PATH,
  };

  for (const arg of argv) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }

    const [name, value] = arg.split("=", 2);

    if (name === "--delay-ms" && value) {
      options.delayMs = Number(value);
    } else if (name === "--limit" && value) {
      options.limit = Number(value);
    } else if (name === "--offset" && value) {
      options.offset = Number(value);
    } else if (name === "--output" && value) {
      options.outputPath = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }

  if (!Number.isInteger(options.offset) || options.offset < 0) {
    throw new Error("--offset must be a non-negative integer.");
  }

  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error("--delay-ms must be a non-negative number.");
  }

  return options;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getIdentity(book) {
  return [book.author, book.title, book.shelf, book.position].join("\u0000");
}

function getSearchAuthor(author) {
  return author
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\/.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTag(value, book) {
  let normalized = normalize(value);
  const keepFictionSuffix = new Set([
    "classic fiction",
    "didactic fiction",
    "historical fiction",
    "science fiction",
  ]).has(normalized);

  normalized = normalized
    .replace(/\bfictional works by one author\b/g, "")
    .replace(/^fiction\s+/, "")
    .replace(keepFictionSuffix ? /$^/ : /\s+fiction$/g, "")
    .replace(/\s+general$/g, "")
    .replace(/\s+traditional$/g, "")
    .replace(/\s+in$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !normalized ||
    normalized.length < 3 ||
    normalized.length > 48 ||
    TAG_BLOCKLIST.has(normalized) ||
    TAG_PHRASE_BLOCKLIST.some((phrase) => normalized.includes(phrase)) ||
    /\b\d{4}\b/.test(normalized)
  ) {
    return null;
  }

  const authorTerms = normalize(getSearchAuthor(book.author))
    .split(" ")
    .filter((term) => term.length > 4);

  if (authorTerms.some((term) => normalized.includes(term))) {
    return null;
  }

  const words = normalized.split(" ");

  if (words.length > 5 || words.every((word) => /^\d+$/.test(word))) {
    return null;
  }

  return normalized;
}

function titleScore(book, resultTitle) {
  const expected = normalize(book.title);
  const actual = normalize(resultTitle);

  if (actual === expected) {
    return 8;
  }

  if (actual.includes(expected) || expected.includes(actual)) {
    return 5;
  }

  return expected
    .split(" ")
    .filter((word) => word.length > 3 && actual.includes(word)).length;
}

function authorScore(book, authors) {
  const expected = normalize(getSearchAuthor(book.author));
  const candidates = authors.map(normalize);

  if (candidates.some((author) => author === expected)) {
    return 8;
  }

  if (
    candidates.some((author) => author.includes(expected) || expected.includes(author))
  ) {
    return 5;
  }

  return expected
    .split(" ")
    .filter(
      (word) =>
        word.length > 2 && candidates.some((author) => author.includes(word)),
    ).length;
}

function rankOpenLibraryResult(book, first, second) {
  return (
    titleScore(book, second.title) - titleScore(book, first.title) ||
    authorScore(book, second.author_name ?? []) -
      authorScore(book, first.author_name ?? []) ||
    (second.subject?.length ?? 0) - (first.subject?.length ?? 0)
  );
}

function rankGoogleBookResult(book, first, second) {
  const firstInfo = first.volumeInfo ?? {};
  const secondInfo = second.volumeInfo ?? {};

  return (
    titleScore(book, secondInfo.title) - titleScore(book, firstInfo.title) ||
    authorScore(book, secondInfo.authors ?? []) -
      authorScore(book, firstInfo.authors ?? []) ||
    (secondInfo.categories?.length ?? 0) - (firstInfo.categories?.length ?? 0)
  );
}

async function fetchJson(url, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await wait(350 * attempt);
      }
    }
  }

  throw lastError;
}

async function searchOpenLibrary(book) {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("title", book.title);
  url.searchParams.set("author", getSearchAuthor(book.author));
  url.searchParams.set("limit", "6");
  url.searchParams.set("fields", OPEN_LIBRARY_FIELDS);

  const result = await fetchJson(url);
  const matches = [...(result?.docs ?? [])].sort((first, second) =>
    rankOpenLibraryResult(book, first, second),
  );

  return matches[0] ?? null;
}

async function getOpenLibraryWork(match) {
  if (!match?.key?.startsWith("/works/")) {
    return null;
  }

  return fetchJson(`https://openlibrary.org${match.key}.json`);
}

async function searchGoogleBooks(book) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set(
    "q",
    `intitle:${book.title} inauthor:${getSearchAuthor(book.author)}`,
  );
  url.searchParams.set("maxResults", "5");
  url.searchParams.set("printType", "books");

  if (process.env.GOOGLE_BOOKS_API_KEY) {
    url.searchParams.set("key", process.env.GOOGLE_BOOKS_API_KEY);
  }

  const result = await fetchJson(url);
  const matches = [...(result?.items ?? [])].sort((first, second) =>
    rankGoogleBookResult(book, first, second),
  );

  return matches[0] ?? null;
}

function getDescriptionText(description) {
  if (!description) {
    return "";
  }

  if (typeof description === "string") {
    return description;
  }

  return description.value ?? "";
}

function stripHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getShortSummary(...descriptions) {
  const description = descriptions.map(getDescriptionText).map(stripHtml).find(Boolean);

  if (!description) {
    return null;
  }

  const sentences = description.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [];
  const summary = sentences.slice(0, 2).join(" ").trim() || description;

  if (summary.length < 80 || /^["'“”]?Mr\.\s+/i.test(summary)) {
    return null;
  }

  if (summary.length <= 420) {
    return summary;
  }

  return `${summary.slice(0, 417).replace(/\s+\S*$/, "")}...`;
}

function addTag(book, tagScores, value, score) {
  const tag = normalizeTag(value, book);

  if (!tag) {
    return;
  }

  tagScores.set(tag, (tagScores.get(tag) ?? 0) + score);
}

function getTags(book, openLibraryMatch, openLibraryWork, googleMatch) {
  const tagScores = new Map();
  const googleInfo = googleMatch?.volumeInfo ?? {};

  addTag(book, tagScores, book.top_category, 4);
  addTag(book, tagScores, book.sub_category, 5);

  for (const category of googleInfo.categories ?? []) {
    for (const tag of category.split(/\s*\/\s*|\s*&\s*/)) {
      addTag(book, tagScores, tag, 6);
    }
  }

  for (const subject of openLibraryMatch?.subject ?? []) {
    addTag(book, tagScores, subject, 2);
  }

  for (const subject of openLibraryWork?.subjects ?? []) {
    addTag(book, tagScores, subject, 3);
  }

  for (const subjectPlace of openLibraryWork?.subject_places ?? []) {
    addTag(book, tagScores, subjectPlace, 2);
  }

  for (const subjectTime of openLibraryWork?.subject_times ?? []) {
    addTag(book, tagScores, subjectTime, 1);
  }

  return [...tagScores.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .slice(0, MAX_TAGS)
    .map(([tag]) => tag);
}

function getSourceSummary(
  openLibraryMatch,
  openLibraryWork,
  googleMatch,
  sourceErrors,
) {
  const googleInfo = googleMatch?.volumeInfo ?? {};

  return {
    google_books: googleMatch
      ? {
          authors: googleInfo.authors ?? [],
          categories: googleInfo.categories ?? [],
          id: googleMatch.id ?? null,
          publishedDate: googleInfo.publishedDate ?? null,
          title: googleInfo.title ?? null,
        }
      : null,
    open_library: openLibraryMatch
      ? {
          author_name: openLibraryMatch.author_name ?? [],
          first_publish_year: openLibraryMatch.first_publish_year ?? null,
          key: openLibraryMatch.key ?? null,
          subjects_sample: (openLibraryMatch.subject ?? []).slice(0, 20),
          title: openLibraryMatch.title ?? null,
        }
      : null,
    open_library_work: openLibraryWork
      ? {
          key: openLibraryWork.key ?? openLibraryMatch?.key ?? null,
          subject_places: openLibraryWork.subject_places ?? [],
          subject_times: openLibraryWork.subject_times ?? [],
          subjects_sample: (openLibraryWork.subjects ?? []).slice(0, 20),
          title: openLibraryWork.title ?? null,
      }
      : null,
    errors: sourceErrors,
  };
}

async function readExistingEnrichment(outputPath) {
  try {
    const existing = await readFile(outputPath, "utf8").then(JSON.parse);

    return new Map(existing.map((row) => [getIdentity(row), row]));
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Map();
    }

    throw error;
  }
}

async function enrichBook(book) {
  const sourceErrors = [];
  const [openLibraryResult, googleResult] = await Promise.allSettled([
    searchOpenLibrary(book),
    searchGoogleBooks(book),
  ]);
  const openLibraryMatch =
    openLibraryResult.status === "fulfilled" ? openLibraryResult.value : null;
  const googleMatch = googleResult.status === "fulfilled" ? googleResult.value : null;

  if (openLibraryResult.status === "rejected") {
    sourceErrors.push(`open_library: ${openLibraryResult.reason.message}`);
  }

  if (googleResult.status === "rejected") {
    sourceErrors.push(`google_books: ${googleResult.reason.message}`);
  }

  let openLibraryWork = null;

  try {
    openLibraryWork = await getOpenLibraryWork(openLibraryMatch);
  } catch (error) {
    sourceErrors.push(`open_library_work: ${error.message}`);
  }

  const googleInfo = googleMatch?.volumeInfo ?? {};
  const summary = getShortSummary(
    googleInfo.description,
    openLibraryWork?.description,
  );
  const tags = getTags(book, openLibraryMatch, openLibraryWork, googleMatch);

  return {
    author: book.author,
    edition: book.edition,
    position: book.position,
    shelf: book.shelf,
    sources: getSourceSummary(
      openLibraryMatch,
      openLibraryWork,
      googleMatch,
      sourceErrors,
    ),
    summary,
    tags,
    title: book.title,
  };
}

const options = parseArgs(process.argv.slice(2));
const existingByIdentity = options.force
  ? new Map()
  : await readExistingEnrichment(options.outputPath);
const selectedBooks = catalogue.slice(
  options.offset,
  options.limit === null ? undefined : options.offset + options.limit,
);
const enrichedByIdentity = new Map(existingByIdentity);

for (const [index, book] of selectedBooks.entries()) {
  const identity = getIdentity(book);
  const count = `${String(index + 1).padStart(3, "0")}/${selectedBooks.length}`;

  if (enrichedByIdentity.has(identity)) {
    process.stdout.write(`${count} skipped ${book.title}\n`);
    continue;
  }

  try {
    const enrichment = await enrichBook(book);

    enrichedByIdentity.set(identity, enrichment);
    process.stdout.write(
      `${count} enriched ${book.title} (${enrichment.tags.length} tags)\n`,
    );
  } catch (error) {
    enrichedByIdentity.set(identity, {
      author: book.author,
      edition: book.edition,
      error: error.message,
      position: book.position,
      shelf: book.shelf,
      sources: null,
      summary: null,
      tags: [],
      title: book.title,
    });
    process.stdout.write(`${count} failed ${book.title}: ${error.message}\n`);
  }

  await writeFile(
    options.outputPath,
    `${JSON.stringify([...enrichedByIdentity.values()], null, 2)}\n`,
  );
  await wait(options.delayMs);
}

process.stdout.write(
  `Saved ${enrichedByIdentity.size} enriched rows to ${options.outputPath}\n`,
);
