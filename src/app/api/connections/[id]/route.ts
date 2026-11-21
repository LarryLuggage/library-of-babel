import { requireCuratorAuth } from "@/lib/auth/curator";
import { deleteConnection } from "@/lib/books/repository";

export const runtime = "nodejs";

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
      { error: "Connection id is required." },
      { status: 400 },
    );
  }

  try {
    const deleted = await deleteConnection(id);
    if (!deleted) {
      return Response.json(
        { error: "Connection not found." },
        { status: 404 },
      );
    }

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete curated connection:", error);
    return Response.json(
      { error: "Failed to delete curated connection." },
      { status: 500 },
    );
  }
}
