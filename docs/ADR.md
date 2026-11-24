# Architectural Decision Records (ADR)

## ADR 1: Metadata Enrichment Pipeline & Similarity Constellation Integration

### Context
To support more advanced bibliographic similarity matching in the "Similarity Constellation" relational view, the catalog needed to be enriched with descriptive metadata (summaries and tags) that are not present in the raw personal library database export. 

### Decision
1. **API Sources**: We added an enrichment script (`enrich-catalogue-books.mjs`) to query Open Library and Google Books APIs for descriptions, subjects, and categorizations.
2. **Incremental Resumability**: Because querying APIs for large catalogues (887 books) is prone to rate limits (specifically Google Books HTTP 429 warnings), the script writes results incrementally after every volume to a workspace file (`book-enrichment.json`), permitting interruption and resumption.
3. **Tag Proximity Metric**: We introduced a shared-tag similarity calculation (`addTagConnection`) in `src/lib/books/catalogue.ts` adding +3 points per shared tag, capped at +12 points, to augment author, division, and physical shelf proximity rules.
4. **Metadata UI Details**: We modified the Constellation details panel (`catalogue-constellation.tsx` and `globals.css`) to render book summaries and tags using styling that preserves the classic printed paper design system.

### Consequences
* The catalog `shelf_catalog_full.json` now contains enriched `summary` and `tags` keys.
* Relational maps show higher-fidelity links using overlap in normalized subject matter.
* A future database migration will be required if we want to sync the newly added `summary` and `tags` fields to the Supabase `books` database table.

## ADR 2: Interactive Shelf Ledger & Library Index Card Detail Modal

### Context
With the introduction of enriched synopsis descriptions and categorization tags for all 887 books in the catalog, users needed a way to browse and read these details from the main list of books ("Complete shelf ledger") without cluttering the screen or navigating away from the landing page.

### Decision
1. **Interactive Client Component**: We refactored the static shelf ledger list into a Client Component (`catalogue-ledger.tsx`) to manage the selection state of the active book.
2. **Library Index Card Visual Theme**: We built the modal detail overlay (`.catalogue-catalog-card`) to replicate a vintage physical library index card:
   - Call numbers in the top-left, matching the physical shelf/position location.
   - Rotated "red rubber stamp" visual for top-categories.
   - Center rod hole representation at the bottom center to capture the authentic physical drawer look.
   - Close button styled as a checkout paper slip/stamp.
3. **Accessibility**: Integrated keyboard event handlers (`onKeyDown` for Space/Enter) and ARIA dialog roles for accessible interaction.

### Consequences
* Clicking any author ledger entry dynamically overlay-scales a beautiful, vintage card detailing all book information, including edition, divisions, synopsis, and tags.
* Keeps the main ledger layout compact and readable while revealing metadata context on demand.

## ADR 3: Interactive Tags & Hoisted State Subject Index Overlay

### Context
With the introduction of the library detail card modal and the constellation detail panel, tags were rendered as static text badges. Users needed a way to discover other volumes sharing the same subject or tag without leaving the interactive visualization map or losing their place in the ledger.

### Decision
1. **Interactive Tags**: We replaced static tag labels with interactive buttons (`.catalogue-tag-interactive`) in both the constellation detail sidebar and the library detail card overlay.
2. **Hoisted State Management**: We converted `page.tsx` into a Client Component to manage hoisted states: `activeBook` and `activeTag`. This allows sibling components to trigger overlays page-wide:
   - Clicking a tag in the constellation detail panel opens the page-level Subject Index Overlay.
   - Clicking a tag in the Library Detail Card updates the state to show the Subject Index Overlay.
3. **Subject Index Drawer Card**: We created `tag-matches-overlay.tsx` to list all volumes sharing the active tag. Book items in this list are clickable links that close the search overlay and immediately open the corresponding `BookDetailCard` overlay.

### Consequences
* Users can pivot between books and subjects fluidly across all sections of the application.
* The state is clean, modularized, and centralized at the page level, allowing any visualization node or catalog card to drive details on demand.

## ADR 4: Bibliographic Pathfinding & Tag Co-occurrence Graph Algorithms

### Context
To further enhance the semantic capabilities of the Library of Babel, the application required two new relational visualizers:
1. A **Tag Co-occurrence Constellation** map showing relationships between frequently co-occurring topic tags in the library.
2. A **Pathfinder** graph search showing the shortest semantic path connecting any two arbitrary volumes.

