import { readFile, writeFile } from "node:fs/promises";

const CATALOGUE_PATH = new URL("../shelf_catalog_full.json", import.meta.url);

const SHELF_26_DUPLICATES = new Set([
  "All Will Have Vengeance\u0000Various",
  "The Return of the King\u0000J.R.R. Tolkien",
  "Society of the Spectacle\u0000Guy Debord",
  "The Norton Anthology of English Literature (Vol. B)\u0000Greenblatt (Editor)",
  "American Democratic Socialism\u0000Gary Dorrien",
  "Aesthetic Theory\u0000Theodor W. Adorno",
  "The Rise and Fall of Communism\u0000Archie Brown",
]);

const TITLE_CORRECTIONS = new Map([
  ["El Señor Presidente (title to confirm)", "El Señor Presidente"],
]);

const VERIFIED_PUBLISH_YEARS = new Map([
  ["Song of Solomon\u0000Toni Morrison", 1977],
  ["The Possessed\u0000Fyodor Dostoevsky", 1872],
  ["Tess of the d'Urbervilles\u0000Thomas Hardy", 1891],
  ["An American Tragedy\u0000Theodore Dreiser", 1925],
  ["A Plan for Escape\u0000Adolfo Bioy Casares", 1945],
  ["My Brilliant Friend\u0000Elena Ferrante", 2011],
  ["The Man of Feeling\u0000Javier Marías", 1986],
]);

const NOISE_TAGS = new Set([
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

function getPairKey(title, author) {
  return `${title}\u0000${author}`;
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) {
    return { tags: [], removedOrDeduped: 0 };
  }

  const seen = new Set();
  const cleaned = [];
  let removedOrDeduped = 0;

  for (const rawTag of tags) {
    const tag = String(rawTag ?? "").trim();
    const normalized = tag.toLocaleLowerCase("en-US");

    if (!tag || NOISE_TAGS.has(normalized) || seen.has(normalized)) {
      removedOrDeduped += 1;
      continue;
    }

    seen.add(normalized);
    cleaned.push(tag);
  }

  if (
    removedOrDeduped === 0 &&
    cleaned.length === tags.length &&
    cleaned.every((tag, index) => tag === tags[index])
  ) {
    return { tags, removedOrDeduped: 0 };
  }

  return { tags: cleaned, removedOrDeduped };
}

async function main() {
  const rawJson = await readFile(CATALOGUE_PATH, "utf8");
  const books = JSON.parse(rawJson);

  let removedDuplicates = 0;
  let cleanedTitles = 0;
  let fixedPublishYears = 0;
  let removedTags = 0;
  let booksWithUpdatedTags = 0;

  const cleanedBooks = [];

  for (const book of books) {
    if (
      book.shelf === 26 &&
      SHELF_26_DUPLICATES.has(getPairKey(book.title, book.author))
    ) {
      removedDuplicates += 1;
      continue;
    }

    let nextBook = book;

    const correctedTitle = TITLE_CORRECTIONS.get(book.title);
    if (correctedTitle && correctedTitle !== book.title) {
      nextBook = { ...nextBook, title: correctedTitle };
      cleanedTitles += 1;
    }

    const verifiedYear = VERIFIED_PUBLISH_YEARS.get(
      getPairKey(nextBook.title, nextBook.author),
    );
    if (
      verifiedYear !== undefined &&
      nextBook.publish_year !== verifiedYear
    ) {
      nextBook = { ...nextBook, publish_year: verifiedYear };
      fixedPublishYears += 1;
    }

    const { tags: nextTags, removedOrDeduped } = cleanTags(nextBook.tags);
    if (nextTags !== nextBook.tags) {
      nextBook = { ...nextBook, tags: nextTags };
      booksWithUpdatedTags += 1;
      removedTags += removedOrDeduped;
    }

    cleanedBooks.push(nextBook);
  }

  const totalChanges =
    removedDuplicates + cleanedTitles + fixedPublishYears + booksWithUpdatedTags;

  if (totalChanges > 0) {
    const serialized = `${JSON.stringify(cleanedBooks, null, 2)}\n`;
    await writeFile(CATALOGUE_PATH, serialized, "utf8");
  }

  process.stdout.write(
    [
      `Catalogue total: ${cleanedBooks.length}`,
      `Removed Shelf 26 duplicates: ${removedDuplicates}`,
      `Cleaned titles: ${cleanedTitles}`,
      `Fixed publish years: ${fixedPublishYears}`,
      `Updated tag arrays: ${booksWithUpdatedTags} (${removedTags} tags removed/deduped)`,
      `Total changes: ${totalChanges}`,
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  console.error("Failed to clean catalogue data:", error);
  process.exitCode = 1;
});
