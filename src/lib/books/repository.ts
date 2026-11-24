import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type CatalogueBook,
  createBookId,
  normalizeCatalogueBook,
  type StorageMode,
} from "@/lib/books/catalogue";
import {
  type BookQuote,
  type CreateQuoteInput,
  type UpdateQuoteInput,
} from "@/lib/books/commonplace";
import {
  type CreateConnectionInput,
  type EditorialConnection,
  isConnectionType,
  normalizeConnectionPairKey,
} from "@/lib/books/connections";
import {
  type AddListItemInput,
  type CreateReadingListInput,
  type ReadingList,
  type ReadingListItem,
  slugifyListName,
  sortReadingLists,
  type UpdateReadingListInput,
} from "@/lib/books/lists";
import {
  type BulkBookPatch,
  computeBulkUpdatePatch,
} from "@/lib/books/triage";
import type {
  CreateBookInput,
  UpdateBookInput,
} from "@/lib/books/validation";
import type { Database } from "@/lib/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type BookRow = Database["public"]["Tables"]["books"]["Row"];
type BookInsert = Database["public"]["Tables"]["books"]["Insert"];
type BookUpdate = Database["public"]["Tables"]["books"]["Update"];
type BookConnectionRow = Database["public"]["Tables"]["book_connections"]["Row"];
type BookQuoteRow = Database["public"]["Tables"]["book_quotes"]["Row"];
type BookQuoteUpdate = Database["public"]["Tables"]["book_quotes"]["Update"];
type ReadingListRow = Database["public"]["Tables"]["reading_lists"]["Row"];
type ReadingListUpdate = Database["public"]["Tables"]["reading_lists"]["Update"];
type ReadingListItemRow =
  Database["public"]["Tables"]["reading_list_items"]["Row"];

type LocalTrackerState = {
  version: 1 | 2 | 3;
  overrides: Record<string, Partial<CatalogueBook>>;
  created: CatalogueBook[];
  deleted: string[];
  connections: EditorialConnection[];
  quotes: BookQuote[];
  lists: ReadingList[];
};

export class DuplicateConnectionError extends Error {
  constructor(
    message = "A curated connection between these two volumes already exists.",
  ) {
    super(message);
    this.name = "DuplicateConnectionError";
  }
}

export class MissingBookReferenceError extends Error {
  constructor(
    message = "One or both referenced volumes were not found.",
  ) {
    super(message);
    this.name = "MissingBookReferenceError";
  }
}

export class DuplicateListError extends Error {
  constructor(
    message = "A reading list with this name already exists.",
  ) {
    super(message);
    this.name = "DuplicateListError";
  }
}

export class DuplicateListItemError extends Error {
  constructor(
    message = "This volume is already on the reading list.",
  ) {
    super(message);
    this.name = "DuplicateListItemError";
  }
}

export class MissingListError extends Error {
  constructor(message = "Reading list not found.") {
    super(message);
    this.name = "MissingListError";
  }
}

export type BulkUpdateResult = {
  updated: CatalogueBook[];
  skipped: Array<{ id: string; reason: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPABASE_PAGE_SIZE = 1000;
const UNCATEGORIZED_CATEGORY = "Uncategorized";

const stateWriteQueues = new Map<string, Promise<unknown>>();

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  return Boolean(url && secretKey);
}

export function getStorageMode(): StorageMode {
  return isSupabaseConfigured() ? "supabase" : "local";
}

function getCatalogueFilePath(): string {
  return path.join(process.cwd(), "shelf_catalog_full.json");
}

function getStateFilePath(): string {
  return (
    process.env.BOOK_TRACKER_STATE_PATH?.trim() ||
    path.join(process.cwd(), "data", "book-tracker-state.json")
  );
}

function withStateLock<T>(
  statePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = stateWriteQueues.get(statePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  stateWriteQueues.set(statePath, next);

  return next.finally(() => {
    if (stateWriteQueues.get(statePath) === next) {
      stateWriteQueues.delete(statePath);
    }
  });
}

async function loadBaseCatalogue(): Promise<CatalogueBook[]> {
  const rawJson = await readFile(getCatalogueFilePath(), "utf8");
  const parsed = JSON.parse(rawJson) as Record<string, unknown>[];
  return parsed.map((row) => normalizeCatalogueBook(row));
}

function emptyLocalState(): LocalTrackerState {
  return {
    version: 3,
    overrides: {},
    created: [],
    deleted: [],
    connections: [],
    quotes: [],
    lists: [],
  };
}

function normalizeLocalConnection(raw: unknown): EditorialConnection | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const sourceId =
    typeof record.source_book_id === "string"
      ? record.source_book_id.trim()
      : "";
  const targetId =
    typeof record.target_book_id === "string"
      ? record.target_book_id.trim()
      : "";

  if (!id || !sourceId || !targetId || sourceId === targetId) {
    return null;
  }

  const weight =
    typeof record.weight === "number" &&
    Number.isInteger(record.weight) &&
    record.weight >= 1 &&
    record.weight <= 3
      ? record.weight
      : 2;

  return {
    id,
    source_book_id: sourceId,
    target_book_id: targetId,
    connection_type: isConnectionType(record.connection_type)
      ? record.connection_type
      : "custom",
    description:
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : null,
    weight,
    created_at:
      typeof record.created_at === "string" && record.created_at.trim()
        ? record.created_at.trim()
        : new Date(0).toISOString(),
  };
}

function normalizeLocalQuote(raw: unknown): BookQuote | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const bookId = typeof record.book_id === "string" ? record.book_id.trim() : "";
  const quoteText =
    typeof record.quote_text === "string" ? record.quote_text.trim() : "";

  if (!id || !bookId || !quoteText) {
    return null;
  }

  const tags = Array.isArray(record.tags)
    ? [
        ...new Set(
          record.tags
            .filter((item): item is string => typeof item === "string")
            .map((item) =>
              item.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"),
            )
            .filter(Boolean),
        ),
      ]
    : [];

  const createdAt =
    typeof record.created_at === "string" && record.created_at.trim()
      ? record.created_at.trim()
      : new Date(0).toISOString();
  const updatedAt =
    typeof record.updated_at === "string" && record.updated_at.trim()
      ? record.updated_at.trim()
      : createdAt;

  return {
    id,
    book_id: bookId,
    quote_text: quoteText,
    page_number:
      typeof record.page_number === "string" && record.page_number.trim()
        ? record.page_number.trim()
        : null,
    chapter:
      typeof record.chapter === "string" && record.chapter.trim()
        ? record.chapter.trim()
        : null,
    note:
      typeof record.note === "string" && record.note.trim()
        ? record.note.trim()
        : null,
    tags,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function normalizeLocalListItem(
  raw: unknown,
  listId: string,
  fallbackPosition: number,
): ReadingListItem | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const bookId = typeof record.book_id === "string" ? record.book_id.trim() : "";
  if (!id || !bookId) {
    return null;
  }

  const position =
    typeof record.position === "number" &&
    Number.isInteger(record.position) &&
    record.position >= 0
      ? record.position
      : fallbackPosition;

  return {
    id,
    list_id: listId,
    book_id: bookId,
    position,
    note:
      typeof record.note === "string" && record.note.trim()
        ? record.note.trim()
        : null,
    added_at:
      typeof record.added_at === "string" && record.added_at.trim()
        ? record.added_at.trim()
        : new Date(0).toISOString(),
  };
}

function normalizeLocalReadingList(raw: unknown): ReadingList | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id || !name) {
    return null;
  }

  const slug =
    typeof record.slug === "string" && record.slug.trim()
      ? record.slug.trim()
      : slugifyListName(name);

  const createdAt =
    typeof record.created_at === "string" && record.created_at.trim()
      ? record.created_at.trim()
      : new Date(0).toISOString();
  const updatedAt =
    typeof record.updated_at === "string" && record.updated_at.trim()
      ? record.updated_at.trim()
      : createdAt;

  const rawItems = Array.isArray(record.items) ? record.items : [];
  const seenBooks = new Set<string>();
  const items: ReadingListItem[] = [];

  for (let i = 0; i < rawItems.length; i += 1) {
    const normalized = normalizeLocalListItem(rawItems[i], id, i);
    if (!normalized || seenBooks.has(normalized.book_id)) {
      continue;
    }
    seenBooks.add(normalized.book_id);
    items.push(normalized);
  }

  items.sort((a, b) => {
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    return a.added_at.localeCompare(b.added_at);
  });

  return {
    id,
    slug,
    name,
    description:
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : null,
    is_queue: record.is_queue === true,
    created_at: createdAt,
    updated_at: updatedAt,
    items,
  };
}

