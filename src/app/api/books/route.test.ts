import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DELETE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";
import { POST as SEED_POST } from "./seed/route";

describe("/api/books routes", () => {
  let tempDir = "";
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "babel-api-test-"));
    savedEnv = {
      BOOK_SEED_TOKEN: process.env.BOOK_SEED_TOKEN,
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

  it("handles GET, POST, PATCH, and DELETE roundtrips cleanly", async () => {
    const getRes = await GET();
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      books: { id: string; title: string }[];
      storageMode: string;
    };
    expect(getBody.storageMode).toBe("local");
    expect(getBody.books).toHaveLength(880);

    // Invalid JSON -> 400
    const badJsonRes = await POST(
      new Request("http://localhost/api/books", {
        method: "POST",
        body: "{bad",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(badJsonRes.status).toBe(400);

    // Invalid payload -> 422
    const invalidRes = await POST(
      new Request("http://localhost/api/books", {
        method: "POST",
        body: JSON.stringify({ title: "", author: "Author", shelf: -1 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(invalidRes.status).toBe(422);

    // Valid create -> 201
    const createRes = await POST(
      new Request("http://localhost/api/books", {
        method: "POST",
        body: JSON.stringify({
          title: "The Book of Sand",
          author: "Jorge Luis Borges",
          shelf: 41,
          position: "Vertical (1)",
          tags: "short stories, infinity",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(createRes.status).toBe(201);
    const createdBody = (await createRes.json()) as {
      book: { id: string; title: string; reading_status: string };
    };
    expect(createdBody.book.title).toBe("The Book of Sand");
    expect(createdBody.book.reading_status).toBe("unread");

    // Valid PATCH -> 200
    const patchRes = await PATCH(
      new Request(`http://localhost/api/books/${createdBody.book.id}`, {
        method: "PATCH",
        body: JSON.stringify({ reading_status: "finished", rating: 5 }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: createdBody.book.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patchedBody = (await patchRes.json()) as {
      book: { reading_status: string; rating: number };
    };
    expect(patchedBody.book.reading_status).toBe("finished");
    expect(patchedBody.book.rating).toBe(5);

    // Missing ID PATCH -> 404
    const missingPatchRes = await PATCH(
      new Request("http://localhost/api/books/missing-id", {
        method: "PATCH",
        body: JSON.stringify({ rating: 3 }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "missing-id" }) },
    );
    expect(missingPatchRes.status).toBe(404);

    // Valid DELETE -> 200, second DELETE -> 404
    const deleteRes = await DELETE(
      new Request(`http://localhost/api/books/${createdBody.book.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: createdBody.book.id }) },
    );
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({
      deleted: true,
      id: createdBody.book.id,
    });

    const missingDeleteRes = await DELETE(
      new Request(`http://localhost/api/books/${createdBody.book.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: createdBody.book.id }) },
    );
    expect(missingDeleteRes.status).toBe(404);
  });

  it("enforces token auth and 5 MB payload limit on /api/books/seed", async () => {
    process.env.BOOK_SEED_TOKEN = "secret-seed-token";

    const unauthRes = await SEED_POST(
      new Request("http://localhost/api/books/seed", {
        method: "POST",
        body: "[]",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(unauthRes.status).toBe(401);

    const oversizedPayload = JSON.stringify([
      {
        title: "Large",
        author: "Author",
        summary: "x".repeat(5 * 1024 * 1024 + 1024),
      },
    ]);
    const tooLargeRes = await SEED_POST(
      new Request("http://localhost/api/books/seed", {
        method: "POST",
        body: oversizedPayload,
        headers: {
          authorization: "Bearer secret-seed-token",
          "content-type": "application/json",
        },
      }),
    );
    expect(tooLargeRes.status).toBe(413);
  });
});
