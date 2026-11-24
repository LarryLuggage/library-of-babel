import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as supabaseAdmin from "@/lib/supabase/admin";
import {
  bulkUpdateBooks,
  createBook,
  deleteBook,
  getStorageMode,
  isSupabaseConfigured,
  listBooks,
  updateBook,
} from "./repository";
import type { CreateBookInput } from "./validation";

vi.mock("@/lib/supabase/admin", { spy: true });

const BASE_CREATE_INPUT: CreateBookInput = {
  title: "The Aleph and Other Stories",
  author: "Jorge Luis Borges",
  edition: "E.P. Dutton",
  shelf: 42,
  position: "Vertical (1)",
  top_category: "Literature",
  sub_category: "Latin American Literature",
  summary: "Short stories exploring infinity and memory.",
  tags: ["short fiction", "infinity"],
  publish_year: 1949,
  reading_status: "reading",
  rating: 5,
  date_started: "2026-11-01",
  date_finished: null,
  personal_notes: "Test note",
  loaned_to: null,
};

describe("local book tracker repository", () => {
  let tempDir = "";
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "babel-repo-test-"));
    savedEnv = {
      BOOK_TRACKER_STATE_PATH: process.env.BOOK_TRACKER_STATE_PATH,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.BOOK_TRACKER_STATE_PATH = path.join(
      tempDir,
      "nested",
      "book-tracker-state.json",
    );
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reports local storage mode when Supabase env vars are absent", () => {
    expect(isSupabaseConfigured()).toBe(false);
    expect(getStorageMode()).toBe("local");
  });

  it("supports full CRUD lifecycle for both created and base catalogue books", async () => {
    // 1. Initial read loads the 880 cleaned books
    const initial = await listBooks();
    expect(initial.storageMode).toBe("local");
    expect(initial.books).toHaveLength(880);

    // 2. Create a new volume
    const created = await createBook(BASE_CREATE_INPUT);
    expect(created.id).toMatch(/^bk_/);
    expect(created.title).toBe("The Aleph and Other Stories");
    expect(created.reading_status).toBe("reading");

    const afterCreate = await listBooks();
    expect(afterCreate.books).toHaveLength(881);
    expect(afterCreate.books.some((b) => b.id === created.id)).toBe(true);

    // 3. Update the created volume
    const updatedCreated = await updateBook(created.id, {
      reading_status: "finished",
      date_finished: "2026-11-20",
      loaned_to: "Library Patron",
    });
    expect(updatedCreated).not.toBeNull();
    expect(updatedCreated!.reading_status).toBe("finished");
    expect(updatedCreated!.date_finished).toBe("2026-11-20");
    expect(updatedCreated!.loaned_to).toBe("Library Patron");

    // 4. Update a base catalogue volume via overrides
    const borgesBase = initial.books.find(
      (b) =>
        b.author === "Jorge Luis Borges" && b.title === "Collected Fictions",
    )!;
    const updatedBase = await updateBook(borgesBase.id, {
      reading_status: "finished",
      rating: 5,
      personal_notes: "Cornerstone of the library.",
    });
    expect(updatedBase).not.toBeNull();
    expect(updatedBase!.rating).toBe(5);
    expect(updatedBase!.personal_notes).toBe("Cornerstone of the library.");

    const afterUpdates = await listBooks();
    const persistedBase = afterUpdates.books.find(
      (b) => b.id === borgesBase.id,
    );
    expect(persistedBase?.rating).toBe(5);
    expect(persistedBase?.reading_status).toBe("finished");

    // 5. Delete the created volume and a base volume
    expect(await deleteBook(created.id)).toBe(true);
    expect(await deleteBook(created.id)).toBe(false);

    expect(await deleteBook(borgesBase.id)).toBe(true);
    expect(await deleteBook(borgesBase.id)).toBe(false);

    expect(await updateBook(borgesBase.id, { rating: 1 })).toBeNull();
    expect(await updateBook("nonexistent-id", { rating: 1 })).toBeNull();

    const afterDeletes = await listBooks();
    expect(afterDeletes.books).toHaveLength(879);
    expect(afterDeletes.books.some((b) => b.id === created.id)).toBe(false);
    expect(afterDeletes.books.some((b) => b.id === borgesBase.id)).toBe(false);

    // Verify atomic rename left no leftover temp files
    const nestedFiles = await readdir(path.join(tempDir, "nested"));
    expect(nestedFiles).toEqual(["book-tracker-state.json"]);
  });

  it("serializes concurrent creates safely without losing updates", async () => {
    const [first, second] = await Promise.all([
      createBook({ ...BASE_CREATE_INPUT, title: "Concurrent Book 1" }),
      createBook({ ...BASE_CREATE_INPUT, title: "Concurrent Book 2" }),
    ]);

    const after = await listBooks();
    expect(after.books).toHaveLength(882);
    expect(after.books.some((b) => b.id === first.id)).toBe(true);
    expect(after.books.some((b) => b.id === second.id)).toBe(true);
  });

  it("bulk updates both base and created books in local mode and skips missing or deleted ids", async () => {
    const initial = await listBooks();
    const baseOne = initial.books[0];
    const baseToDelete = initial.books[1];
    const createdBook = await createBook({
      ...BASE_CREATE_INPUT,
      title: "Bulk Created Book",
      tags: ["initial tag", "remove me"],
    });

    expect(await deleteBook(baseToDelete.id)).toBe(true);

    const result = await bulkUpdateBooks(
      [baseOne.id, createdBook.id, baseToDelete.id, "does-not-exist", baseOne.id],
      {
        reading_status: "finished",
        shelf: 19,
        top_category: "Philosophy & Theory",
        add_tags: ["curated-bulk"],
        remove_tags: ["remove me"],
      },
    );

    expect(result.updated).toHaveLength(2);
    expect(result.skipped).toEqual([
      { id: baseToDelete.id, reason: "Book not found." },
      { id: "does-not-exist", reason: "Book not found." },
    ]);

    const updatedBase = result.updated.find((b) => b.id === baseOne.id)!;
    expect(updatedBase.reading_status).toBe("finished");
    expect(updatedBase.shelf).toBe(19);
    expect(updatedBase.top_category).toBe("Philosophy & Theory");
    expect(updatedBase.tags).toContain("curated-bulk");

    const updatedCreated = result.updated.find((b) => b.id === createdBook.id)!;
    expect(updatedCreated.reading_status).toBe("finished");
    expect(updatedCreated.shelf).toBe(19);
    expect(updatedCreated.tags).toEqual(["initial tag", "curated-bulk"]);

    const persisted = await listBooks();
    const reloadedCreated = persisted.books.find(
      (b) => b.id === createdBook.id,
    )!;
    expect(reloadedCreated.reading_status).toBe("finished");
    expect(reloadedCreated.shelf).toBe(19);
    expect(reloadedCreated.tags).toEqual(["initial tag", "curated-bulk"]);
  });
});

