import { requireCuratorAuth } from "@/lib/auth/curator";
import {
  validateAddListItemInput,
  validateReorderListItemsInput,
} from "@/lib/books/lists";
import {
  addBookToReadingList,
  DuplicateListItemError,
  MissingBookReferenceError,
  MissingListError,
  removeBookFromReadingList,
  reorderReadingListItems,
} from "@/lib/books/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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
      { error: "Reading list id is required." },
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

  const validation = validateAddListItemInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const { list, item } = await addBookToReadingList(id, validation.data);
    return Response.json({ list, item }, { status: 201 });
  } catch (error) {
    if (
      error instanceof MissingListError ||
      error instanceof MissingBookReferenceError
    ) {
      return Response.json({ error: error.message }, { status: 404 });
    }

    if (error instanceof DuplicateListItemError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    console.error("Failed to add book to reading list:", error);
    return Response.json(
      { error: "Failed to add book to reading list." },
      { status: 500 },
    );
  }
}

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
      { error: "Reading list id is required." },
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

  const validation = validateReorderListItemsInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const list = await reorderReadingListItems(id, validation.data.book_ids);
    if (!list) {
      return Response.json(
        { error: "Reading list not found." },
        { status: 404 },
      );
    }

    return Response.json({ list });
  } catch (error) {
    console.error("Failed to reorder reading list items:", error);
    return Response.json(
      { error: "Failed to reorder reading list items." },
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
      { error: "Reading list id is required." },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  let bookId = url.searchParams.get("book_id")?.trim() ?? "";

  if (!bookId) {
    try {
      const payload = (await request.json()) as Record<string, unknown>;
      if (
        typeof payload === "object" &&
        payload !== null &&
        typeof payload.book_id === "string"
      ) {
        bookId = payload.book_id.trim();
      }
    } catch {
      // No JSON body or invalid JSON; handled below by empty bookId check.
    }
  }

  if (!bookId) {
    return Response.json(
      { error: "book_id is required as a query parameter or JSON body field." },
      { status: 400 },
    );
  }

  try {
    const result = await removeBookFromReadingList(id, bookId);
    if (!result || !result.deleted) {
      return Response.json(
        { error: "Reading list or list item not found." },
        { status: 404 },
      );
    }

    return Response.json({ list: result.list, deleted: true });
  } catch (error) {
    console.error("Failed to remove book from reading list:", error);
    return Response.json(
      { error: "Failed to remove book from reading list." },
      { status: 500 },
    );
  }
}
