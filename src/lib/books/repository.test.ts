import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createBook,
  deleteBook,
  getStorageMode,
  isSupabaseConfigured,
  listBooks,
  updateBook,
} from "./repository";
import type { CreateBookInput } from "./validation";

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
});