### Decision
1. **Breadth-First Search (BFS) Pathfinding**:
   - Implemented a BFS algorithm in `src/lib/books/relations.ts` and `src/app/pathfinder-modal.tsx` to compute the shortest path between any two volumes.
   - Using a level-by-level traversal ensures that the minimum number of hops (concept bridges) is identified.
   - For path-length ties, the algorithm selects the path with the highest cumulative similarity score.
2. **Tag Co-occurrence Matrix**:
   - Designed a tag co-occurrence matrix in `src/lib/books/relations.ts` and `src/app/catalogue-constellation.tsx` to map nodes representing subject tags and links representing their co-occurrence frequency across volumes.
3. **Hoisted States and Layout View Tabs**:
   - Centralized state management in `src/app/page.tsx` using layout selector tabs to switch between the "Similarity Constellation" and "Tag Constellation", and between the "Shelf Ledger" and a horizontal "Chronological Scroll" grouped by decade.
   - Introduced a "Borges' Oracle" (Aleph Modal) to generate random book suggestions with retro typewriter quotes.

### Consequences
* The application now supports full semantic tracing across 887 books.
* Visualization pages dynamically adapt to modes without breaking state.
* The Next.js production build succeeds with zero ESLint/TypeScript errors and warnings.

## ADR 5: Data Hygiene, Surname Indexing, Graph Density Tuning & Native Dialog Accessibility

### Context
A comprehensive codebase and UX audit revealed that the client was shipping a redundant 1.3 MB `book-enrichment.json` import for publication years already present in `shelf_catalog_full.json`, the similarity graph had 63.9% edge density (primarily due to broad `top_category` scores and injected division tags), `PathfinderModal` duplicated BFS greedily instead of using `relations.ts`, 7 Shelf 26 entries duplicated Shelf 28's photo seam, several Open Library `publish_year` values reflected reprints or wrong works, author indexing sorted by given name instead of surname, and custom `div` modals lacked `Escape`/focus restoration and responsive layout polish.

### Decision
1. **Idempotent Data Cleanup (`scripts/clean-catalogue-data.mjs`)**:
   - Deduplicated the 7 overlapping Shelf 26 seam entries (reducing total base volumes from 887 to 880 while preserving distinct multi-copy editions), normalized `"El Señor Presidente (title to confirm)"`, corrected 7 verified Open Library mis-dates, and stripped 26 noisy/foreign/division-duplicate tags (`literature`, `large type books`, `translations into english`, `new york times reviewed`, etc.).
   - Hardened `scripts/enrich-catalogue-books.mjs` with the expanded `TAG_BLOCKLIST` and an author-overlap gate before accepting Open Library matches.
2. **Surname-First Author Indexing & Tuned Graph (`src/lib/books/catalogue.ts`, `src/lib/books/relations.ts`)**:
   - Implemented `getAuthorSortKey` and `getAuthorInitial` (handling parenthetical qualifiers, multi-author separators, generational suffixes, and noble/prepositional particles such as `de`, `von`, `del`, `di`) so `"Jorge Luis Borges"` files under **B**.
   - Removed `top_category`-only edges and scored shared non-noise tags by inverse document frequency (`buildTagFrequencyMap`), paired with a precomputed `CatalogueGraph` in `relations.ts` using high-signal edges (`score >= 4`) first and falling back to `score >= 2` only when disconnected.
   - Added `tagCounts` and `cooccurrenceMap` to `TagCooccurrenceData` for O(1) lookup in `CatalogueConstellation`.
3. **Server Component Shell & Modern Web Accessibility (`src/app/**`)**:
   - Converted `src/app/page.tsx` to a dynamic `async` Server Component hydrating `CatalogueApp` (`src/app/catalogue-app.tsx`), and removed the 1.3 MB `book-enrichment.json` import from `chronological-scroll.tsx`.
   - Wired active filters directly into `ChronologicalScroll`, promoted matching results (`#catalogue-results`) immediately below `#catalogue-search` when filters are active, made Principal Divisions clickable toggles, and unified tag exploration around `TagMatchesOverlay`.
   - Replaced custom modal overlays with a shared native `<dialog>` wrapper (`src/app/modal-dialog.tsx`) using `showModal()`, `closedby="any"` plus Safari pointer bounding-rect light-dismiss fallback, and `overscroll-behavior: contain` on `dialog:modal` and `dialog::backdrop`.
   - Upgraded tablists to WAI-ARIA `tablist`/`tab`/`tabpanel` with arrow-key navigation and `::after` border indicators, converted clickable `<li>`/`<span>` items to nested native `<button>` elements, fixed `.card-rod-hole` footer overlap, and switched the mobile constellation (`<= 38rem`) to a non-overlapping 2-column grid.

