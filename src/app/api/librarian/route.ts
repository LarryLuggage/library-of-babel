import { requireCuratorAuth } from "@/lib/auth/curator";
import {
  isLibrarianConfigured,
  type LibrarianMessage,
  queryGeminiLibrarian,
  runLocalLibrarianQuery,
} from "@/lib/books/librarian";
import { listBooks, listConnections } from "@/lib/books/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX_REQUESTS = 15;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MIN_PROMPT_LENGTH = 3;
const MAX_PROMPT_LENGTH = 500;
const MAX_HISTORY_ENTRIES = 6;
const MAX_HISTORY_TEXT_LENGTH = 600;

type RateLimitBucket = {
  count: number;
  windowStartMs: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

export function resetLibrarianRateLimitForTests(): void {
  rateLimitBuckets.clear();
}

function resolveClientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "local";
}

function pruneExpiredBuckets(nowMs: number): void {
  if (rateLimitBuckets.size < 500) {
    return;
  }

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (nowMs - bucket.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(key);
    }
  }
}

function checkAndRecordLibrarianRateLimit(
  request: Request,
  nowMs: number = Date.now(),
): { limited: boolean; retryAfterSeconds: number } {
  pruneExpiredBuckets(nowMs);
  const key = resolveClientKey(request);
  const current = rateLimitBuckets.get(key);

  if (!current || nowMs - current.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(key, { count: 1, windowStartMs: nowMs });
    return {
      limited: false,
      retryAfterSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((RATE_LIMIT_WINDOW_MS - (nowMs - current.windowStartMs)) / 1000),
  );

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      limited: true,
      retryAfterSeconds,
    };
  }

  current.count += 1;
  return {
    limited: false,
    retryAfterSeconds,
  };
}

type ValidatedLibrarianPayload =
  | { ok: true; prompt: string; history: LibrarianMessage[] }
  | { ok: false; error: string; issues: string[] };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateLibrarianPayload(payload: unknown): ValidatedLibrarianPayload {
  if (!isPlainRecord(payload)) {
    const message = "Request body must be a JSON object.";
    return { ok: false, error: message, issues: [message] };
  }

  const issues: string[] = [];

  const rawPrompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (
    rawPrompt.length < MIN_PROMPT_LENGTH ||
    rawPrompt.length > MAX_PROMPT_LENGTH
  ) {
    issues.push(
      `prompt must be a string between ${MIN_PROMPT_LENGTH} and ${MAX_PROMPT_LENGTH} characters.`,
    );
  }

  const history: LibrarianMessage[] = [];
  if (payload.history !== undefined) {
    if (!Array.isArray(payload.history)) {
      issues.push("history must be an array of conversation turns.");
    } else if (payload.history.length > MAX_HISTORY_ENTRIES) {
      issues.push(
        `history must contain at most ${MAX_HISTORY_ENTRIES} entries.`,
      );
    } else {
      for (let i = 0; i < payload.history.length; i += 1) {
        const entry = payload.history[i];
        if (!isPlainRecord(entry)) {
          issues.push(`history[${i}] must be an object with role and text.`);
          continue;
        }
        const role = entry.role;
        const text = typeof entry.text === "string" ? entry.text.trim() : "";
        if (role !== "user" && role !== "assistant") {
          issues.push(`history[${i}].role must be "user" or "assistant".`);
          continue;
        }
        if (text.length === 0 || text.length > MAX_HISTORY_TEXT_LENGTH) {
          issues.push(
            `history[${i}].text must be between 1 and ${MAX_HISTORY_TEXT_LENGTH} characters.`,
          );
          continue;
        }
        history.push({ role, text });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, error: issues[0], issues };
  }

  return { ok: true, prompt: rawPrompt, history };
}

export async function POST(request: Request) {
  const geminiEnabled = isLibrarianConfigured();

  if (geminiEnabled) {
    const authError = requireCuratorAuth(request);
    if (authError) {
      return authError;
    }
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

  const validation = validateLibrarianPayload(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.issues },
      { status: 422 },
    );
  }

  if (geminiEnabled) {
    const rateLimit = checkAndRecordLibrarianRateLimit(request);
    if (rateLimit.limited) {
      return Response.json(
        {
          error:
            "Too many Librarian requests. Please wait before trying again.",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    try {
      const [{ books }, connections] = await Promise.all([
        listBooks(),
        listConnections(),
      ]);

      const response = await queryGeminiLibrarian({
        prompt: validation.prompt,
        history: validation.history,
        books,
        connections,
      });

      return Response.json(response, { status: 200 });
    } catch (error) {
      console.error("Gemini Librarian request failed:", error);
      return Response.json(
        {
          error:
            "Gemini Librarian is temporarily unavailable. Try again or use Local Shelf Search.",
        },
        { status: 502 },
      );
    }
  }

  try {
    const [{ books }, connections] = await Promise.all([
      listBooks(),
      listConnections(),
    ]);

    const response = runLocalLibrarianQuery(
      books,
      connections,
      validation.prompt,
    );

    return Response.json(response, { status: 200 });
  } catch (error) {
    console.error("Local Librarian search failed:", error);
    return Response.json(
      { error: "Failed to search the library catalogue." },
      { status: 500 },
    );
  }
}
