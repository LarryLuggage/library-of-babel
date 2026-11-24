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
  type CreateConnectionInput,
  type EditorialConnection,
  isConnectionType,
  normalizeConnectionPairKey,
} from "@/lib/books/connections";
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

type LocalTrackerState = {
  version: 1 | 2;
  overrides: Record<string, Partial<CatalogueBook>>;
  created: CatalogueBook[];
  deleted: string[];
  connections: EditorialConnection[];
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
    version: 2,
    overrides: {},
    created: [],
    deleted: [],
    connections: [],
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

async function loadLocalState(statePath: string): Promise<LocalTrackerState> {
  try {
    const rawJson = await readFile(statePath, "utf8");
    const parsed = JSON.parse(rawJson) as Partial<LocalTrackerState>;

    const connections = Array.isArray(parsed.connections)
      ? parsed.connections
          .map(normalizeLocalConnection)
          .filter((item): item is EditorialConnection => item !== null)
      : [];

    return {
      version: parsed.version === 1 ? 1 : 2,
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
    version: 2,
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
      state.connections = state.connections.filter(
        (conn) => conn.source_book_id !== id && conn.target_book_id !== id,
      );
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
    state.connections = state.connections.filter(
      (conn) => conn.source_book_id !== id && conn.target_book_id !== id,
    );
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
