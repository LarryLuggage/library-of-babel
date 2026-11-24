# Library of Babel

Interactive bibliographic knowledge graph, physical shelf atlas, and personal reading tracker for an 880-volume personal library catalogue, built with Next.js 16, React 19, TypeScript, Tailwind CSS v4, and Supabase (with automatic local JSON persistence).

## Features

- **Dual-Mode Catalogue Persistence**: Runs out of the box in local development by overlaying atomic JSON edits (`data/book-tracker-state.json`) onto `shelf_catalog_full.json`, and promotes seamlessly to Supabase Postgres when credentials are configured.
- **Shelf Ledger & Triage Views**: Surname-first author indexing (`getAuthorSortKey`), instant full-text search across title/author/edition/tags, filters by principal division, shelf, reading status (`unread`, `reading`, `finished`, `dnf`, `loaned`), and metadata triage (`missing_any`, `missing_summary`, `missing_year`, `missing_tags`, `duplicates`).
- **Similarity & Tag Constellations**: Interactive maps connecting books by inverse-document-frequency weighted subject tags, shared authors, physical shelf proximity, and curator-authored editorial links, alongside a tag co-occurrence constellation.
- **Chronological Scroll & Classical Chronology**: Era-grouped horizontal timeline supporting BCE and early CE dates (`Antiquity (BCE)` for `-3000..-1`, `Medieval & Early CE` for `0..1499`, modern decades `1500s+`, and `Undated`).
- **Physical Shelf Elevation View**: Spatial synthesis of Shelves `1–41` modeling standing archival spines and horizontal stacks (`Left Stack`, `Top Stack`, `Desk Stack`, etc.).
- **Pathfinder & Borges' Oracle**: Breadth-first shortest semantic path search between any two books (ranking minimum hops, then highest cumulative similarity score) plus randomized discovery.
- **Index Card Detail & Inline Reading Ledger**: Vintage library index card modal (`BookDetailCard`) with inline status, 1–5 star ratings, start/finish dates, borrower loan tracking, personal notes, and curated editorial connection management (`book_connections`).
- **Book Editor, ISBN Scanner & Multi-Source Lookup**: Create/edit modal with `@zxing/browser` barcode scanning and `GET /api/books/lookup` integration querying Open Library (+ top-3 work records), optional Google Books, and optional Wikipedia fallback enrichment (`?enrich=1`).
- **Duplicate Clustering & Bulk Editing**: Prioritized union-find duplicate detection that keeps numbered multi-volume works (`Vol. 1` vs `Vol. 2`, `Part I` vs `Part II`, `#1` vs `#2`) separate, paired with `POST /api/books/bulk` batch updates for status, shelf, division, and tag additions/removals (capped at 20 tags).
- **Reading Analytics & Safe Exports**: Summary metrics, completion rate, rating histogram, yearly finished totals, division/era breakdowns, loaned-out tracker, and RFC-4180 CSV (with spreadsheet formula-injection neutralization) and JSON downloads.
- **Read Next Shelf Recommender**: Deterministic taste-profile recommendation engine (`src/lib/books/recommender.ts`) scoring unread volumes by ratings, curated `book_connections`, IDF-weighted subject tags, author/division affinity, and era proximity—supporting `best_match`, `stretch` (under-explored divisions/eras), `same_authors`, seed-book anchoring, and cold-start fallbacks.
- **Commonplace Book & Aleph Meditations**: Dedicated quote & passage archive (`book_quotes`) with page/chapter citations, personal margin notes, tag filtering, and integration into **The Aleph** meditation pool alongside the three classic Borges epigraphs.
- **Custom Reading Lists & Ranked Up Next Queue**: Curator-authored reading lists (`reading_lists`, `reading_list_items`) with a pinned ranked **Up Next** queue (`is_queue`), item reordering, inline book-card membership chips, and automatic cascade cleanup on volume deletion.
- **Grounded AI Reference Librarian**: Conversational shelf discovery (`POST /api/librarian`) that shortlists the catalogue by natural-language cues (era/century, shelf range, unread intent, keywords, and taste profile). Runs in zero-key deterministic **Local Shelf Search** mode by default, or upgrades to structured JSON Gemini responses (with strict `book_id` grounding validation, curator authentication, and per-IP rate limiting) when `GEMINI_API_KEY` is configured.
- **Passphrase Curator Authentication**: HMAC-SHA256 signed HTTP-only `babel_curator_session` cookie (30-day TTL), constant-time SHA-256 verification, and 10-failure / 15-minute IP rate limiting (`429`).
- **Deep-Linkable URLs & Installable PWA**: Every book modal, reading list, shelf elevation, commonplace archive, and active filter state synchronizes cleanly to query parameters with dynamic page titles, Open Graph previews, web app manifest, and a safe static-icon service worker.

