import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as SESSION_POST } from "@/app/api/auth/session/route";
import {
  DELETE as CONNECTION_DELETE,
} from "@/app/api/connections/[id]/route";
import {
  GET as CONNECTIONS_GET,
  POST as CONNECTIONS_POST,
} from "@/app/api/connections/route";
import { resetAuthRateLimitForTests } from "@/lib/auth/curator";
import { DELETE, PATCH } from "./[id]/route";
import { GET as LOOKUP_GET } from "./lookup/route";
import { GET, POST } from "./route";
import { POST as SEED_POST } from "./seed/route";

describe("/api/books, /api/connections, and /api/books/lookup routes", () => {
  let tempDir = "";
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    resetAuthRateLimitForTests();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "babel-api-test-"));
    savedEnv = {
      BOOK_OWNER_PASSPHRASE: process.env.BOOK_OWNER_PASSPHRASE,
      BOOK_SESSION_SECRET: process.env.BOOK_SESSION_SECRET,
      BOOK_SEED_TOKEN: process.env.BOOK_SEED_TOKEN,
      BOOK_TRACKER_STATE_PATH: process.env.BOOK_TRACKER_STATE_PATH,
      GOOGLE_BOOKS_API_KEY: process.env.GOOGLE_BOOKS_API_KEY,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

    delete process.env.BOOK_OWNER_PASSPHRASE;
    delete process.env.BOOK_SESSION_SECRET;
    delete process.env.GOOGLE_BOOKS_API_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.BOOK_TRACKER_STATE_PATH = path.join(
      tempDir,
      "book-tracker-state.json",
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it("enforces curator session auth on mutating book and connection endpoints", async () => {
    process.env.BOOK_OWNER_PASSPHRASE = "curator-test-passphrase";

    const listRes = await GET();
    expect(listRes.status).toBe(200);
    const { books } = (await listRes.json()) as {
      books: Array<{ id: string }>;
    };
    const bookA = books[0].id;
    const bookB = books[1].id;

    // Unauthenticated mutations -> 401
    const unauthBookPost = await POST(
      new Request("http://localhost/api/books", {
        method: "POST",
        body: JSON.stringify({
          title: "Protected Book",
          author: "Author",
          shelf: 1,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(unauthBookPost.status).toBe(401);

    const unauthBookPatch = await PATCH(
      new Request(`http://localhost/api/books/${bookA}`, {
        method: "PATCH",
        body: JSON.stringify({ rating: 5 }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: bookA }) },
    );
    expect(unauthBookPatch.status).toBe(401);

    const unauthBookDelete = await DELETE(
      new Request(`http://localhost/api/books/${bookA}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: bookA }) },
    );
    expect(unauthBookDelete.status).toBe(401);

    const unauthConnPost = await CONNECTIONS_POST(
      new Request("http://localhost/api/connections", {
        method: "POST",
        body: JSON.stringify({
          source_book_id: bookA,
          target_book_id: bookB,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(unauthConnPost.status).toBe(401);

    const unauthConnDelete = await CONNECTION_DELETE(
      new Request("http://localhost/api/connections/conn_1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "conn_1" }) },
    );
    expect(unauthConnDelete.status).toBe(401);

    // Sign in via /api/auth/session
    const loginRes = await SESSION_POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ passphrase: "curator-test-passphrase" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(loginRes.status).toBe(200);
    const setCookieHeader = loginRes.headers.get("set-cookie");
    expect(setCookieHeader).toBeTruthy();
    const sessionCookie = setCookieHeader!.split(";")[0];

    // Authenticated POST /api/books -> 201
    const authedBookPost = await POST(
      new Request("http://localhost/api/books", {
        method: "POST",
        body: JSON.stringify({
          title: "Authorized Volume",
          author: "Curator Author",
          shelf: 41,
          position: "Vertical (2)",
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(authedBookPost.status).toBe(201);
    const createdBookBody = (await authedBookPost.json()) as {
      book: { id: string };
    };

    // Authenticated /api/connections CRUD
    const emptyConnGet = await CONNECTIONS_GET();
    expect(emptyConnGet.status).toBe(200);
    expect(await emptyConnGet.json()).toEqual({ connections: [] });

    const invalidConnPost = await CONNECTIONS_POST(
      new Request("http://localhost/api/connections", {
        method: "POST",
        body: JSON.stringify({
          source_book_id: bookA,
          target_book_id: bookA,
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(invalidConnPost.status).toBe(422);

    const missingBookConnPost = await CONNECTIONS_POST(
      new Request("http://localhost/api/connections", {
        method: "POST",
        body: JSON.stringify({
          source_book_id: bookA,
          target_book_id: "nonexistent-book",
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(missingBookConnPost.status).toBe(404);

    const createConnRes = await CONNECTIONS_POST(
      new Request("http://localhost/api/connections", {
        method: "POST",
        body: JSON.stringify({
          source_book_id: bookA,
          target_book_id: createdBookBody.book.id,
          connection_type: "responds_to",
          description: "Annotated bridge.",
          weight: 2,
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(createConnRes.status).toBe(201);
    const createdConnBody = (await createConnRes.json()) as {
      connection: { id: string };
    };

    // Duplicate pair -> 409
    const dupConnRes = await CONNECTIONS_POST(
      new Request("http://localhost/api/connections", {
        method: "POST",
        body: JSON.stringify({
          source_book_id: createdBookBody.book.id,
          target_book_id: bookA,
          connection_type: "custom",
        }),
        headers: {
          "Content-Type": "application/json",
          cookie: sessionCookie,
        },
      }),
    );
    expect(dupConnRes.status).toBe(409);

    const popConnGet = await CONNECTIONS_GET();
    expect(popConnGet.status).toBe(200);
    const popConnBody = (await popConnGet.json()) as {
      connections: Array<{ id: string }>;
    };
    expect(popConnBody.connections).toHaveLength(1);

    const delConnRes = await CONNECTION_DELETE(
      new Request(
        `http://localhost/api/connections/${createdConnBody.connection.id}`,
        {
          method: "DELETE",
          headers: { cookie: sessionCookie },
        },
      ),
      { params: Promise.resolve({ id: createdConnBody.connection.id }) },
    );
    expect(delConnRes.status).toBe(200);

    const delConnAgain = await CONNECTION_DELETE(
      new Request(
        `http://localhost/api/connections/${createdConnBody.connection.id}`,
        {
          method: "DELETE",
          headers: { cookie: sessionCookie },
        },
      ),
      { params: Promise.resolve({ id: createdConnBody.connection.id }) },
    );
    expect(delConnAgain.status).toBe(404);

    // Cleanup created book
    const delBookRes = await DELETE(
      new Request(`http://localhost/api/books/${createdBookBody.book.id}`, {
        method: "DELETE",
        headers: { cookie: sessionCookie },
      }),
      { params: Promise.resolve({ id: createdBookBody.book.id }) },
    );
    expect(delBookRes.status).toBe(200);
  });

  it("validates queries and returns normalized results or 502 on /api/books/lookup", async () => {
    const shortRes = await LOOKUP_GET(
      new Request("http://localhost/api/books/lookup?q=a"),
    );
    expect(shortRes.status).toBe(400);
    expect(await shortRes.json()).toEqual({
      error: "Search query must be at least 2 characters.",
      candidates: [],
    });

    const missingRes = await LOOKUP_GET(
      new Request("http://localhost/api/books/lookup"),
    );
    expect(missingRes.status).toBe(400);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith("https://openlibrary.org/search.json")) {
          return Response.json({
            docs: [
              {
                key: "/works/OL99W",
                title: "The Name of the Rose",
                author_name: ["Umberto Eco"],
                publisher: ["Harcourt"],
                first_publish_year: 1980,
                subject: ["Semiotics", "Literature"],
              },
            ],
          });
        }
        return Response.json({
          description: "Mystery in a medieval abbey.",
        });
      });

    const okRes = await LOOKUP_GET(
      new Request("http://localhost/api/books/lookup?q=Name%20of%20the%20Rose"),
    );
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as {
      candidates: Array<{ title: string; summary: string | null }>;
    };
    expect(okBody.candidates).toHaveLength(1);
    expect(okBody.candidates[0].title).toBe("The Name of the Rose");
    expect(okBody.candidates[0].summary).toBe("Mystery in a medieval abbey.");
    expect(fetchSpy).toHaveBeenCalled();

    fetchSpy.mockRejectedValueOnce(new Error("Upstream timeout"));
    const errorRes = await LOOKUP_GET(
      new Request("http://localhost/api/books/lookup?q=Ficciones"),
    );
    expect(errorRes.status).toBe(502);
    expect(await errorRes.json()).toEqual({
      error: "Bibliographic lookup service unavailable.",
      candidates: [],
    });
  });
});
