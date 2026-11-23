import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  cleanSummary,
  extractAuthorSurname,
  extractYearFromWikipediaExtract,
  getBookIdentity,
  getPairKey,
  isBrokenSummary,
  MAX_PUBLISH_YEAR,
  mergeTags,
  MIN_PUBLISH_YEAR,
  MIN_WIKIPEDIA_SCORE,
  normalizeWorkTitle,
  parseWikidataYear,
  resolvePublishYear,
  scoreWikipediaCandidate,
  stripAuthorAnnotations,
  summarizeText,
} from "./lib/enrichment-helpers.mjs";
import { VERIFIED_CLASSIC_YEARS } from "./lib/classic-years.mjs";

const CATALOGUE_PATH = new URL("../shelf_catalog_full.json", import.meta.url);
const DEFAULT_OUTPUT_PATH = "/private/tmp/library-of-babel-book-enrichment.json";
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_DELAY_MS = 100;
const REQUEST_TIMEOUT_MS = 10000;
const CHECKPOINT_INTERVAL = 10;
const USER_AGENT =
  "LibraryOfBabelCatalogue/1.0 (https://github.com/LarryLuggage/library-of-babel)";

const OPEN_LIBRARY_FIELDS = [
  "key",
  "title",
  "author_name",
  "subject",
  "first_publish_year",
].join(",");

const genreLabelCache = new Map();

/**
 * Parses CLI flags for the enrichment runner.
 */
export function parseArgs(argv) {
  const options = {
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    force: false,
    limit: null,
    offset: 0,
    onlyIncomplete: false,
    outputPath: DEFAULT_OUTPUT_PATH,
  };

  for (const arg of argv) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--only-incomplete") {
      options.onlyIncomplete = true;
      continue;
    }

    const eqIndex = arg.indexOf("=");
    const name = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
    const value = eqIndex === -1 ? "" : arg.slice(eqIndex + 1);

    if (name === "--concurrency" && value) {
      options.concurrency = Number(value);
    } else if (name === "--delay-ms" && value) {
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

  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }
  if (
    options.limit !== null &&
    (!Number.isInteger(options.limit) || options.limit < 1)
  ) {
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

/**
 * Returns true if a catalogue book is missing metadata, has a broken summary,
 * or needs classic/suspicious publication year resolution.
 */
export function needsEnrichment(book) {
  if (!cleanSummary(book.summary) || isBrokenSummary(book.summary, book)) {
    return true;
  }

  const year = book.publish_year;
  if (
    typeof year !== "number" ||
    !Number.isInteger(year) ||
    year === 0 ||
    year === 1800 ||
    year === 1900 ||
    year < MIN_PUBLISH_YEAR ||
    year > MAX_PUBLISH_YEAR
  ) {
    return true;
  }

  const classicYear = VERIFIED_CLASSIC_YEARS.get(
    getPairKey(book.title, book.author),
  );
  if (classicYear !== undefined && year !== classicYear) {
    return true;
  }

  if (!Array.isArray(book.tags) || mergeTags(book.tags, [], book).length === 0) {
    return true;
  }

  return false;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, { attempts = 3, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 404) {
        return null;
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        if (attempt < attempts) {
          const backoff =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 500 * attempt;
          await wait(backoff);
          continue;
        }
      }

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await wait(350 * attempt);
      }
    }
  }

  throw lastError;
}

