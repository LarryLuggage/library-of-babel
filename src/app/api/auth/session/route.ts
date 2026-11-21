import {
  buildClearCookieHeader,
  buildSessionCookieHeader,
  checkAndRecordAuthFailure,
  clearAuthFailures,
  createSessionToken,
  getAuthRateLimitStatus,
  getCuratorSessionFromCookieHeader,
  isCuratorAuthRequired,
  verifyPassphrase,
} from "@/lib/auth/curator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  return Response.json(
    getCuratorSessionFromCookieHeader(request.headers.get("cookie")),
  );
}

export async function POST(request: Request) {
  const passphraseConfigured = Boolean(
    process.env.BOOK_OWNER_PASSPHRASE?.trim(),
  );

  if (!passphraseConfigured) {
    if (process.env.NODE_ENV === "production") {
      return Response.json(
        { error: "Curator authentication is not configured." },
        { status: 503 },
      );
    }

    return Response.json({ authRequired: false, isCurator: true });
  }

  const rateLimit = getAuthRateLimitStatus(request);
  if (rateLimit.limited) {
    return Response.json(
      { error: "Too many failed sign-in attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!isPlainRecord(payload) || typeof payload.passphrase !== "string") {
    return Response.json(
      { error: "Passphrase must be provided as a string." },
      { status: 400 },
    );
  }

  if (!verifyPassphrase(payload.passphrase)) {
    checkAndRecordAuthFailure(request);
    return Response.json(
      { error: "Invalid curator passphrase." },
      { status: 401 },
    );
  }

  clearAuthFailures(request);
  const token = createSessionToken();

  return Response.json(
    { authRequired: true, isCurator: true },
    {
      status: 200,
      headers: {
        "Set-Cookie": buildSessionCookieHeader(token),
      },
    },
  );
}

export async function DELETE() {
  const authRequired = isCuratorAuthRequired();

  return Response.json(
    {
      authRequired,
      isCurator: !authRequired,
    },
    {
      status: 200,
      headers: {
        "Set-Cookie": buildClearCookieHeader(),
      },
    },
  );
}
