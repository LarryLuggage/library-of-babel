import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type CatalogueBook,
  createBookId,
  normalizeCatalogueBook,
  type StorageMode,
} from "@/lib/books/catalogue";
import type {
  CreateBookInput,
  UpdateBookInput,
} from "@/lib/books/validation";
import type { Database } from "@/lib/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type BookRow = Database["public"]["Tables"]["books"]["Row"];
type BookInsert = Database["public"]["Tables"]["books"]["Insert"];
type BookUpdate = Database["public"]["Tables"]["books"]["Update"];

type LocalTrackerState = {
  version: 1;
  overrides: Record<string, Partial<CatalogueBook>>;
  created: CatalogueBook[];
  deleted: string[];
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
    version: 1,
    overrides: {},
    created: [],
    deleted: [],
  };
}

async function loadLocalState(statePath: string): Promise<LocalTrackerState> {
  try {
    const rawJson = await readFile(statePath, "utf8");
    const parsed = JSON.parse(rawJson) as Partial<LocalTrackerState>;

    return {
      version: 1,
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

  const tmpPath = path.join(
    directory,
    `.${path.basename(statePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

    const updatePayload: BookUpdate = {
      updated_at: new Date().toISOString(),
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
    if (patch.top_category !== undefined) {
      updatePayload.top_category = patch.top_category;
    }
    if (patch.sub_category !== undefined) {
      updatePayload.sub_category = patch.sub_category;
    }
    if (
      patch.top_category !== undefined ||
      patch.sub_category !== undefined
    ) {
      const nextTop =
        patch.top_category !== undefined
          ? patch.top_category
          : existing.top_category;
      const nextSub =
        patch.sub_category !== undefined
          ? patch.sub_category
          : existing.sub_category;
      updatePayload.category = nextSub ?? nextTop ?? UNCATEGORIZED_CATEGORY;
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
    await saveLocalState(statePath, state);
    return true;
  });
}