### Consequences
* Client static JS bundles no longer contain either `book-enrichment.json` or `shelf_catalog_full.json`.
* Pathfinder traces meaningful 2–4 hop conceptual bridges instead of collapsing nearly every pair to 1–2 hops, and mobile renders with zero horizontal overflow or overlapping cards.

## ADR 6: Dual-Mode Book Tracker Persistence & CRUD Architecture

### Context
While the application worked well as a read-only visual catalog, a personal book tracker requires creating/editing/removing volumes and tracking reading status (`unread`, `reading`, `finished`, `dnf`), 1–5 star ratings, completion dates, loans, and personal notes. Additionally, `public.books` lacked bibliographic/tracker columns, `unique (title, author)` collided on multi-copy editions, and local development had no `.env.local` Supabase configuration.

### Decision
1. **Extended Schema & Migration (`supabase/migrations/20261120000000_extend_books_tracker.sql`)**:
   - Extended `public.books` with `book_key`, `position`, `top_category`, `sub_category`, `summary`, `tags`, `publish_year`, `reading_status`, `rating`, `date_started`, `date_finished`, `personal_notes`, `loaned_to`, and `updated_at`.
   - Replaced `unique (title, author)` with `books_book_key_idx` on `(book_key)` and `books_copy_identity_idx` on `(title, author, coalesce(shelf_row, -1), coalesce(position, ''))` so distinct physical copies do not collide, and removed the redundant `unique_connection_pair` constraint.
2. **Dual-Mode Repository & Hardened API (`src/lib/books/repository.ts`, `validation.ts`, `src/app/api/books/**`)**:
   - Built `repository.ts` to read/write via Supabase when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are present, and fall back automatically to an atomic JSON overlay (`data/book-tracker-state.json`, overridable via `BOOK_TRACKER_STATE_PATH`) merged over `shelf_catalog_full.json` in local dev.
   - Added `GET`/`POST /api/books` and `PATCH`/`DELETE /api/books/[id]` backed by strict runtime validation (`validation.ts`), and hardened `POST /api/books/seed` with `crypto.timingSafeEqual`, a 5 MB payload cap (`413`), and sanitized `500` responses.
3. **Interactive Book Tracker UI & Test Suite**:
   - Added masthead `Finished`/`Reading` counters, a `Reading status` filter (including `"Loaned out"`), `BookEditorModal` (`Add volume` / `Edit volume`), inline **Reading Ledger** controls and non-shifting delete confirmation inside `BookDetailCard`, and ledger badges.
   - Added Vitest (`vitest.config.ts`) with 29 unit and integration tests covering surname sorting, graph pathfinding, validation, seed parsing, local repository roundtrips, and `/api/books` route handlers.

### Consequences
* Reading progress and catalog edits persist immediately out-of-the-box in local mode and seamlessly promote to Supabase once `.env.local` credentials are configured and migrations are applied.
* Core bibliographic logic, graph algorithms, and API mutations are guarded by automated Vitest checks alongside ESLint, TypeScript, and Next.js production builds.

---

## ADR 7: Passphrase Curator Authentication, Bibliographic Lookup, Physical Shelf Modeling, Analytics Export, and Curated Editorial Connections

### Date
2026-11-21

### Context
With the core CRUD tracker established (ADR 6), public deployment needed lightweight write protection without heavy user-account infrastructure, alongside richer curation workflows: external bibliographic lookup when accessioning books, visual spatial representation of the library's 41 shelves, reading analytics and portable backups, and first-class curator-defined conceptual links in the graph.

