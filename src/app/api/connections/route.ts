import { requireCuratorAuth } from "@/lib/auth/curator";
import { validateCreateConnectionInput } from "@/lib/books/connections";
import {
  createConnection,
  DuplicateConnectionError,
  listConnections,
  MissingBookReferenceError,
} from "@/lib/books/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const connections = await listConnections();
    return Response.json({ connections });
  } catch (error) {
    console.error("Failed to list curated connections:", error);
    return Response.json(
      { error: "Failed to load curated connections." },
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

  const validation = validateCreateConnectionInput(payload);
  if (!validation.ok) {
    return Response.json(
      { error: validation.error, issues: validation.errors },
      { status: 422 },
    );
  }

  try {
    const connection = await createConnection(validation.data);
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateConnectionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    if (error instanceof MissingBookReferenceError) {
      return Response.json({ error: error.message }, { status: 404 });
    }

    console.error("Failed to create curated connection:", error);
    return Response.json(
      { error: "Failed to create curated connection." },
      { status: 500 },
    );
  }
}