async function loadLocalState(statePath: string): Promise<LocalTrackerState> {
  try {
    const rawJson = await readFile(statePath, "utf8");
    const parsed = JSON.parse(rawJson) as Partial<LocalTrackerState>;

    const connections = Array.isArray(parsed.connections)
      ? parsed.connections
          .map(normalizeLocalConnection)
          .filter((item): item is EditorialConnection => item !== null)
      : [];

    const quotes = Array.isArray(parsed.quotes)
      ? parsed.quotes
          .map(normalizeLocalQuote)
          .filter((item): item is BookQuote => item !== null)
      : [];

    const lists = Array.isArray(parsed.lists)
      ? parsed.lists
          .map(normalizeLocalReadingList)
          .filter((item): item is ReadingList => item !== null)
      : [];

    const version =
      parsed.version === 1 ? 1 : parsed.version === 2 ? 2 : 3;

    return {
      version,
      overrides:
        parsed.overrides &&
        typeof parsed.overrides === "object" &&
        !Array.isArray(parsed.overrides)
          ? parsed.overrides
          : {},
      created: Array.isArray(parsed.created) ? parsed.created : [],
      deleted: Array.isArray(parsed.deleted)
        ? parsed.deleted.filter((item): item is string => typeof item === "string")
        : [],
      connections,
      quotes,
      lists,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return emptyLocalState();
    }
    throw error;
  }
}

