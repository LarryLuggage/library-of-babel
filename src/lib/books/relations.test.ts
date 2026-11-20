import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  type CatalogueBook,
  getBookKey,
  normalizeCatalogueBook,
} from "./catalogue";
import {
  buildCatalogueGraph,
  getPathfinderConnection,
  getTagCooccurrences,
} from "./relations";

function makeBook(overrides: Partial<CatalogueBook>): CatalogueBook {
  return normalizeCatalogueBook({
    author: "Author",
    title: "Title",
    edition: "Ed",
    shelf: 10,
    position: "Pos",
    top_category: "Literature",
    sub_category: null,
    summary: null,
    tags: [],
    publish_year: 2000,
    ...overrides,
  });
}

function loadCleanedCatalogue(): CatalogueBook[] {
  const raw = readFileSync(
    path.join(process.cwd(), "shelf_catalog_full.json"),
    "utf8",
  );
  return (JSON.parse(raw) as Record<string, unknown>[]).map((row) =>
    normalizeCatalogueBook(row),
  );
}

describe("buildCatalogueGraph and getPathfinderConnection", () => {
  it("returns a single step when source and target are identical", () => {
    const book = makeBook({ author: "Borges", title: "Ficciones", shelf: 1 });
    const pathResult = getPathfinderConnection(book, book, [book]);

    expect(pathResult).toEqual([{ book, reasons: [], score: 0 }]);
  });

  it("picks the highest cumulative score among shortest-hop ties", () => {
    // 2-hop via B: A->B (same shelf + rare tag = 4 + 5 = 9), B->D (same author = 14) => total 23
    // 2-hop via C: A->C (same shelf = 4), C->D (same shelf = 4) => total 8
    const a = makeBook({
      author: "Writer A",
      title: "Book A",
      shelf: 1,
      tags: ["rare-bridge"],
    });
    const b = makeBook({
      author: "Shared Author",
      title: "Book B",
      shelf: 1,
      tags: ["rare-bridge"],
    });
    const cWithSub = makeBook({
      author: "Writer C",
      title: "Book C",
      shelf: 1,
      sub_category: "Branch C",
    });
    const dWithSub = makeBook({
      author: "Shared Author",
      title: "Book D",
      shelf: 20,
      sub_category: "Branch C",
    });

    const books = [a, b, cWithSub, dWithSub];
    const graph = buildCatalogueGraph(books);
    const result = getPathfinderConnection(a, dWithSub, books, graph);

    expect(result).not.toBeNull();
    expect(result!.map((step) => step.book.title)).toEqual([
      "Book A",
      "Book B",
      "Book D",
    ]);
    expect(result![0].score).toBe(0);
    expect(result![1].score).toBe(9);
    expect(result![2].score).toBe(14);
  });

  it("falls back to allEdges (score >= 2) when disconnected on highSignalEdges (score >= 4)", () => {
    // A <-> B only shares neighboring shelf (score 2)
    // B <-> C shares same author (score 14)
    const a = makeBook({
      author: "Author A",
      title: "Alpha",
      shelf: 1,
      tags: [],
    });
    const b = makeBook({
      author: "Author B",
      title: "Beta",
      shelf: 2,
      tags: [],
    });
    const c = makeBook({
      author: "Author B",
      title: "Gamma",
      shelf: 15,
      tags: [],
    });

    const books = [a, b, c];
    const graph = buildCatalogueGraph(books);

    expect(graph.highSignalEdges.get(getBookKey(a))).toEqual([]);
    expect(graph.allEdges.get(getBookKey(a))?.length).toBe(1);

    const pathResult = getPathfinderConnection(a, c, books, graph);
    expect(pathResult).not.toBeNull();
    expect(pathResult!.map((step) => step.book.title)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(pathResult![1].score).toBe(2);
    expect(pathResult![2].score).toBe(14);
  });

  it("returns null when books are disconnected even on allEdges", () => {
    const a = makeBook({
      author: "Author A",
      title: "Island A",
      shelf: 1,
      tags: ["unique-a"],
    });
    const b = makeBook({
      author: "Author B",
      title: "Island B",
      shelf: 25,
      tags: ["unique-b"],
    });

    expect(getPathfinderConnection(a, b, [a, b])).toBeNull();
  });

  it("finds valid multi-hop paths across the cleaned 880-volume catalogue", () => {
    const books = loadCleanedCatalogue();
    expect(books).toHaveLength(880);

    const graph = buildCatalogueGraph(books);
    const borges = books.find(
      (b) =>
        b.author === "Jorge Luis Borges" && b.title === "Collected Fictions",
    )!;
    const adorno = books.find(
      (b) => b.author === "Theodor W. Adorno" && b.title === "Aesthetic Theory",
    )!;
    const dostoevsky = books.find(
      (b) => b.author === "Fyodor Dostoevsky" && b.title === "The Possessed",
    )!;
    const morrison = books.find(
      (b) => b.author === "Toni Morrison" && b.title === "Song of Solomon",
    )!;

    expect(borges).toBeDefined();
    expect(adorno).toBeDefined();
    expect(dostoevsky).toBeDefined();
    expect(morrison).toBeDefined();

    const pathOne = getPathfinderConnection(borges, adorno, books, graph);
    expect(pathOne).not.toBeNull();
    expect(pathOne!.length).toBeGreaterThanOrEqual(2);
    expect(getBookKey(pathOne![0].book)).toBe(getBookKey(borges));
    expect(getBookKey(pathOne![pathOne!.length - 1].book)).toBe(
      getBookKey(adorno),
    );
    for (let i = 1; i < pathOne!.length; i += 1) {
      expect(pathOne![i].score).toBeGreaterThanOrEqual(2);
      expect(pathOne![i].reasons.length).toBeGreaterThan(0);
    }

    const pathTwo = getPathfinderConnection(dostoevsky, morrison, books, graph);
    expect(pathTwo).not.toBeNull();
    expect(pathTwo!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getTagCooccurrences", () => {
  it("strips noise tags, deduplicates per book, and populates O(1) cooccurrenceMap", () => {
    const books = [
      makeBook({
        title: "Book 1",
        tags: [
          "Literature",
          "existentialism",
          "Existentialism",
          "phenomenology",
        ],
      }),
      makeBook({
        title: "Book 2",
        tags: ["existentialism", "phenomenology", "ethics", "NYT"],
      }),
      makeBook({
        title: "Book 3",
        tags: ["solitude"],
      }),
    ];

    const result = getTagCooccurrences(books);

    expect(result.tagCounts.get("literature")).toBeUndefined();
    expect(result.tagCounts.get("NYT")).toBeUndefined();
    expect(result.tagCounts.get("existentialism")).toBe(2);
    expect(result.tagCounts.get("phenomenology")).toBe(2);
    expect(result.tagCounts.get("ethics")).toBe(1);
    expect(result.tagCounts.get("solitude")).toBe(1);

    expect(
      result.cooccurrenceMap.get("existentialism")?.get("phenomenology"),
    ).toBe(2);
    expect(
      result.cooccurrenceMap.get("phenomenology")?.get("existentialism"),
    ).toBe(2);
    expect(result.cooccurrenceMap.get("existentialism")?.get("ethics")).toBe(1);
    expect(result.cooccurrenceMap.get("solitude")?.size).toBe(0);

    const exPhenLink = result.links.find(
      (link) =>
        (link.source === "existentialism" && link.target === "phenomenology") ||
        (link.source === "phenomenology" && link.target === "existentialism"),
    );
    expect(exPhenLink?.count).toBe(2);
    expect(result.nodes.some((node) => node.tag === "existentialism")).toBe(
      true,
    );
  });
});
