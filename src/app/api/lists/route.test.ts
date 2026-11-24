import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as SESSION_POST } from "@/app/api/auth/session/route";
import { GET as BOOKS_GET } from "@/app/api/books/route";
import { resetAuthRateLimitForTests } from "@/lib/auth/curator";
import {
  DELETE as ITEMS_DELETE,
  PATCH as ITEMS_PATCH,
  POST as ITEMS_POST,
} from "./[id]/items/route";
import { DELETE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

describe("/api/lists routes", () => {
  let tempDir = "";
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    resetAuthRateLimitForTests();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "babel-lists-api-test-"));
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

  it("enforces curator auth, rejects duplicate slugs/items with 409, and supports full list & item roundtrip", async () => {
    process.env.BOOK_OWNER_PASSPHRASE = "lists-curator-passphrase";

    const booksRes = await BOOKS_GET();
    const { books } = (await booksRes.json()) as { books: Array<{ id: string }> };
    const bookA = books[0].id;
    const bookB = books[1].id;
    const bookC = books[2].id;

    // Public GET -> 200
    const initialGet = await GET();
    expect(initialGet.status).toBe(200);
    expect(await initialGet.json()).toEqual({ lists: [] });

    // Unauthenticated mutations -> 401
    expect(
      (
        await POST(
          new Request("http://localhost/api/lists", {
            method: "POST",
            body: JSON.stringify({ name: "Up Next", is_queue: true }),
            headers: { "Content-Type": "application/json" },
          }),
        )
      ).status,
    ).toBe(401);

    expect(
      (
        await ITEMS_POST(
          new Request("http://localhost/api/lists/lst_1/items", {
            method: "POST",
            body: JSON.stringify({ book_id: bookA }),
            headers: { "Content-Type": "application/json" },
          }),
          { params: Promise.resolve({ id: "lst_1" }) },
        )
      ).status,
    ).toBe(401);

    // Sign in
    const loginRes = await SESSION_POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ passphrase: "lists-curator-passphrase" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(loginRes.status).toBe(200);
    const sessionCookie = loginRes.headers.get("set-cookie")!.split(";")[0];

    // Create queue -> 201
    const createQueueRes = await POST(
      new Request("http://localhost/api/lists", {
        method: "POST",
        body: JSON.stringify({
          name: "Up Next",
          description: "Ranked reading queue",
          is_queue: true,
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(createQueueRes.status).toBe(201);
    const queueBody = (await createQueueRes.json()) as {
      list: { id: string; slug: string; is_queue: boolean };
    };
    expect(queueBody.list.slug).toBe("up-next");
    expect(queueBody.list.is_queue).toBe(true);

    // Duplicate slug -> 409
    const dupSlugRes = await POST(
      new Request("http://localhost/api/lists", {
        method: "POST",
        body: JSON.stringify({ name: "up  next!" }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(dupSlugRes.status).toBe(409);

    // Add 3 books -> 201
    for (const bid of [bookA, bookB, bookC]) {
      const addRes = await ITEMS_POST(
        new Request(`http://localhost/api/lists/${queueBody.list.id}/items`, {
          method: "POST",
          body: JSON.stringify({ book_id: bid }),
          headers: {
            "Content-Type": "application/json",
            cookie: sessionCookie,
          },
        }),
        { params: Promise.resolve({ id: queueBody.list.id }) },
      );
      expect(addRes.status).toBe(201);
    }

    // Duplicate item -> 409
    const dupItemRes = await ITEMS_POST(
      new Request(`http://localhost/api/lists/${queueBody.list.id}/items`, {
        method: "POST",
        body: JSON.stringify({ book_id: bookA }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
      { params: Promise.resolve({ id: queueBody.list.id }) },
    );
    expect(dupItemRes.status).toBe(409);

    // Reorder items -> 200
    const reorderRes = await ITEMS_PATCH(
      new Request(`http://localhost/api/lists/${queueBody.list.id}/items`, {
        method: "PATCH",
        body: JSON.stringify({ book_ids: [bookC, bookA] }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
      { params: Promise.resolve({ id: queueBody.list.id }) },
    );
    expect(reorderRes.status).toBe(200);
    const reorderedBody = (await reorderRes.json()) as {
      list: { items: Array<{ book_id: string; position: number }> };
    };
    expect(reorderedBody.list.items.map((i) => i.book_id)).toEqual([
      bookC,
      bookA,
      bookB,
    ]);
    expect(reorderedBody.list.items.map((i) => i.position)).toEqual([0, 1, 2]);

    // Remove item via searchParam -> 200
    const removeByParam = await ITEMS_DELETE(
      new Request(
        `http://localhost/api/lists/${queueBody.list.id}/items?book_id=${encodeURIComponent(bookA)}`,
        {
          method: "DELETE",
          headers: { cookie: sessionCookie },
        },
      ),
      { params: Promise.resolve({ id: queueBody.list.id }) },
    );
    expect(removeByParam.status).toBe(200);
    const afterRemoveParam = (await removeByParam.json()) as {
      list: { items: Array<{ book_id: string; position: number }> };
      deleted: boolean;
    };
    expect(afterRemoveParam.deleted).toBe(true);
    expect(afterRemoveParam.list.items.map((i) => i.book_id)).toEqual([
      bookC,
      bookB,
    ]);
    expect(afterRemoveParam.list.items.map((i) => i.position)).toEqual([0, 1]);

    // Remove item via JSON body -> 200
    const removeByBody = await ITEMS_DELETE(
      new Request(`http://localhost/api/lists/${queueBody.list.id}/items`, {
        method: "DELETE",
        body: JSON.stringify({ book_id: bookC }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
      { params: Promise.resolve({ id: queueBody.list.id }) },
    );
    expect(removeByBody.status).toBe(200);

    // Update list metadata -> 200
    const patchListRes = await PATCH(
      new Request(`http://localhost/api/lists/${queueBody.list.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Priority Queue" }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
      { params: Promise.resolve({ id: queueBody.list.id }) },
    );
    expect(patchListRes.status).toBe(200);
    const patchedList = (await patchListRes.json()) as {
      list: { name: string; slug: string };
    };
    expect(patchedList.list.name).toBe("Priority Queue");
    expect(patchedList.list.slug).toBe("priority-queue");

    // Delete list -> 200, second delete -> 404
    const deleteListRes = await DELETE(
      new Request(`http://localhost/api/lists/${queueBody.list.id}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ id: queueBody.list.id }) },
    );
    expect(deleteListRes.status).toBe(200);
    expect(await deleteListRes.json()).toEqual({
      deleted: true,
      id: queueBody.list.id,
    });

    const deleteListAgain = await DELETE(
      new Request(`http://localhost/api/lists/${queueBody.list.id}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ id: queueBody.list.id }) },
    );
    expect(deleteListAgain.status).toBe(404);
  });
});
