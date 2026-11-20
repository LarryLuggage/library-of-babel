import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseBookSeedPayload, SeedPayloadError } from "./seed";

describe("parseBookSeedPayload", () => {
  it("preserves separate physical copies and deduplicates identical copy identities", () => {
    const payload = [
      {
        title: "The Great Critics",
        author: "Smith and Parks",
        edition: "W.W. Norton",
        shelf: 21,
        position: "Vertical (16)",
        top_category: "Literature",
        sub_category: "Literary Criticism",
        tags: ["literary criticism", "literature"],
        publish_year: 1951,
      },
      {
        title: "The Great Critics",
        author: "Smith and Parks",
        edition: "W.W. Norton",
        shelf: 40,
        position: "Top Stack Center (Horiz. 7)",
        top_category: "Literature",
        sub_category: "Literary Criticism",
        tags: ["literary criticism"],
        publish_year: 1951,
      },
      {
        title: "The Selected Works of Cesare Pavese",
        author: "Cesare Pavese",
        shelf: 35,
        position: "Vertical (12)",
      },
      {
        title: "The Selected Works of Cesare Pavese",
        author: "Cesare Pavese",
        shelf: 38,
        position: "Top Stack Right (Horiz. 4)",
      },
      // True duplicate of the shelf 35 copy
      {
        title: "The Selected Works of Cesare Pavese",
        author: "Cesare Pavese",
        shelf: 35,
        position: "Vertical (12)",
      },
    ];

    const parsed = parseBookSeedPayload(payload);

    expect(parsed.received).toBe(5);
    expect(parsed.rejected).toBe(0);
    expect(parsed.duplicatesRemoved).toBe(1);
    expect(parsed.books).toHaveLength(4);
    expect(new Set(parsed.books.map((book) => book.book_key)).size).toBe(4);
  });

  it("preserves extended tracker and bibliographic fields", () => {
    const parsed = parseBookSeedPayload({
      books: [
        {
          title: "Collected Fictions",
          author: "Jorge Luis Borges",
          edition: "Penguin Classics",
          shelf: 3,
          position: "Vertical (4)",
          top_category: "Literature",
          sub_category: "Latin American Literature",
          summary: "Complete short fiction of Jorge Luis Borges.",
          tags: ["labyrinths", "argentine fiction", "literature"],
          publish_year: 1998,
          reading_status: "finished",
          rating: 5,
          date_started: "2026-01-01",
          date_finished: "2026-02-01",
          personal_notes: "Essential volume.",
          loaned_to: "M. Scott",
        },
      ],
    });

    expect(parsed.rejected).toBe(0);
    expect(parsed.books).toHaveLength(1);
    const book = parsed.books[0];

    expect(book.book_key).toMatch(/^bk_[0-9a-f]{16}_collected-fictions$/);
    expect(book.category).toBe("Latin American Literature");
    expect(book.top_category).toBe("Literature");
    expect(book.sub_category).toBe("Latin American Literature");
    expect(book.position).toBe("Vertical (4)");
    expect(book.summary).toBe("Complete short fiction of Jorge Luis Borges.");
    expect(book.tags).toEqual(["labyrinths", "argentine fiction"]);
    expect(book.publish_year).toBe(1998);
    expect(book.reading_status).toBe("finished");
    expect(book.rating).toBe(5);
    expect(book.date_started).toBe("2026-01-01");
    expect(book.date_finished).toBe("2026-02-01");
    expect(book.personal_notes).toBe("Essential volume.");
    expect(book.loaned_to).toBe("M. Scott");
  });

  it("rejects malformed rows and invalid top-level payloads", () => {
    expect(() => parseBookSeedPayload("not-an-array")).toThrow(
      SeedPayloadError,
    );

    const parsed = parseBookSeedPayload([
      "not-an-object",
      { title: "   ", author: "Author" },
      { title: "Valid", author: "Author", shelf: -2 },
      { title: "Bad Year", author: "Author", publish_year: 9999 },
      { title: "Bad Tags", author: "Author", tags: "not-an-array" },
      { title: "Bad Status", author: "Author", reading_status: "paused" },
      { title: "Bad Rating", author: "Author", rating: 6 },
      { title: "Bad Date", author: "Author", date_started: "2026-02-30" },
      { title: "Bad Color", author: "Author", spine_color: "red" },
      { title: "Good Book", author: "Good Author", shelf: 5 },
    ]);

    expect(parsed.received).toBe(10);
    expect(parsed.rejected).toBe(9);
    expect(parsed.books).toHaveLength(1);
    expect(parsed.books[0].title).toBe("Good Book");
  });

  it("parses the entire cleaned shelf_catalog_full.json with zero errors", () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "shelf_catalog_full.json"),
        "utf8",
      ),
    ) as unknown[];

    const parsed = parseBookSeedPayload(raw);

    expect(parsed.received).toBe(880);
    expect(parsed.rejected).toBe(0);
    expect(parsed.duplicatesRemoved).toBe(0);
    expect(parsed.books).toHaveLength(880);
    expect(new Set(parsed.books.map((book) => book.book_key)).size).toBe(880);
  });
});
