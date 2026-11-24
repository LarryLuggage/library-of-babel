import { requireCuratorAuth } from "@/lib/auth/curator";
import { validateUpdateListInput } from "@/lib/books/lists";
import {
  deleteReadingList,
  DuplicateListError,
  updateReadingList,
} from "@/lib/books/repository";

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

  const validation = validateUpdateListInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const list = await updateReadingList(id, validation.data);
    if (!list) {
      return Response.json(
        { error: "Reading list not found." },
        { status: 404 },
      );
    }

    return Response.json({ list });
  } catch (error) {
    if (error instanceof DuplicateListError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    console.error("Failed to update reading list:", error);
    return Response.json(
      { error: "Failed to update reading list." },
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

  try {
    const deleted = await deleteReadingList(id);
    if (!deleted) {
      return Response.json(
        { error: "Reading list not found." },
        { status: 404 },
      );
    }

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete reading list:", error);
    return Response.json(
      { error: "Failed to delete reading list." },
      { status: 500 },
    );
  }
}
