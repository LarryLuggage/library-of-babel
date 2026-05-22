import { writeFile } from "node:fs/promises";
import catalogue from "../shelf_catalog_full.json" with { type: "json" };

const OUTPUT_PATH =
  process.argv[2] ?? "/private/tmp/library-of-babel-open-library-subjects.json";
const SEARCH_FIELDS = [
  "key",
  "title",
  "author_name",
  "subject",
  "first_publish_year",
].join(",");

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getSearchAuthor(author) {
  return author
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\/.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleScore(book, result) {
  const expected = normalize(book.title);
  const actual = normalize(result.title ?? "");

  if (actual === expected) {
    return 3;
  }

  if (actual.includes(expected) || expected.includes(actual)) {
    return 2;
  }

  return 0;
}

function authorScore(book, result) {
  const expected = normalize(getSearchAuthor(book.author));
  const authors = (result.author_name ?? []).map(normalize);

  if (authors.some((author) => author === expected)) {
    return 3;
  }

  if (
    authors.some((author) => author.includes(expected) || expected.includes(author))
  ) {
    return 2;
  }

  return 0;
}

function rankResult(book, first, second) {
  return (
    titleScore(book, second) - titleScore(book, first) ||
    authorScore(book, second) - authorScore(book, first) ||
    (second.subject?.length ?? 0) - (first.subject?.length ?? 0)
  );
}

async function searchBook(book, includeAuthor) {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("title", book.title);
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", SEARCH_FIELDS);

  if (includeAuthor) {
    url.searchParams.set("author", getSearchAuthor(book.author));
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Open Library returned ${response.status} for ${url}.`);
  }

  return response.json();
}

async function getBestMatch(book) {
  const authorSearch = await searchBook(book, true);
  const titleSearch =
    authorSearch.docs.length > 0 ? authorSearch : await searchBook(book, false);
  const docs = [...titleSearch.docs].sort((first, second) =>
    rankResult(book, first, second),
  );
  const match = docs[0];

  if (!match) {
    return null;
  }

  return {
    author_name: match.author_name ?? [],
    first_publish_year: match.first_publish_year ?? null,
    key: match.key ?? null,
    subject: match.subject ?? [],
    title: match.title ?? null,
  };
}

const uncategorized = catalogue.filter((book) => !book.top_category);
const matches = [];

for (const [index, book] of uncategorized.entries()) {
  const match = await getBestMatch(book);

  matches.push({
    author: book.author,
    edition: book.edition,
    match,
    position: book.position,
    shelf: book.shelf,
    title: book.title,
  });

  process.stdout.write(
    `${String(index + 1).padStart(3, "0")}/${uncategorized.length} ${
      match ? "matched" : "missing"
    } ${book.title}\n`,
  );
  await wait(90);
}

await writeFile(OUTPUT_PATH, `${JSON.stringify(matches, null, 2)}\n`);
process.stdout.write(`Saved ${matches.length} rows to ${OUTPUT_PATH}\n`);
