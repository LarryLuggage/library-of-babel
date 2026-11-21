import { requireCuratorAuth } from "@/lib/auth/curator";
import { createBook, listBooks } from "@/lib/books/repository";
import { validateCreateBookInput } from "@/lib/books/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUniqueViolationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function GET() {
  try {
    const result = await listBooks();
    return Response.json(result);
  } catch (error) {
    console.error("Failed to list books:", error);
    return Response.json(
      { error: "Failed to load catalogue books." },
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

  const validation = validateCreateBookInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const book = await createBook(validation.data);
    return Response.json({ book }, { status: 201 });
  } catch (error) {
    if (isUniqueViolationError(error)) {
      return Response.json(
        { error: "A volume with this shelf copy identity already exists." },
        { status: 409 },
      );
    }

    console.error("Failed to create book:", error);
    return Response.json(
      { error: "Failed to create book." },
      { status: 500 },
    );
  }
}