### Decision
1. **Single-Owner Passphrase Curator Auth (`src/lib/auth/curator.ts`, `src/app/api/auth/session/route.ts`, `src/app/curator-auth-modal.tsx`)**:
   - Introduced `BOOK_OWNER_PASSPHRASE` (plus optional `BOOK_SESSION_SECRET`) with HMAC-SHA256 signed HTTP-only `babel_curator_session` cookies (30-day TTL), constant-time SHA-256 verification, and 10-failure / 15-minute IP rate limiting (`429`).
   - Kept local development (`NODE_ENV !== "production"`) open when `BOOK_OWNER_PASSPHRASE` is unset, while failing closed (`503`) in production if unconfigured.
   - Guarded all mutating book and connection routes (`POST`, `PATCH`, `DELETE`) via `requireCuratorAuth(request)` and updated `CatalogueApp` with deferred post-auth action replay for gated creation/edit flows plus z-index isolation on `.catalogue-kicker-row`.
2. **Quick-Add Bibliographic Lookup (`src/lib/books/lookup.ts`, `src/app/api/books/lookup/route.ts`, `src/app/book-editor-modal.tsx`)**:
   - Implemented timeout-bounded Open Library Search + top-3 `/works/...json` lookup with ISBN detection and optional `GOOGLE_BOOKS_API_KEY` fallback, normalizing up to 6 deduplicated candidates for one-click form prefill inside `BookEditorModal`.
3. **Physical Shelf Elevation View (`src/lib/books/shelves.ts`, `src/app/physical-shelf-view.tsx`)**:
   - Built deterministic position parsing (`parseBookPosition`) and shelf layout synthesis (`buildPhysicalShelves`) covering all 26 position formats across Shelves `1–41`, separating top horizontal stacks from standing archival spines on an inner-scrollable `.shelf-ledge`.
4. **Reading Stats Dashboard & Safe Export (`src/lib/books/stats.ts`, `src/app/reading-stats-modal.tsx`)**:
   - Added pure catalogue metrics (`computeCatalogueStats`) and RFC-4180 CSV / JSON serializers (`serializeBooksToCsv`, `serializeBooksToJson`) with formula-injection neutralization for leading spreadsheet trigger characters.
5. **Curated Editorial Connections (`src/lib/books/connections.ts`, `src/lib/books/repository.ts`, `src/lib/books/relations.ts`, `src/app/api/connections/`)**:
   - Upgraded local persistence to `LocalTrackerState` `version: 2` and added Supabase `book_connections` CRUD with duplicate undirected pair rejection (`409`) and book-deletion cascade cleanup.
   - Boosted relational scoring by `18 + (weight - 1) * 3` and prepended `"Curator link (...)"` bridge reasons into Constellation and Pathfinder explanations.

### Consequences
* Public visitors can browse, filter, inspect shelves/statistics, and trace paths freely while mutations remain gated behind the curator passphrase when configured.
* All 56 Vitest unit/integration tests across 11 suites, ESLint, TypeScript, Next.js production builds, and live Chromium Pass A/Pass B QA verifications pass cleanly before proceeding to Milestone 2 (Wikipedia/Wikidata enrichment, Playwright E2E, CI, and README documentation).

## ADR 8: Multi-Source Bibliographic Enrichment, Classical Chronology & Non-Destructive Live Sync

### Date
2026-11-23

### Context
Prior to Track 2, the static catalogue (`shelf_catalog_full.json`) had significant gaps and legacy artifacts: `537` of `880` volumes lacked summaries, `191` lacked publication years, `175` lacked subject tags, dozens of entries contained Open Library link fragments, author biographies, non-English prose, or `1800`/`1900` edition placeholders, and zero antiquity (`< 0`) or medieval/early CE (`0..1499`) works were represented accurately because the timeline grouped strictly by modern decades and rendered raw signed integers. Meanwhile, live production Supabase (`public.books`) held `877` active rows (`226` with reading progress, `108` rated, and `3` intentional duplicate/split deletions compared to the 880-row seed).

