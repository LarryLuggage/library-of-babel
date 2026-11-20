import { deleteBook, updateBook } from "@/lib/books/repository";
import { validateUpdateBookInput } from "@/lib/books/validation";

export const runtime = "nodejs";

function isUniqueViolationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = rawId.trim();

  if (!id) {
    return Response.json({ error: "Book id is required." }, { status: 400 });
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

  const validation = validateUpdateBookInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const book = await updateBook(id, validation.data);
    if (!book) {
      return Response.json({ error: "Book not found." }, { status: 404 });
    }

    return Response.json({ book });
  } catch (error) {
    if (isUniqueViolationError(error)) {
      return Response.json(
        { error: "A volume with this shelf copy identity already exists." },
        { status: 409 },
      );
    }

    console.error("Failed to update book:", error);
    return Response.json(
      { error: "Failed to update book." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = rawId.trim();

  if (!id) {
    return Response.json({ error: "Book id is required." }, { status: 400 });
  }

  try {
    const deleted = await deleteBook(id);
    if (!deleted) {
      return Response.json({ error: "Book not found." }, { status: 404 });
    }

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete book:", error);
    return Response.json(
      { error: "Failed to delete book." },
      { status: 500 },
    );
  }
}