---

## Deep-Linkable URLs & Mobile PWA Installation

### Deep-Linkable URLs

Catalogue views, modals, and filters are serialized directly in the URL query string so any shelf, volume, or reading list can be bookmarked or shared:

- `?book=<book_id>` — Opens the archival index card modal for a specific volume.
- `?view=shelves|timeline|lists|commonplace` — Switches directly to Physical Shelves, Decadal Timeline, Reading Lists, or the Commonplace Book (defaults to the Shelf Ledger).
- `?list=<slug>` — Opens a specific reading list (automatically implies `view=lists`).
- `?shelf=<number>` — Focuses a physical shelf in either the Ledger or Physical Shelves view.
- Filter parameters — `?q=`, `?division=`, `?tag=`, `?status=unread|reading|finished|dnf|loaned`, `?triage=missing_any|missing_summary|missing_year|missing_tags|duplicates`, and `?author=A..Z|#`.

### Mobile PWA Installation

Library of Babel ships with a Next.js Web App Manifest (`/manifest.webmanifest`), Apple touch icon, and a network-first service worker (`public/sw.js`) that caches only static app icons (never `/api/*` or HTML responses):

- **iOS (Safari)**: Open the catalogue in Safari, tap the **Share** button, and choose **Add to Home Screen**.
- **Android / Desktop (Chrome or Edge)**: Open the catalogue and select **Install app** from the address bar or browser menu.

---

## Architecture & Storage Modes

`src/lib/books/repository.ts` selects the storage backend dynamically via `isSupabaseConfigured()`:

1. **Local JSON Overlay Mode (default when Supabase env vars are absent)**
   - Loads the baseline 880 volumes from `shelf_catalog_full.json`.
   - Serializes concurrent writes with an in-process per-path lock (`withStateLock`) and writes atomically via temp file + `rename` to `data/book-tracker-state.json` (overridable via `BOOK_TRACKER_STATE_PATH`).
   - Stores created volumes, per-book overrides, deleted IDs, curated `connections`, commonplace `quotes`, and `lists` (`LocalTrackerState` `version: 3`).

