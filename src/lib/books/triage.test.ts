import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeCatalogueBook, type CatalogueBook } from "./catalogue";
import {
  computeBulkUpdatePatch,
  computeTriageCounts,
  findPotentialDuplicateGroups,
  getDuplicateBookIdSet,
  getMissingMetadataReasons,
} from "./triage";

function makeBook(overrides: Partial<CatalogueBook> = {}): CatalogueBook {
  return normalizeCatalogueBook({
    id: overrides.id ?? "bk_default",
    author: overrides.author ?? "Jorge Luis Borges",
    title: overrides.title ?? "Ficciones",
    edition: overrides.edition ?? "Grove Press",
    shelf: overrides.shelf ?? 1,
    position: overrides.position ?? "Vertical (1)",
    top_category:
      overrides.top_category !== undefined ? overrides.top_category : "Literature",
    sub_category:
      overrides.sub_category !== undefined ? overrides.sub_category : "Fiction",
    summary:
      overrides.summary !== undefined
        ? overrides.summary
        : "Collected short stories of labyrinths and mirrors.",
    tags: overrides.tags ?? ["short stories", "labyrinths"],
    publish_year:
      overrides.publish_year !== undefined ? overrides.publish_year : 1944,
    reading_status: overrides.reading_status ?? "unread",
    rating: overrides.rating ?? null,
    date_started: overrides.date_started ?? null,
    date_finished: overrides.date_finished ?? null,
    personal_notes: overrides.personal_notes ?? null,
    loaned_to: overrides.loaned_to ?? null,
  });
}

describe("getMissingMetadataReasons", () => {
  it("returns empty array when summary, publish_year, and non-noise tags are present", () => {
    expect(getMissingMetadataReasons(makeBook())).toEqual([]);
  });

  it("flags blank summary, null publish_year, and empty or noise-only tags", () => {
    const missingAll = makeBook({
      summary: "   ",
      publish_year: null,
      tags: ["Literature", "Classics", "In Library"],
    });
    expect(getMissingMetadataReasons(missingAll)).toEqual([
      "summary",
      "publish_year",
      "tags",
    ]);

    const missingYearOnly = makeBook({
      publish_year: null,
      tags: ["philosophy"],
    });
    expect(getMissingMetadataReasons(missingYearOnly)).toEqual(["publish_year"]);

    const zeroBceOrValidNegative = makeBook({
      publish_year: -375,
    });
    expect(getMissingMetadataReasons(zeroBceOrValidNegative)).toEqual([]);
  });
});

