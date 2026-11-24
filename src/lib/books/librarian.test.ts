import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogueBook } from "./catalogue";
import {
  isLibrarianConfigured,
  queryGeminiLibrarian,
  runLocalLibrarianQuery,
  shortlistCatalogueForPrompt,
} from "./librarian";

function makeBook(
  overrides: Partial<CatalogueBook> & { id: string; title: string; author: string },
): CatalogueBook {
  return {
    edition: "Hardcover",
    shelf: 5,
    position: "Vertical (1)",
    top_category: "Philosophy",
    sub_category: "Continental Philosophy",
    summary: "A foundational study of language and perception.",
    tags: [],
    publish_year: 1950,
    reading_status: "unread",
    rating: null,
    date_started: null,
    date_finished: null,
    personal_notes: null,
    loaned_to: null,
    ...overrides,
  };
}

const SAMPLE_BOOKS: CatalogueBook[] = [
  makeBook({
    id: "bk_plato",
    title: "The Republic",
    author: "Plato",
    shelf: 2,
    position: "Vertical (3)",
    top_category: "Philosophy",
    sub_category: "Ancient Philosophy",
    summary: "Socratic dialogue on justice, the ideal city, and the forms.",
    tags: ["justice", "dialectic", "greek philosophy"],
    publish_year: -375,
    reading_status: "unread",
  }),
  makeBook({
    id: "bk_nietzsche",
    title: "Beyond Good and Evil",
    author: "Friedrich Nietzsche",
    shelf: 8,
    position: "Vertical (12)",
    top_category: "Philosophy",
    sub_category: "19th Century Philosophy",
    summary: "A critique of traditional morality and philosophical dogmatism.",
    tags: ["morality", "genealogy", "aphorisms"],
    publish_year: 1886,
    reading_status: "unread",
  }),
  makeBook({
    id: "bk_tolstoy_read",
    title: "Anna Karenina",
    author: "Leo Tolstoy",
    shelf: 14,
    position: "Vertical (4)",
    top_category: "Literature",
    sub_category: "Russian Literature",
    summary: "Tragic realist novel of aristocratic society in imperial Russia.",
    tags: ["realism", "russia", "tragedy"],
    publish_year: 1878,
    reading_status: "finished",
    rating: 5,
  }),
  makeBook({
    id: "bk_dostoevsky_unread",
    title: "The Brothers Karamazov",
    author: "Fyodor Dostoevsky",
    shelf: 15,
    position: "Top Stack",
    top_category: "Literature",
    sub_category: "Russian Literature",
    summary: "Philosophical novel exploring faith, doubt, and moral guilt in 19th-century Russia.",
    tags: ["russia", "theology", "morality"],
    publish_year: 1880,
    reading_status: "unread",
  }),
  makeBook({
    id: "bk_borges",
    title: "Labyrinths",
    author: "Jorge Luis Borges",
    shelf: 22,
    position: "Vertical (7)",
    top_category: "Literature",
    sub_category: "Metafiction",
    summary: "Short stories and essays on infinite libraries, mirrors, and time.",
    tags: ["labyrinths", "infinity", "short stories"],
    publish_year: 1962,
    reading_status: "unread",
  }),
];

describe("librarian domain logic", () => {
  const savedApiKey = process.env.GEMINI_API_KEY;
  const savedModel = process.env.GEMINI_MODEL;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedApiKey;
    }
    if (savedModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = savedModel;
    }
  });

  it("shortlists by century/era, shelf range, unread intent, and keywords", () => {
    // 19th century + unread + Russian -> should surface Brothers Karamazov ahead of finished Anna Karenina
    const russianUnread = shortlistCatalogueForPrompt(
      SAMPLE_BOOKS,
      [],
      "unread 19th century russia morality",
      3,
    );
    expect(russianUnread[0].id).toBe("bk_dostoevsky_unread");

    // Antiquity cue -> should surface Plato
    const ancient = shortlistCatalogueForPrompt(
      SAMPLE_BOOKS,
      [],
      "ancient justice philosophy",
      3,
    );
    expect(ancient[0].id).toBe("bk_plato");

    // Shelf range cue -> shelves 20-25 should surface Borges on shelf 22
    const shelfRange = shortlistCatalogueForPrompt(
      SAMPLE_BOOKS,
      [],
      "something on shelves 20-25",
      3,
    );
    expect(shelfRange[0].id).toBe("bk_borges");
  });

  it("runLocalLibrarianQuery returns grounded local recommendations with shelf notes", () => {
    const result = runLocalLibrarianQuery(
      SAMPLE_BOOKS,
      [],
      "unread books about labyrinths and infinity",
      3,
    );

    expect(result.mode).toBe("local");
    expect(result.reply).toContain("5-volume catalogue");
    expect(result.recommendations).toHaveLength(3);
    expect(result.recommendations[0].book.id).toBe("bk_borges");
    expect(result.recommendations[0].shelfNote).toBe("Shelf 22 · Vertical (7)");
    expect(result.recommendations[0].pitch).toContain("labyrinths");
  });

  it("queryGeminiLibrarian parses structured JSON, drops hallucinated book_ids, and deduplicates", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    expect(isLibrarianConfigured()).toBe(true);

    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reply: "For infinite libraries and moral inquiry, start with Borges and Dostoevsky.",
                      recommendations: [
                        {
                          book_id: "bk_borges",
                          pitch: "Essential metaphysical fictions about infinite libraries.",
                          shelf_note: "Shelf 22 · Vertical (7)",
                        },
                        {
                          book_id: "bk_hallucinated_nonexistent_id",
                          pitch: "A book you do not own.",
                        },
                        {
                          book_id: "bk_borges",
                          pitch: "Duplicate entry that should be ignored.",
                        },
                        {
                          book_id: "bk_dostoevsky_unread",
                          pitch: "Deep 19th-century Russian moral drama on your unread stack.",
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await queryGeminiLibrarian({
      prompt: "Suggest unread philosophical fiction",
      history: [{ role: "user", text: "I love Tolstoy" }],
      books: SAMPLE_BOOKS,
      connections: [],
      fetchImpl: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain(
      "generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-gemini-key",
    );
    expect(init?.method).toBe("POST");

    expect(result.mode).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.reply).toContain("Borges and Dostoevsky");
    expect(result.recommendations.map((r) => r.book.id)).toEqual([
      "bk_borges",
      "bk_dostoevsky_unread",
    ]);
    expect(result.recommendations[1].shelfNote).toBe("Shelf 15 · Top Stack");
  });

  it("queryGeminiLibrarian throws cleanly on upstream non-200 status", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const mockFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Upstream error", { status: 503 }));

    await expect(
      queryGeminiLibrarian({
        prompt: "Suggest ancient philosophy",
        books: SAMPLE_BOOKS,
        connections: [],
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow("status 503");
  });
});
