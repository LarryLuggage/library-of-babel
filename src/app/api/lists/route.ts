import { requireCuratorAuth } from "@/lib/auth/curator";
import { validateCreateListInput } from "@/lib/books/lists";
import {
  createReadingList,
  DuplicateListError,
  listReadingLists,
} from "@/lib/books/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const lists = await listReadingLists();
    return Response.json({ lists });
  } catch (error) {
    console.error("Failed to list reading lists:", error);
    return Response.json(
      { error: "Failed to load reading lists." },
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

  const validation = validateCreateListInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const list = await createReadingList(validation.data);
    return Response.json({ list }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateListError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    console.error("Failed to create reading list:", error);
    return Response.json(
      { error: "Failed to create reading list." },
      { status: 500 },
    );
  }
}
