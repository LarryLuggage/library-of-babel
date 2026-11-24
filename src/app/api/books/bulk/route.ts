import { requireCuratorAuth } from "@/lib/auth/curator";
import { bulkUpdateBooks } from "@/lib/books/repository";
import { validateBulkBooksInput } from "@/lib/books/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const validation = validateBulkBooksInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const result = await bulkUpdateBooks(
      validation.data.ids,
      validation.data.patch,
    );
    return Response.json(result);
  } catch (error) {
    console.error("Failed to bulk update books:", error);
    return Response.json(
      { error: "Failed to bulk update books." },
      { status: 500 },
    );
  }
}
