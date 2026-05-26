import { readFile, writeFile } from "node:fs/promises";

const CATALOGUE_PATH = new URL("../shelf_catalog_full.json", import.meta.url);
const ENRICHMENT_PATH =
  process.argv[2] ?? "/private/tmp/library-of-babel-book-enrichment.json";

function getIdentity(row) {
  return [row.author, row.title, row.shelf, row.position].join("\u0000");
}

const [catalogue, enrichment] = await Promise.all([
  readFile(CATALOGUE_PATH, "utf8").then(JSON.parse),
  readFile(ENRICHMENT_PATH, "utf8").then(JSON.parse),
]);

const enrichmentByIdentity = new Map(
  enrichment.map((row) => [getIdentity(row), row]),
);

let updated = 0;
const nextCatalogue = catalogue.map((book) => {
  const enrichedBook = enrichmentByIdentity.get(getIdentity(book));

  if (!enrichedBook || enrichedBook.error) {
    return book;
  }

  updated += 1;

  return {
    ...book,
    summary: enrichedBook.summary,
    tags: enrichedBook.tags,
  };
});

await writeFile(CATALOGUE_PATH, `${JSON.stringify(nextCatalogue, null, 2)}\n`);
process.stdout.write(`Applied enrichment to ${updated} catalogue rows.\n`);