### Decision
* **Classical Chronology Domain Model & UI (`-3000..2100`)**: Added `MIN_PUBLISH_YEAR`, `MAX_PUBLISH_YEAR`, `formatPublishYear()`, and `getTimelineBucket()` in `src/lib/books/catalogue.ts` to format negative years as `<abs> BCE` and group timeline/statistics eras into `Antiquity (BCE)`, `Medieval & Early CE`, `YYYYs`, and `Undated`, paired with matching timeline wrapping CSS and editor validation (`-3000`..`2100`).
* **Multi-Source Enrichment & Strict Quality Filtering**: Upgraded `scripts/enrich-catalogue-books.mjs`, `scripts/apply-catalogue-enrichment.mjs`, `scripts/clean-catalogue-data.mjs`, `scripts/lib/enrichment-helpers.mjs`, and `scripts/lib/classic-years.mjs` to combine curated verified classic chronology (`222` entries) with English Wikipedia + Wikidata (`P577`, `P571`, `P136`) and Open Library fallbacks. Enforced candidate scoring (`MIN_WIKIPEDIA_SCORE = 48`), non-lossy abbreviation-aware sentence splitting, person-biography/foreign-prose/author-mismatch rejection (`isBrokenSummary`), and idempotent non-destructive merging (`title`, `author`, `shelf`, `position`, and `book_key` preserved verbatim).
* **Non-Destructive Live Supabase Synchronization**: Synced enriched `summary`, `tags`, `publish_year`, and `updated_at` onto `public.books` keyed strictly by `book_key` across batched SQL `UPDATE` statements—updating all `877` existing live rows without re-inserting the `3` removed volumes or touching reading statuses, ratings, notes, loans, or `book_connections`.

### Consequences
* Canonical catalogue coverage rose from `343 -> 569` summaries (`0` broken/bio/dot-split/key-drift findings), `689 -> 766` publication years (`26` BCE, `16` Early CE), and `705 -> 765` tagged volumes, while `npm run clean:catalogue` confirmed `0` further changes on re-run.
* Live Supabase `public.books` now reflects `568` summaries, `764` years (`26` BCE, `16` Early CE), and `762` tagged rows across `877` active records with `0` untouched rows and zero loss of curator state.
* All `81` Vitest tests across `12` suites, `eslint`, `tsc --noEmit`, `next build`, and desktop (`1280x800`) + mobile (`390x844`) Chromium visual inspections pass; Track 4 (Playwright E2E, CI, and `README.md`) remains deferred until approved.

## ADR 9: Bulk Curator Operations, Metadata & Duplicate Triage, On-Demand ISBN Barcode Scanning, and Production Documentation

### Date
2026-11-23

### Context
With active live curation on production (`877` volumes, `226` reading statuses, `108` ratings) and `311` remaining volumes still missing summaries or years, maintaining shelf locations, tags, reading statuses, and occasional duplicate/split records one book at a time created unnecessary friction. Furthermore, adding newly acquired physical books on mobile required manually typing ISBNs, and `README.md` remained a 45-line Phase 1 stub that no longer documented the full application, environment variables, migrations, or enrichment CLI.

### Decision
* **Deterministic Curator Triage & Duplicate Detection (`src/lib/books/triage.ts`, `src/app/curator-triage-panel.tsx`)**: Added pure helpers (`getMissingMetadataReasons`, `findPotentialDuplicateGroups`, `computeTriageCounts`, `computeBulkUpdatePatch`) wired into a `Curator triage` filter in `CatalogueApp`. Duplicate clustering preserves volume/part markers (`Vol. 1` vs `Vol. 2`), normalizes diacritics/subtitles, and requires non-conflicting author surnames on same-shelf matches so distinct authors sharing generic anthology titles (e.g., *Selected Poems*) are never false-grouped. Deletions remain explicit, curator-gated, and 2-step confirmed.
* **Auth-Gated Batch Mutations (`POST /api/books/bulk`, `src/lib/books/validation.ts`, `src/lib/books/repository.ts`, `src/app/catalogue-ledger.tsx`)**: Added `validateBulkBooksInput` (`1..200` deduplicated IDs, non-empty patch) and `bulkUpdateBooks()` supporting atomic single-lock writes in Local Mode and per-row collision-safe updates (`23505` reported in `skipped`) in Supabase Mode. Added accessible multi-select checkboxes and a collapsible sticky `<form>` Bulk Action Bar in `CatalogueLedger` requiring an explicit submit button.
* **Wikipedia-Backed 1-Click Enrich (`src/lib/books/lookup.ts`, `src/app/book-detail-card.tsx`, `src/app/book-editor-modal.tsx`)**: Extended `/api/books/lookup` with an optional `?enrich=1` English Wikipedia summary/year fallback (`4000ms` timeout, biography/disambiguation guards) powering an inline selective field-diff preview on incomplete book detail cards and a collapsed `"Find / Enrich metadata"` disclosure in edit mode.
* **Lazy-Loaded Dual-Engine ISBN Barcode Scanner (`src/app/isbn-scanner.tsx`)**: Added `@zxing/browser` and `@zxing/library`, loaded exclusively on demand via `next/dynamic(..., { ssr: false })` and dynamic `import()` when the curator opens `"Scan ISBN"`. Uses native `BarcodeDetector` (`ean_13`, `ean_8`) when available, falls back to ZXing on iOS Safari/Firefox, always stops `MediaStream` tracks cleanly, and includes a `"Scan barcode from photo"` `<input type="file" capture="environment">` fallback.
* **Production Documentation (`README.md`)**: Replaced the Phase 1 stub with complete documentation of views, curator auth, Local vs. Supabase storage modes, `.env.example` variables, both migrations, seeding, Vercel deployment, enrichment scripts, and test/build commands.

