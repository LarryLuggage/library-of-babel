import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  cleanSummary,
  getBookIdentity,
  getPairKey,
  isBrokenSummary,
  mergeTags,
  resolvePublishYear,
} from "./lib/enrichment-helpers.mjs";
import { VERIFIED_CLASSIC_YEARS } from "./lib/classic-years.mjs";

const CATALOGUE_PATH = new URL("../shelf_catalog_full.json", import.meta.url);

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
 * Idempotently cleans summaries, strips broken summary garbage, applies verified classic
 * publication years, and normalizes tags without mutating `title`, `author`, `shelf`, or `position`.
 */
export function cleanCatalogueBooks(books) {
  const stats = {
    cleanedSummaries: 0,
    fixedPublishYears: 0,
    strippedBrokenSummaries: 0,
    tagsRemovedOrNormalized: 0,
    totalBooks: books.length,
    totalChanges: 0,
    updatedTagArrays: 0,
  };

  const cleanedBooks = books.map((book) => {
    let nextBook = book;
    let bookChanged = false;

    const classicYear =
      VERIFIED_CLASSIC_YEARS.get(getPairKey(book.title, book.author)) ?? null;
    const resolvedYear = resolvePublishYear({
      classicYear,
      existingYear: book.publish_year ?? null,
    });

    if (resolvedYear !== (book.publish_year ?? null)) {
      nextBook = { ...nextBook, publish_year: resolvedYear };
      stats.fixedPublishYears += 1;
      bookChanged = true;
    }

    if (book.summary !== null && book.summary !== undefined) {
      const cleaned = cleanSummary(book.summary);
      const nextSummary =
        cleaned && !isBrokenSummary(cleaned, book) ? cleaned : null;

      if (nextSummary !== book.summary) {
        nextBook = { ...nextBook, summary: nextSummary };
        if (nextSummary === null) {
          stats.strippedBrokenSummaries += 1;
        } else {
          stats.cleanedSummaries += 1;
        }
        bookChanged = true;
      }
    }

    const currentTags = Array.isArray(book.tags) ? book.tags : [];
    const nextTags = mergeTags(currentTags, [], book);
    if (!arraysEqual(currentTags, nextTags)) {
      nextBook = { ...nextBook, tags: nextTags };
      stats.updatedTagArrays += 1;
      stats.tagsRemovedOrNormalized += Math.max(
        0,
        currentTags.length - nextTags.length,
      );
      bookChanged = true;
    }

    // Guarantee book_key / identifying-field invariance
    if (
      nextBook.title !== book.title ||
      nextBook.author !== book.author ||
      nextBook.shelf !== book.shelf ||
      nextBook.position !== book.position ||
      getBookIdentity(nextBook) !== getBookIdentity(book)
    ) {
      throw new Error(
        `Identifying field mutation detected during clean for ${book.title}`,
      );
    }

    if (bookChanged) {
      stats.totalChanges += 1;
    }

    return nextBook;
  });

  return { cleanedBooks, stats };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rawJson = await readFile(CATALOGUE_PATH, "utf8");
  const books = JSON.parse(rawJson);

  const { cleanedBooks, stats } = cleanCatalogueBooks(books);

  if (!dryRun && stats.totalChanges > 0) {
    const serialized = `${JSON.stringify(cleanedBooks, null, 2)}\n`;
    await writeFile(CATALOGUE_PATH, serialized, "utf8");
  }

  process.stdout.write(
    [
      `Catalogue total: ${stats.totalBooks}`,
      `Fixed publish years: ${stats.fixedPublishYears}`,
      `Cleaned summaries: ${stats.cleanedSummaries}`,
      `Stripped broken summaries: ${stats.strippedBrokenSummaries}`,
      `Updated tag arrays: ${stats.updatedTagArrays} (${stats.tagsRemovedOrNormalized} tags removed/deduped)`,
      `Total books modified: ${stats.totalChanges}`,
      dryRun ? "(dry-run: no file written)" : "",
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error("Failed to clean catalogue data:", error);
    process.exitCode = 1;
  });
}
