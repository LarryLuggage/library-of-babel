import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  cleanSummary,
  getBookIdentity,
  getPairKey,
  isBrokenSummary,
  mergeEnrichedBook,
} from "./lib/enrichment-helpers.mjs";
import { VERIFIED_CLASSIC_YEARS } from "./lib/classic-years.mjs";

const CATALOGUE_PATH = new URL("../shelf_catalog_full.json", import.meta.url);
const DEFAULT_ENRICHMENT_PATH =
  "/private/tmp/library-of-babel-book-enrichment.json";

/**
 * Parses CLI flags for `apply-catalogue-enrichment.mjs`.
 */
export function parseArgs(argv) {
  let inputPath = DEFAULT_ENRICHMENT_PATH;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--input=")) {
      inputPath = arg.slice("--input=".length);
      continue;
    }
    if (arg === "--input" && argv[i + 1]) {
      inputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      inputPath = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dryRun, inputPath };
}

function arraysEqual(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second)) {
    return first === second;
  }
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

/**
 * Applies enrichment records and verified classic years to a catalogue array
 * without mutating identifying fields (`title`, `author`, `shelf`, `position`).
 */
export function applyCatalogueEnrichment(catalogue, enrichmentRows) {
  const enrichmentByIdentity = new Map(
    enrichmentRows.map((row) => [getBookIdentity(row), row]),
  );

  const stats = {
    brokenSummariesCleared: 0,
    brokenSummariesFixed: 0,
    matchedEnrichmentRecords: 0,
    summariesFilled: 0,
    summariesNormalized: 0,
    tagsFilled: 0,
    tagsUpdated: 0,
    totalBooks: catalogue.length,
    updatedBooks: 0,
    yearsCorrected: 0,
    yearsFilled: 0,
  };

  const nextCatalogue = catalogue.map((book) => {
    const identity = getBookIdentity(book);
    const enrichedRow = enrichmentByIdentity.get(identity);
    const usableEnrichment =
      enrichedRow && !enrichedRow.error ? enrichedRow : null;

    if (usableEnrichment) {
      stats.matchedEnrichmentRecords += 1;
    }

    const classicYear =
      VERIFIED_CLASSIC_YEARS.get(getPairKey(book.title, book.author)) ?? null;
    const mergedBook = mergeEnrichedBook(book, usableEnrichment, classicYear);

    // Guarantee canonical identity fields never change
    if (
      mergedBook.title !== book.title ||
      mergedBook.author !== book.author ||
      mergedBook.shelf !== book.shelf ||
      mergedBook.position !== book.position
    ) {
      throw new Error(
        `Canonical identity mismatch detected for ${book.title} (${book.author})`,
      );
    }

    const hadSummary = Boolean(cleanSummary(book.summary));
    const wasBroken =
      hadSummary &&
      (isBrokenSummary(book.summary, book) ||
        isBrokenSummary(cleanSummary(book.summary), book));
    const hasNextSummary = Boolean(mergedBook.summary);

    let bookChanged = false;

    if (mergedBook.summary !== book.summary) {
      bookChanged = true;
      if (!hadSummary && hasNextSummary) {
        stats.summariesFilled += 1;
      } else if (wasBroken && hasNextSummary) {
        stats.brokenSummariesFixed += 1;
      } else if (wasBroken && !hasNextSummary) {
        stats.brokenSummariesCleared += 1;
      } else if (hasNextSummary) {
        stats.summariesNormalized += 1;
      }
    }

    if (mergedBook.publish_year !== book.publish_year) {
      bookChanged = true;
      if (book.publish_year == null && mergedBook.publish_year != null) {
        stats.yearsFilled += 1;
      } else {
        stats.yearsCorrected += 1;
      }
    }

    if (!arraysEqual(book.tags ?? [], mergedBook.tags)) {
      bookChanged = true;
      stats.tagsUpdated += 1;
      if ((book.tags?.length ?? 0) === 0 && mergedBook.tags.length > 0) {
        stats.tagsFilled += 1;
      }
    }

    if (bookChanged) {
      stats.updatedBooks += 1;
      return mergedBook;
    }

    return book;
  });

  return { nextCatalogue, stats };
}

async function run() {
  const { dryRun, inputPath } = parseArgs(process.argv.slice(2));
  const [catalogue, enrichment] = await Promise.all([
    readFile(CATALOGUE_PATH, "utf8").then(JSON.parse),
    readFile(inputPath, "utf8").then(JSON.parse),
  ]);

  const { nextCatalogue, stats } = applyCatalogueEnrichment(
    catalogue,
    enrichment,
  );

  if (!dryRun && stats.updatedBooks > 0) {
    await writeFile(
      CATALOGUE_PATH,
      `${JSON.stringify(nextCatalogue, null, 2)}\n`,
      "utf8",
    );
  }

  process.stdout.write(
    `${JSON.stringify({ dryRun, inputPath, ...stats }, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run().catch((error) => {
    console.error("Failed to apply catalogue enrichment:", error);
    process.exitCode = 1;
  });
}