2. **Supabase Postgres Mode (active when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` are set)**
   - Server Components (`src/app/page.tsx`) and Node.js Route Handlers query `public.books`, `public.book_connections`, `public.book_quotes`, `public.reading_lists`, and `public.reading_list_items` through `createSupabaseAdminClient()` (`src/lib/supabase/admin.ts`).
   - Row-level security (RLS) is enabled on all tables with no public browser policies; all reads and mutations flow through Next.js server routes.
   - Copy identity uses `books_book_key_idx` (`book_key`) and `books_copy_identity_idx` (`(title, author, coalesce(shelf_row, -1), coalesce(position, ''))`) so multiple physical copies on different shelves or positions do not collide.

---

## Getting Started (Local Development)

Install dependencies and create a local env file:

```bash
npm install
cp .env.example .env.local
```

Start the development server immediately in local JSON mode (no database required):

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). When `BOOK_OWNER_PASSPHRASE` is unset in non-production environments, curator writes are open locally; set `BOOK_OWNER_PASSPHRASE` in `.env.local` to test passphrase sign-in locally.

---

## Environment Variables

Variables defined in `.env.example` (plus optional local state path override):

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | For Supabase mode | Supabase project URL (`https://<ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | For Supabase mode | Browser-safe Supabase publishable/anon key. |
| `SUPABASE_SECRET_KEY` | For Supabase mode | Server-only Supabase secret key (`SUPABASE_SERVICE_ROLE_KEY` is also supported as a legacy fallback). |
| `BOOK_SEED_TOKEN` | For seeding | Bearer token checked in constant time by `POST /api/books/seed`. |
| `BOOK_OWNER_PASSPHRASE` | **Required in production** | Curator passphrase used to mint and verify signed `babel_curator_session` cookies. Optional in local dev. |
| `BOOK_SESSION_SECRET` | Optional | Explicit HMAC signing secret for curator session cookies (defaults to a SHA-256 key derived from `BOOK_OWNER_PASSPHRASE`). |
| `GOOGLE_BOOKS_API_KEY` | Optional | Enables Google Books alongside Open Library in `/api/books/lookup` and `npm run enrich:books`. |
| `GEMINI_API_KEY` | Optional | Enables the Gemini-backed AI Reference Librarian in `POST /api/librarian` (requires curator sign-in when configured; falls back to Local Shelf Search when unset). |
| `GEMINI_MODEL` | Optional | Overrides the Gemini model used by `POST /api/librarian` (defaults to `gemini-2.5-flash`). |
| `BOOK_TRACKER_STATE_PATH` | Optional (local mode) | Overrides the default `data/book-tracker-state.json` persistence path. |

---

## Supabase Database Setup & Seeding

### 1. Apply All Migrations

Run all SQL migrations in order via the Supabase CLI (`supabase db push`) or the Supabase SQL Editor:

1. `supabase/migrations/20260522000000_create_bibliographic_graph.sql`
   - Creates `public.books` and `public.book_connections`, GIN full-text search index `books_search_idx`, undirected pair index `book_connections_undirected_pair_idx`, and enables RLS.
2. `supabase/migrations/20261120000000_extend_books_tracker.sql`
   - Adds `book_key`, `position`, `top_category`, `sub_category`, `summary`, `tags`, `publish_year`, `reading_status`, `rating`, `date_started`, `date_finished`, `personal_notes`, `loaned_to`, and `updated_at` to `public.books`.
   - Drops legacy `unique_book_identity` and `unique_connection_pair`, and creates `books_book_key_idx` and `books_copy_identity_idx`.
3. `supabase/migrations/20261124000000_add_commonplace_and_lists.sql`
   - Creates `public.book_quotes`, `public.reading_lists`, and `public.reading_list_items` (with unique `(list_id, book_id)` constraint, ordering indexes, cascade deletes, and RLS enabled).

### 2. Seed the Catalogue (`POST /api/books/seed`)

`POST /api/books/seed` accepts a JSON array of book objects or `{ "books": [...] }` (up to 5 MB), normalizes/deduplicates rows, and upserts to `public.books` on `book_key` in batches of 250:

```bash
curl -X POST http://localhost:3000/api/books/seed \
  -H "Authorization: Bearer $BOOK_SEED_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @shelf_catalog_full.json
```

---

## API Routes

| Route | Methods | Auth | Description |
| --- | --- | --- | --- |
| `/api/auth/session` | `GET`, `POST`, `DELETE` | Public (`POST` rate-limited) | Inspect curator session state, sign in with `BOOK_OWNER_PASSPHRASE`, or sign out. |
| `/api/books` | `GET`, `POST` | `GET`: Public, `POST`: Curator | List all volumes + active `storageMode`, or accession a new volume. |
| `/api/books/[id]` | `PATCH`, `DELETE` | Curator | Update bibliographic/reading fields or remove a volume (and cascade its local connections). |
| `/api/books/bulk` | `POST` | Curator | Batch-update 1–200 volumes (`reading_status`, `shelf`, `top_category`, `add_tags`, `remove_tags`), returning `{ updated, skipped }`. |
| `/api/books/lookup` | `GET` | Public | Query Open Library (+ optional Google Books) by title, author, or ISBN; pass `&enrich=1` for Wikipedia summary/year fallback. |
| `/api/books/seed` | `POST` | `BOOK_SEED_TOKEN` Bearer | Privileged bulk seed upsert into Supabase `public.books`. |
| `/api/connections` | `GET`, `POST` | `GET`: Public, `POST`: Curator | List or create curated editorial links between two volumes (`409` on duplicate undirected pair). |
| `/api/connections/[id]` | `DELETE` | Curator | Delete a curated editorial connection. |
| `/api/quotes` | `GET`, `POST` | `GET`: Public, `POST`: Curator | List saved commonplace book passages (newest first) or record a new quote for a volume (`404` if volume missing). |
| `/api/quotes/[id]` | `PATCH`, `DELETE` | Curator | Update or remove a saved commonplace book quote. |
| `/api/lists` | `GET`, `POST` | `GET`: Public, `POST`: Curator | List custom reading lists & pinned queues (`is_queue`), or create a new list (`409` on duplicate slug). |
| `/api/lists/[id]` | `PATCH`, `DELETE` | Curator | Rename/update metadata (`409` on slug collision) or delete a reading list. |
| `/api/lists/[id]/items` | `POST`, `PATCH`, `DELETE` | Curator | Add a volume to a list (`409` if already present), reorder items by `book_ids`, or remove a volume (`?book_id=` or JSON body). |
| `/api/librarian` | `POST` | Curator when `GEMINI_API_KEY` is set (rate-limited); Public in Local Shelf Search mode | Conversational catalogue discovery returning grounded recommendations from your shelves (strictly post-validated against real catalogue `book_id`s in Gemini mode). |

---

## Deploying to Vercel

1. **Apply Supabase migrations** (`20260522000000_create_bibliographic_graph.sql`, `20261120000000_extend_books_tracker.sql`, and `20261124000000_add_commonplace_and_lists.sql`) to your production Supabase project.
2. **Import the repository in Vercel** using the default Next.js build settings (`npm run build`).
3. **Configure Production Environment Variables** in Vercel Project Settings:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `BOOK_OWNER_PASSPHRASE` (**mandatory**: in `NODE_ENV=production`, mutating routes return `503` if unset)
   - `BOOK_SEED_TOKEN`
   - Optional: `BOOK_SESSION_SECRET`, `GOOGLE_BOOKS_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`
4. **Seed Production Data** (if deploying against a fresh database):

```bash
curl -X POST https://<your-domain>/api/books/seed \
  -H "Authorization: Bearer $BOOK_SEED_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @shelf_catalog_full.json
```

> [!NOTE]
> Serverless production hosts do not preserve ephemeral filesystem writes across invocations—ensure Supabase environment variables are configured for durable production persistence.

---

## Enrichment & Data Hygiene CLI

Offline Node.js scripts keep `shelf_catalog_full.json` clean and enriched without altering physical copy identity fields (`title`, `author`, `shelf`, `position`):

- **Enrich catalogue metadata** (`scripts/enrich-catalogue-books.mjs`):

  ```bash
  npm run enrich:books -- --only-incomplete --concurrency=4 --delay-ms=100
  ```

  Combines curated classic chronology (`scripts/lib/classic-years.mjs`), English Wikipedia + Wikidata, and Open Library (plus optional `GOOGLE_BOOKS_API_KEY`), checkpointing incrementally to `/private/tmp/library-of-babel-book-enrichment.json` (override with `--output=PATH`, `--limit=N`, `--offset=N`, `--force`).

- **Apply enrichment output to `shelf_catalog_full.json`** (`scripts/apply-catalogue-enrichment.mjs`):

  ```bash
  npm run apply:book-enrichment -- --dry-run
  npm run apply:book-enrichment
  ```

  Supports `--input=PATH` and `--dry-run`.

- **Clean and normalize `shelf_catalog_full.json`** (`scripts/clean-catalogue-data.mjs`):

  ```bash
  npm run clean:catalogue -- --dry-run
  npm run clean:catalogue
  ```

  Idempotently strips broken/boilerplate summaries, applies verified classic years, and normalizes/deduplicates tags.

---

## Verification & Testing

Run the full automated verification suite:

```bash
npm test              # Vitest unit and route integration tests
npm run lint          # ESLint
npx tsc --noEmit      # TypeScript strict typecheck
npm run build         # Next.js production build
```
