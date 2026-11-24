import { describe, expect, it } from "vitest";

import type { CatalogueBook } from "./catalogue";
import type { EditorialConnection } from "./connections";
import { getShelfRecommendations } from "./recommender";

function makeBook(overrides: Partial<CatalogueBook> & { id: string; title: string; author: string }): CatalogueBook {
  return {
    edition: "First Edition",
    shelf: 1,
    position: "Vertical (1)",
    top_category: "Literature",
    sub_category: "Modern Fiction",
    summary: "A richly annotated volume from the personal library.",
    tags: [],
    publish_year: 1950,
    reading_status: "unread",
    rating: null,
    date_started: null,
    date_finished: null,
    personal_notes: null,
    loaned_to: null,
    ...overrides,
  };
}

describe("getShelfRecommendations", () => {
  it("scores personalized recommendations using 5-star authors, curated connections, IDF tags, and DNF/low-rating penalties", () => {
    const books: CatalogueBook[] = [
      // 5-star favorite
      makeBook({
        id: "bk_fav_borges",
        title: "Ficciones",
        author: "Jorge Luis Borges",
        sub_category: "Metafiction",
        tags: ["labyrinths", "infinity", "short stories"],
        publish_year: 1944,
        reading_status: "finished",
        rating: 5,
      }),
      // 1-star DNF
      makeBook({
        id: "bk_dnf_grisham",
        title: "The Broker",
        author: "John Grisham",
        top_category: "Fiction",
        sub_category: "Legal Thriller",
        tags: ["courtroom", "espionage"],
        publish_year: 2005,
        reading_status: "dnf",
        rating: 1,
      }),
      // Unread: curated connection to 5-star favorite
      makeBook({
        id: "bk_linked_eco",
        title: "The Name of the Rose",
        author: "Umberto Eco",
        sub_category: "Historical Mystery",
        tags: ["labyrinths", "monastery"],
        publish_year: 1980,
        reading_status: "unread",
      }),
      // Unread: same author as 5-star favorite
      makeBook({
        id: "bk_unread_borges",
        title: "The Aleph",
        author: "Jorge Luis Borges",
        sub_category: "Metafiction",
        tags: ["infinity", "mirrors"],
        publish_year: 1949,
        reading_status: "unread",
      }),
      // Unread: rare IDF tag match
      makeBook({
        id: "bk_calvino",
        title: "Invisible Cities",
        author: "Italo Calvino",
        sub_category: "Metafiction",
        tags: ["labyrinths", "memory"],
        publish_year: 1972,
        reading_status: "unread",
      }),
      // Unread: penalized DNF author & genre
      makeBook({
        id: "bk_unread_grisham",
        title: "The Firm",
        author: "John Grisham",
        top_category: "Fiction",
        sub_category: "Legal Thriller",
        tags: ["courtroom", "suspense"],
        publish_year: 1991,
        reading_status: "unread",
      }),
    ];

    const connections: EditorialConnection[] = [
      {
        id: "conn_1",
        source_book_id: "bk_fav_borges",
        target_book_id: "bk_linked_eco",
        connection_type: "influenced_by",
        description: "The blind librarian Jorge of Burgos echoes Borges.",
        weight: 3,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    const result = getShelfRecommendations(books, connections, {
      mode: "best_match",
      limit: 6,
    });

    expect(result.profile.isPersonalized).toBe(true);
    expect(result.profile.ratedCount).toBe(2);
    expect(result.profile.finishedCount).toBe(1);
    expect(result.totalUnreadPool).toBe(4);
    expect(result.recommendations.map((r) => r.book.id)).toEqual([
      "bk_linked_eco",
      "bk_unread_borges",
      "bk_calvino",
      "bk_unread_grisham",
    ]);

    // Curated connection reason and anchor title surfaced
    expect(result.recommendations[0].reasons[0]).toContain("Curator link");
    expect(result.recommendations[0].anchorTitles).toContain("Ficciones");

    // Penalized DNF author ranks strictly last with a negative score
    const grishamRec = result.recommendations.find(
      (r) => r.book.id === "bk_unread_grisham",
    );
    expect(grishamRec).toBeDefined();
    expect(grishamRec!.score).toBeLessThan(0);
  });

  it("uses cold-start fallback when zero books are rated, finished, or reading", () => {
    const books: CatalogueBook[] = [
      makeBook({
        id: "bk_bare",
        title: "Bare Entry",
        author: "Author A",
        sub_category: "History",
        summary: null,
        tags: [],
        publish_year: null,
      }),
      makeBook({
        id: "bk_rich_linked",
        title: "Rich Curated Entry",
        author: "Author B",
        sub_category: "Philosophy",
        summary: "Detailed philosophical treatise.",
        tags: ["epistemology", "ethics", "logic"],
        publish_year: 1781,
      }),
      makeBook({
        id: "bk_rich_plain",
        title: "Annotated Novel",
        author: "Author C",
        sub_category: "Literature",
        summary: "Classic novel summary.",
        tags: ["realism", "russia"],
        publish_year: 1869,
      }),
    ];

    const connections: EditorialConnection[] = [
      {
        id: "conn_cold",
        source_book_id: "bk_rich_linked",
        target_book_id: "bk_rich_plain",
        connection_type: "paired_reading",
        description: null,
        weight: 2,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    const result = getShelfRecommendations(books, connections);
    expect(result.profile.isPersonalized).toBe(false);
    expect(result.recommendations[0].book.id).toBe("bk_rich_linked");
    expect(result.recommendations[result.recommendations.length - 1].book.id).toBe(
      "bk_bare",
    );
  });

  it("favors under-explored divisions and eras in stretch mode with subtle bridges", () => {
    const books: CatalogueBook[] = [
      // Reader's established taste: 1900-1969 Philosophy
      makeBook({
        id: "bk_read_1",
        title: "Being and Time",
        author: "Martin Heidegger",
        sub_category: "Philosophy",
        tags: ["phenomenology", "time"],
        publish_year: 1927,
        reading_status: "finished",
        rating: 5,
      }),
      makeBook({
        id: "bk_read_2",
        title: "Phenomenology of Perception",
        author: "Maurice Merleau-Ponty",
        sub_category: "Philosophy",
        tags: ["phenomenology", "perception"],
        publish_year: 1945,
        reading_status: "finished",
        rating: 4,
      }),
      // Unread: same division + same era + same author (NOT a stretch)
      makeBook({
        id: "bk_same_zone",
        title: "What Is Called Thinking?",
        author: "Martin Heidegger",
        sub_category: "Philosophy",
        tags: ["phenomenology"],
        publish_year: 1954,
        reading_status: "unread",
      }),
      // Unread: unexplored division (Poetry) + unexplored era (Antiquity) + subtle shared tag "time"
      makeBook({
        id: "bk_stretch_pick",
        title: "On the Nature of Things",
        author: "Lucretius",
        sub_category: "Classical Poetry",
        tags: ["time", "atomism", "epicureanism"],
        publish_year: -50,
        reading_status: "unread",
      }),
    ];

    const result = getShelfRecommendations(books, [], { mode: "stretch" });
    expect(result.recommendations[0].book.id).toBe("bk_stretch_pick");
    expect(result.recommendations[0].reasons.join(" ")).toContain(
      "Unexplored division",
    );
    expect(result.recommendations[0].reasons.join(" ")).toContain(
      "Bridges your interest in time",
    );
  });

  it("restricts to positive-taste authors in same_authors mode and lifts the 2-book author cap", () => {
    const books: CatalogueBook[] = [
      makeBook({
        id: "bk_read_dost",
        title: "Crime and Punishment",
        author: "Fyodor Dostoevsky",
        reading_status: "finished",
        rating: 5,
      }),
      makeBook({
        id: "bk_dost_1",
        title: "The Brothers Karamazov",
        author: "Fyodor Dostoevsky",
        reading_status: "unread",
      }),
      makeBook({
        id: "bk_dost_2",
        title: "The Idiot",
        author: "Fyodor Dostoevsky",
        reading_status: "unread",
      }),
      makeBook({
        id: "bk_dost_3",
        title: "Demons",
        author: "Fyodor Dostoevsky",
        reading_status: "unread",
      }),
      makeBook({
        id: "bk_other",
        title: "War and Peace",
        author: "Leo Tolstoy",
        reading_status: "unread",
      }),
    ];

    const sameAuthorResult = getShelfRecommendations(books, [], {
      mode: "same_authors",
      limit: 8,
    });

    expect(sameAuthorResult.recommendations).toHaveLength(3);
    expect(
      sameAuthorResult.recommendations.every(
        (r) => r.book.author === "Fyodor Dostoevsky",
      ),
    ).toBe(true);

    // By contrast, best_match enforces the max-2-per-author diversity cap
    const bestMatchResult = getShelfRecommendations(books, [], {
      mode: "best_match",
      limit: 8,
    });
    const dostCountInBestMatch = bestMatchResult.recommendations.filter(
      (r) => r.book.author === "Fyodor Dostoevsky",
    ).length;
    expect(dostCountInBestMatch).toBe(2);
  });

  it("supports seedBookId anchoring and excludes the seed book itself", () => {
    const books: CatalogueBook[] = [
      makeBook({
        id: "bk_seed",
        title: "The Republic",
        author: "Plato",
        sub_category: "Ancient Philosophy",
        tags: ["justice", "politics", "dialectic"],
        publish_year: -375,
        reading_status: "unread",
      }),
      makeBook({
        id: "bk_aristotle",
        title: "Nicomachean Ethics",
        author: "Aristotle",
        sub_category: "Ancient Philosophy",
        tags: ["justice", "virtue"],
        publish_year: -340,
        reading_status: "unread",
      }),
      makeBook({
        id: "bk_modern",
        title: "Neuromancer",
        author: "William Gibson",
        sub_category: "Science Fiction",
        tags: ["cyberpunk"],
        publish_year: 1984,
        reading_status: "unread",
      }),
    ];

    const connections: EditorialConnection[] = [
      {
        id: "conn_seed",
        source_book_id: "bk_seed",
        target_book_id: "bk_aristotle",
        connection_type: "responds_to",
        description: "Aristotle answers Plato's theory of the Good.",
        weight: 3,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    const result = getShelfRecommendations(books, connections, {
      seedBookId: "bk_seed",
    });

    expect(result.seedBook?.id).toBe("bk_seed");
    expect(result.recommendations.some((r) => r.book.id === "bk_seed")).toBe(
      false,
    );
    expect(result.recommendations[0].book.id).toBe("bk_aristotle");
    expect(result.recommendations[0].reasons[0]).toContain(
      "Curator link to The Republic",
    );
  });

  it("filters by division, era, and excludeLoaned", () => {
    const books: CatalogueBook[] = [
      makeBook({
        id: "bk_antiquity_loaned",
        title: "The Iliad",
        author: "Homer",
        sub_category: "Classics",
        publish_year: -750,
        loaned_to: "Alex",
      }),
      makeBook({
        id: "bk_antiquity_avail",
        title: "The Odyssey",
        author: "Homer",
        sub_category: "Classics",
        publish_year: -720,
        loaned_to: null,
      }),
      makeBook({
        id: "bk_modern_avail",
        title: "Ulysses",
        author: "James Joyce",
        sub_category: "Modernism",
        publish_year: 1922,
        loaned_to: null,
      }),
    ];

    const filtered = getShelfRecommendations(books, [], {
      division: "Classics",
      era: "antiquity",
      excludeLoaned: true,
    });
    expect(filtered.totalUnreadPool).toBe(1);
    expect(filtered.recommendations.map((r) => r.book.id)).toEqual([
      "bk_antiquity_avail",
    ]);

    const includingLoaned = getShelfRecommendations(books, [], {
      division: "Classics",
      era: "antiquity",
      excludeLoaned: false,
    });
    expect(includingLoaned.totalUnreadPool).toBe(2);
  });
});
