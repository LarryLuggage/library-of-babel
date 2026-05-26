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