function buildWikipediaQueries(book) {
  const cleanTitle = String(book.title ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*[—–:-]\s*(?:vol(?:ume)?\.?|part|book|bk\.?)\s+[ivxlcdm0-9]+\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const baseWorkTitle = cleanTitle
    .replace(/,?\s+and\s+Other\s+(?:Stories|Works|Essays|Plays|Poems|Writings|Tales)\b.*$/i, "")
    .trim();
  const cleanAuthor = stripAuthorAnnotations(book.author);
  const surname = extractAuthorSurname(book.author);

  const queries = [];
  if (surname) {
    queries.push(`${cleanTitle} ${surname}`);
    if (baseWorkTitle && baseWorkTitle !== cleanTitle) {
      queries.push(`${baseWorkTitle} ${surname}`);
    }
    if (cleanAuthor && cleanAuthor !== surname) {
      queries.push(`${cleanTitle} ${cleanAuthor}`);
    }
  } else {
    queries.push(`${cleanTitle} book`);
    queries.push(cleanTitle);
  }

  return [...new Set(queries.filter(Boolean))];
}

async function searchWikipediaPages(query) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", "6");
  url.searchParams.set("srnamespace", "0");
  url.searchParams.set("format", "json");
  url.searchParams.set("utf8", "1");

  const data = await fetchJson(url);
  return data?.query?.search ?? [];
}

async function fetchWikipediaPageDetails(pageIds) {
  if (!pageIds.length) {
    return new Map();
  }

  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("pageids", pageIds.join("|"));
  url.searchParams.set("prop", "extracts|pageprops|categories");
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("cllimit", "50");
  url.searchParams.set("clshow", "!hidden");
  url.searchParams.set("ppprop", "wikibase_item");
  url.searchParams.set("format", "json");
  url.searchParams.set("utf8", "1");

  const data = await fetchJson(url);
  const pages = Object.values(data?.query?.pages ?? {});
  return new Map(pages.map((page) => [page.pageid, page]));
}

async function lookupWikipedia(book) {
  const queries = buildWikipediaQueries(book);
  let bestMatch = null;

  for (const query of queries) {
    const searchResults = await searchWikipediaPages(query);
    if (!searchResults.length) {
      continue;
    }

    const pageIds = searchResults
      .map((item) => item.pageid)
      .filter((id) => Number.isInteger(id))
      .slice(0, 6);
    const detailsById = await fetchWikipediaPageDetails(pageIds);

    for (const searchResult of searchResults) {
      const page = detailsById.get(searchResult.pageid);
      if (!page) {
        continue;
      }

      const extract = page.extract ?? "";
      const categories = (page.categories ?? []).map((cat) =>
        String(cat.title ?? "").replace(/^Category:/i, ""),
      );
      const score = scoreWikipediaCandidate({
        book,
        categories,
        extract,
        searchResult,
      });

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          categories,
          extract,
          pageid: page.pageid,
          qid: page.pageprops?.wikibase_item ?? null,
          score,
          title: page.title ?? searchResult.title,
        };
      }
    }

    if (bestMatch && bestMatch.score >= MIN_WIKIPEDIA_SCORE) {
      break;
    }
  }

  if (!bestMatch || bestMatch.score < MIN_WIKIPEDIA_SCORE) {
    return null;
  }

  return bestMatch;
}

async function resolveWikidataLabels(qids) {
  const missing = [...new Set(qids)].filter((id) => id && !genreLabelCache.has(id));
  if (missing.length > 0) {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", missing.slice(0, 20).join("|"));
    url.searchParams.set("props", "labels");
    url.searchParams.set("languages", "en");
    url.searchParams.set("format", "json");

    const data = await fetchJson(url);
    for (const [id, entity] of Object.entries(data?.entities ?? {})) {
      const label = entity?.labels?.en?.value ?? null;
      if (label) {
        genreLabelCache.set(id, label);
      }
    }
  }

  return qids.map((id) => genreLabelCache.get(id)).filter(Boolean);
}

