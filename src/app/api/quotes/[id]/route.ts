import { requireCuratorAuth } from "@/lib/auth/curator";
import { validateUpdateQuoteInput } from "@/lib/books/commonplace";
import { deleteQuote, updateQuote } from "@/lib/books/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = requireCuratorAuth(request);
  if (authError) {
    return authError;
  }

  const { id: rawId } = await context.params;
  const id = rawId.trim();
  if (!id) {
    return Response.json(
      { error: "Quote id is required." },
      { status: 400 },
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

  const validation = validateUpdateQuoteInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const quote = await updateQuote(id, validation.data);
    if (!quote) {
      return Response.json({ error: "Quote not found." }, { status: 404 });
    }

    return Response.json({ quote });
  } catch (error) {
    console.error("Failed to update quote:", error);
    return Response.json(
      { error: "Failed to update quote." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = requireCuratorAuth(request);
  if (authError) {
    return authError;
  }

  const { id: rawId } = await context.params;
  const id = rawId.trim();
  if (!id) {
    return Response.json(
      { error: "Quote id is required." },
      { status: 400 },
    );
  }

  try {
    const deleted = await deleteQuote(id);
    if (!deleted) {
      return Response.json({ error: "Quote not found." }, { status: 404 });
    }

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete quote:", error);
    return Response.json(
      { error: "Failed to delete quote." },
      { status: 500 },
    );
  }
}
