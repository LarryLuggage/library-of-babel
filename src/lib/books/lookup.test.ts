import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as LOOKUP_GET } from "@/app/api/books/lookup/route";
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

  it("enriches missing summary and BCE year from Wikipedia when enrich=true and rejects person-bio/disambig pages", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "");

    const calls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);

      if (url.startsWith("https://openlibrary.org/search.json")) {
        return Response.json({
          docs: [
            {
              key: "/works/OL50W",
              title: "The Republic",
              author_name: ["Plato"],
              publisher: ["Penguin Classics"],
              subject: ["Political philosophy"],
            },
          ],
        });
      }

      if (url === "https://openlibrary.org/works/OL50W.json") {
        return Response.json({});
      }

      if (
        url.startsWith("https://en.wikipedia.org/w/api.php") &&
        url.includes("list=search")
      ) {
        return Response.json({
          query: {
            search: [
              { pageid: 101, title: "Plato" },
              { pageid: 102, title: "Republic (disambiguation)" },
              { pageid: 103, title: "Republic (Plato)" },
            ],
          },
        });
      }

      if (
        url.startsWith("https://en.wikipedia.org/w/api.php") &&
        url.includes("prop=extracts")
      ) {
        return Response.json({
          query: {
            pages: {
              "101": {
                pageid: 101,
                title: "Plato",
                extract:
                  "Plato (428/427 – 348/347 BC) was an ancient Greek philosopher of the Classical period whose book Republic became famous.",
                categories: [{ title: "Category:348 BC deaths" }],
              },
              "102": {
                pageid: 102,
                title: "Republic (disambiguation)",
                extract: "Republic may refer to:",
                categories: [{ title: "Category:Disambiguation pages" }],
              },
              "103": {
                pageid: 103,
                title: "Republic (Plato)",
                extract:
                  "The Republic is a Socratic dialogue, authored by Plato around 375 BCE, concerning justice, the order and character of the just city-state, and the just man.",
                categories: [{ title: "Category:Dialogues of Plato" }],
              },
            },
          },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const results = await lookupBibliographicCandidates(
      "The Republic Plato",
      mockFetch,
      { enrich: true },
    );

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("open_library");
    expect(results[0].publish_year).toBe(-375);
    expect(results[0].summary).toContain("Socratic dialogue");
    expect(calls.some((url) => url.includes("en.wikipedia.org"))).toBe(true);
  });

  it("appends a wikipedia candidate when Open Library returns nothing and truncates long summaries <= 420 chars", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "");

    const longSentence =
      "Ficciones is a 1944 collection of short stories by Argentine writer Jorge Luis Borges. " +
      "It gathers his early labyrinthine tales of infinite libraries, detective puzzles, and speculative metaphysics into two celebrated sections that reshaped twentieth-century world literature. " +
      "Later editions expanded the second section with additional tales exploring mirrors, memory, imaginary encyclopedias, and philosophical paradoxes across centuries of erudite invention and subtle irony.";

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://openlibrary.org/search.json")) {
        return Response.json({ docs: [] });
      }
      if (url.includes("list=search")) {
        return Response.json({
          query: { search: [{ pageid: 201, title: "Ficciones" }] },
        });
      }
      if (url.includes("prop=extracts")) {
        return Response.json({
          query: {
            pages: {
              "201": {
                pageid: 201,
                title: "Ficciones",
                extract: longSentence,
                categories: [{ title: "Category:1944 short story collections" }],
              },
            },
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    };

    const results = await lookupBibliographicCandidates("Ficciones", mockFetch, {
      enrich: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Ficciones",
      author: "Jorge Luis Borges",
      publish_year: 1944,
      source: "wikipedia",
    });
    expect(results[0].summary).not.toBeNull();
    expect(results[0].summary!.length).toBeLessThanOrEqual(420);
  });

  it("preserves Open Library results if Wikipedia fails and skips Wikipedia for ISBN or complete candidates", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "");

    let wikiCalls = 0;
    const mockFetchFailingWiki: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://openlibrary.org/search.json")) {
        return Response.json({
          docs: [
            {
              key: "/works/OL1W",
              title: "Incomplete Book",
              author_name: ["Some Author"],
            },
          ],
        });
      }
      if (url.startsWith("https://openlibrary.org/works/")) {
        return Response.json({});
      }
      if (url.includes("en.wikipedia.org")) {
        wikiCalls += 1;
        return new Response("Service Unavailable", { status: 503 });
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    const fallbackResults = await lookupBibliographicCandidates(
      "Incomplete Book",
      mockFetchFailingWiki,
      { enrich: true },
    );
    expect(wikiCalls).toBe(1);
    expect(fallbackResults).toHaveLength(1);
    expect(fallbackResults[0].title).toBe("Incomplete Book");

    // Skips Wikipedia when ISBN is searched
    wikiCalls = 0;
    await lookupBibliographicCandidates("9780140184327", mockFetchFailingWiki, {
      enrich: true,
    });
    expect(wikiCalls).toBe(0);

    // Skips Wikipedia when a candidate already has both summary and publish_year
    let completeWikiCalls = 0;
    const completeFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://openlibrary.org/search.json")) {
        return Response.json({
          docs: [
            {
              key: "/works/OL2W",
              title: "Complete Book",
              author_name: ["Author"],
              first_publish_year: 1999,
            },
          ],
        });
      }
      if (url === "https://openlibrary.org/works/OL2W.json") {
        return Response.json({ description: "Already has summary." });
      }
      if (url.includes("en.wikipedia.org")) {
        completeWikiCalls += 1;
      }
      return new Response("Not Found", { status: 404 });
    };

    const completeResults = await lookupBibliographicCandidates(
      "Complete Book",
      completeFetch,
      { enrich: true },
    );
    expect(completeResults[0].summary).toBe("Already has summary.");
    expect(completeWikiCalls).toBe(0);
  });

  it("wires enrich=1 query param through GET /api/books/lookup", async () => {
    vi.stubEnv("GOOGLE_BOOKS_API_KEY", "");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith("https://openlibrary.org/search.json")) {
          return Response.json({ docs: [] });
        }
        if (url.includes("list=search")) {
          return Response.json({
            query: { search: [{ pageid: 301, title: "Poetics (Aristotle)" }] },
          });
        }
        if (url.includes("prop=extracts")) {
          return Response.json({
            query: {
              pages: {
                "301": {
                  pageid: 301,
                  title: "Poetics (Aristotle)",
                  extract:
                    "Poetics by Aristotle is the earliest surviving work of Greek dramatic theory, written around 335 BC.",
                  categories: [{ title: "Category:Works by Aristotle" }],
                },
              },
            },
          });
        }
        return new Response("Not Found", { status: 404 });
      });

    const response = await LOOKUP_GET(
      new Request("http://localhost/api/books/lookup?q=Poetics&enrich=1"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      candidates: Array<{
        title: string;
        publish_year: number | null;
        source: string;
      }>;
    };
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      title: "Poetics",
      publish_year: -335,
      source: "wikipedia",
    });
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
