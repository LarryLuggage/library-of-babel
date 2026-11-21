import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectIsbn,
  lookupBibliographicCandidates,
  normalizeGoogleBooksItems,
  normalizeOpenLibraryDocs,
} from "./lookup";

describe("detectIsbn", () => {
  it("normalizes valid ISBN-10 and ISBN-13 inputs and rejects non-ISBN queries", () => {
    expect(detectIsbn("978-0-14-310598-5")).toBe("9780143105985");
    expect(detectIsbn("979 10 1234 567 8")).toBe("9791012345678");
    expect(detectIsbn("ISBN 0-14-017739-6")).toBe("0140177396");
    expect(detectIsbn("080213030x")).toBe("080213030X");
    expect(detectIsbn("1234567890123")).toBeNull();
    expect(detectIsbn("Borges Ficciones")).toBeNull();
  });
});

describe("bibliographic normalizers", () => {
  it("normalizes Open Library docs, strips HTML from descriptions, and removes noise tags", () => {
    const workDetails = new Map([
      [
        "/works/OL1W",
        {
          description: {
            value:
              "<p>Stories of <em>labyrinths</em> &amp; infinite libraries.</p>",
          },
          subjects: ["Labyrinths", "Literature", "Philosophy Theory"],
        },
      ],
    ]);

    const candidates = normalizeOpenLibraryDocs(
      [
        {
          key: "/works/OL1W",
          title: "Ficciones",
          author_name: ["Jorge Luis Borges"],
          publisher: ["Grove Press", "Penguin"],
          first_publish_year: 1944,
          subject: [
            "Short stories",
            "Classics",
            "Infinity",
            "t4",
            "t5",
            "t6",
            "t7",
            "t8",
            "t9",
            "t10",
            "t11",
            "t12",
          ],
          isbn: ["0802130305", "9780802130303"],
        },
        {
          title: "",
          author_name: ["Skipped"],
        },
      ],
      workDetails,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({
      title: "Ficciones",
      author: "Jorge Luis Borges",
      edition: "Grove Press",
      publish_year: 1944,
      summary: "Stories of labyrinths & infinite libraries.",
      tags: [
        "short stories",
        "infinity",
        "t4",
        "t5",
        "t6",
        "t7",
        "t8",
        "t9",
        "t10",
        "t11",
      ],
      isbn: "9780802130303",
      source: "open_library",
    });
  });

  it("normalizes Google Books volume items", () => {
    const candidates = normalizeGoogleBooksItems([
      {
        volumeInfo: {
          title: "Invisible Cities",
          authors: ["Italo Calvino"],
          publisher: "Harcourt",
          publishedDate: "1974-01-01",
          description: "<b>Marco Polo</b> &quot;describes&quot; cities.",
          categories: ["Fiction / Magical Realism & Urbanism", "Literature"],
          industryIdentifiers: [
            { type: "ISBN_10", identifier: "0156453800" },
            { type: "ISBN_13", identifier: "9780156453806" },
          ],
        },
      },
    ]);

    expect(candidates).toEqual([
      {
        title: "Invisible Cities",
        author: "Italo Calvino",
        edition: "Harcourt",
        publish_year: 1974,
        summary: 'Marco Polo "describes" cities.',
        tags: ["fiction", "magical realism", "urbanism"],
        isbn: "9780156453806",
        source: "google_books",
      },
    ]);
  });
});

describe("lookupBibliographicCandidates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("queries Open Library by ISBN and enriches work summaries tolerating work failures", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "");

    const calls: Array<{ url: string; userAgent: string | null }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const headers = new Headers(init?.headers);
      calls.push({ url, userAgent: headers.get("user-agent") });

      if (url.startsWith("https://openlibrary.org/search.json")) {
        return Response.json({
          docs: [
            {
              key: "/works/OL10W",
              title: "The Book of Sand",
              author_name: ["Jorge Luis Borges"],
              publisher: ["Dutton"],
              first_publish_year: 1975,
              subject: ["Infinite", "Literature"],
              isbn: ["9780140184327"],
            },
            {
              key: "/works/OL20W",
              title: "Failing Work",
              author_name: ["Other Author"],
            },
          ],
        });
      }

      if (url === "https://openlibrary.org/works/OL10W.json") {
        return Response.json({
          description: "Thirteen strange tales.",
          subjects: ["Labyrinths"],
        });
      }

      if (url === "https://openlibrary.org/works/OL20W.json") {
        return new Response("Not Found", { status: 404 });
      }

      return new Response("Unexpected", { status: 500 });
    };

    const results = await lookupBibliographicCandidates(
      "978-0-14-018432-7",
      mockFetch,
    );

    expect(calls[0].userAgent).toBe("LibraryOfBabel/1.0");
    expect(calls[0].url).toContain("isbn=9780140184327");
    expect(results).toHaveLength(2);
    expect(results[0].summary).toBe("Thirteen strange tales.");
    expect(results[0].tags).toEqual(["infinite", "labyrinths"]);
    expect(results[1].summary).toBeNull();
  });

  it("merges Google Books enrichment, deduplicates, and caps at 6 candidates", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "test-google-key");

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://openlibrary.org/search.json")) {
        return Response.json({
          docs: [
            {
              key: "/works/OL1W",
              title: "Pedagogy of the Oppressed",
              author_name: ["Paulo Freire"],
              first_publish_year: 1968,
              subject: ["Critical pedagogy"],
            },
            ...Array.from({ length: 5 }, (_, idx) => ({
              title: `Extra OL ${idx + 1}`,
              author_name: [`Author ${idx + 1}`],
            })),
          ],
        });
      }

      if (url.startsWith("https://openlibrary.org/works/")) {
        return Response.json({});
      }

      if (url.startsWith("https://www.googleapis.com/books/v1/volumes")) {
        expect(url).toContain("key=test-google-key");
        return Response.json({
          items: [
            {
              volumeInfo: {
                title: "Pedagogy of the Oppressed",
                authors: ["Paulo Freire"],
                publisher: "Continuum",
                description: "<p>Foundational liberation text.</p>",
                categories: ["Education / Philosophy"],
                industryIdentifiers: [
                  { type: "ISBN_13", identifier: "9780826412768" },
                ],
              },
            },
            {
              volumeInfo: {
                title: "Unique Google Book",
                authors: ["Google Author"],
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const results = await lookupBibliographicCandidates(
      "Pedagogy of the Oppressed",
      mockFetch,
    );

    expect(results).toHaveLength(6);
    expect(results[0].title).toBe("Pedagogy of the Oppressed");
    expect(results[0].summary).toBe("Foundational liberation text.");
    expect(results[0].edition).toBe("Continuum");
    expect(results[0].isbn).toBe("9780826412768");
    expect(results[0].tags).toEqual([
      "critical pedagogy",
      "education",
      "philosophy",
    ]);
  });

  it("throws when upstream search fails", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "");
    const failingFetch: typeof fetch = async () =>
      new Response("Bad Gateway", { status: 502 });

    await expect(
      lookupBibliographicCandidates("Borges", failingFetch),
    ).rejects.toThrow();
  });
});
