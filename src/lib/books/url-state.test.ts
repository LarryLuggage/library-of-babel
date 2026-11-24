import { describe, expect, it } from "vitest";

import { getBookKey, type CatalogueBook } from "./catalogue";
import type { ReadingList } from "./lists";
import {
  buildDynamicPageDescription,
  buildDynamicPageTitle,
  buildShareUrl,
  DEFAULT_CATALOGUE_URL_STATE,
  parseCatalogueSearchParams,
  serializeCatalogueUrlState,
} from "./url-state";

function makeBook(
  overrides: Partial<CatalogueBook> & Pick<CatalogueBook, "id" | "title" | "author">,
): CatalogueBook {
  return {
    edition: "",
    shelf: 1,
    position: "Standing",
    top_category: "Literature",
    sub_category: null,
    summary: null,
    tags: [],
    publish_year: 1944,
    reading_status: "unread",
    rating: null,
    date_started: null,
    date_finished: null,
    personal_notes: null,
    loaned_to: null,
    ...overrides,
  };
}

function makeList(
  overrides: Partial<ReadingList> & Pick<ReadingList, "id" | "slug" | "name">,
): ReadingList {
  return {
    description: null,
    is_queue: false,
    created_at: "2026-11-24T12:00:00.000Z",
    updated_at: "2026-11-24T12:00:00.000Z",
    items: [],
    ...overrides,
  };
}

