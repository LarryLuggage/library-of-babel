import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { type CatalogueBook, normalizeCatalogueBook } from "./catalogue";
import { buildPhysicalShelves, parseBookPosition } from "./shelves";

function makeBook(overrides: Partial<CatalogueBook> = {}): CatalogueBook {
  return normalizeCatalogueBook({
    author: "Test Author",
    title: "Test Title",
    edition: "Penguin",
    shelf: 1,
    position: "Vertical (1)",
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

describe("parseBookPosition", () => {
  it("parses all standing position patterns accurately", () => {
    expect(parseBookPosition("Vertical (1)")).toEqual({
      kind: "standing",
      stackLabel: "Standing",
      slot: 1,
    });
    expect(parseBookPosition("Vertical (38)")).toEqual({
      kind: "standing",
      stackLabel: "Standing",
      slot: 38,
    });
    expect(parseBookPosition("Vertical Right (1)")).toEqual({
      kind: "standing",
      stackLabel: "Standing",
      slot: 1001,
    });
    expect(parseBookPosition("Vertical Right (13)")).toEqual({
      kind: "standing",
      stackLabel: "Standing",
      slot: 1013,
    });
    expect(parseBookPosition("Vertical")).toEqual({
      kind: "standing",
      stackLabel: "Standing",
      slot: 900,
    });
    expect(parseBookPosition("Center Leaner (Vert.)")).toEqual({
      kind: "standing",
      stackLabel: "Standing",
      slot: 950,
    });
    expect(parseBookPosition("Right Anchor (Vert.)")).toEqual({
      kind: "standing",
      stackLabel: "Standing",
      slot: 1999,
    });
    expect(parseBookPosition("")).toEqual({
      kind: "standing",
      stackLabel: "Standing",
      slot: 2000,
    });
  });

  it("parses all horizontal stack patterns accurately", () => {
    expect(parseBookPosition("Top Stack Left (Horiz. 3)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack Left",
      slot: 3,
    });
    expect(parseBookPosition("Top Stack Left (Horiz.)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack Left",
      slot: 99,
    });
    expect(parseBookPosition("Top Stack Center (Horiz. 4)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack Center",
      slot: 4,
    });
    expect(parseBookPosition("Top Stack Right (Horiz. 12)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack Right",
      slot: 12,
    });
    expect(parseBookPosition("Top Stack Right (Horiz.)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack Right",
      slot: 99,
    });
    expect(parseBookPosition("Top Stack Far Right (Horiz.)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack Far Right",
      slot: 99,
    });
    expect(parseBookPosition("Top Stack Far Right")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack Far Right",
      slot: 99,
    });
    expect(parseBookPosition("Top Stack Overhead (Far R)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack Overhead",
      slot: 99,
    });
    expect(parseBookPosition("Top Stack Overhead")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack Overhead",
      slot: 99,
    });
    expect(parseBookPosition("Top Stack 3 (Horiz.)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack",
      slot: 3,
    });
    expect(parseBookPosition("Top Stack (Horiz. 5)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack",
      slot: 5,
    });
    expect(parseBookPosition("Top Stack (Horiz.)")).toEqual({
      kind: "stack",
      stackLabel: "Top Stack",
      slot: 99,
    });
    expect(parseBookPosition("Left Stack (Horiz. 10)")).toEqual({
      kind: "stack",
      stackLabel: "Left Stack",
      slot: 10,
    });
    expect(parseBookPosition("Horizontal Stack (Top)")).toEqual({
      kind: "stack",
      stackLabel: "Horizontal Stack",
      slot: 1,
    });
    expect(parseBookPosition("Horizontal Stack (4)")).toEqual({
      kind: "stack",
      stackLabel: "Horizontal Stack",
      slot: 4,
    });
    expect(parseBookPosition("Horizontal Stack (Base)")).toEqual({
      kind: "stack",
      stackLabel: "Horizontal Stack",
      slot: 99,
    });
    expect(parseBookPosition("Desk Stack (Horiz. 7)")).toEqual({
      kind: "stack",
      stackLabel: "Desk Stack",
      slot: 7,
    });
    expect(parseBookPosition("Front Stack (Horiz. 2)")).toEqual({
      kind: "stack",
      stackLabel: "Front Stack",
      slot: 2,
    });
    expect(parseBookPosition("Overhead Stack A (Photo 3)")).toEqual({
      kind: "stack",
      stackLabel: "Overhead Stack A",
      slot: 99,
    });
    expect(parseBookPosition("Overhead Stack A")).toEqual({
      kind: "stack",
      stackLabel: "Overhead Stack A",
      slot: 99,
    });
    expect(parseBookPosition("Overhead Stack B (Photo 4)")).toEqual({
      kind: "stack",
      stackLabel: "Overhead Stack B",
      slot: 99,
    });
    expect(parseBookPosition("Side Table Pile")).toEqual({
      kind: "stack",
      stackLabel: "Stack",
      slot: 99,
    });
  });
});

describe("buildPhysicalShelves", () => {
  it("groups shelves ascending, sorts standing spines numerically, and orders stacks spatially", () => {
    const books = [
      makeBook({ shelf: 5, title: "S5", position: "Vertical (2)" }),
      makeBook({ shelf: 1, title: "V10", position: "Vertical (10)" }),
      makeBook({ shelf: 1, title: "V2", position: "Vertical (2)" }),
      makeBook({ shelf: 1, title: "VR1", position: "Vertical Right (1)" }),
      makeBook({ shelf: 1, title: "Base", position: "Horizontal Stack (Base)" }),
      makeBook({ shelf: 1, title: "Mid", position: "Horizontal Stack (3)" }),
      makeBook({ shelf: 1, title: "Top", position: "Horizontal Stack (Top)" }),
      makeBook({ shelf: 1, title: "Left1", position: "Left Stack (Horiz. 1)" }),
      makeBook({ shelf: 1, title: "TopRight", position: "Top Stack Right (Horiz. 1)" }),
      makeBook({ shelf: 1, title: "TopLeft", position: "Top Stack Left (Horiz. 1)" }),
    ];

    const groups = buildPhysicalShelves(books);
    expect(groups.map((g) => g.shelf)).toEqual([1, 5]);
    expect(groups[0].totalBooks).toBe(9);
    expect(groups[0].standing.map((s) => s.book.title)).toEqual([
      "V2",
      "V10",
      "VR1",
    ]);
    expect(groups[0].stacks.map((s) => s.label)).toEqual([
      "Left Stack",
      "Top Stack Left",
      "Top Stack Right",
      "Horizontal Stack",
    ]);
    const horizStack = groups[0].stacks.find(
      (s) => s.label === "Horizontal Stack",
    );
    expect(horizStack?.books.map((b) => b.book.title)).toEqual([
      "Top",
      "Mid",
      "Base",
    ]);
  });

  it("accounts for all 880 real books across Shelves 1-41 with zero unrecognized positions", () => {
    const catalogue = loadCleanedCatalogue();
    expect(catalogue).toHaveLength(880);

    const shelfGroups = buildPhysicalShelves(catalogue);
    expect(shelfGroups[0].shelf).toBe(1);
    expect(shelfGroups[shelfGroups.length - 1].shelf).toBe(41);

    const totalAccounted = shelfGroups.reduce(
      (sum, group) => sum + group.totalBooks,
      0,
    );
    expect(totalAccounted).toBe(880);

    const genericStacks = shelfGroups.flatMap((group) =>
      group.stacks.filter((stack) => stack.label === "Stack"),
    );
    expect(genericStacks).toEqual([]);

    for (const group of shelfGroups) {
      const groupSum =
        group.standing.length +
        group.stacks.reduce((acc, stack) => acc + stack.books.length, 0);
      expect(groupSum).toBe(group.totalBooks);
    }
  });
});