describe("findPotentialDuplicateGroups", () => {
  it("groups exact duplicates across shelves with deterministic sorting", () => {
    const copyB = makeBook({
      id: "bk_2",
      title: "The Great Critics",
      author: "Smith and Parks",
      shelf: 40,
      position: "Top Stack (Horiz. 7)",
    });
    const copyA = makeBook({
      id: "bk_1",
      title: "The Great Critics",
      author: "Smith & Parks (Eds.)",
      shelf: 21,
      position: "Vertical (16)",
    });

    const groups = findPotentialDuplicateGroups([copyB, copyA]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("Same title & author");
    expect(groups[0].books.map((b) => b.id)).toEqual(["bk_1", "bk_2"]);
  });

  it("groups subtitle and diacritic variants when author surnames match (including particles)", () => {
    const first = makeBook({
      id: "bk_goethe_1",
      title: "The Sorrows of Young Werther: A New Translation",
      author: "J.W. von Goethe",
      shelf: 3,
      position: "Vertical (2)",
    });
    const second = makeBook({
      id: "bk_goethe_2",
      title: "Sorrows of Young Werther (Penguin Classics)",
      author: "Johann Wolfgang von Goethe (trans. Michael Hulse)",
      shelf: 14,
      position: "Vertical (8)",
    });

    const groups = findPotentialDuplicateGroups([second, first]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("Same title & matching surname");
    expect(groups[0].books.map((b) => b.id)).toEqual([
      "bk_goethe_1",
      "bk_goethe_2",
    ]);
  });

  it("groups same-shelf identical titles when authors differ slightly or are unknown", () => {
    const a = makeBook({
      id: "bk_shelf_a",
      title: "Beowulf",
      author: "Unknown",
      shelf: 12,
      position: "Vertical (1)",
    });
    const b = makeBook({
      id: "bk_shelf_b",
      title: "Beowulf (Bilingual Edition)",
      author: "Seamus Heaney (trans.)",
      shelf: 12,
      position: "Vertical (2)",
    });

    const groups = findPotentialDuplicateGroups([b, a]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("Same shelf & title");

    // Distinct personal authors sharing a generic anthology title on the same shelf must not collide.
    const distinctSameShelf = findPotentialDuplicateGroups([
      makeBook({
        id: "poem_sandburg",
        title: "Selected Poems",
        author: "Carl Sandburg",
        shelf: 29,
      }),
      makeBook({
        id: "poem_borges",
        title: "Selected Poems",
        author: "Jorge Luis Borges",
        shelf: 29,
      }),
    ]);
    expect(distinctSameShelf).toEqual([]);
  });

  it("does NOT group numbered volumes (Vol., Part, Volume, #)", () => {
    const books = [
      makeBook({ id: "v1", title: "History Vol. 1", author: "Herodotus", shelf: 5 }),
      makeBook({ id: "v2", title: "History Vol. 2", author: "Herodotus", shelf: 5 }),
      makeBook({ id: "p1", title: "Don Quixote Part I", author: "Cervantes", shelf: 6 }),
      makeBook({ id: "p2", title: "Don Quixote Part II", author: "Cervantes", shelf: 6 }),
      makeBook({ id: "n1", title: "Foundation #1", author: "Isaac Asimov", shelf: 7 }),
      makeBook({ id: "n2", title: "Foundation #2", author: "Isaac Asimov", shelf: 7 }),
      makeBook({
        id: "r1",
        title: "Capital: Volume I",
        author: "Karl Marx",
        shelf: 8,
      }),
      makeBook({
        id: "r2",
        title: "Capital: Volume II",
        author: "Karl Marx",
        shelf: 8,
      }),
    ];

    expect(findPotentialDuplicateGroups(books)).toEqual([]);
  });

  it("does NOT group distinct authors with different works or matching titles across different shelves", () => {
    const books = [
      makeBook({
        id: "d1",
        title: "Ficciones",
        author: "Jorge Luis Borges",
        shelf: 1,
      }),
      makeBook({
        id: "d2",
        title: "Invisible Cities",
        author: "Italo Calvino",
        shelf: 1,
      }),
      makeBook({
        id: "d3",
        title: "Confessions",
        author: "Jean-Jacques Rousseau",
        shelf: 14,
      }),
      makeBook({
        id: "d4",
        title: "Confessions",
        author: "Saint Augustine",
        shelf: 27,
      }),
    ];

    expect(findPotentialDuplicateGroups(books)).toEqual([]);
  });

  it("merges overlapping pairs across buckets without double-reporting", () => {
    const a = makeBook({
      id: "ov_1",
      title: "Being and Time",
      author: "Martin Heidegger",
      shelf: 10,
      position: "Vertical (1)",
    });
    const b = makeBook({
      id: "ov_2",
      title: "Being and Time",
      author: "Martin Heidegger",
      shelf: 10,
      position: "Vertical (2)",
    });
    const c = makeBook({
      id: "ov_3",
      title: "Being and Time: A Revised Translation",
      author: "M. Heidegger",
      shelf: 22,
      position: "Vertical (3)",
    });

    const groups = findPotentialDuplicateGroups([c, b, a]);
    expect(groups).toHaveLength(1);
    expect(groups[0].books.map((book) => book.id)).toEqual([
      "ov_1",
      "ov_2",
      "ov_3",
    ]);

    const idSet = getDuplicateBookIdSet(groups);
    expect([...idSet].sort()).toEqual(["ov_1", "ov_2", "ov_3"]);
  });

  it("preserves short subtitle prefixes (< 4 alnum chars) so distinct volumes do not collide", () => {
    const a = makeBook({
      id: "short_1",
      title: "n+1: Middlemen",
      author: "Various",
      shelf: 13,
    });
    const b = makeBook({
      id: "short_2",
      title: "n+1: Inside Job",
      author: "Various",
      shelf: 13,
    });

    expect(findPotentialDuplicateGroups([a, b])).toEqual([]);
  });
});

describe("computeTriageCounts", () => {
  it("computes accurate missing metadata counts and duplicate totals", () => {
    const books = [
      makeBook({ id: "ok_1", title: "Book One", author: "Author One", shelf: 1 }),
      makeBook({
        id: "miss_sum",
        title: "Book Two",
        author: "Author Two",
        shelf: 2,
        summary: null,
      }),
      makeBook({
        id: "miss_yr_tags",
        title: "Book Three",
        author: "Author Three",
        shelf: 3,
        publish_year: null,
        tags: [],
      }),
      makeBook({
        id: "dup_1",
        title: "Selected Works of Cesare Pavese",
        author: "Cesare Pavese",
        shelf: 35,
        summary: null,
      }),
      makeBook({
        id: "dup_2",
        title: "The Selected Works of Cesare Pavese",
        author: "Cesare Pavese",
        shelf: 38,
      }),
    ];

    const summary = computeTriageCounts(books);
    expect(summary.missing_summary).toBe(2);
    expect(summary.missing_year).toBe(1);
    expect(summary.missing_tags).toBe(1);
    expect(summary.missing_any).toBe(3);
    expect(summary.duplicateGroups).toHaveLength(1);
    expect(summary.duplicates).toBe(2);
  });
});

describe("computeBulkUpdatePatch", () => {
  it("omits tags when neither add_tags nor remove_tags is provided", () => {
    const book = makeBook({ tags: ["poetry", "modernism"] });
    const result = computeBulkUpdatePatch(book, {
      reading_status: "finished",
      shelf: 12,
      top_category: null,
    });

    expect(result).toEqual({
      reading_status: "finished",
      shelf: 12,
      top_category: null,
    });
    expect("tags" in result).toBe(false);
  });

  it("adds, removes, normalizes, deduplicates, and caps tags at 20", () => {
    const existingTags = Array.from({ length: 18 }, (_, idx) => `Tag-${idx + 1}`);
    const book = makeBook({ tags: ["Keep", "Remove Me", ...existingTags] });

    const result = computeBulkUpdatePatch(book, {
      remove_tags: ["remove me", "tag-1", "nonexistent"],
      add_tags: ["keep", "New Tag", "new tag", "Extra-1", "Extra-2", "Extra-3"],
    });

    expect(result.tags).toBeDefined();
    expect(result.tags!.length).toBe(20);
    expect(result.tags![0]).toBe("keep");
    expect(result.tags).not.toContain("remove me");
    expect(result.tags).not.toContain("tag-1");
    expect(result.tags).toContain("new tag");
    expect(result.tags).toContain("extra-1");
    expect(result.tags).not.toContain("extra-2");
    expect(result.tags).not.toContain("extra-3");
  });
});

describe("cleaned 880-volume catalogue triage sanity", () => {
  it("counts real missing metadata and keeps multi-volume series separate", () => {
    const raw = readFileSync(
      path.join(process.cwd(), "shelf_catalog_full.json"),
      "utf8",
    );
    const books = (JSON.parse(raw) as Record<string, unknown>[]).map((row) =>
      normalizeCatalogueBook(row),
    );

    const summary = computeTriageCounts(books);
    expect(summary.missing_summary).toBe(311);
    expect(summary.missing_year).toBe(114);
    expect(summary.missing_tags).toBe(115);

    const groupedTitles = summary.duplicateGroups.flatMap((g) =>
      g.books.map((b) => b.title),
    );
    expect(groupedTitles).not.toContain("Systematic Theology: Volume I");
    expect(groupedTitles).not.toContain("Le Morte d'Arthur — Volume 1");
    expect(groupedTitles).not.toContain(
      "Molière: The Complete Richard Wilbur Translations (Vol 1)",
    );
    expect(groupedTitles).not.toContain(
      "The Norton Anthology of English Literature (Vol. B)",
    );
    expect(groupedTitles).toContain("The Selected Works of Cesare Pavese");
    expect(groupedTitles).toContain("The Great Critics");
  });
});