async function lookupWikidata(qid) {
  if (!qid) {
    return null;
  }

  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", qid);
  url.searchParams.set("props", "claims|labels");
  url.searchParams.set("languages", "en");
  url.searchParams.set("format", "json");

  const data = await fetchJson(url);
  const entity = data?.entities?.[qid];
  if (!entity) {
    return null;
  }

  const claims = entity.claims ?? {};
  const pubYears = (claims.P577 ?? [])
    .map((claim) => parseWikidataYear(claim))
    .filter((year) => year !== null);
  const inceptionYears = (claims.P571 ?? [])
    .map((claim) => parseWikidataYear(claim))
    .filter((year) => year !== null);

  const publishYear =
    pubYears.length > 0
      ? Math.min(...pubYears)
      : inceptionYears.length > 0
        ? Math.min(...inceptionYears)
        : null;

  const genreQids = (claims.P136 ?? [])
    .map((claim) => claim?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean)
    .slice(0, 8);
  const genres = genreQids.length > 0 ? await resolveWikidataLabels(genreQids) : [];

  return {
    genres,
    label: entity?.labels?.en?.value ?? null,
    publish_year: publishYear,
    qid,
  };
}

function titleScore(book, resultTitle) {
  const expected = normalizeWorkTitle(book.title);
  const actual = normalizeWorkTitle(resultTitle);
  if (!expected || !actual) {
    return 0;
  }
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
  const expected = stripAuthorAnnotations(book.author).toLowerCase();
  const surname = extractAuthorSurname(book.author).toLowerCase();
  const candidates = (authors ?? []).map((a) => String(a ?? "").toLowerCase());

  if (candidates.some((author) => author === expected)) {
    return 8;
  }
  if (
    surname &&
    candidates.some((author) => author.includes(surname))
  ) {
    return 5;
  }
  return expected
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 && candidates.some((author) => author.includes(word)),
    ).length;
}

async function searchOpenLibrary(book) {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("title", book.title);
  const authorQuery = stripAuthorAnnotations(book.author);
  if (authorQuery && authorQuery !== "Various") {
    url.searchParams.set("author", authorQuery);
  }
  url.searchParams.set("limit", "6");
  url.searchParams.set("fields", OPEN_LIBRARY_FIELDS);

  const result = await fetchJson(url);
  const matches = [...(result?.docs ?? [])]
    .filter(
      (match) =>
        authorScore(book, match.author_name ?? []) > 0 ||
        book.author === "Various",
    )
    .sort(
      (first, second) =>
        titleScore(book, second.title) - titleScore(book, first.title) ||
        authorScore(book, second.author_name ?? []) -
          authorScore(book, first.author_name ?? []) ||
        (second.subject?.length ?? 0) - (first.subject?.length ?? 0),
    );

  return matches[0] ?? null;
}

async function getOpenLibraryWork(match) {
  if (!match?.key?.startsWith("/works/")) {
    return null;
  }
  return fetchJson(`https://openlibrary.org${match.key}.json`);
}

async function searchGoogleBooks(book, apiKey) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  const authorQuery = stripAuthorAnnotations(book.author);
  url.searchParams.set("q", `intitle:${book.title} inauthor:${authorQuery}`);
  url.searchParams.set("maxResults", "5");
  url.searchParams.set("printType", "books");
  url.searchParams.set("key", apiKey);

  const result = await fetchJson(url);
  const matches = [...(result?.items ?? [])].sort((first, second) => {
    const firstInfo = first.volumeInfo ?? {};
    const secondInfo = second.volumeInfo ?? {};
    return (
      titleScore(book, secondInfo.title) - titleScore(book, firstInfo.title) ||
      authorScore(book, secondInfo.authors ?? []) -
        authorScore(book, firstInfo.authors ?? []) ||
      (secondInfo.categories?.length ?? 0) - (firstInfo.categories?.length ?? 0)
    );
  });

  return matches[0] ?? null;
}

function getDescriptionText(description) {
  if (!description) {
    return "";
  }
  return typeof description === "string" ? description : (description.value ?? "");
}