describe("supabase bulkUpdateBooks", () => {
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("maps columns cleanly, skips missing books, and isolates 23505 unique copy violations per row", async () => {
    const row1 = {
      id: "11111111-1111-1111-1111-111111111111",
      book_key: "bk_one",
      title: "Book One",
      author: "Author One",
      category: "Literature",
      edition: null,
      shelf_row: 1,
      position: "Vertical (1)",
      top_category: "Literature",
      sub_category: null,
      summary: null,
      tags: ["essay"],
      publish_year: 1990,
      reading_status: "unread" as const,
      rating: null,
      date_started: null,
      date_finished: null,
      personal_notes: null,
      loaned_to: null,
      notes: null,
      spine_color: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    const row2 = {
      ...row1,
      id: "22222222-2222-2222-2222-222222222222",
      book_key: "bk_two",
      title: "Book Two",
      sub_category: "Metaphysics",
    };

    const updatePayloads: Array<{ id: string; payload: Record<string, unknown> }> = [];

    const mockClient = {
      from: (table: string) => {
        expect(table).toBe("books");
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column === "book_key") {
                return {
                  data: [row1, row2].filter((r) => values.includes(r.book_key)),
                  error: null,
                };
              }
              return { data: [], error: null };
            },
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => ({
              select: () => ({
                single: async () => {
                  updatePayloads.push({ id, payload });
                  if (id === row2.id) {
                    return {
                      data: null,
                      error: { code: "23505", message: "duplicate key value" },
                    };
                  }
                  return {
                    data: {
                      ...row1,
                      ...payload,
                    },
                    error: null,
                  };
                },
              }),
            }),
          }),
        };
      },
    };

    vi.spyOn(supabaseAdmin, "createSupabaseAdminClient").mockReturnValue(
      mockClient as unknown as ReturnType<
        typeof supabaseAdmin.createSupabaseAdminClient
      >,
    );

    const result = await bulkUpdateBooks(["bk_one", "bk_two", "bk_missing"], {
      reading_status: "reading",
      shelf: 10,
      top_category: "Philosophy & Theory",
      add_tags: ["phenomenology"],
    });

    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].id).toBe("bk_one");
    expect(result.updated[0].reading_status).toBe("reading");
    expect(result.updated[0].shelf).toBe(10);
    expect(result.updated[0].top_category).toBe("Philosophy & Theory");
    expect(result.updated[0].tags).toEqual(["essay", "phenomenology"]);

    expect(result.skipped).toEqual([
      {
        id: "bk_two",
        reason: "A volume with this shelf copy identity already exists.",
      },
      { id: "bk_missing", reason: "Book not found." },
    ]);

    expect(updatePayloads[0].payload).toMatchObject({
      reading_status: "reading",
      shelf_row: 10,
      top_category: "Philosophy & Theory",
      category: "Philosophy & Theory",
      tags: ["essay", "phenomenology"],
    });
    expect(updatePayloads[1].payload.category).toBe("Metaphysics");
  });
});
