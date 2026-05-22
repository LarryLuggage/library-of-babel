import { readFile, writeFile } from "node:fs/promises";

const CATALOGUE_PATH = new URL("../shelf_catalog_full.json", import.meta.url);
const REPORT_PATH =
  process.argv[2] ?? "/private/tmp/library-of-babel-division-report.json";

function getIdentity(row) {
  return [row.author, row.title, row.shelf, row.position].join("\u0000");
}

const [catalogue, report] = await Promise.all([
  readFile(CATALOGUE_PATH, "utf8").then(JSON.parse),
  readFile(REPORT_PATH, "utf8").then(JSON.parse),
]);

const divisionsByIdentity = new Map(
  report.map((row) => [getIdentity(row), row.classification.division]),
);

let updated = 0;
const nextCatalogue = catalogue.map((book) => {
  if (book.top_category) {
    return book;
  }

  const division = divisionsByIdentity.get(getIdentity(book));

  if (!division) {
    throw new Error(`Missing division for ${book.author} - ${book.title}.`);
  }

  updated += 1;

  return {
    ...book,
    top_category: division,
  };
});

await writeFile(CATALOGUE_PATH, `${JSON.stringify(nextCatalogue, null, 2)}\n`);
process.stdout.write(`Updated ${updated} catalogue rows.\n`);
