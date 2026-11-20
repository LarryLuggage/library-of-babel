import { timingSafeEqual } from "node:crypto";

import { parseBookSeedPayload, SeedPayloadError } from "@/lib/books/seed";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UPSERT_BATCH_SIZE = 250;
const MAX_SEED_PAYLOAD_BYTES = 5 * 1024 * 1024;

export const runtime = "nodejs";

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function getSeedAuthError(request: Request) {
  const expectedToken = process.env.BOOK_SEED_TOKEN;

  if (!expectedToken) {
    return Response.json(
      { error: "BOOK_SEED_TOKEN is not configured." },
      { status: 503 },
    );
  }

  const providedAuth = request.headers.get("authorization") ?? "";
  if (!tokensMatch(providedAuth, `Bearer ${expectedToken}`)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("Seed payload exceeds the 5 MB size limit.");
    this.name = "PayloadTooLargeError";
  }
}

async function readBoundedJsonBody(request: Request): Promise<unknown> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_SEED_PAYLOAD_BYTES) {
      throw new PayloadTooLargeError();
    }
  }

  if (!request.body) {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_SEED_PAYLOAD_BYTES) {
      throw new PayloadTooLargeError();
    }
    return JSON.parse(text);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SEED_PAYLOAD_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder("utf-8", { fatal: true }).decode(combined);
  return JSON.parse(text);
}

function getBatches<T>(items: T[]) {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += UPSERT_BATCH_SIZE) {
    batches.push(items.slice(index, index + UPSERT_BATCH_SIZE));
  }

  return batches;
}

export async function POST(request: Request) {
  const authError = getSeedAuthError(request);

  if (authError) {
    return authError;
  }

  let payload: unknown;

  try {
    payload = await readBoundedJsonBody(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return Response.json(
        { error: error.message },
        { status: 413 },
      );
    }

    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  let parsedPayload;

  try {
    parsedPayload = parseBookSeedPayload(payload);
  } catch (error) {
    if (error instanceof SeedPayloadError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }

  if (parsedPayload.books.length === 0) {
    return Response.json(
      {
        error: "No valid book records were provided.",
        issues: parsedPayload.issues,
      },
      { status: 422 },
    );
  }

  let supabase;

  try {
    supabase = createSupabaseAdminClient();
  } catch (error) {
    console.error("Supabase admin client configuration error:", error);
    return Response.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  let upserted = 0;

  for (const batch of getBatches(parsedPayload.books)) {
    const { data, error } = await supabase
      .from("books")
      .upsert(batch, { onConflict: "book_key" })
      .select("id");

    if (error) {
      console.error("Supabase book upsert failed:", error);
      return Response.json(
        { error: "Supabase book upsert failed." },
        { status: 500 },
      );
    }

    upserted += data.length;
  }

  return Response.json({
    accepted: parsedPayload.books.length,
    duplicatesRemoved: parsedPayload.duplicatesRemoved,
    issues: parsedPayload.issues,
    received: parsedPayload.received,
    rejected: parsedPayload.rejected,
    upserted,
  });
}
