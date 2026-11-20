import { describe, expect, it } from "vitest";

import {
  validateCreateBookInput,
  validateUpdateBookInput,
} from "./validation";

describe("validateCreateBookInput", () => {
  it("validates minimal required fields and applies clean defaults", () => {
    const result = validateCreateBookInput({
      title: "  Ficciones  ",
      author: "  Jorge Luis Borges ",
      shelf: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual({
      title: "Ficciones",
      author: "Jorge Luis Borges",
      edition: "",
      shelf: 0,
      position: "",
      top_category: null,
      sub_category: null,
      summary: null,
      tags: [],
      publish_year: null,
      reading_status: "unread",
      rating: null,
      date_started: null,
      date_finished: null,
      personal_notes: null,
      loaned_to: null,
    });
  });

  it("normalizes, trims, and deduplicates comma-separated and array tags", () => {
    const commaResult = validateCreateBookInput({
      title: "Book",
      author: "Author",
      shelf: 4,
      tags: "  Magic Realism , surrealism,  magic   realism , ",
    });
    expect(commaResult.ok).toBe(true);
    if (commaResult.ok) {
      expect(commaResult.data.tags).toEqual(["magic realism", "surrealism"]);
    }

    const twentyTags = Array.from({ length: 20 }, (_, i) => `tag-${i + 1}`);
    const maxAllowed = validateCreateBookInput({
      title: "Book",
      author: "Author",
      shelf: 4,
      tags: twentyTags,
    });
    expect(maxAllowed.ok).toBe(true);

    const twentyOneTags = Array.from({ length: 21 }, (_, i) => `tag-${i + 1}`);
    const overMax = validateCreateBookInput({
      title: "Book",
      author: "Author",
      shelf: 4,
      tags: twentyOneTags,
    });
    expect(overMax.ok).toBe(false);
  });

  it("enforces boundaries on shelf, publish_year, rating, reading_status, and dates", () => {
    const validBoundary = validateCreateBookInput({
      title: "The Odyssey",
      author: "Homer",
      shelf: 1,
      publish_year: -3000,
      reading_status: "reading",
      rating: 5,
      date_started: "2024-02-29",
      date_finished: "",
    });
    expect(validBoundary.ok).toBe(true);
    if (validBoundary.ok) {
      expect(validBoundary.data.publish_year).toBe(-3000);
      expect(validBoundary.data.date_started).toBe("2024-02-29");
      expect(validBoundary.data.date_finished).toBeNull();
    }

    const invalid = validateCreateBookInput({
      title: " ",
      author: 42,
      shelf: -1,
      publish_year: 2101,
      reading_status: "abandoned",
      rating: 6,
      date_started: "2025-02-29",
      date_finished: "2026-13-01",
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.length).toBeGreaterThanOrEqual(7);
    }
  });

  it("rejects non-object payloads", () => {
    expect(validateCreateBookInput(null).ok).toBe(false);
    expect(validateCreateBookInput([]).ok).toBe(false);
    expect(validateCreateBookInput("text").ok).toBe(false);
  });
});

describe("validateUpdateBookInput", () => {
  it("accepts valid partial patches and clears empty nullable fields", () => {
    const result = validateUpdateBookInput({
      reading_status: "finished",
      rating: 4,
      personal_notes: "   ",
      loaned_to: "  Alice  ",
      tags: ["Essay", "essay", "Philosophy"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual({
      reading_status: "finished",
      rating: 4,
      personal_notes: null,
      loaned_to: "Alice",
      tags: ["essay", "philosophy"],
    });
  });

  it("rejects empty update objects and invalid partial values", () => {
    expect(validateUpdateBookInput({}).ok).toBe(false);
    expect(validateUpdateBookInput({ rating: 0 }).ok).toBe(false);
    expect(validateUpdateBookInput({ shelf: 1.5 }).ok).toBe(false);
    expect(validateUpdateBookInput({ date_finished: "2026-02-30" }).ok).toBe(
      false,
    );
  });
});