### Consequences
* Curators can triage missing metadata and true duplicates, batch-update reading status/shelf/division/tags in one request, selectively enrich individual books in-app, and scan ISBN barcodes on mobile without bloating the initial catalogue JavaScript bundle.
* All `105` Vitest unit and route tests across `14` suites, `eslint`, `tsc --noEmit`, and `next build` pass cleanly; live Chromium QA confirmed duplicate triage (`2` true groups), bulk mode, live 1-Click Enrich persistence, ISBN scanner mount, and `0px` mobile horizontal overflow.
* Milestone B (local taste-graph *"What Should I Read Next?"* shelf recommender + optional Gemini AI Librarian chat) is queued next once Milestone A is committed.

## ADR 10: Local Taste-Graph Shelf Recommender and Curator-Gated Gemini AI Reference Librarian

### Date
2026-11-24

### Context
With `877` live volumes, `226` reading statuses, `108` ratings, and curated `book_connections`, deciding what unread volume on the shelves to pick up next required manually cross-referencing filters, eras, and past favorites. At the same time, introducing optional generative AI ("AI Librarian") on a public Vercel deployment required strict catalogue grounding (zero hallucinated titles) and strict quota protection so unauthenticated visitors could never exhaust the owner's `GEMINI_API_KEY`.

### Decision
* **Zero-Key Local Taste-Graph Engine (`src/lib/books/recommender.ts`)**: Built a pure client-safe recommendation engine scoring unread shelf volumes from weighted ratings (`5★`..`3★`), finished/reading history, gentle `dnf`/low-rating penalties, curated `book_connections` boosts, IDF-weighted display tags, division/sub-category affinity, and era proximity, with `Best Match`, `Stretch Picks`, `Favorite Authors`, `seedBookId` ("Similar unread") anchoring, a 2-book-per-author diversity cap, and a cold-start *"Catalogue Highlights"* fallback.
* **Curator-Gated Grounded Gemini AI Librarian (`src/lib/books/librarian.ts`, `src/app/api/librarian/route.ts`)**: Implemented server-side natural-language cue parsing (`shortlistCatalogueForPrompt`) selecting up to `60` real candidate volumes per query and calling Gemini's `generateContent` REST endpoint (`gemini-2.5-flash` default, structured JSON output, `15000ms` timeout, zero extra npm dependencies) with strict post-validation dropping any unknown/hallucinated `book_id`. Whenever `GEMINI_API_KEY` is configured, `POST /api/librarian` enforces `requireCuratorAuth(request)` (`401` when unauthenticated) and a per-IP `15 req / 15 min` rate limit (`429`); when `GEMINI_API_KEY` is unset or when a public visitor browses without curator sign-in, the UI falls back cleanly to zero-cost **Local Shelf Search**.
* **Dual-Tab Reader's Advisory UI (`src/app/read-next-modal.tsx`, `src/app/page.tsx`, `src/app/catalogue-app.tsx`, `src/app/book-detail-card.tsx`)**: Exposed a `"Read Next"` toolbar button and per-volume `"Similar unread"` trigger opening an accessible native `<ModalDialog>` with an ARIA `role="tablist"` switching between `Shelf Recommender` and `AI Librarian`.

### Consequences
* Readers get instant, explainable unread shelf recommendations offline or online with zero external dependencies or schema migrations, and curators can optionally enable Gemini AI synthesis by setting `GEMINI_API_KEY` in `.env.local` or Vercel without exposing API quota to public traffic.
* All `120` Vitest tests across `17` suites, `eslint`, `tsc --noEmit`, `next build`, and desktop (`1280x800`) + mobile (`390x844`) Chromium visual inspections pass cleanly (`0` console errors, `0` failed requests, `0px` page horizontal overflow).
