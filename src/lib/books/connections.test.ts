import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type CatalogueBook,
  getCatalogueConnection,
  getNearestConnections,
  normalizeCatalogueBook,
} from "./catalogue";
import {
  type EditorialConnection,
  normalizeConnectionPairKey,
  validateCreateConnectionInput,
} from "./connections";
import { buildCatalogueGraph, getPathfinderConnection } from "./relations";
import {
  createBook,
  createConnection,
  deleteBook,
  deleteConnection,
  DuplicateConnectionError,
  listBooks,
  listConnections,
  MissingBookReferenceError,
} from "./repository";

function makeBook(overrides: Partial<CatalogueBook> = {}): CatalogueBook {
  return normalizeCatalogueBook({
    author: "Author Name",
    title: "Book Title",
    edition: "Ed",
    shelf: 1,
    position: "Vertical (1)",
    top_category: "Literature",
    sub_category: null,
    summary: null,
    tags: [],
    publish_year: 1990,
    ...overrides,
  });
}

describe("connection validation and graph boost", () => {
  it("validates and normalizes createConnection payloads", () => {
    const valid = validateCreateConnectionInput({
      source_book_id: " bk_1 ",
      target_book_id: " bk_2 ",
      connection_type: "responds_to",
      description: "  Direct dialogue on narrative memory.  ",
      weight: 3,
    });
    expect(valid).toEqual({
      ok: true,
      data: {
        source_book_id: "bk_1",
        target_book_id: "bk_2",
        connection_type: "responds_to",
        description: "Direct dialogue on narrative memory.",
        weight: 3,
      },
    });

    const defaults = validateCreateConnectionInput({
      source_book_id: "bk_1",
      target_book_id: "bk_2",
    });
    expect(defaults).toEqual({
      ok: true,
      data: {
        source_book_id: "bk_1",
        target_book_id: "bk_2",
        connection_type: "custom",
        description: null,
        weight: 2,
      },
    });

    const selfLink = validateCreateConnectionInput({
      source_book_id: "bk_1",
      target_book_id: "bk_1",
    });
    expect(selfLink.ok).toBe(false);

    const badType = validateCreateConnectionInput({
      source_book_id: "bk_1",
      target_book_id: "bk_2",
      connection_type: "unknown_type",
    });
    expect(badType.ok).toBe(false);

    const longDesc = validateCreateConnectionInput({
      source_book_id: "bk_1",
      target_book_id: "bk_2",
      description: "a".repeat(501),
    });
    expect(longDesc.ok).toBe(false);

    const badWeight = validateCreateConnectionInput({
      source_book_id: "bk_1",
      target_book_id: "bk_2",
      weight: 4,
    });
    expect(badWeight.ok).toBe(false);
  });

  it("normalizes pair keys symmetrically", () => {
    expect(normalizeConnectionPairKey("bk_a", "bk_b")).toBe(
      normalizeConnectionPairKey("bk_b", "bk_a"),
    );
  });

  it("boosts catalogue similarity and pathfinder bridges via editorial connections", () => {
    const bookA = makeBook({
      id: "bk_island_a",
      author: "Author One",
      title: "Island Alpha",
      shelf: 1,
      tags: ["unique-alpha"],
    });
    const bookB = makeBook({
      id: "bk_island_b",
      author: "Author Two",
      title: "Island Beta",
      shelf: 30,
      tags: ["unique-beta"],
    });
    const bookC = makeBook({
      id: "bk_neighbor_b",
      author: "Author Two",
      title: "Neighbor Beta",
      shelf: 15,
    });

    // Unrelated without editorial link
    expect(getCatalogueConnection(bookA, bookB)).toBeNull();
    expect(
      getPathfinderConnection(bookA, bookC, [bookA, bookB, bookC]),
    ).toBeNull();

    const editorial: EditorialConnection = {
      id: "conn_1",
      source_book_id: bookA.id,
      target_book_id: bookB.id,
      connection_type: "influenced_by",
      description: "Shared archival theory.",
      weight: 2,
      created_at: "2026-11-20T00:00:00.000Z",
    };

    const boosted = getCatalogueConnection(bookA, bookB, undefined, [
      editorial,
    ]);
    expect(boosted).not.toBeNull();
    expect(boosted!.score).toBe(21);
    expect(boosted!.reasons[0]).toBe(
      "Curator link (Influenced by): Shared archival theory.",
    );

    // Weight 1 -> +18, weight 3 -> +24, null description omits colon suffix
    const weight3NoDesc: EditorialConnection = {
      ...editorial,
      connection_type: "paired_reading",
      description: null,
      weight: 3,
    };
    const boostedMax = getCatalogueConnection(bookB, bookA, undefined, [
      weight3NoDesc,
    ]);
    expect(boostedMax?.score).toBe(24);
    expect(boostedMax?.reasons[0]).toBe("Curator link (Paired reading).");

    const nearest = getNearestConnections(
      bookA,
      [bookA, bookB, bookC],
      3,
      undefined,
      [editorial],
    );
    expect(nearest).toHaveLength(1);
    expect(nearest[0].book.id).toBe(bookB.id);

    const graph = buildCatalogueGraph([bookA, bookB, bookC], [editorial]);
    const path = getPathfinderConnection(
      bookA,
      bookC,
      [bookA, bookB, bookC],
      graph,
    );
    expect(path).not.toBeNull();
    expect(path!.map((step) => step.book.id)).toEqual([
      bookA.id,
      bookB.id,
      bookC.id,
    ]);
  });
});

