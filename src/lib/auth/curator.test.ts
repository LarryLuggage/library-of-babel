import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as SESSION_DELETE,
  GET as SESSION_GET,
  POST as SESSION_POST,
} from "@/app/api/auth/session/route";
import {
  buildClearCookieHeader,
  buildSessionCookieHeader,
  checkAndRecordAuthFailure,
  clearAuthFailures,
  CURATOR_COOKIE_NAME,
  createSessionToken,
  getAuthRateLimitStatus,
  getCuratorSessionFromCookieHeader,
  isCuratorAuthRequired,
  requireCuratorAuth,
  resetAuthRateLimitForTests,
  verifyPassphrase,
  verifySessionToken,
} from "./curator";

describe("curator session auth", () => {
  beforeEach(() => {
    resetAuthRateLimitForTests();
    vi.unstubAllEnvs();
    vi.stubEnv("BOOK_OWNER_PASSPHRASE", "");
    vi.stubEnv("BOOK_SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    resetAuthRateLimitForTests();
    vi.unstubAllEnvs();
  });

  it("allows open local editing when passphrase is unset in non-production", () => {
    expect(isCuratorAuthRequired()).toBe(false);
    expect(getCuratorSessionFromCookieHeader(null)).toEqual({
      authRequired: false,
      isCurator: true,
    });
    expect(
      requireCuratorAuth(new Request("http://localhost/api/books")),
    ).toBeNull();
    expect(() => createSessionToken()).toThrow();
  });

  it("fails closed with 503 when passphrase is unset in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(isCuratorAuthRequired()).toBe(true);
    expect(getCuratorSessionFromCookieHeader(null)).toEqual({
      authRequired: true,
      isCurator: false,
    });

    const authResponse = requireCuratorAuth(
      new Request("http://localhost/api/books", { method: "POST" }),
    );
    expect(authResponse).not.toBeNull();
    expect(authResponse!.status).toBe(503);
    expect(await authResponse!.json()).toEqual({
      error: "Curator authentication is not configured.",
    });

    const postRes = await SESSION_POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ passphrase: "anything" }),
      }),
    );
    expect(postRes.status).toBe(503);
  });

  it("verifies passphrases in constant time and mints/verifies 30-day HMAC tokens", () => {
    vi.stubEnv("BOOK_OWNER_PASSPHRASE", "babel-library-secret");

    expect(isCuratorAuthRequired()).toBe(true);
    expect(verifyPassphrase("babel-library-secret")).toBe(true);
    expect(verifyPassphrase("  babel-library-secret \n")).toBe(true);
    expect(verifyPassphrase("wrong")).toBe(false);
    expect(verifyPassphrase("babel-library-secret-extra")).toBe(false);
    expect(verifyPassphrase("")).toBe(false);

    const issuedAt = 1_700_000_000_000;
    const token = createSessionToken(issuedAt);
    expect(token.split(".")).toHaveLength(4);
    expect(token.startsWith("v1.")).toBe(true);

    // Valid right after issuance and just before 30d expiry
    expect(verifySessionToken(token, issuedAt + 1000)).toBe(true);
    expect(
      verifySessionToken(token, issuedAt + 30 * 24 * 60 * 60 * 1000 - 1),
    ).toBe(true);

    // Expired at/after 30d
    expect(
      verifySessionToken(token, issuedAt + 30 * 24 * 60 * 60 * 1000),
    ).toBe(false);

    // Tampered token fails
    const parts = token.split(".");
    const tamperedSig = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3].slice(0, -1)}${parts[3].endsWith("a") ? "b" : "a"}`;
    expect(verifySessionToken(tamperedSig, issuedAt + 1000)).toBe(false);
    expect(verifySessionToken("v2.9999999999999.abc.def", issuedAt)).toBe(
      false,
    );

    // Explicit BOOK_SESSION_SECRET invalidates tokens signed under previous secret
    vi.stubEnv("BOOK_SESSION_SECRET", "override-hmac-key");
    expect(verifySessionToken(token, issuedAt + 1000)).toBe(false);

    const newSecretToken = createSessionToken(issuedAt);
    expect(verifySessionToken(newSecretToken, issuedAt + 1000)).toBe(true);
  });

  it("parses session cookies cleanly and guards requests with 401 when unauthenticated", async () => {
    vi.stubEnv("BOOK_OWNER_PASSPHRASE", "curator-pass");
    const token = createSessionToken();

    const cookieHeader = `theme=paper; ${CURATOR_COOKIE_NAME}=${token}; extra=a=b`;
    expect(getCuratorSessionFromCookieHeader(cookieHeader)).toEqual({
      authRequired: true,
      isCurator: true,
    });

    expect(
      getCuratorSessionFromCookieHeader(`${CURATOR_COOKIE_NAME}=invalid`),
    ).toEqual({
      authRequired: true,
      isCurator: false,
    });

    expect(
      requireCuratorAuth(
        new Request("http://localhost/api/books", {
          headers: { cookie: cookieHeader },
        }),
      ),
    ).toBeNull();

    const unauth = requireCuratorAuth(new Request("http://localhost/api/books"));
    expect(unauth).not.toBeNull();
    expect(unauth!.status).toBe(401);
    expect(await unauth!.json()).toEqual({
      error: "Curator sign-in required.",
    });

    expect(buildSessionCookieHeader(token)).toContain(
      `${CURATOR_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    );
    expect(buildSessionCookieHeader(token)).not.toContain("Secure");

    vi.stubEnv("NODE_ENV", "production");
    expect(buildSessionCookieHeader(token)).toContain("; Secure");
    expect(buildClearCookieHeader()).toContain("Max-Age=0; Secure");
  });

  it("enforces rate limiting per client IP across a 15-minute window", () => {
    const start = 1_700_000_000_000;
    const reqA = new Request("http://localhost/api/auth/session", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
    });
    const reqB = new Request("http://localhost/api/auth/session", {
      headers: { "x-forwarded-for": "198.51.100.7" },
    });

    for (let i = 1; i <= 10; i += 1) {
      const result = checkAndRecordAuthFailure(reqA, start + i * 1000);
      expect(result.limited).toBe(false);
      expect(result.count).toBe(i);
    }

    expect(getAuthRateLimitStatus(reqA, start + 20_000).limited).toBe(true);
    expect(checkAndRecordAuthFailure(reqA, start + 20_000).limited).toBe(true);

    // Different IP stays unaffected
    expect(getAuthRateLimitStatus(reqB, start + 20_000).limited).toBe(false);

    // Window expires after 15 minutes from first failure (recorded at start + 1000)
    expect(
      getAuthRateLimitStatus(reqA, start + 1000 + 15 * 60 * 1000).limited,
    ).toBe(false);

    // Clear resets count
    checkAndRecordAuthFailure(reqB, start);
    clearAuthFailures(reqB);
    expect(getAuthRateLimitStatus(reqB, start + 1000).count).toBe(0);
  });

  it("handles /api/auth/session GET, POST, rate limiting, and DELETE end-to-end", async () => {
    vi.stubEnv("BOOK_OWNER_PASSPHRASE", "secret-aleph");

    const initialGet = await SESSION_GET(
      new Request("http://localhost/api/auth/session"),
    );
    expect(initialGet.status).toBe(200);
    expect(await initialGet.json()).toEqual({
      authRequired: true,
      isCurator: false,
    });

    // Bad JSON -> 400
    const badJson = await SESSION_POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: "{bad",
      }),
    );
    expect(badJson.status).toBe(400);

    // 10 invalid attempts -> 401; 11th -> 429
    for (let i = 0; i < 10; i += 1) {
      const failRes = await SESSION_POST(
        new Request("http://localhost/api/auth/session", {
          method: "POST",
          body: JSON.stringify({ passphrase: "wrong" }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "192.0.2.55",
          },
        }),
      );
      expect(failRes.status).toBe(401);
    }

    const lockedRes = await SESSION_POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ passphrase: "secret-aleph" }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.55",
        },
      }),
    );
    expect(lockedRes.status).toBe(429);
    expect(lockedRes.headers.get("retry-after")).toBeTruthy();

    // Another client succeeds and receives HttpOnly cookie
    const okRes = await SESSION_POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ passphrase: "secret-aleph" }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.88",
        },
      }),
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ authRequired: true, isCurator: true });
    const setCookie = okRes.headers.get("set-cookie");
    expect(setCookie).toContain(`${CURATOR_COOKIE_NAME}=`);
    const cookiePair = setCookie!.split(";")[0];

    const authedGet = await SESSION_GET(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: cookiePair },
      }),
    );
    expect(await authedGet.json()).toEqual({
      authRequired: true,
      isCurator: true,
    });

    const delRes = await SESSION_DELETE();
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({
      authRequired: true,
      isCurator: false,
    });
    expect(delRes.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
