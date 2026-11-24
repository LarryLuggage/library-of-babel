import { requireCuratorAuth } from "@/lib/auth/curator";
import { validateCreateQuoteInput } from "@/lib/books/commonplace";
import {
  createQuote,
  listQuotes,
  MissingBookReferenceError,
} from "@/lib/books/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const quotes = await listQuotes();
    return Response.json({ quotes });
  } catch (error) {
    console.error("Failed to list quotes:", error);
    return Response.json(
      { error: "Failed to load quotes." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authError = requireCuratorAuth(request);
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

  const validation = validateCreateQuoteInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const quote = await createQuote(validation.data);
    return Response.json({ quote }, { status: 201 });
  } catch (error) {
    if (error instanceof MissingBookReferenceError) {
      return Response.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to create quote:", error);
    return Response.json(
      { error: "Failed to save quote." },
      { status: 500 },
    );
  }
}
