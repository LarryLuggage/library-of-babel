import { parseBookSeedPayload, SeedPayloadError } from "@/lib/books/seed";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const UPSERT_BATCH_SIZE = 250;

export const runtime = "nodejs";

function getSeedAuthError(request: Request) {
  const expectedToken = process.env.BOOK_SEED_TOKEN;

  if (!expectedToken) {
    return Response.json(
      { error: "BOOK_SEED_TOKEN is not configured." },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${expectedToken}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
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
    payload = await request.json();
  } catch {
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
    const message =
      error instanceof Error ? error.message : "Supabase is not configured.";

    return Response.json({ error: message }, { status: 503 });
  }

  let upserted = 0;

  for (const batch of getBatches(parsedPayload.books)) {
    const { data, error } = await supabase
      .from("books")
      .upsert(batch, { onConflict: "title,author" })
      .select("id");

    if (error) {
      return Response.json(
        {
          error: "Supabase book upsert failed.",
          message: error.message,
        },
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