function extractTagsFromWikipediaCategories(categories) {
  const tags = [];

  for (const rawCategory of categories ?? []) {
    if (
      /^(?:articles|all articles|commons|cs1|pages|wikipedia|use |short description|webarchive|isbn|needing|living people|births|deaths|novels adapted into|books adapted into|films based on|works by )/i.test(
        rawCategory,
      )
    ) {
      continue;
    }

    const stripped = rawCategory
      .replace(/^\d{4}\s+/i, "")
      .replace(/^\d{1,2}(?:st|nd|rd|th)-century\s+/i, "")
      .replace(/^\d{4}s\s+/i, "")
      .replace(/^novels set in\s+/i, "")
      .replace(/^books about\s+/i, "")
      .replace(/\s+(?:books|novels|novellas|poems|plays|works|essays|short stories|treatises)$/i, "")
      .trim();

    if (stripped) {
      tags.push(stripped);
    }
  }

  return tags;
}

function pickBestValidSummary(book, candidates) {
  for (const rawCandidate of candidates) {
    const summarized = summarizeText(rawCandidate);
    if (summarized && !isBrokenSummary(summarized, book)) {
      return summarized;
    }
  }
  return null;
}

async function enrichBook(book) {
  const sourceErrors = [];
  const classicYear =
    VERIFIED_CLASSIC_YEARS.get(getPairKey(book.title, book.author)) ?? null;

  let wikipediaMatch = null;
  try {
    wikipediaMatch = await lookupWikipedia(book);
  } catch (error) {
    sourceErrors.push(`wikipedia: ${error.message}`);
  }

  let wikidataRecord = null;
  if (wikipediaMatch?.qid) {
    try {
      wikidataRecord = await lookupWikidata(wikipediaMatch.qid);
    } catch (error) {
      sourceErrors.push(`wikidata: ${error.message}`);
    }
  }

  const wikipediaExtractYear = wikipediaMatch?.extract
    ? extractYearFromWikipediaExtract(wikipediaMatch.extract)
    : null;
  const wikidataYear = wikidataRecord?.publish_year ?? null;

  let wikiSummary = pickBestValidSummary(book, [wikipediaMatch?.extract]);
  const wikiTags = [
    ...(wikidataRecord?.genres ?? []),
    ...extractTagsFromWikipediaCategories(wikipediaMatch?.categories ?? []),
  ];

  // Fallback to Open Library only when Wikipedia/Wikidata left gaps
  let openLibraryMatch = null;
  let openLibraryWork = null;
  const needOlSummary = !wikiSummary;
  const needOlYear =
    classicYear === null && wikidataYear === null && wikipediaExtractYear === null;
  const needOlTags = mergeTags(book.tags, wikiTags, book).length < 4;

  if (needOlSummary || needOlYear || needOlTags) {
    try {
      openLibraryMatch = await searchOpenLibrary(book);
      openLibraryWork = await getOpenLibraryWork(openLibraryMatch);
    } catch (error) {
      sourceErrors.push(`open_library: ${error.message}`);
    }
  }

  // Optional Google Books fallback ONLY when GOOGLE_BOOKS_API_KEY is explicitly configured
  let googleMatch = null;
  const googleApiKey = process.env.GOOGLE_BOOKS_API_KEY?.trim() ?? "";
  const olSummary = pickBestValidSummary(book, [
    getDescriptionText(openLibraryWork?.description),
  ]);
  if (googleApiKey && (!wikiSummary && !olSummary)) {
    try {
      googleMatch = await searchGoogleBooks(book, googleApiKey);
    } catch (error) {
      sourceErrors.push(`google_books: ${error.message}`);
    }
  }

  const googleInfo = googleMatch?.volumeInfo ?? {};
  const summary =
    wikiSummary ??
    olSummary ??
    pickBestValidSummary(book, [googleInfo.description]);

  const rawTags = [
    ...(book.sub_category ? [book.sub_category] : []),
    ...wikiTags,
    ...(googleInfo.categories ?? []).flatMap((cat) =>
      cat.split(/\s*\/\s*|\s*&\s*/),
    ),
    ...(openLibraryWork?.subjects ?? []),
    ...(openLibraryMatch?.subject ?? []),
    ...(openLibraryWork?.subject_places ?? []),
  ];
  const tags = mergeTags([], rawTags, book);

  const publishYear = resolvePublishYear({
    classicYear,
    existingYear: book.publish_year ?? null,
    openLibraryYear: openLibraryMatch?.first_publish_year ?? null,
    wikidataYear,
    wikipediaExtractYear,
  });

  return {
    author: book.author,
    edition: book.edition,
    position: book.position,
    publish_year: publishYear,
    shelf: book.shelf,
    sources: {
      errors: sourceErrors,
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
            title: openLibraryMatch.title ?? null,
          }
        : null,
      wikidata: wikidataRecord,
      wikipedia: wikipediaMatch
        ? {
            categories: wikipediaMatch.categories.slice(0, 15),
            extract_year: wikipediaExtractYear,
            pageid: wikipediaMatch.pageid,
            qid: wikipediaMatch.qid,
            score: wikipediaMatch.score,
            title: wikipediaMatch.title,
          }
        : null,
    },
    summary,
    tags,
    title: book.title,
  };
}