async function saveLocalState(
  statePath: string,
  state: LocalTrackerState,
): Promise<void> {
  const directory = path.dirname(statePath);
  await mkdir(directory, { recursive: true });

  const persistedState: LocalTrackerState = {
    ...state,
    version: 3,
  };

  const tmpPath = path.join(
    directory,
    `.${path.basename(statePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(
    tmpPath,
    `${JSON.stringify(persistedState, null, 2)}\n`,
    "utf8",
  );
  await rename(tmpPath, statePath);
}

function mapSupabaseRowToBook(row: BookRow): CatalogueBook {
  return normalizeCatalogueBook({
    id: row.book_key ?? row.id,
    author: row.author,
    title: row.title,
    edition: row.edition ?? "",
    shelf: row.shelf_row ?? 0,
    position: row.position ?? "",
    top_category: row.top_category,
    sub_category: row.sub_category,
    summary: row.summary,
    tags: row.tags,
    publish_year: row.publish_year,
    reading_status: row.reading_status,
    rating: row.rating,
    date_started: row.date_started,
    date_finished: row.date_finished,
    personal_notes: row.personal_notes,
    loaned_to: row.loaned_to,
  });
}

async function findSupabaseRowByKeyOrId(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
): Promise<BookRow | null> {
  const query = supabase.from("books").select("*");
  const { data, error } = UUID_PATTERN.test(id)
    ? await query.or(`book_key.eq.${id},id.eq.${id}`).maybeSingle()
    : await query.eq("book_key", id).maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function listBooks(): Promise<{
  books: CatalogueBook[];
  storageMode: StorageMode;
}> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const rows: BookRow[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      rows.push(...data);

      if (data.length < SUPABASE_PAGE_SIZE) {
        break;
      }

      offset += SUPABASE_PAGE_SIZE;
    }

    return {
      books: rows.map(mapSupabaseRowToBook),
      storageMode: "supabase",
    };
  }

  const statePath = getStateFilePath();
  const [baseBooks, state] = await Promise.all([
    loadBaseCatalogue(),
    loadLocalState(statePath),
  ]);

  const deletedSet = new Set(state.deleted);
  const mergedBaseBooks: CatalogueBook[] = [];

  for (const book of baseBooks) {
    if (deletedSet.has(book.id)) {
      continue;
    }

    const override = state.overrides[book.id];
    mergedBaseBooks.push(
      override
        ? normalizeCatalogueBook({ ...book, ...override, id: book.id })
        : book,
    );
  }

  const createdBooks = state.created
    .filter((book) => !deletedSet.has(book.id))
    .map((book) => normalizeCatalogueBook(book as Record<string, unknown>));

  return {
    books: [...mergedBaseBooks, ...createdBooks],
    storageMode: "local",
  };
}

export async function createBook(input: CreateBookInput): Promise<CatalogueBook> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    let bookKey = createBookId({
      author: input.author,
      title: input.title,
      shelf: input.shelf,
      position: input.position,
    });

    const { data: existing, error: lookupError } = await supabase
      .from("books")
      .select("id")
      .eq("book_key", bookKey)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    if (existing) {
      bookKey = `${bookKey}_${randomUUID().slice(0, 8)}`;
    }

    const insertRow: BookInsert = {
      book_key: bookKey,
      title: input.title,
      author: input.author,
      category:
        input.sub_category ?? input.top_category ?? UNCATEGORIZED_CATEGORY,
      edition: input.edition || null,
      shelf_row: input.shelf,
      position: input.position || null,
      top_category: input.top_category,
      sub_category: input.sub_category,
      summary: input.summary,
      tags: input.tags,
      publish_year: input.publish_year,
      reading_status: input.reading_status,
      rating: input.rating,
      date_started: input.date_started,
      date_finished: input.date_finished,
      personal_notes: input.personal_notes,
      loaned_to: input.loaned_to,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("books")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return mapSupabaseRowToBook(data);
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const [baseBooks, state] = await Promise.all([
      loadBaseCatalogue(),
      loadLocalState(statePath),
    ]);

    const usedIds = new Set<string>([
      ...baseBooks.map((book) => book.id),
      ...state.created.map((book) => book.id),
      ...state.deleted,
    ]);

    const baseId = createBookId({
      author: input.author,
      title: input.title,
      shelf: input.shelf,
      position: input.position,
    });

    const id = usedIds.has(baseId)
      ? `${baseId}_${randomUUID().slice(0, 8)}`
      : baseId;

    const newBook = normalizeCatalogueBook({
      ...input,
      id,
    });

    state.created.push(newBook);
    await saveLocalState(statePath, state);

    return newBook;
  });
}

function isUniqueViolationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function buildCategoryFields(
  existing: Pick<BookRow, "top_category" | "sub_category">,
  patch: Pick<UpdateBookInput, "top_category" | "sub_category">,
): Pick<BookUpdate, "top_category" | "sub_category" | "category"> {
  const fields: Pick<BookUpdate, "top_category" | "sub_category" | "category"> =
    {};

  if (patch.top_category !== undefined) {
    fields.top_category = patch.top_category;
  }
  if (patch.sub_category !== undefined) {
    fields.sub_category = patch.sub_category;
  }
  if (patch.top_category !== undefined || patch.sub_category !== undefined) {
    const nextTop =
      patch.top_category !== undefined
        ? patch.top_category
        : existing.top_category;
    const nextSub =
      patch.sub_category !== undefined
        ? patch.sub_category
        : existing.sub_category;
    fields.category = nextSub ?? nextTop ?? UNCATEGORIZED_CATEGORY;
  }

  return fields;
}

function buildSupabaseUpdatePayload(
  existing: Pick<BookRow, "top_category" | "sub_category">,
  patch: UpdateBookInput,
): BookUpdate {
  const updatePayload: BookUpdate = {
    updated_at: new Date().toISOString(),
    ...buildCategoryFields(existing, patch),
  };

  if (patch.title !== undefined) {
    updatePayload.title = patch.title;
  }
  if (patch.author !== undefined) {
    updatePayload.author = patch.author;
  }
  if (patch.edition !== undefined) {
    updatePayload.edition = patch.edition || null;
  }
  if (patch.shelf !== undefined) {
    updatePayload.shelf_row = patch.shelf;
  }
  if (patch.position !== undefined) {
    updatePayload.position = patch.position || null;
  }
  if (patch.summary !== undefined) {
    updatePayload.summary = patch.summary;
  }
  if (patch.tags !== undefined) {
    updatePayload.tags = patch.tags;
  }
  if (patch.publish_year !== undefined) {
    updatePayload.publish_year = patch.publish_year;
  }
  if (patch.reading_status !== undefined) {
    updatePayload.reading_status = patch.reading_status;
  }
  if (patch.rating !== undefined) {
    updatePayload.rating = patch.rating;
  }
  if (patch.date_started !== undefined) {
    updatePayload.date_started = patch.date_started;
  }
  if (patch.date_finished !== undefined) {
    updatePayload.date_finished = patch.date_finished;
  }
  if (patch.personal_notes !== undefined) {
    updatePayload.personal_notes = patch.personal_notes;
  }
  if (patch.loaned_to !== undefined) {
    updatePayload.loaned_to = patch.loaned_to;
  }

  return updatePayload;
}

export async function updateBook(
  id: string,
  patch: UpdateBookInput,
): Promise<CatalogueBook | null> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const existing = await findSupabaseRowByKeyOrId(supabase, id);

    if (!existing) {
      return null;
    }

    const updatePayload = buildSupabaseUpdatePayload(existing, patch);

    const { data, error } = await supabase
      .from("books")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return mapSupabaseRowToBook(data);
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const createdIndex = state.created.findIndex((book) => book.id === id);

    if (createdIndex !== -1) {
      const updated = normalizeCatalogueBook({
        ...state.created[createdIndex],
        ...patch,
        id,
      });
      state.created[createdIndex] = updated;
      await saveLocalState(statePath, state);
      return updated;
    }

    if (state.deleted.includes(id)) {
      return null;
    }

    const baseBooks = await loadBaseCatalogue();
    const baseBook = baseBooks.find((book) => book.id === id);

    if (!baseBook) {
      return null;
    }

    const nextOverride: Partial<CatalogueBook> = {
      ...(state.overrides[id] ?? {}),
      ...patch,
    };
    state.overrides[id] = nextOverride;

    const updated = normalizeCatalogueBook({
      ...baseBook,
      ...nextOverride,
      id,
    });
    await saveLocalState(statePath, state);
    return updated;
  });
}

export async function bulkUpdateBooks(
  ids: readonly string[],
  patch: BulkBookPatch,
): Promise<BulkUpdateResult> {
  const dedupedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const rawId of ids) {
    const trimmed = rawId.trim();
    if (trimmed && !seenIds.has(trimmed)) {
      seenIds.add(trimmed);
      dedupedIds.push(trimmed);
    }
  }

  if (dedupedIds.length === 0) {
    return { updated: [], skipped: [] };
  }

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const rowByIdentifier = new Map<string, BookRow>();

    const { data: keyRows, error: keyLookupError } = await supabase
      .from("books")
      .select("*")
      .in("book_key", dedupedIds);

    if (keyLookupError) {
      throw keyLookupError;
    }

    for (const row of keyRows ?? []) {
      if (row.book_key) {
        rowByIdentifier.set(row.book_key, row);
      }
      rowByIdentifier.set(row.id, row);
    }

    const missingUuidIds = dedupedIds.filter(
      (id) => !rowByIdentifier.has(id) && UUID_PATTERN.test(id),
    );
    if (missingUuidIds.length > 0) {
      const { data: uuidRows, error: uuidLookupError } = await supabase
        .from("books")
        .select("*")
        .in("id", missingUuidIds);

      if (uuidLookupError) {
        throw uuidLookupError;
      }

      for (const row of uuidRows ?? []) {
        if (row.book_key) {
          rowByIdentifier.set(row.book_key, row);
        }
        rowByIdentifier.set(row.id, row);
      }
    }

    const updated: CatalogueBook[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const processedRowUuids = new Set<string>();

    for (const id of dedupedIds) {
      const existing = rowByIdentifier.get(id);
      if (!existing) {
        skipped.push({ id, reason: "Book not found." });
        continue;
      }

      if (processedRowUuids.has(existing.id)) {
        continue;
      }
      processedRowUuids.add(existing.id);

      const existingBook = mapSupabaseRowToBook(existing);
      const updatePatch = computeBulkUpdatePatch(existingBook, patch);
      const updatePayload = buildSupabaseUpdatePayload(existing, updatePatch);

      const { data, error } = await supabase
        .from("books")
        .update(updatePayload)
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) {
        if (isUniqueViolationError(error)) {
          skipped.push({
            id,
            reason: "A volume with this shelf copy identity already exists.",
          });
          continue;
        }
        throw error;
      }

      updated.push(mapSupabaseRowToBook(data));
    }

    return { updated, skipped };
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const [baseBooks, state] = await Promise.all([
      loadBaseCatalogue(),
      loadLocalState(statePath),
    ]);

    const deletedSet = new Set(state.deleted);
    const createdIndexById = new Map<string, number>();
    for (let i = 0; i < state.created.length; i += 1) {
      createdIndexById.set(state.created[i].id, i);
    }

    const baseBookById = new Map<string, CatalogueBook>();
    for (const book of baseBooks) {
      baseBookById.set(book.id, book);
    }

    const updated: CatalogueBook[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const id of dedupedIds) {
      if (deletedSet.has(id)) {
        skipped.push({ id, reason: "Book not found." });
        continue;
      }

      const createdIndex = createdIndexById.get(id);
      if (createdIndex !== undefined) {
        const currentBook = normalizeCatalogueBook(
          state.created[createdIndex] as Record<string, unknown>,
        );
        const updatePatch = computeBulkUpdatePatch(currentBook, patch);
        const nextBook = normalizeCatalogueBook({
          ...currentBook,
          ...updatePatch,
          id,
        });
        state.created[createdIndex] = nextBook;
        updated.push(nextBook);
        continue;
      }

      const baseBook = baseBookById.get(id);
      if (!baseBook) {
        skipped.push({ id, reason: "Book not found." });
        continue;
      }

      const currentOverride = state.overrides[id] ?? {};
      const currentBook = normalizeCatalogueBook({
        ...baseBook,
        ...currentOverride,
        id,
      });
      const updatePatch = computeBulkUpdatePatch(currentBook, patch);
      const nextOverride: Partial<CatalogueBook> = {
        ...currentOverride,
        ...updatePatch,
      };
      state.overrides[id] = nextOverride;

      const nextBook = normalizeCatalogueBook({
        ...baseBook,
        ...nextOverride,
        id,
      });
      updated.push(nextBook);
    }

    if (updated.length > 0) {
      await saveLocalState(statePath, state);
    }

    return { updated, skipped };
  });
}

function cascadeDeleteBookFromLocalState(
  state: LocalTrackerState,
  bookId: string,
): void {
  state.connections = state.connections.filter(
    (conn) => conn.source_book_id !== bookId && conn.target_book_id !== bookId,
  );
  state.quotes = state.quotes.filter((quote) => quote.book_id !== bookId);

  const now = new Date().toISOString();
  state.lists = state.lists.map((list) => {
    const remaining = list.items.filter((item) => item.book_id !== bookId);
    if (remaining.length === list.items.length) {
      return list;
    }
    return {
      ...list,
      updated_at: now,
      items: remaining.map((item, index) => ({
        ...item,
        position: index,
      })),
    };
  });
}

export async function deleteBook(id: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const existing = await findSupabaseRowByKeyOrId(supabase, id);

    if (!existing) {
      return false;
    }

    const { error } = await supabase
      .from("books")
      .delete()
      .eq("id", existing.id);

    if (error) {
      throw error;
    }

    return true;
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const createdLengthBefore = state.created.length;
    state.created = state.created.filter((book) => book.id !== id);

    if (state.created.length !== createdLengthBefore) {
      cascadeDeleteBookFromLocalState(state, id);
      await saveLocalState(statePath, state);
      return true;
    }

    if (state.deleted.includes(id)) {
      return false;
    }

    const baseBooks = await loadBaseCatalogue();
    const existsInBase = baseBooks.some((book) => book.id === id);

    if (!existsInBase) {
      return false;
    }

    state.deleted.push(id);
    delete state.overrides[id];
    cascadeDeleteBookFromLocalState(state, id);
    await saveLocalState(statePath, state);
    return true;
  });
}

function mapSupabaseRowToConnection(
  row: BookConnectionRow,
  uuidToBookId: ReadonlyMap<string, string>,
): EditorialConnection {
  const weight =
    typeof row.weight === "number" &&
    Number.isInteger(row.weight) &&
    row.weight >= 1 &&
    row.weight <= 3
      ? row.weight
      : 2;

  return {
    id: row.id,
    source_book_id: uuidToBookId.get(row.source_book_id) ?? row.source_book_id,
    target_book_id: uuidToBookId.get(row.target_book_id) ?? row.target_book_id,
    connection_type: isConnectionType(row.connection_type)
      ? row.connection_type
      : "custom",
    description: row.description,
    weight,
    created_at: row.created_at,
  };
}

export async function listConnections(): Promise<EditorialConnection[]> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const rows: BookConnectionRow[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from("book_connections")
        .select("*")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      rows.push(...data);

      if (data.length < SUPABASE_PAGE_SIZE) {
        break;
      }

      offset += SUPABASE_PAGE_SIZE;
    }

    if (rows.length === 0) {
      return [];
    }

    const bookUuids = [
      ...new Set(
        rows.flatMap((row) => [row.source_book_id, row.target_book_id]),
      ),
    ];

    const uuidToBookId = new Map<string, string>();
    const ID_BATCH_SIZE = 500;
    for (let i = 0; i < bookUuids.length; i += ID_BATCH_SIZE) {
      const batch = bookUuids.slice(i, i + ID_BATCH_SIZE);
      const { data: bookRows, error: bookLookupError } = await supabase
        .from("books")
        .select("id, book_key")
        .in("id", batch);

      if (bookLookupError) {
        throw bookLookupError;
      }

      for (const bookRow of bookRows ?? []) {
        uuidToBookId.set(bookRow.id, bookRow.book_key ?? bookRow.id);
      }
    }

    return rows.map((row) => mapSupabaseRowToConnection(row, uuidToBookId));
  }

  const statePath = getStateFilePath();
  const state = await loadLocalState(statePath);
  const deletedSet = new Set(state.deleted);

  return state.connections.filter(
    (conn) =>
      !deletedSet.has(conn.source_book_id) &&
      !deletedSet.has(conn.target_book_id),
  );
}

export async function createConnection(
  input: CreateConnectionInput,
): Promise<EditorialConnection> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const [sourceRow, targetRow] = await Promise.all([
      findSupabaseRowByKeyOrId(supabase, input.source_book_id),
      findSupabaseRowByKeyOrId(supabase, input.target_book_id),
    ]);

    if (!sourceRow || !targetRow) {
      throw new MissingBookReferenceError();
    }

    if (sourceRow.id === targetRow.id) {
      throw new DuplicateConnectionError("Cannot link a volume to itself.");
    }

    const { data, error } = await supabase
      .from("book_connections")
      .insert({
        source_book_id: sourceRow.id,
        target_book_id: targetRow.id,
        connection_type: input.connection_type,
        description: input.description,
        weight: input.weight,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new DuplicateConnectionError();
      }
      throw error;
    }

    const uuidToBookId = new Map<string, string>([
      [sourceRow.id, sourceRow.book_key ?? sourceRow.id],
      [targetRow.id, targetRow.book_key ?? targetRow.id],
    ]);

    return mapSupabaseRowToConnection(data, uuidToBookId);
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const [baseBooks, state] = await Promise.all([
      loadBaseCatalogue(),
      loadLocalState(statePath),
    ]);

    const deletedSet = new Set(state.deleted);
    const activeBookIds = new Set<string>();
    for (const book of baseBooks) {
      if (!deletedSet.has(book.id)) {
        activeBookIds.add(book.id);
      }
    }
    for (const book of state.created) {
      if (!deletedSet.has(book.id)) {
        activeBookIds.add(book.id);
      }
    }

    if (
      !activeBookIds.has(input.source_book_id) ||
      !activeBookIds.has(input.target_book_id)
    ) {
      throw new MissingBookReferenceError();
    }

    const pairKey = normalizeConnectionPairKey(
      input.source_book_id,
      input.target_book_id,
    );
    const duplicateExists = state.connections.some(
      (conn) =>
        normalizeConnectionPairKey(conn.source_book_id, conn.target_book_id) ===
        pairKey,
    );

    if (duplicateExists) {
      throw new DuplicateConnectionError();
    }

    const connection: EditorialConnection = {
      id: `conn_${randomUUID()}`,
      source_book_id: input.source_book_id,
      target_book_id: input.target_book_id,
      connection_type: input.connection_type,
      description: input.description,
      weight: input.weight,
      created_at: new Date().toISOString(),
    };

    state.connections.push(connection);
    await saveLocalState(statePath, state);
    return connection;
  });
}

export async function deleteConnection(id: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    if (!UUID_PATTERN.test(id)) {
      return false;
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("book_connections")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) {
      throw error;
    }

    return (data?.length ?? 0) > 0;
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const countBefore = state.connections.length;
    state.connections = state.connections.filter((conn) => conn.id !== id);

    if (state.connections.length === countBefore) {
      return false;
    }

    await saveLocalState(statePath, state);
    return true;
  });
}

async function resolveSupabaseBookKeysByUuid(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  uuids: readonly string[],
): Promise<Map<string, string>> {
  const uniqueUuids = [...new Set(uuids)];
  const uuidToBookId = new Map<string, string>();
  const ID_BATCH_SIZE = 500;

  for (let i = 0; i < uniqueUuids.length; i += ID_BATCH_SIZE) {
    const batch = uniqueUuids.slice(i, i + ID_BATCH_SIZE);
    const { data: bookRows, error } = await supabase
      .from("books")
      .select("id, book_key")
      .in("id", batch);

    if (error) {
      throw error;
    }

    for (const bookRow of bookRows ?? []) {
      uuidToBookId.set(bookRow.id, bookRow.book_key ?? bookRow.id);
    }
  }

  return uuidToBookId;
}

async function loadActiveLocalBookIds(
  state: LocalTrackerState,
): Promise<Set<string>> {
  const baseBooks = await loadBaseCatalogue();
  const deletedSet = new Set(state.deleted);
  const activeBookIds = new Set<string>();

  for (const book of baseBooks) {
    if (!deletedSet.has(book.id)) {
      activeBookIds.add(book.id);
    }
  }
  for (const book of state.created) {
    if (!deletedSet.has(book.id)) {
      activeBookIds.add(book.id);
    }
  }

  return activeBookIds;
}

function mapSupabaseRowToQuote(
  row: BookQuoteRow,
  uuidToBookId: ReadonlyMap<string, string>,
): BookQuote {
  return {
    id: row.id,
    book_id: uuidToBookId.get(row.book_id) ?? row.book_id,
    quote_text: row.quote_text,
    page_number: row.page_number,
    chapter: row.chapter,
    note: row.note,
    tags: Array.isArray(row.tags) ? row.tags : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listQuotes(): Promise<BookQuote[]> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const rows: BookQuoteRow[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await supabase
        .from("book_quotes")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      rows.push(...data);

      if (data.length < SUPABASE_PAGE_SIZE) {
        break;
      }

      offset += SUPABASE_PAGE_SIZE;
    }

    if (rows.length === 0) {
      return [];
    }

    const uuidToBookId = await resolveSupabaseBookKeysByUuid(
      supabase,
      rows.map((row) => row.book_id),
    );

    return rows.map((row) => mapSupabaseRowToQuote(row, uuidToBookId));
  }

  const statePath = getStateFilePath();
  const state = await loadLocalState(statePath);
  const deletedSet = new Set(state.deleted);

  return state.quotes
    .filter((quote) => !deletedSet.has(quote.book_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createQuote(input: CreateQuoteInput): Promise<BookQuote> {
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const bookRow = await findSupabaseRowByKeyOrId(supabase, input.book_id);

    if (!bookRow) {
      throw new MissingBookReferenceError("Referenced volume was not found.");
    }

    const { data, error } = await supabase
      .from("book_quotes")
      .insert({
        book_id: bookRow.id,
        quote_text: input.quote_text,
        page_number: input.page_number ?? null,
        chapter: input.chapter ?? null,
        note: input.note ?? null,
        tags: input.tags ?? [],
        updated_at: now,
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    const uuidToBookId = new Map<string, string>([
      [bookRow.id, bookRow.book_key ?? bookRow.id],
    ]);
    return mapSupabaseRowToQuote(data, uuidToBookId);
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const activeBookIds = await loadActiveLocalBookIds(state);

    if (!activeBookIds.has(input.book_id)) {
      throw new MissingBookReferenceError("Referenced volume was not found.");
    }

    const quote: BookQuote = {
      id: `qt_${randomUUID()}`,
      book_id: input.book_id,
      quote_text: input.quote_text,
      page_number: input.page_number ?? null,
      chapter: input.chapter ?? null,
      note: input.note ?? null,
      tags: input.tags ?? [],
      created_at: now,
      updated_at: now,
    };

    state.quotes.push(quote);
    await saveLocalState(statePath, state);
    return quote;
  });
}

export async function updateQuote(
  id: string,
  patch: UpdateQuoteInput,
): Promise<BookQuote | null> {
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    if (!UUID_PATTERN.test(id)) {
      return null;
    }

    const supabase = createSupabaseAdminClient();
    const updatePayload: BookQuoteUpdate = {
      updated_at: now,
    };

    if (patch.quote_text !== undefined) {
      updatePayload.quote_text = patch.quote_text;
    }
    if (patch.page_number !== undefined) {
      updatePayload.page_number = patch.page_number;
    }
    if (patch.chapter !== undefined) {
      updatePayload.chapter = patch.chapter;
    }
    if (patch.note !== undefined) {
      updatePayload.note = patch.note;
    }
    if (patch.tags !== undefined) {
      updatePayload.tags = patch.tags;
    }

    const { data, error } = await supabase
      .from("book_quotes")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    const uuidToBookId = await resolveSupabaseBookKeysByUuid(supabase, [
      data.book_id,
    ]);
    return mapSupabaseRowToQuote(data, uuidToBookId);
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const index = state.quotes.findIndex((quote) => quote.id === id);

    if (index === -1 || state.deleted.includes(state.quotes[index].book_id)) {
      return null;
    }

    const existing = state.quotes[index];
    const updated: BookQuote = {
      ...existing,
      ...(patch.quote_text !== undefined
        ? { quote_text: patch.quote_text }
        : {}),
      ...(patch.page_number !== undefined
        ? { page_number: patch.page_number }
        : {}),
      ...(patch.chapter !== undefined ? { chapter: patch.chapter } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      updated_at: now,
    };

    state.quotes[index] = updated;
    await saveLocalState(statePath, state);
    return updated;
  });
}

export async function deleteQuote(id: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    if (!UUID_PATTERN.test(id)) {
      return false;
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("book_quotes")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) {
      throw error;
    }

    return (data?.length ?? 0) > 0;
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const countBefore = state.quotes.length;
    state.quotes = state.quotes.filter((quote) => quote.id !== id);

    if (state.quotes.length === countBefore) {
      return false;
    }

    await saveLocalState(statePath, state);
    return true;
  });
}

function mapSupabaseRowToListItem(
  row: ReadingListItemRow,
  uuidToBookId: ReadonlyMap<string, string>,
): ReadingListItem {
  return {
    id: row.id,
    list_id: row.list_id,
    book_id: uuidToBookId.get(row.book_id) ?? row.book_id,
    position: row.position,
    note: row.note,
    added_at: row.added_at,
  };
}

function mapSupabaseRowToReadingList(
  row: ReadingListRow,
  items: ReadingListItem[],
): ReadingList {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    is_queue: row.is_queue,
    created_at: row.created_at,
    updated_at: row.updated_at,
    items,
  };
}

async function loadSupabaseReadingListById(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  listId: string,
): Promise<ReadingList | null> {
  const { data: listRow, error: listError } = await supabase
    .from("reading_lists")
    .select("*")
    .eq("id", listId)
    .maybeSingle();

  if (listError) {
    throw listError;
  }

  if (!listRow) {
    return null;
  }

  const { data: itemRows, error: itemError } = await supabase
    .from("reading_list_items")
    .select("*")
    .eq("list_id", listId)
    .order("position", { ascending: true })
    .order("added_at", { ascending: true })
    .order("id", { ascending: true });

  if (itemError) {
    throw itemError;
  }

  const rows = itemRows ?? [];
  const uuidToBookId =
    rows.length > 0
      ? await resolveSupabaseBookKeysByUuid(
          supabase,
          rows.map((r) => r.book_id),
        )
      : new Map<string, string>();

  const items = rows.map((row) => mapSupabaseRowToListItem(row, uuidToBookId));
  return mapSupabaseRowToReadingList(listRow, items);
}

export async function listReadingLists(): Promise<ReadingList[]> {
  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const listRows: ReadingListRow[] = [];
    let listOffset = 0;

    while (true) {
      const { data, error } = await supabase
        .from("reading_lists")
        .select("*")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(listOffset, listOffset + SUPABASE_PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      listRows.push(...data);

      if (data.length < SUPABASE_PAGE_SIZE) {
        break;
      }

      listOffset += SUPABASE_PAGE_SIZE;
    }

    if (listRows.length === 0) {
      return [];
    }

    const itemRows: ReadingListItemRow[] = [];
    let itemOffset = 0;

    while (true) {
      const { data, error } = await supabase
        .from("reading_list_items")
        .select("*")
        .order("position", { ascending: true })
        .order("added_at", { ascending: true })
        .order("id", { ascending: true })
        .range(itemOffset, itemOffset + SUPABASE_PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      itemRows.push(...data);

      if (data.length < SUPABASE_PAGE_SIZE) {
        break;
      }

      itemOffset += SUPABASE_PAGE_SIZE;
    }

    const uuidToBookId =
      itemRows.length > 0
        ? await resolveSupabaseBookKeysByUuid(
            supabase,
            itemRows.map((row) => row.book_id),
          )
        : new Map<string, string>();

    const itemsByListId = new Map<string, ReadingListItem[]>();
    for (const row of itemRows) {
      const listItems = itemsByListId.get(row.list_id) ?? [];
      listItems.push(mapSupabaseRowToListItem(row, uuidToBookId));
      itemsByListId.set(row.list_id, listItems);
    }

    const assembled = listRows.map((row) =>
      mapSupabaseRowToReadingList(row, itemsByListId.get(row.id) ?? []),
    );
    return sortReadingLists(assembled);
  }

  const statePath = getStateFilePath();
  const state = await loadLocalState(statePath);
  const deletedSet = new Set(state.deleted);

  const sanitized = state.lists.map((list) => ({
    ...list,
    items: list.items
      .filter((item) => !deletedSet.has(item.book_id))
      .sort((a, b) => {
        if (a.position !== b.position) {
          return a.position - b.position;
        }
        return a.added_at.localeCompare(b.added_at);
      }),
  }));

  return sortReadingLists(sanitized);
}

export async function createReadingList(
  input: CreateReadingListInput,
): Promise<ReadingList> {
  const now = new Date().toISOString();
  const slug = slugifyListName(input.name);

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("reading_lists")
      .insert({
        slug,
        name: input.name,
        description: input.description ?? null,
        is_queue: input.is_queue ?? false,
        updated_at: now,
      })
      .select("*")
      .single();

    if (error) {
      if (isUniqueViolationError(error)) {
        throw new DuplicateListError();
      }
      throw error;
    }

    return mapSupabaseRowToReadingList(data, []);
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    if (state.lists.some((list) => list.slug === slug)) {
      throw new DuplicateListError();
    }

    const list: ReadingList = {
      id: `lst_${randomUUID()}`,
      slug,
      name: input.name,
      description: input.description ?? null,
      is_queue: input.is_queue ?? false,
      created_at: now,
      updated_at: now,
      items: [],
    };

    state.lists.push(list);
    await saveLocalState(statePath, state);
    return list;
  });
}

export async function updateReadingList(
  id: string,
  patch: UpdateReadingListInput,
): Promise<ReadingList | null> {
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    if (!UUID_PATTERN.test(id)) {
      return null;
    }

    const supabase = createSupabaseAdminClient();
    const updatePayload: ReadingListUpdate = {
      updated_at: now,
    };

    if (patch.name !== undefined) {
      updatePayload.name = patch.name;
      updatePayload.slug = slugifyListName(patch.name);
    }
    if (patch.description !== undefined) {
      updatePayload.description = patch.description;
    }
    if (patch.is_queue !== undefined) {
      updatePayload.is_queue = patch.is_queue;
    }

    const { data, error } = await supabase
      .from("reading_lists")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      if (isUniqueViolationError(error)) {
        throw new DuplicateListError();
      }
      throw error;
    }

    if (!data) {
      return null;
    }

    return loadSupabaseReadingListById(supabase, data.id);
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const index = state.lists.findIndex((list) => list.id === id);

    if (index === -1) {
      return null;
    }

    const existing = state.lists[index];
    const nextName = patch.name !== undefined ? patch.name : existing.name;
    const nextSlug =
      patch.name !== undefined ? slugifyListName(patch.name) : existing.slug;

    if (
      state.lists.some((list) => list.id !== id && list.slug === nextSlug)
    ) {
      throw new DuplicateListError();
    }

    const updated: ReadingList = {
      ...existing,
      name: nextName,
      slug: nextSlug,
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.is_queue !== undefined ? { is_queue: patch.is_queue } : {}),
      updated_at: now,
    };

    state.lists[index] = updated;
    await saveLocalState(statePath, state);
    return updated;
  });
}

export async function deleteReadingList(id: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    if (!UUID_PATTERN.test(id)) {
      return false;
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("reading_lists")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) {
      throw error;
    }

    return (data?.length ?? 0) > 0;
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const countBefore = state.lists.length;
    state.lists = state.lists.filter((list) => list.id !== id);

    if (state.lists.length === countBefore) {
      return false;
    }

    await saveLocalState(statePath, state);
    return true;
  });
}

export async function addBookToReadingList(
  listId: string,
  input: AddListItemInput,
): Promise<{ list: ReadingList; item: ReadingListItem }> {
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    if (!UUID_PATTERN.test(listId)) {
      throw new MissingListError();
    }

    const supabase = createSupabaseAdminClient();
    const [{ data: listRow, error: listError }, bookRow] = await Promise.all([
      supabase
        .from("reading_lists")
        .select("id")
        .eq("id", listId)
        .maybeSingle(),
      findSupabaseRowByKeyOrId(supabase, input.book_id),
    ]);

    if (listError) {
      throw listError;
    }
    if (!listRow) {
      throw new MissingListError();
    }
    if (!bookRow) {
      throw new MissingBookReferenceError("Referenced volume was not found.");
    }

    const { data: tailRow, error: tailError } = await supabase
      .from("reading_list_items")
      .select("position")
      .eq("list_id", listId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tailError) {
      throw tailError;
    }

    const nextPosition = tailRow ? tailRow.position + 1 : 0;

    const { data: insertedItem, error: insertError } = await supabase
      .from("reading_list_items")
      .insert({
        list_id: listId,
        book_id: bookRow.id,
        position: nextPosition,
        note: input.note ?? null,
      })
      .select("*")
      .single();

    if (insertError) {
      if (isUniqueViolationError(insertError)) {
        throw new DuplicateListItemError();
      }
      throw insertError;
    }

    const { error: touchError } = await supabase
      .from("reading_lists")
      .update({ updated_at: now })
      .eq("id", listId);

    if (touchError) {
      throw touchError;
    }

    const list = await loadSupabaseReadingListById(supabase, listId);
    if (!list) {
      throw new MissingListError();
    }

    const uuidToBookId = new Map<string, string>([
      [bookRow.id, bookRow.book_key ?? bookRow.id],
    ]);
    return {
      list,
      item: mapSupabaseRowToListItem(insertedItem, uuidToBookId),
    };
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const listIndex = state.lists.findIndex((list) => list.id === listId);

    if (listIndex === -1) {
      throw new MissingListError();
    }

    const activeBookIds = await loadActiveLocalBookIds(state);
    if (!activeBookIds.has(input.book_id)) {
      throw new MissingBookReferenceError("Referenced volume was not found.");
    }

    const list = state.lists[listIndex];
    if (list.items.some((item) => item.book_id === input.book_id)) {
      throw new DuplicateListItemError();
    }

    const nextPosition =
      list.items.length === 0
        ? 0
        : Math.max(...list.items.map((item) => item.position)) + 1;

    const item: ReadingListItem = {
      id: `lsti_${randomUUID()}`,
      list_id: listId,
      book_id: input.book_id,
      position: nextPosition,
      note: input.note ?? null,
      added_at: now,
    };

    const updatedList: ReadingList = {
      ...list,
      updated_at: now,
      items: [...list.items, item],
    };

    state.lists[listIndex] = updatedList;
    await saveLocalState(statePath, state);
    return { list: updatedList, item };
  });
}

function computeReorderedItems(
  currentItems: readonly ReadingListItem[],
  requestedBookIds: readonly string[],
): ReadingListItem[] {
  const itemByBookId = new Map<string, ReadingListItem>();
  for (const item of currentItems) {
    itemByBookId.set(item.book_id, item);
  }

  const ordered: ReadingListItem[] = [];
  const placed = new Set<string>();

  for (const bookId of requestedBookIds) {
    if (placed.has(bookId)) {
      continue;
    }
    const item = itemByBookId.get(bookId);
    if (item) {
      placed.add(bookId);
      ordered.push(item);
    }
  }

  for (const item of currentItems) {
    if (!placed.has(item.book_id)) {
      placed.add(item.book_id);
      ordered.push(item);
    }
  }

  return ordered.map((item, index) => ({
    ...item,
    position: index,
  }));
}

export async function reorderReadingListItems(
  listId: string,
  bookIds: readonly string[],
): Promise<ReadingList | null> {
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    if (!UUID_PATTERN.test(listId)) {
      return null;
    }

    const supabase = createSupabaseAdminClient();
    const currentList = await loadSupabaseReadingListById(supabase, listId);
    if (!currentList) {
      return null;
    }

    const reordered = computeReorderedItems(currentList.items, bookIds);

    for (const item of reordered) {
      const { error } = await supabase
        .from("reading_list_items")
        .update({ position: item.position })
        .eq("id", item.id);

      if (error) {
        throw error;
      }
    }

    const { error: touchError } = await supabase
      .from("reading_lists")
      .update({ updated_at: now })
      .eq("id", listId);

    if (touchError) {
      throw touchError;
    }

    return {
      ...currentList,
      updated_at: now,
      items: reordered,
    };
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const listIndex = state.lists.findIndex((list) => list.id === listId);

    if (listIndex === -1) {
      return null;
    }

    const list = state.lists[listIndex];
    const reordered = computeReorderedItems(list.items, bookIds);
    const updatedList: ReadingList = {
      ...list,
      updated_at: now,
      items: reordered,
    };

    state.lists[listIndex] = updatedList;
    await saveLocalState(statePath, state);
    return updatedList;
  });
}

export async function removeBookFromReadingList(
  listId: string,
  bookId: string,
): Promise<{ list: ReadingList; deleted: boolean } | null> {
  const now = new Date().toISOString();

  if (isSupabaseConfigured()) {
    if (!UUID_PATTERN.test(listId)) {
      return null;
    }

    const supabase = createSupabaseAdminClient();
    const currentList = await loadSupabaseReadingListById(supabase, listId);
    if (!currentList) {
      return null;
    }

    const targetItem = currentList.items.find(
      (item) => item.book_id === bookId,
    );
    if (!targetItem) {
      return { list: currentList, deleted: false };
    }

    const { error: deleteError } = await supabase
      .from("reading_list_items")
      .delete()
      .eq("id", targetItem.id);

    if (deleteError) {
      throw deleteError;
    }

    const remaining = currentList.items
      .filter((item) => item.id !== targetItem.id)
      .map((item, index) => ({ ...item, position: index }));

    for (const item of remaining) {
      const { error } = await supabase
        .from("reading_list_items")
        .update({ position: item.position })
        .eq("id", item.id);

      if (error) {
        throw error;
      }
    }

    const { error: touchError } = await supabase
      .from("reading_lists")
      .update({ updated_at: now })
      .eq("id", listId);

    if (touchError) {
      throw touchError;
    }

    return {
      list: {
        ...currentList,
        updated_at: now,
        items: remaining,
      },
      deleted: true,
    };
  }

  const statePath = getStateFilePath();
  return withStateLock(statePath, async () => {
    const state = await loadLocalState(statePath);
    const listIndex = state.lists.findIndex((list) => list.id === listId);

    if (listIndex === -1) {
      return null;
    }

    const list = state.lists[listIndex];
    const remaining = list.items.filter((item) => item.book_id !== bookId);

    if (remaining.length === list.items.length) {
      return { list, deleted: false };
    }

    const updatedList: ReadingList = {
      ...list,
      updated_at: now,
      items: remaining.map((item, index) => ({
        ...item,
        position: index,
      })),
    };

    state.lists[listIndex] = updatedList;
    await saveLocalState(statePath, state);
    return { list: updatedList, deleted: true };
  });
}
