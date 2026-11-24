import { describe, expect, it } from "vitest";

import { normalizeCatalogueBook, type CatalogueBook } from "./catalogue";
import {
  buildAlephMeditationPool,
  buildQuoteTagList,
  CLASSIC_ALEPH_MEDITATIONS,
  filterQuotes,
  validateCreateQuoteInput,
  validateUpdateQuoteInput,
  type BookQuote,
} from "./commonplace";

function makeBook(overrides: Partial<CatalogueBook> & { id: string }): CatalogueBook {
  return normalizeCatalogueBook({
    title: "Collected Fictions",
    author: "Jorge Luis Borges",
    shelf: 1,
    position: "Vertical (1)",
    ...overrides,
  });
}

function makeQuote(overrides: Partial<BookQuote> & { id: string; book_id: string }): BookQuote {
  return {
    quote_text: "The universe (which others call the Library) is composed of an indefinite number of hexagonal galleries.",
    page_number: "112",
    chapter: "The Library of Babel",
    note: "Foundational epigraph.",
    tags: ["infinity", "labyrinth"],
    created_at: "2026-11-24T12:00:00.000Z",
    updated_at: "2026-11-24T12:00:00.000Z",
    ...overrides,
  };
}

describe("commonplace domain logic", () => {
  it("validates and normalizes quote creation input", () => {
    const valid = validateCreateQuoteInput({
      book_id: "  bk_borges  ",
      quote_text: "  Time forks perpetually toward innumerable futures.  ",
      page_number: " 127 ",
      chapter: "  The Garden of Forking Paths ",
      note: "  ",
      tags: "Time, Labyrinth, time,  Infinite  Spaces ",
    });

    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.data).toEqual({
        book_id: "bk_borges",
        quote_text: "Time forks perpetually toward innumerable futures.",
        page_number: "127",
        chapter: "The Garden of Forking Paths",
        note: null,
        tags: ["time", "labyrinth", "infinite spaces"],
      });
    }

    expect(validateCreateQuoteInput(null).ok).toBe(false);
    expect(validateCreateQuoteInput({ book_id: "", quote_text: "Hi" }).ok).toBe(false);
    expect(validateCreateQuoteInput({ book_id: "bk_1", quote_text: "   " }).ok).toBe(false);
    expect(
      validateCreateQuoteInput({
        book_id: "bk_1",
        quote_text: "x".repeat(3001),
      }).ok,
    ).toBe(false);
    expect(
      validateCreateQuoteInput({
        book_id: "bk_1",
        quote_text: "Valid",
        page_number: "p".repeat(41),
      }).ok,
    ).toBe(false);
    expect(
      validateCreateQuoteInput({
        book_id: "bk_1",
        quote_text: "Valid",
        tags: Array.from({ length: 13 }, (_, i) => `tag-${i}`),
      }).ok,
    ).toBe(false);
  });

  it("validates partial quote update input and rejects empty patches", () => {
    expect(validateUpdateQuoteInput({}).ok).toBe(false);
    expect(validateUpdateQuoteInput({ quote_text: "   " }).ok).toBe(false);

    const valid = validateUpdateQuoteInput({
      note: "Updated margin gloss.",
      tags: ["Memory", "memory"],
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.data).toEqual({
        note: "Updated margin gloss.",
        tags: ["memory"],
      });
    }
  });

  it("filters quotes by query (text, note, chapter, page, tags, book title/author), tag, and bookId", () => {
    const borges = makeBook({
      id: "bk_borges",
      title: "Collected Fictions",
      author: "Jorge Luis Borges",
    });
    const eco = makeBook({
      id: "bk_eco",
      title: "The Name of the Rose",
      author: "Umberto Eco",
    });
    const booksById = new Map([
      [borges.id, borges],
      [eco.id, eco],
    ]);

    const q1 = makeQuote({
      id: "qt_1",
      book_id: borges.id,
      quote_text: "Hexagonal galleries of the infinite library.",
      page_number: "112",
      chapter: "The Library of Babel",
      note: "Geometric motif",
      tags: ["infinity", "architecture"],
    });
    const q2 = makeQuote({
      id: "qt_2",
      book_id: eco.id,
      quote_text: "Books are not made to be believed, but to be subjected to inquiry.",
      page_number: "316",
      chapter: "Fourth Day",
      note: "William of Baskerville on critical reading",
      tags: ["semiotics", "inquiry"],
    });

    expect(filterQuotes([q1, q2], booksById, { query: "Umberto Eco" })).toEqual([q2]);
    expect(filterQuotes([q1, q2], booksById, { query: "Baskerville" })).toEqual([q2]);
    expect(filterQuotes([q1, q2], booksById, { query: "112" })).toEqual([q1]);
    expect(filterQuotes([q1, q2], booksById, { tag: "ARCHITECTURE" })).toEqual([q1]);
    expect(filterQuotes([q1, q2], booksById, { bookId: eco.id })).toEqual([q2]);
    expect(
      filterQuotes([q1, q2], booksById, { query: "borges inquiry" }),
    ).toEqual([]);
  });

  it("builds quote tag lists sorted by descending frequency then alphabetically", () => {
    const quotes = [
      makeQuote({ id: "qt_1", book_id: "bk_1", tags: ["memory", "time"] }),
      makeQuote({ id: "qt_2", book_id: "bk_1", tags: ["labyrinth", "time"] }),
      makeQuote({ id: "qt_3", book_id: "bk_1", tags: ["aesthetics", "memory"] }),
    ];

    expect(buildQuoteTagList(quotes)).toEqual([
      "memory",
      "time",
      "aesthetics",
      "labyrinth",
    ]);
  });

  it("builds Aleph meditation pool starting with the 3 classic Borges meditations followed by saved quotes", () => {
    const borges = makeBook({
      id: "bk_borges",
      title: "Collected Fictions",
      author: "Jorge Luis Borges",
    });
    const booksById = new Map([[borges.id, borges]]);

    const quotes = [
      makeQuote({
        id: "qt_1",
        book_id: borges.id,
        quote_text: "I have always imagined that Paradise will be a kind of library.",
        page_number: "42",
      }),
      makeQuote({
        id: "qt_2",
        book_id: borges.id,
        quote_text: "Mirrors and copulation are abominable.",
        page_number: null,
      }),
    ];

    const pool = buildAlephMeditationPool(quotes, booksById);
    expect(pool).toHaveLength(CLASSIC_ALEPH_MEDITATIONS.length + 2);
    expect(pool.slice(0, 3).every((m) => !m.isUserQuote)).toBe(true);
    expect(pool[0].sourceLabel).toBe(
      "Jorge Luis Borges · The Aleph / Library of Babel",
    );

    expect(pool[3]).toEqual({
      text: "I have always imagined that Paradise will be a kind of library.",
      sourceLabel: "Collected Fictions · Jorge Luis Borges · p. 42",
      bookId: "bk_borges",
      isUserQuote: true,
    });
    expect(pool[4]).toEqual({
      text: "Mirrors and copulation are abominable.",
      sourceLabel: "Collected Fictions · Jorge Luis Borges",
      bookId: "bk_borges",
      isUserQuote: true,
    });
  });
});