describe("catalogue URL state", () => {
  describe("parseCatalogueSearchParams", () => {
    it("returns default state for null, undefined, or empty inputs", () => {
      expect(parseCatalogueSearchParams(null)).toEqual(
        DEFAULT_CATALOGUE_URL_STATE,
      );
      expect(parseCatalogueSearchParams(undefined)).toEqual(
        DEFAULT_CATALOGUE_URL_STATE,
      );
      expect(parseCatalogueSearchParams(new URLSearchParams())).toEqual(
        DEFAULT_CATALOGUE_URL_STATE,
      );
      expect(parseCatalogueSearchParams({})).toEqual(
        DEFAULT_CATALOGUE_URL_STATE,
      );
    });

    it("parses valid parameters from URLSearchParams", () => {
      const params = new URLSearchParams(
        "view=shelves&book=bk_123_ficciones&q=labyrinth&division=Literature&tag=metafiction&shelf=12&status=finished&triage=missing_year&author=b",
      );

      expect(parseCatalogueSearchParams(params)).toEqual({
        view: "shelves",
        book: "bk_123_ficciones",
        list: null,
        q: "labyrinth",
        division: "Literature",
        tag: "metafiction",
        shelf: "12",
        status: "finished",
        triage: "missing_year",
        author: "B",
      });
    });

    it("parses Next.js searchParams record including string arrays", () => {
      const state = parseCatalogueSearchParams({
        view: ["timeline", "ledger"],
        book: "  bk_42  ",
        shelf: "0",
        status: "loaned",
        triage: "duplicates",
        author: "#",
        q: "  borges  ",
      });

      expect(state).toEqual({
        view: "timeline",
        book: "bk_42",
        list: null,
        q: "borges",
        division: "",
        tag: "",
        shelf: "0",
        status: "loaned",
        triage: "duplicates",
        author: "#",
      });
    });

    it("defaults view to lists when list param is present and view is missing or invalid", () => {
      expect(
        parseCatalogueSearchParams(new URLSearchParams("list=up-next")),
      ).toMatchObject({
        view: "lists",
        list: "up-next",
      });

      expect(
        parseCatalogueSearchParams({
          view: "not-a-view",
          list: "winter-syllabus",
        }),
      ).toMatchObject({
        view: "lists",
        list: "winter-syllabus",
      });
    });

    it("falls back safely on invalid enums, negative shelves, and oversized identifiers", () => {
      const state = parseCatalogueSearchParams({
        view: "invalid",
        book: "a".repeat(161),
        list: "b".repeat(121),
        q: "c".repeat(250),
        division: "d".repeat(140),
        tag: "e".repeat(140),
        shelf: "-5",
        status: "borrowed",
        triage: "broken",
        author: "AB",
      });

      expect(state).toEqual({
        view: "ledger",
        book: null,
        list: null,
        q: "c".repeat(200),
        division: "d".repeat(120),
        tag: "e".repeat(120),
        shelf: "",
        status: "",
        triage: "",
        author: "",
      });
    });
  });

  describe("serializeCatalogueUrlState & buildShareUrl", () => {
    it("returns empty string for default state and omits ledger view or non-lists list param", () => {
      expect(serializeCatalogueUrlState({})).toBe("");
      expect(serializeCatalogueUrlState(DEFAULT_CATALOGUE_URL_STATE)).toBe("");
      expect(
        serializeCatalogueUrlState({ view: "ledger", list: "up-next" }),
      ).toBe("");
    });

    it("roundtrips non-default state deterministically", () => {
      const input = {
        view: "lists" as const,
        book: "bk_ficciones",
        list: "up-next",
        q: "mirrors",
        division: "Philosophy",
        tag: "time",
        shelf: "7",
        status: "reading" as const,
        triage: "missing_summary" as const,
        author: "B",
      };

      const serialized = serializeCatalogueUrlState(input);
      expect(serialized).toBe(
        "?view=lists&book=bk_ficciones&list=up-next&q=mirrors&division=Philosophy&tag=time&shelf=7&status=reading&triage=missing_summary&author=B",
      );

      const parsed = parseCatalogueSearchParams(
        new URLSearchParams(serialized),
      );
      expect(parsed).toEqual(input);
    });

    it("builds absolute share URLs cleanly", () => {
      expect(
        buildShareUrl("https://babel.example.com/", "/", {
          book: "bk_aleph",
        }),
      ).toBe("https://babel.example.com/?book=bk_aleph");

      expect(
        buildShareUrl("https://babel.example.com", "", {
          view: "commonplace",
        }),
      ).toBe("https://babel.example.com/?view=commonplace");

      expect(buildShareUrl("https://babel.example.com", "/", {})).toBe(
        "https://babel.example.com/",
      );
    });
  });

  describe("buildDynamicPageTitle & buildDynamicPageDescription", () => {
    const ficciones = makeBook({
      id: "bk_ficciones",
      title: "Ficciones",
      author: "Jorge Luis Borges",
      shelf: 4,
      position: "Standing",
      top_category: "World Literature",
      summary:
        "A landmark collection of metaphysical short stories exploring labyrinths, mirrors, and infinite libraries.",
    });

    const untitledSummaryBook = makeBook({
      id: "bk_aleph",
      title: "The Aleph",
      author: "Jorge Luis Borges",
      shelf: 4,
      position: "Left Stack",
      top_category: "World Literature",
      summary: null,
    });

    const upNext = makeList({
      id: "list_1",
      slug: "up-next",
      name: "Up Next",
      description: "Autumn evening reads.",
      is_queue: true,
      items: [
        {
          id: "item_1",
          list_id: "list_1",
          book_id: "bk_ficciones",
          position: 0,
          note: null,
          added_at: "2026-11-24T12:00:00.000Z",
        },
        {
          id: "item_2",
          list_id: "list_1",
          book_id: "bk_aleph",
          position: 1,
          note: null,
          added_at: "2026-11-24T12:00:00.000Z",
        },
      ],
    });

    const stoics = makeList({
      id: "list_2",
      slug: "stoics",
      name: "Stoic Canon",
      description: null,
      items: [
        {
          id: "item_3",
          list_id: "list_2",
          book_id: "bk_ficciones",
          position: 0,
          note: null,
          added_at: "2026-11-24T12:00:00.000Z",
        },
      ],
    });

    const books = [ficciones, untitledSummaryBook];
    const lists = [upNext, stoics];

    it("prioritizes matched book by id or bookKey", () => {
      const state = {
        ...DEFAULT_CATALOGUE_URL_STATE,
        book: getBookKey(ficciones),
        view: "lists" as const,
        list: "up-next",
      };

      expect(buildDynamicPageTitle(state, books, lists)).toBe(
        "Ficciones by Jorge Luis Borges | Library of Babel",
      );
      expect(buildDynamicPageDescription(state, books, lists)).toContain(
        "metaphysical short stories",
      );

      const fallbackSummaryState = {
        ...DEFAULT_CATALOGUE_URL_STATE,
        book: "bk_aleph",
      };
      expect(
        buildDynamicPageDescription(fallbackSummaryState, books, lists),
      ).toContain("Shelf 4 (Left Stack)");
    });

    it("formats reading list titles and descriptions", () => {
      const withDesc = {
        ...DEFAULT_CATALOGUE_URL_STATE,
        view: "lists" as const,
        list: "up-next",
      };
      expect(buildDynamicPageTitle(withDesc, books, lists)).toBe(
        "Up Next | Library of Babel",
      );
      expect(buildDynamicPageDescription(withDesc, books, lists)).toBe(
        "Autumn evening reads. (2 volumes)",
      );

      const withoutDesc = {
        ...DEFAULT_CATALOGUE_URL_STATE,
        view: "lists" as const,
        list: "stoics",
      };
      expect(buildDynamicPageTitle(withoutDesc, books, lists)).toBe(
        "Stoic Canon | Library of Babel",
      );
      expect(buildDynamicPageDescription(withoutDesc, books, lists)).toContain(
        "1 volume",
      );
    });

    it("formats view, shelf, division, and default titles and descriptions", () => {
      expect(
        buildDynamicPageTitle(
          { ...DEFAULT_CATALOGUE_URL_STATE, view: "commonplace" },
          books,
          lists,
        ),
      ).toBe("Commonplace Book | Library of Babel");

      expect(
        buildDynamicPageTitle(
          { ...DEFAULT_CATALOGUE_URL_STATE, view: "lists" },
          books,
          lists,
        ),
      ).toBe("Reading Lists | Library of Babel");

      expect(
        buildDynamicPageTitle(
          { ...DEFAULT_CATALOGUE_URL_STATE, view: "shelves", shelf: "14" },
          books,
          lists,
        ),
      ).toBe("Shelf 14 | Library of Babel");

      expect(
        buildDynamicPageTitle(
          { ...DEFAULT_CATALOGUE_URL_STATE, view: "shelves" },
          books,
          lists,
        ),
      ).toBe("Physical Shelves | Library of Babel");

      expect(
        buildDynamicPageTitle(
          { ...DEFAULT_CATALOGUE_URL_STATE, view: "timeline" },
          books,
          lists,
        ),
      ).toBe("Decadal Timeline | Library of Babel");

      expect(
        buildDynamicPageTitle(
          { ...DEFAULT_CATALOGUE_URL_STATE, shelf: "8" },
          books,
          lists,
        ),
      ).toBe("Shelf 8 | Library of Babel");

      expect(
        buildDynamicPageTitle(
          { ...DEFAULT_CATALOGUE_URL_STATE, division: "Philosophy" },
          books,
          lists,
        ),
      ).toBe("Philosophy | Library of Babel");

      expect(
        buildDynamicPageTitle(DEFAULT_CATALOGUE_URL_STATE, books, lists),
      ).toBe("Library of Babel");

      expect(
        buildDynamicPageDescription(DEFAULT_CATALOGUE_URL_STATE, books, lists),
      ).toBe(
        "A descriptive shelf catalogue, commonplace book, and reading ledger for the Library of Babel.",
      );
    });
  });
});