async function readExistingEnrichment(outputPath) {
  try {
    const existing = await readFile(outputPath, "utf8").then(JSON.parse);
    return new Map(existing.map((row) => [getBookIdentity(row), row]));
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const catalogue = await readFile(CATALOGUE_PATH, "utf8").then(JSON.parse);

  const existingByIdentity = options.force
    ? new Map()
    : await readExistingEnrichment(options.outputPath);

  const candidateBooks = options.onlyIncomplete
    ? catalogue.filter(needsEnrichment)
    : catalogue;
  const selectedBooks = candidateBooks.slice(
    options.offset,
    options.limit === null ? undefined : options.offset + options.limit,
  );

  const enrichedByIdentity = new Map(existingByIdentity);
  const pendingBooks = selectedBooks.filter(
    (book) => options.force || !enrichedByIdentity.has(getBookIdentity(book)),
  );

  process.stdout.write(
    `Selected ${selectedBooks.length} books (${pendingBooks.length} pending, concurrency=${options.concurrency}, delayMs=${options.delayMs}).\n`,
  );

  let cursor = 0;
  let processed = 0;
  let writeChain = Promise.resolve();

  const checkpoint = () => {
    const payload = `${JSON.stringify([...enrichedByIdentity.values()], null, 2)}\n`;
    writeChain = writeChain.then(() => writeFile(options.outputPath, payload));
    return writeChain;
  };

  async function worker() {
    while (cursor < pendingBooks.length) {
      const index = cursor;
      cursor += 1;
      const book = pendingBooks[index];
      const identity = getBookIdentity(book);

      try {
        const enrichment = await enrichBook(book);
        enrichedByIdentity.set(identity, enrichment);
        processed += 1;
        const count = `${String(processed).padStart(3, "0")}/${pendingBooks.length}`;
        process.stdout.write(
          `${count} enriched ${book.title} (yr=${enrichment.publish_year ?? "null"}, tags=${enrichment.tags.length}, wiki=${enrichment.sources.wikipedia ? "yes" : "no"})\n`,
        );
      } catch (error) {
        enrichedByIdentity.set(identity, {
          author: book.author,
          edition: book.edition,
          error: error.message,
          position: book.position,
          publish_year: book.publish_year ?? null,
          shelf: book.shelf,
          sources: null,
          summary: null,
          tags: [],
          title: book.title,
        });
        processed += 1;
        const count = `${String(processed).padStart(3, "0")}/${pendingBooks.length}`;
        process.stdout.write(`${count} failed ${book.title}: ${error.message}\n`);
      }

      if (processed % CHECKPOINT_INTERVAL === 0) {
        await checkpoint();
      }

      if (options.delayMs > 0) {
        await wait(options.delayMs);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(options.concurrency, Math.max(1, pendingBooks.length)) },
    () => worker(),
  );
  await Promise.all(workers);
  await checkpoint();

  process.stdout.write(
    `Saved ${enrichedByIdentity.size} enriched rows to ${options.outputPath}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run().catch((error) => {
    console.error("Failed to enrich catalogue books:", error);
    process.exitCode = 1;
  });
}
