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
