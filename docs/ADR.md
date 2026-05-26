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
