import { describe, expect, it } from "vitest";

import {
  getListsForBook,
  reorderItemIds,
  slugifyListName,
  sortReadingLists,
  validateAddListItemInput,
  validateCreateListInput,
  validateReorderListItemsInput,
  validateUpdateListInput,
  type ReadingList,
} from "./lists";

function makeList(overrides: Partial<ReadingList> & { id: string; name: string }): ReadingList {
  return {
    slug: slugifyListName(overrides.name),
    description: null,
    is_queue: false,
    created_at: "2026-11-24T12:00:00.000Z",
    updated_at: "2026-11-24T12:00:00.000Z",
    items: [],
    ...overrides,
  };
}

describe("reading lists domain logic", () => {
  it("slugifies names with NFKD ASCII folding and fallback", () => {
    expect(slugifyListName("Café & Résumé: Winter 2026!")).toBe(
      "cafe-resume-winter-2026",
    );
    expect(slugifyListName("Up Next Queue")).toBe("up-next-queue");
    expect(slugifyListName("   !!!   ")).toBe("reading-list");
  });

  it("sorts reading lists with pinned queues first, then alphabetically by name", () => {
    const lists = [
      makeList({ id: "l1", name: "Stoicism", is_queue: false }),
      makeList({ id: "l2", name: "Autumn Syllabus", is_queue: false }),
      makeList({ id: "l3", name: "Up Next", is_queue: true }),
      makeList({ id: "l4", name: "A Priority Queue", is_queue: true }),
    ];

    expect(sortReadingLists(lists).map((l) => l.name)).toEqual([
      "A Priority Queue",
      "Up Next",
      "Autumn Syllabus",
      "Stoicism",
    ]);
  });

  it("finds lists containing a specific book", () => {
    const lists = [
      makeList({
        id: "l1",
        name: "Borges Lineage",
        items: [
          {
            id: "i1",
            list_id: "l1",
            book_id: "bk_a",
            position: 0,
            note: null,
            added_at: "2026-11-24T12:00:00.000Z",
          },
        ],
      }),
      makeList({
        id: "l2",
        name: "Up Next",
        is_queue: true,
        items: [
          {
            id: "i2",
            list_id: "l2",
            book_id: "bk_a",
            position: 0,
            note: null,
            added_at: "2026-11-24T12:00:00.000Z",
          },
          {
            id: "i3",
            list_id: "l2",
            book_id: "bk_b",
            position: 1,
            note: null,
            added_at: "2026-11-24T12:00:00.000Z",
          },
        ],
      }),
    ];

    expect(getListsForBook(lists, "bk_a").map((l) => l.id)).toEqual(["l2", "l1"]);
    expect(getListsForBook(lists, "bk_b").map((l) => l.id)).toEqual(["l2"]);
    expect(getListsForBook(lists, "bk_c")).toEqual([]);
  });

  it("reorders item IDs up and down cleanly with boundary guards", () => {
    const ids = ["bk_1", "bk_2", "bk_3"];
    expect(reorderItemIds(ids, "bk_2", "up")).toEqual(["bk_2", "bk_1", "bk_3"]);
    expect(reorderItemIds(ids, "bk_2", "down")).toEqual(["bk_1", "bk_3", "bk_2"]);
    expect(reorderItemIds(ids, "bk_1", "up")).toEqual(["bk_1", "bk_2", "bk_3"]);
    expect(reorderItemIds(ids, "bk_3", "down")).toEqual(["bk_1", "bk_2", "bk_3"]);
    expect(reorderItemIds(ids, "missing", "up")).toEqual(["bk_1", "bk_2", "bk_3"]);
  });

  it("validates list creation, updates, item additions, and reorders", () => {
    const createOk = validateCreateListInput({
      name: "  Winter Canon  ",
      description: "  Heavy novels for snow days. ",
      is_queue: true,
    });
    expect(createOk.ok).toBe(true);
    if (createOk.ok) {
      expect(createOk.data).toEqual({
        name: "Winter Canon",
        description: "Heavy novels for snow days.",
        is_queue: true,
      });
    }

    expect(validateCreateListInput({ name: "   " }).ok).toBe(false);
    expect(validateCreateListInput({ name: "Valid", is_queue: "yes" }).ok).toBe(false);

    expect(validateUpdateListInput({}).ok).toBe(false);
    const updateOk = validateUpdateListInput({ name: "Spring Canon" });
    expect(updateOk.ok).toBe(true);

    const addOk = validateAddListItemInput({
      book_id: " bk_1 ",
      note: " Read after Finnegans Wake ",
    });
    expect(addOk.ok).toBe(true);
    if (addOk.ok) {
      expect(addOk.data).toEqual({
        book_id: "bk_1",
        note: "Read after Finnegans Wake",
      });
    }
    expect(validateAddListItemInput({ book_id: "" }).ok).toBe(false);

    const reorderOk = validateReorderListItemsInput({
      book_ids: [" bk_2 ", "bk_1", "bk_2"],
    });
    expect(reorderOk.ok).toBe(true);
    if (reorderOk.ok) {
      expect(reorderOk.data.book_ids).toEqual(["bk_2", "bk_1"]);
    }
    expect(validateReorderListItemsInput({ book_ids: [] }).ok).toBe(false);
    expect(validateReorderListItemsInput({ book_ids: [""] }).ok).toBe(false);
  });
});
