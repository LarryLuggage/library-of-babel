# Library of Babel

Interactive bibliographic knowledge graph for a personal library catalog.

Phase 1 establishes the Next.js workspace, Supabase schema, and seed ingestion route for the exported shelf catalogs already in this repository.

## Getting Started

Install dependencies and copy the environment template:

```bash
npm install
cp .env.example .env.local
```

Set the Supabase URL, browser publishable key, server secret key, and seed bearer token in `.env.local`.

Apply the migration at `supabase/migrations/20260522000000_create_bibliographic_graph.sql` through Supabase migrations or the SQL editor before seeding the catalogs.

The migration enables row-level security without public policies. Seed ingestion uses the server-only Supabase key; later browser-facing reads should get explicit policies or server-side routes.

Run the app:

```bash
npm run dev
```

## Seed Ingestion

`POST /api/books/seed` accepts either a bare array of book records or `{ "books": [...] }`. Each row must provide `title` and `author`; `edition`, `spine_color`, `shelf_row`, and `notes` are optional.

The parser also accepts the full shelf export format in `shelf_catalog_full.json`. It stores `shelf` as `shelf_row`, and resolves the required database category from `category`, `sub_category`, then `top_category`. Rows without category metadata are stored as `Uncategorized`.

The route uses the `books(title, author)` unique constraint as its upsert target, trims payload text, rejects malformed rows, removes duplicate identities inside the request body, and batches writes to Supabase.

Seed the full exported catalog:

```bash
curl -X POST http://localhost:3000/api/books/seed \
  -H "Authorization: Bearer $BOOK_SEED_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @shelf_catalog_full.json
```

The earlier literature, philosophy, and history catalog files remain valid seed inputs.
