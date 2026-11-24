import { lookupBibliographicCandidates } from "@/lib/books/lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();
  const enrich = searchParams.get("enrich") === "1";

  if (query.length < 2) {
    return Response.json(
      {
        error: "Search query must be at least 2 characters.",
        candidates: [],
      },
      { status: 400 },
    );
  }

  try {
    const candidates = await lookupBibliographicCandidates(query, fetch, {
      enrich,
    });
    return Response.json({ candidates });
  } catch (error) {
    console.error("Bibliographic lookup failed:", error);
    return Response.json(
      {
        error: "Bibliographic lookup service unavailable.",
        candidates: [],
      },
      { status: 502 },
    );
  }
}
