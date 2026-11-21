import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const CURATOR_COOKIE_NAME = "babel_curator_session";

const SESSION_VERSION = "v1";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const AUTH_RATE_LIMIT_MAX_FAILURES = 10;
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export type CuratorAuthState = {
  authRequired: boolean;
  isCurator: boolean;
};

export type AuthRateLimitStatus = {
  limited: boolean;
  count: number;
  retryAfterSeconds: number;
};

type FailureBucket = {
  count: number;
  windowStartMs: number;
};

const failureBuckets = new Map<string, FailureBucket>();

function getConfiguredPassphrase(): string {
  return process.env.BOOK_OWNER_PASSPHRASE?.trim() ?? "";
}

function getSessionSigningKey(passphrase: string): Buffer {
  const explicitSecret = process.env.BOOK_SESSION_SECRET?.trim();
  if (explicitSecret) {
    return Buffer.from(explicitSecret, "utf8");
  }

  return createHash("sha256")
    .update(`babel-curator-session:${passphrase}`, "utf8")
    .digest();
}

function parseCookieValue(
  cookieHeader: string | null,
  cookieName: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  const segments = cookieHeader.split(";");
  for (const segment of segments) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const name = segment.slice(0, separatorIndex).trim();
    if (name !== cookieName) {
      continue;
    }

    const rawValue = segment.slice(separatorIndex + 1).trim();
    if (!rawValue) {
      return "";
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function resolveClientKey(clientKeyOrRequest: string | Request): string {
  if (typeof clientKeyOrRequest === "string") {
    return clientKeyOrRequest.trim() || "local";
  }

  const forwardedFor = clientKeyOrRequest.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  return "local";
}

function pruneExpiredBuckets(nowMs: number): void {
  if (failureBuckets.size < 500) {
    return;
  }

  for (const [key, bucket] of failureBuckets.entries()) {
    if (nowMs - bucket.windowStartMs >= AUTH_RATE_LIMIT_WINDOW_MS) {
      failureBuckets.delete(key);
    }
  }
}

export function isCuratorAuthRequired(): boolean {
  return Boolean(getConfiguredPassphrase()) || process.env.NODE_ENV === "production";
}

/**
 * Generates a signed HMAC-SHA256 curator session token valid for 30 days.
 */
export function createSessionToken(nowMs: number = Date.now()): string {
  const passphrase = getConfiguredPassphrase();
  if (!passphrase) {
    throw new Error(
      "Cannot create curator session token when BOOK_OWNER_PASSPHRASE is not set.",
    );
  }

  const expiresAtMs = Math.trunc(nowMs + SESSION_TTL_MS);
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${SESSION_VERSION}.${expiresAtMs}.${nonce}`;
  const signature = createHmac("sha256", getSessionSigningKey(passphrase))
    .update(payload, "utf8")
    .digest("base64url");

  return `${payload}.${signature}`;
}

/**
 * Verifies a curator session token's structure, expiry, and HMAC-SHA256 signature.
 */
export function verifySessionToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const passphrase = getConfiguredPassphrase();
  if (!passphrase || typeof token !== "string" || !token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const [version, expiresRaw, nonce, providedSignature] = parts;
  if (
    version !== SESSION_VERSION ||
    !/^\d+$/.test(expiresRaw) ||
    !/^[A-Za-z0-9_-]+$/.test(nonce) ||
    !/^[A-Za-z0-9_-]+$/.test(providedSignature)
  ) {
    return false;
  }

  const expiresAtMs = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) {
    return false;
  }

  const payload = `${version}.${expiresRaw}.${nonce}`;
  const expectedSignature = createHmac(
    "sha256",
    getSessionSigningKey(passphrase),
  )
    .update(payload, "utf8")
    .digest("base64url");

  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Compares a candidate passphrase against BOOK_OWNER_PASSPHRASE in constant time via SHA-256 digests.
 */
export function verifyPassphrase(candidate: string): boolean {
  const expected = getConfiguredPassphrase();
  if (!expected || typeof candidate !== "string") {
    return false;
  }

  const normalizedCandidate = candidate.trim();
  if (!normalizedCandidate) {
    return false;
  }

  const candidateDigest = createHash("sha256")
    .update(normalizedCandidate, "utf8")
    .digest();
  const expectedDigest = createHash("sha256")
    .update(expected, "utf8")
    .digest();

  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function getCuratorSessionFromCookieHeader(
  cookieHeader: string | null,
): CuratorAuthState {
  const passphrase = getConfiguredPassphrase();

  if (!passphrase) {
    return process.env.NODE_ENV === "production"
      ? { authRequired: true, isCurator: false }
      : { authRequired: false, isCurator: true };
  }

  const token = parseCookieValue(cookieHeader, CURATOR_COOKIE_NAME);
  return {
    authRequired: true,
    isCurator: verifySessionToken(token),
  };
}

/**
 * Resolves curator auth state in Next.js Server Components using request cookies.
 */
export async function getServerCuratorSession(): Promise<CuratorAuthState> {
  const passphrase = getConfiguredPassphrase();

  if (!passphrase) {
    return process.env.NODE_ENV === "production"
      ? { authRequired: true, isCurator: false }
      : { authRequired: false, isCurator: true };
  }

  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const token = cookieStore.get(CURATOR_COOKIE_NAME)?.value;

  return {
    authRequired: true,
    isCurator: verifySessionToken(token),
  };
}

/**
 * Guards mutating route handlers. Returns null when authorized, or a 401/503 Response otherwise.
 */
export function requireCuratorAuth(request: Request): Response | null {
  const passphrase = getConfiguredPassphrase();

  if (!passphrase) {
    if (process.env.NODE_ENV === "production") {
      return Response.json(
        { error: "Curator authentication is not configured." },
        { status: 503 },
      );
    }

    return null;
  }

  const session = getCuratorSessionFromCookieHeader(
    request.headers.get("cookie"),
  );

  if (!session.isCurator) {
    return Response.json(
      { error: "Curator sign-in required." },
      { status: 401 },
    );
  }

  return null;
}

export function getAuthRateLimitStatus(
  clientKeyOrRequest: string | Request,
  nowMs: number = Date.now(),
): AuthRateLimitStatus {
  const key = resolveClientKey(clientKeyOrRequest);
  const existing = failureBuckets.get(key);

  if (!existing) {
    return { limited: false, count: 0, retryAfterSeconds: 0 };
  }

  const elapsedMs = nowMs - existing.windowStartMs;
  if (elapsedMs >= AUTH_RATE_LIMIT_WINDOW_MS) {
    failureBuckets.delete(key);
    return { limited: false, count: 0, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((AUTH_RATE_LIMIT_WINDOW_MS - elapsedMs) / 1000),
  );

  return {
    limited: existing.count >= AUTH_RATE_LIMIT_MAX_FAILURES,
    count: existing.count,
    retryAfterSeconds,
  };
}

/**
 * Checks whether the client is rate-limited and records a failed attempt if not already locked out.
 */
export function checkAndRecordAuthFailure(
  clientKeyOrRequest: string | Request,
  nowMs: number = Date.now(),
): AuthRateLimitStatus {
  pruneExpiredBuckets(nowMs);
  const key = resolveClientKey(clientKeyOrRequest);
  const current = failureBuckets.get(key);

  if (!current || nowMs - current.windowStartMs >= AUTH_RATE_LIMIT_WINDOW_MS) {
    failureBuckets.set(key, { count: 1, windowStartMs: nowMs });
    return {
      limited: false,
      count: 1,
      retryAfterSeconds: Math.ceil(AUTH_RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(
      (AUTH_RATE_LIMIT_WINDOW_MS - (nowMs - current.windowStartMs)) / 1000,
    ),
  );

  if (current.count >= AUTH_RATE_LIMIT_MAX_FAILURES) {
    return {
      limited: true,
      count: current.count,
      retryAfterSeconds,
    };
  }

  current.count += 1;
  return {
    limited: false,
    count: current.count,
    retryAfterSeconds,
  };
}

export function clearAuthFailures(clientKeyOrRequest: string | Request): void {
  const key = resolveClientKey(clientKeyOrRequest);
  failureBuckets.delete(key);
}

export function resetAuthRateLimitForTests(): void {
  failureBuckets.clear();
}

export function buildSessionCookieHeader(token: string): string {
  const securePart =
    process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CURATOR_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${securePart}`;
}

export function buildClearCookieHeader(): string {
  const securePart =
    process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CURATOR_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${securePart}`;
}
