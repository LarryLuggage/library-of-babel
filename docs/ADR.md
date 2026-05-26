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
