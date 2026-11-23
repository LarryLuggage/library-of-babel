import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { type CatalogueBook, normalizeCatalogueBook } from "./catalogue";
import {
  computeCatalogueStats,
  serializeBooksToCsv,
  serializeBooksToJson,
} from "./stats";

function makeBook(overrides: Partial<CatalogueBook> = {}): CatalogueBook {
  return normalizeCatalogueBook({
    author: "Author Name",
    title: "Book Title",
    edition: "Penguin",
    shelf: 1,
    position: "Vertical (1)",
    top_category: "Literature",
    sub_category: null,
    summary: null,
    tags: [],
    publish_year: 1990,
    reading_status: "unread",
    rating: null,
    date_started: null,
    date_finished: null,
    personal_notes: null,
    loaned_to: null,
    ...overrides,
  });
}

describe("computeCatalogueStats", () => {
  it("handles an empty corpus safely", () => {
    const stats = computeCatalogueStats([]);

    expect(stats.totalBooks).toBe(0);
    expect(stats.statusCounts).toEqual({
      unread: 0,
      reading: 0,
      finished: 0,
      dnf: 0,
    });
    expect(stats.completionPercent).toBe(0);
    expect(stats.loanedCount).toBe(0);
    expect(stats.loanedBooks).toEqual([]);
    expect(stats.ratedCount).toBe(0);
    expect(stats.averageRating).toBeNull();
    expect(stats.ratingHistogram).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(stats.finishedByYear).toEqual([]);
    expect(stats.divisionBreakdown).toEqual([]);
    expect(stats.decadeBreakdown).toEqual([]);
    expect(stats.topAuthors).toEqual([]);
  });

  it("computes completion %, ratings, loans, years, divisions, decades, and top authors", () => {
    const books: CatalogueBook[] = [
      makeBook({
        title: "Ficciones",
        author: "Jorge Luis Borges",
        top_category: "Literature",
        publish_year: 1944,
        reading_status: "finished",
        rating: 5,
        date_finished: "2026-04-10",
      }),
      makeBook({
        title: "Labyrinths",
        author: "Jorge Luis Borges",
        top_category: "Literature",
        publish_year: 1962,
        reading_status: "reading",
        rating: 4,
        loaned_to: "Elena",
      }),
      makeBook({
        title: "Aesthetic Theory",
        author: "Theodor W. Adorno",
        top_category: "Philosophy & Theory",
        publish_year: 1970,
        reading_status: "dnf",
        rating: 4,
      }),
      makeBook({
        title: "Anthology 1",
        author: "Various",
        top_category: "History & Reference",
        publish_year: null,
        reading_status: "unread",
      }),
      makeBook({
        title: "Anthology 2",
        author: "Various",
        top_category: "History & Reference",
        publish_year: 1948,
        reading_status: "unread",
      }),
      makeBook({
        title: "Book 6",
        author: "Author Six",
        top_category: "Literature",
        publish_year: 2012,
        reading_status: "unread",
      }),
      makeBook({
        title: "Book 7",
        author: "Author Seven",
        top_category: "Literature",
        publish_year: 2015,
        reading_status: "unread",
      }),
      makeBook({
        title: "Book 8",
        author: "Author Eight",
        top_category: null,
        publish_year: null,
        reading_status: "unread",
        loaned_to: "Marco",
      }),
    ];

    const stats = computeCatalogueStats(books);

    expect(stats.totalBooks).toBe(8);
    expect(stats.statusCounts).toEqual({
      unread: 5,
      reading: 1,
      finished: 1,
      dnf: 1,
    });
    expect(stats.completionPercent).toBe(12.5);
    expect(stats.loanedCount).toBe(2);
    expect(stats.loanedBooks.map((b) => b.title)).toEqual([
      "Labyrinths",
      "Book 8",
    ]);
    expect(stats.ratedCount).toBe(3);
    expect(stats.averageRating).toBe(4.3);
    expect(stats.ratingHistogram).toEqual({
      1: 0,
      2: 0,
      3: 0,
      4: 2,
      5: 1,
    });
    expect(stats.finishedByYear).toEqual([{ year: 2026, count: 1 }]);
    expect(stats.divisionBreakdown).toEqual([
      {
        name: "Literature",
        total: 4,
        finished: 1,
        reading: 1,
        unread: 2,
        dnf: 0,
      },
      {
        name: "History & Reference",
        total: 2,
        finished: 0,
        reading: 0,
        unread: 2,
        dnf: 0,
      },
      {
        name: "Philosophy & Theory",
        total: 1,
        finished: 0,
        reading: 0,
        unread: 0,
        dnf: 1,
      },
      {
        name: "Unclassified",
        total: 1,
        finished: 0,
        reading: 0,
        unread: 1,
        dnf: 0,
      },
    ]);
    expect(stats.decadeBreakdown).toEqual([
      { decade: "1940s", count: 2 },
      { decade: "1960s", count: 1 },
      { decade: "1970s", count: 1 },
      { decade: "2010s", count: 2 },
      { decade: "Undated", count: 2 },
    ]);
    expect(stats.topAuthors.some((a) => a.author === "Various")).toBe(false);
    expect(stats.topAuthors[0]).toEqual({
      author: "Jorge Luis Borges",
      count: 2,
      finished: 1,
    });
  });

  it("groups and sorts Antiquity (BCE), Medieval & Early CE, modern decades, and Undated chronologically", () => {
    const books: CatalogueBook[] = [
      makeBook({ title: "Undated Volume", publish_year: null }),
      makeBook({ title: "Infinite Jest", publish_year: 1996 }),
      makeBook({ title: "Don Quixote", publish_year: 1605 }),
      makeBook({ title: "Inferno", publish_year: 1320 }),
      makeBook({ title: "Confessions", publish_year: 397 }),
      makeBook({ title: "The Republic", publish_year: -375 }),
      makeBook({ title: "The Odyssey", publish_year: -750 }),
    ];

    const stats = computeCatalogueStats(books);

    expect(stats.totalBooks).toBe(7);
    expect(stats.decadeBreakdown).toEqual([
      { decade: "Antiquity (BCE)", count: 2 },
      { decade: "Medieval & Early CE", count: 2 },
      { decade: "1600s", count: 1 },
      { decade: "1990s", count: 1 },
      { decade: "Undated", count: 1 },
    ]);
    expect(
      stats.decadeBreakdown.reduce((sum, entry) => sum + entry.count, 0),
    ).toBe(stats.totalBooks);
  });

  it("summarizes the full 880-book catalogue cleanly", () => {
    const raw = readFileSync(
      path.join(process.cwd(), "shelf_catalog_full.json"),
      "utf8",
    );
    const books = (JSON.parse(raw) as Record<string, unknown>[]).map((row) =>
      normalizeCatalogueBook(row),
    );
    const stats = computeCatalogueStats(books);

    expect(stats.totalBooks).toBe(880);
    expect(
      stats.divisionBreakdown.reduce((sum, entry) => sum + entry.total, 0),
    ).toBe(880);
    expect(stats.topAuthors).toHaveLength(10);
    expect(stats.topAuthors.some((a) => a.author === "Various")).toBe(false);
    expect(stats.decadeBreakdown[stats.decadeBreakdown.length - 1].decade).toBe(
      "Undated",
    );
  });
});