describe("local connection persistence in repository", () => {
  let tempDir = "";
  let statePath = "";
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "babel-conn-repo-"));
    statePath = path.join(tempDir, "book-tracker-state.json");
    savedEnv = {
      BOOK_TRACKER_STATE_PATH: process.env.BOOK_TRACKER_STATE_PATH,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.BOOK_TRACKER_STATE_PATH = statePath;
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("upgrades v1 state files, prevents duplicates/missing refs, and prunes connections on deleteBook", async () => {
    // Seed an existing v1 state file without connections field
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        overrides: {},
        created: [],
        deleted: [],
      }),
      "utf8",
    );

    expect(await listConnections()).toEqual([]);

    const { books } = await listBooks();
    const baseBook = books[0];
    const customBook = await createBook({
      title: "Custom Linked Book",
      author: "Curator Author",
      edition: "First",
      shelf: 41,
      position: "Vertical (1)",
      top_category: "Literature",
      sub_category: null,
      summary: null,
      tags: [],
      publish_year: 2020,
      reading_status: "unread",
      rating: null,
      date_started: null,
      date_finished: null,
      personal_notes: null,
      loaned_to: null,
    });

    await expect(
      createConnection({
        source_book_id: baseBook.id,
        target_book_id: "missing_book_id",
        connection_type: "custom",
        description: null,
        weight: 2,
      }),
    ).rejects.toBeInstanceOf(MissingBookReferenceError);

    const createdConn = await createConnection({
      source_book_id: baseBook.id,
      target_book_id: customBook.id,
      connection_type: "paired_reading",
      description: "Read alongside each other.",
      weight: 2,
    });

    expect(createdConn.id).toMatch(/^conn_/);
    expect(await listConnections()).toEqual([createdConn]);

    // Reverse undirected pair must reject as duplicate
    await expect(
      createConnection({
        source_book_id: customBook.id,
        target_book_id: baseBook.id,
        connection_type: "contrasts_with",
        description: null,
        weight: 1,
      }),
    ).rejects.toBeInstanceOf(DuplicateConnectionError);

    // Persisted file should be upgraded to version 2
    const persistedRaw = JSON.parse(
      await readFile(statePath, "utf8"),
    ) as { version: number; connections: EditorialConnection[] };
    expect(persistedRaw.version).toBe(2);
    expect(persistedRaw.connections).toHaveLength(1);

    // Deleting the custom book prunes the connection automatically
    expect(await deleteBook(customBook.id)).toBe(true);
    expect(await listConnections()).toEqual([]);

    // Explicit deleteConnection returns false for missing ID, true when found
    const anotherBase = books[1];
    const conn2 = await createConnection({
      source_book_id: baseBook.id,
      target_book_id: anotherBase.id,
      connection_type: "shared_lineage",
      description: null,
      weight: 1,
    });
    expect(await deleteConnection(conn2.id)).toBe(true);
    expect(await deleteConnection(conn2.id)).toBe(false);
  });
});
