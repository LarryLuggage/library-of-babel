import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSessionToken,
  CURATOR_COOKIE_NAME,
  resetAuthRateLimitForTests,
} from "@/lib/auth/curator";
import { listBooks } from "@/lib/books/repository";
import { POST, resetLibrarianRateLimitForTests } from "./route";

describe("/api/librarian route", () => {
  let tempDir = "";
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    resetAuthRateLimitForTests();
    resetLibrarianRateLimitForTests();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "babel-librarian-test-"));
    savedEnv = {
      BOOK_OWNER_PASSPHRASE: process.env.BOOK_OWNER_PASSPHRASE,
      BOOK_SESSION_SECRET: process.env.BOOK_SESSION_SECRET,
      BOOK_TRACKER_STATE_PATH: process.env.BOOK_TRACKER_STATE_PATH,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_MODEL: process.env.GEMINI_MODEL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

    delete process.env.BOOK_OWNER_PASSPHRASE;
    delete process.env.BOOK_SESSION_SECRET;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
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
    resetLibrarianRateLimitForTests();
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

  it("returns 401 when GEMINI_API_KEY and BOOK_OWNER_PASSPHRASE are set and caller is unauthenticated", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.BOOK_OWNER_PASSPHRASE = "secret-curator-passphrase";

    const res = await POST(
      new Request("http://localhost/api/librarian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Recommend unread philosophy" }),
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Curator sign-in required");
  });

  it("validates JSON (400) and prompt/history payload (422)", async () => {
    const badJson = await POST(
      new Request("http://localhost/api/librarian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
    );
    expect(badJson.status).toBe(400);

    const shortPrompt = await POST(
      new Request("http://localhost/api/librarian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      }),
    );
    expect(shortPrompt.status).toBe(422);

    const badHistory = await POST(
      new Request("http://localhost/api/librarian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Recommend ancient Greek philosophy",
          history: [{ role: "system", text: "invalid role" }],
        }),
      }),
    );
    expect(badHistory.status).toBe(422);
  });

  it("returns 200 in local fallback mode when GEMINI_API_KEY is unset", async () => {
    const res = await POST(
      new Request("http://localhost/api/librarian", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "unread philosophy books on shelf 1" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      reply: string;
      recommendations: Array<{ book: { id: string; title: string }; pitch: string }>;
    };

    expect(body.mode).toBe("local");
    expect(body.reply).toContain("880-volume catalogue");
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.recommendations[0].book.id).toBeTruthy();
  });

  it("returns 200 with mocked Gemini response when authenticated and enforces 429 rate limit", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    process.env.BOOK_OWNER_PASSPHRASE = "secret-curator-passphrase";

    const { books } = await listBooks();
    const realBook = books[0];
    const token = createSessionToken();

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reply: "A grounded suggestion straight from your catalogue.",
                      recommendations: [
                        {
                          book_id: realBook.id,
                          pitch: "Picked directly from your shelves.",
                        },
                        {
                          book_id: "bk_fake_hallucinated_999",
                          pitch: "Should be dropped.",
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const makeAuthenticatedRequest = () =>
      POST(
        new Request("http://localhost/api/librarian", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `${CURATOR_COOKIE_NAME}=${token}`,
            "x-forwarded-for": "203.0.113.42",
          },
          body: JSON.stringify({
            prompt: "Suggest a classic from my shelves",
          }),
        }),
      );

    // First 15 requests succeed
    const firstRes = await makeAuthenticatedRequest();
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as {
      mode: string;
      model: string;
      reply: string;
      recommendations: Array<{ book: { id: string } }>;
    };
    expect(firstBody.mode).toBe("gemini");
    expect(firstBody.model).toBe("gemini-2.5-flash");
    expect(firstBody.recommendations.map((r) => r.book.id)).toEqual([
      realBook.id,
    ]);

    for (let i = 1; i < 15; i += 1) {
      const res = await makeAuthenticatedRequest();
      expect(res.status).toBe(200);
    }

    // 16th request within window triggers 429 + Retry-After
    const limitedRes = await makeAuthenticatedRequest();
    expect(limitedRes.status).toBe(429);
    expect(Number(limitedRes.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("returns 502 when upstream Gemini API fails", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.BOOK_OWNER_PASSPHRASE = "secret-curator-passphrase";
    const token = createSessionToken();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Service Unavailable", { status: 503 }),
    );

    const res = await POST(
      new Request("http://localhost/api/librarian", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${CURATOR_COOKIE_NAME}=${token}`,
        },
        body: JSON.stringify({ prompt: "Recommend historical essays" }),
      }),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Gemini Librarian is temporarily unavailable");
  });
});
