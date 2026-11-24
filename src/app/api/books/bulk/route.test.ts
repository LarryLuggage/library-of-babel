import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as SESSION_POST } from "@/app/api/auth/session/route";
import { resetAuthRateLimitForTests } from "@/lib/auth/curator";
import { GET as BOOKS_GET, POST as BOOKS_POST } from "../route";
import { POST as BULK_POST } from "./route";

describe("POST /api/books/bulk", () => {
  let tempDir = "";
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    resetAuthRateLimitForTests();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "babel-bulk-api-test-"));
    savedEnv = {
      BOOK_OWNER_PASSPHRASE: process.env.BOOK_OWNER_PASSPHRASE,
      BOOK_SESSION_SECRET: process.env.BOOK_SESSION_SECRET,
      BOOK_TRACKER_STATE_PATH: process.env.BOOK_TRACKER_STATE_PATH,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

    delete process.env.BOOK_OWNER_PASSPHRASE;
    delete process.env.BOOK_SESSION_SECRET;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.BOOK_TRACKER_STATE_PATH = path.join(
      tempDir,
      "book-tracker-state.json",
    );
  });

  afterEach(async () => {
    resetAuthRateLimitForTests();
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

  it("enforces curator auth (401) when BOOK_OWNER_PASSPHRASE is set and allows authenticated bulk updates", async () => {
    process.env.BOOK_OWNER_PASSPHRASE = "bulk-curator-passphrase";

    const listRes = await BOOKS_GET();
    const { books } = (await listRes.json()) as {
      books: Array<{ id: string }>;
    };

    const unauthRes = await BULK_POST(
      new Request("http://localhost/api/books/bulk", {
        method: "POST",
        body: JSON.stringify({
          ids: [books[0].id],
          patch: { reading_status: "reading" },
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(unauthRes.status).toBe(401);

    const loginRes = await SESSION_POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ passphrase: "bulk-curator-passphrase" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(loginRes.status).toBe(200);
    const sessionCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

    const authedRes = await BULK_POST(
      new Request("http://localhost/api/books/bulk", {
        method: "POST",
        body: JSON.stringify({
          ids: [books[0].id, books[1].id],
          patch: { reading_status: "reading" },
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(authedRes.status).toBe(200);
    const body = (await authedRes.json()) as {
      updated: Array<{ id: string; reading_status: string }>;
      skipped: Array<{ id: string; reason: string }>;
    };
    expect(body.updated).toHaveLength(2);
    expect(body.skipped).toEqual([]);
    expect(body.updated.every((b) => b.reading_status === "reading")).toBe(true);
  });

  it("returns 400 on malformed JSON and 422 on invalid bulk payloads", async () => {
    const badJsonRes = await BULK_POST(
      new Request("http://localhost/api/books/bulk", {
        method: "POST",
        body: "{not-json",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(badJsonRes.status).toBe(400);

    const invalidCases = [
      { ids: [], patch: { shelf: 2 } },
      { ids: ["bk_1"], patch: {} },
      { ids: ["bk_1"], patch: { title: "Not Allowed" } },
      { ids: ["bk_1"], patch: { shelf: -1 } },
      {
        ids: Array.from({ length: 201 }, (_, idx) => `bk_${idx}`),
        patch: { reading_status: "finished" },
      },
    ];

    for (const invalidPayload of invalidCases) {
      const res = await BULK_POST(
        new Request("http://localhost/api/books/bulk", {
          method: "POST",
          body: JSON.stringify(invalidPayload),
          headers: { "Content-Type": "application/json" },
        }),
      );
      expect(res.status).toBe(422);
      const errBody = (await res.json()) as {
        error: string;
        issues: string[];
      };
      expect(errBody.error).toBeTruthy();
      expect(Array.isArray(errBody.issues)).toBe(true);
    }
  });

  it("applies multi-book updates across base and created volumes, skips missing IDs, and persists state", async () => {
    const initialRes = await BOOKS_GET();
    const initialBody = (await initialRes.json()) as {
      books: Array<{ id: string; tags: string[] }>;
    };
    const baseBook = initialBody.books[0];

    const createRes = await BOOKS_POST(
      new Request("http://localhost/api/books", {
        method: "POST",
        body: JSON.stringify({
          title: "Bulk Route Test Book",
          author: "Test Author",
          shelf: 2,
          tags: ["draft", "essay"],
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(createRes.status).toBe(201);
    const { book: createdBook } = (await createRes.json()) as {
      book: { id: string };
    };

    const bulkRes = await BULK_POST(
      new Request("http://localhost/api/books/bulk", {
        method: "POST",
        body: JSON.stringify({
          ids: [baseBook.id, createdBook.id, "missing-volume-id"],
          patch: {
            reading_status: "finished",
            shelf: 33,
            top_category: "History & Reference",
            add_tags: "curated,  batch-3a ",
            remove_tags: ["draft"],
          },
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(bulkRes.status).toBe(200);
    const bulkBody = (await bulkRes.json()) as {
      updated: Array<{
        id: string;
        reading_status: string;
        shelf: number;
        top_category: string | null;
        tags: string[];
      }>;
      skipped: Array<{ id: string; reason: string }>;
    };

    expect(bulkBody.updated).toHaveLength(2);
    expect(bulkBody.skipped).toEqual([
      { id: "missing-volume-id", reason: "Book not found." },
    ]);

    const updatedCreated = bulkBody.updated.find(
      (b) => b.id === createdBook.id,
    )!;
    expect(updatedCreated.reading_status).toBe("finished");
    expect(updatedCreated.shelf).toBe(33);
    expect(updatedCreated.top_category).toBe("History & Reference");
    expect(updatedCreated.tags).toEqual(["essay", "curated", "batch-3a"]);

    const reloadedRes = await BOOKS_GET();
    const reloadedBody = (await reloadedRes.json()) as {
      books: Array<{
        id: string;
        reading_status: string;
        shelf: number;
        top_category: string | null;
        tags: string[];
      }>;
    };
    const persistedBase = reloadedBody.books.find((b) => b.id === baseBook.id)!;
    expect(persistedBase.reading_status).toBe("finished");
    expect(persistedBase.shelf).toBe(33);
    expect(persistedBase.top_category).toBe("History & Reference");
    expect(persistedBase.tags).toContain("curated");
    expect(persistedBase.tags).toContain("batch-3a");
  });
});