describe("export serializers", () => {
  it("serializes books to valid JSON", () => {
    const book = makeBook({
      title: "The Aleph",
      author: "Jorge Luis Borges",
      tags: ["infinity", "short stories"],
    });
    const parsed = JSON.parse(serializeBooksToJson([book])) as CatalogueBook[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("The Aleph");
    expect(parsed[0].tags).toEqual(["infinity", "short stories"]);
  });

  it("escapes CSV cells per RFC-4180 and neutralizes formula injection prefixes", () => {
    const books: CatalogueBook[] = [
      {
        ...makeBook({
          id: "bk_1",
          title: '=CMD("calc")',
          author: "+Author, Jr.",
          edition: '-Edition "Special"',
          loaned_to: "@attacker",
          tags: ["tag1", "tag2"],
        }),
        summary: "\tLine 1\nLine 2",
        personal_notes: "\r=1+1",
      },
    ];

    const csv = serializeBooksToCsv(books);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "id,title,author,edition,shelf,position,top_category,sub_category,publish_year,reading_status,rating,date_started,date_finished,loaned_to,tags,summary,personal_notes",
    );
    expect(csv).toContain("'=CMD(\"\"calc\"\")");
    expect(csv).toContain('"\'+Author, Jr."');
    expect(csv).toContain('"\'-Edition ""Special"""');
    expect(csv).toContain("'@attacker");
    expect(csv).toContain('"\'\tLine 1\nLine 2"');
    expect(csv).toContain('"\'\r=1+1"');
    expect(csv).toContain('"tag1, tag2"');
  });
});
