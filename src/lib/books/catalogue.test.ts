import { describe, expect, it } from "vitest";

import {
  buildTagFrequencyMap,
  type CatalogueBook,
  compareCatalogueBooks,
  createBookId,
  filterDisplayTags,
  getAuthorInitial,
  getAuthorSortKey,
  getCatalogueConnection,
  getNearestConnections,
  NOISE_TAGS,
  normalizeCatalogueBook,
} from "./catalogue";

function makeBook(overrides: Partial<CatalogueBook> = {}): CatalogueBook {
  const base = normalizeCatalogueBook({
    author: "Test Author",
    title: "Test Title",
    edition: "Penguin",
    shelf: 10,
    position: "Vertical (1)",
    top_category: "Literature",
    sub_category: null,
    summary: null,
    tags: [],
    publish_year: 2000,
    ...overrides,
  });
  return {
    ...base,
    ...overrides,
    id:
      overrides.id ??
      createBookId({
        author: overrides.author ?? base.author,
        title: overrides.title ?? base.title,
        shelf: overrides.shelf ?? base.shelf,
        position: overrides.position ?? base.position,
      }),
  };
}

describe("author sorting and initials", () => {
  it("formats surname-first sort keys for canonical authors", () => {
    expect(getAuthorSortKey("Jorge Luis Borges")).toBe("Borges, Jorge Luis");
    expect(getAuthorSortKey("Fyodor Dostoevsky")).toBe("Dostoevsky, Fyodor");
    expect(getAuthorSortKey("J.W. von Goethe")).toBe("Goethe, J.W. von");
    expect(getAuthorSortKey("Theodor W. Adorno")).toBe("Adorno, Theodor W.");
    expect(getAuthorSortKey("Greenblatt (Editor)")).toBe("Greenblatt");
    expect(getAuthorSortKey("Plato")).toBe("Plato");
    expect(getAuthorSortKey("Miguel de Cervantes")).toBe(
      "Cervantes, Miguel de",
    );
    expect(getAuthorSortKey("Gilles Deleuze & Félix Guattari")).toBe(
      "Deleuze, Gilles",
    );
  });

  it("extracts uppercase ASCII-normalized surname initials", () => {
    expect(getAuthorInitial("Jorge Luis Borges")).toBe("B");
    expect(getAuthorInitial("Fyodor Dostoevsky")).toBe("D");
    expect(getAuthorInitial("J.W. von Goethe")).toBe("G");
    expect(getAuthorInitial("Theodor W. Adorno")).toBe("A");
    expect(getAuthorInitial("Greenblatt (Editor)")).toBe("G");
    expect(getAuthorInitial("Plato")).toBe("P");
    expect(getAuthorInitial("Émile Zola")).toBe("Z");
  });

  it("orders books in ledger surname order", () => {
    const authors = [
      "Plato",
      "Greenblatt (Editor)",
      "Jorge Luis Borges",
      "J.W. von Goethe",
      "Theodor W. Adorno",
      "Fyodor Dostoevsky",
    ];
    const sorted = authors
      .map((author) => makeBook({ author, title: `Work by ${author}` }))
      .sort(compareCatalogueBooks)
      .map((book) => book.author);

    expect(sorted).toEqual([
      "Theodor W. Adorno",
      "Jorge Luis Borges",
      "Fyodor Dostoevsky",
      "J.W. von Goethe",
      "Greenblatt (Editor)",
      "Plato",
    ]);
  });
});

describe("noise tag stripping and deduplication", () => {
  it("strips known noise and division tags case-insensitively", () => {
    expect(NOISE_TAGS.has("literature")).toBe(true);
    expect(NOISE_TAGS.has("philosophy theory")).toBe(true);
    expect(NOISE_TAGS.has("history reference")).toBe(true);

    const cleaned = filterDisplayTags([
      "Literature",
      "  Existentialism ",
      "classic literature",
      "existentialism",
      "Philosophy Theory",
      "phenomenology",
      "IN LIBRARY",
      "fiction general",
      "",
    ]);

    expect(cleaned).toEqual(["Existentialism", "phenomenology"]);
  });

  it("handles null or undefined tag lists safely", () => {
    expect(filterDisplayTags(null)).toEqual([]);
    expect(filterDisplayTags(undefined)).toEqual([]);
  });
});

describe("IDF tag scoring and edge isolation", () => {
  it("does not connect books solely on broad top_category or noise tags", () => {
    const first = makeBook({
      author: "Author One",
      title: "Book One",
      shelf: 1,
      top_category: "Literature",
      sub_category: "Modernist Fiction",
      tags: ["literature", "classic fiction", "in english"],
    });
    const second = makeBook({
      author: "Author Two",
      title: "Book Two",
      shelf: 25,
      top_category: "Literature",
      sub_category: "Victorian Fiction",
      tags: ["literature", "classic literature", "open library staff picks"],
    });

    expect(getCatalogueConnection(first, second)).toBeNull();
  });

  it("scores rare shared tags higher than common shared tags and lists rarest first", () => {
    const books: CatalogueBook[] = [];
    for (let i = 0; i < 85; i += 1) {
      books.push(
        makeBook({
          author: `Filler ${i}`,
          title: `Common Novel ${i}`,
          shelf: 10 + (i % 20),
          position: `V-${i}`,
          tags: i < 15 ? ["common theme", "mid theme"] : ["common theme"],
        }),
      );
    }

    const focus = makeBook({
      author: "Jorge Luis Borges",
      title: "Ficciones",
      shelf: 3,
      tags: ["common theme", "mid theme", "rare labyrinth"],
    });
    const rarePeer = makeBook({
      author: "Italo Calvino",
      title: "Invisible Cities",
      shelf: 18,
      tags: ["common theme", "rare labyrinth"],
    });
    const commonOnlyPeer = makeBook({
      author: "Common Author",
      title: "Common Peer",
      shelf: 18,
      tags: ["common theme"],
    });

    const corpus = [...books, focus, rarePeer, commonOnlyPeer];
    const tagFrequency = buildTagFrequencyMap(corpus);

    const rareConnection = getCatalogueConnection(focus, rarePeer, tagFrequency);
    const commonConnection = getCatalogueConnection(
      focus,
      commonOnlyPeer,
      tagFrequency,
    );

    // rare labyrinth (freq 2 -> +5) + common theme (freq 88 -> +2) = 7
    expect(rareConnection).not.toBeNull();
    expect(rareConnection!.score).toBe(7);
    expect(rareConnection!.reasons[0]).toContain(
      "rare labyrinth, common theme",
    );

    // common theme only (freq 88 -> +2)
    expect(commonConnection).not.toBeNull();
    expect(commonConnection!.score).toBe(2);

    const nearest = getNearestConnections(focus, corpus, 2, tagFrequency);
    expect(nearest[0].book.title).toBe("Invisible Cities");
  });

  it("caps tag connection points at 14", () => {
    const focus = makeBook({
      author: "Author A",
      title: "Title A",
      shelf: 1,
      tags: ["t1", "t2", "t3", "t4"],
    });
    const peer = makeBook({
      author: "Author B",
      title: "Title B",
      shelf: 20,
      tags: ["t1", "t2", "t3", "t4"],
    });
    const tagFrequency = buildTagFrequencyMap([focus, peer]);
    const connection = getCatalogueConnection(focus, peer, tagFrequency);

    // 4 rare tags * 5 pts = 20, capped at 14
    expect(connection?.score).toBe(14);
  });
});
