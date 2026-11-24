import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as SESSION_POST } from "@/app/api/auth/session/route";
import { GET as BOOKS_GET } from "@/app/api/books/route";
import { resetAuthRateLimitForTests } from "@/lib/auth/curator";
import { DELETE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

describe("/api/quotes routes", () => {
  let tempDir = "";
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    resetAuthRateLimitForTests();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "babel-quotes-api-test-"));
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

  it("enforces curator auth, validates inputs, handles missing books, and supports full CRUD roundtrip", async () => {
    process.env.BOOK_OWNER_PASSPHRASE = "quotes-curator-passphrase";

    const booksRes = await BOOKS_GET();
    const { books } = (await booksRes.json()) as { books: Array<{ id: string }> };
    const bookId = books[0].id;

    // Public GET works without auth
    const initialGet = await GET();
    expect(initialGet.status).toBe(200);
    expect(await initialGet.json()).toEqual({ quotes: [] });

    // Unauthenticated POST / PATCH / DELETE -> 401
    const unauthPost = await POST(
      new Request("http://localhost/api/quotes", {
        method: "POST",
        body: JSON.stringify({ book_id: bookId, quote_text: "A passage." }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(unauthPost.status).toBe(401);

    const unauthPatch = await PATCH(
      new Request("http://localhost/api/quotes/qt_1", {
        method: "PATCH",
        body: JSON.stringify({ note: "Edited" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "qt_1" }) },
    );
    expect(unauthPatch.status).toBe(401);

    const unauthDelete = await DELETE(
      new Request("http://localhost/api/quotes/qt_1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "qt_1" }) },
    );
    expect(unauthDelete.status).toBe(401);

    // Sign in
    const loginRes = await SESSION_POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ passphrase: "quotes-curator-passphrase" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(loginRes.status).toBe(200);
    const sessionCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

    // Malformed JSON -> 400
    const badJsonRes = await POST(
      new Request("http://localhost/api/quotes", {
        method: "POST",
        body: "{bad",
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(badJsonRes.status).toBe(400);

    // Validation error -> 422
    const invalidRes = await POST(
      new Request("http://localhost/api/quotes", {
        method: "POST",
        body: JSON.stringify({ book_id: bookId, quote_text: "   " }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(invalidRes.status).toBe(422);

    // Missing book -> 404
    const missingBookRes = await POST(
      new Request("http://localhost/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          book_id: "nonexistent-volume",
          quote_text: "A stray quotation.",
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(missingBookRes.status).toBe(404);

    // Valid POST -> 201
    const createRes = await POST(
      new Request("http://localhost/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          book_id: bookId,
          quote_text: "I have always imagined that Paradise will be a kind of library.",
          page_number: "88",
          chapter: "Poem of the Gifts",
          note: "Opening epigraph",
          tags: "Library, Paradise, library",
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(createRes.status).toBe(201);
    const createdBody = (await createRes.json()) as {
      quote: { id: string; book_id: string; tags: string[]; note: string | null };
    };
    expect(createdBody.quote.book_id).toBe(bookId);
    expect(createdBody.quote.tags).toEqual(["library", "paradise"]);

    // GET reflects created quote
    const populatedGet = await GET();
    expect(populatedGet.status).toBe(200);
    const populatedBody = (await populatedGet.json()) as {
      quotes: Array<{ id: string }>;
    };
    expect(populatedBody.quotes).toHaveLength(1);
    expect(populatedBody.quotes[0].id).toBe(createdBody.quote.id);

    // PATCH validation -> 422
    const emptyPatch = await PATCH(
      new Request(`http://localhost/api/quotes/${createdBody.quote.id}`, {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
      { params: Promise.resolve({ id: createdBody.quote.id }) },
    );
    expect(emptyPatch.status).toBe(422);

    // Valid PATCH -> 200
    const patchRes = await PATCH(
      new Request(`http://localhost/api/quotes/${createdBody.quote.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          note: "Revised marginalia",
          tags: ["borges", "memory"],
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
      { params: Promise.resolve({ id: createdBody.quote.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patchedBody = (await patchRes.json()) as {
      quote: { note: string | null; tags: string[] };
    };
    expect(patchedBody.quote.note).toBe("Revised marginalia");
    expect(patchedBody.quote.tags).toEqual(["borges", "memory"]);

    // DELETE -> 200, second DELETE -> 404
    const deleteRes = await DELETE(
      new Request(`http://localhost/api/quotes/${createdBody.quote.id}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ id: createdBody.quote.id }) },
    );
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({
      deleted: true,
      id: createdBody.quote.id,
    });

    const deleteAgain = await DELETE(
      new Request(`http://localhost/api/quotes/${createdBody.quote.id}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ id: createdBody.quote.id }) },
    );
    expect(deleteAgain.status).toBe(404);
  });
});
