import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  cleanSummary,
  extractAuthorSurname,
  extractYearFromWikipediaExtract,
  getBookIdentity,
  getPairKey,
  isBrokenSummary,
  MAX_PUBLISH_YEAR,
  MAX_TAGS,
  mergeEnrichedBook,
  mergeTags,
  MIN_PUBLISH_YEAR,
  MIN_WIKIPEDIA_SCORE,
  normalizeTag,
  normalizeWorkTitle,
  parseWikidataYear,
  resolvePublishYear,
  scoreWikipediaCandidate,
  splitSentences,
  stripAuthorAnnotations,
  summarizeText,
} from "../../../scripts/lib/enrichment-helpers.mjs";
import { VERIFIED_CLASSIC_YEARS } from "../../../scripts/lib/classic-years.mjs";
import { applyCatalogueEnrichment } from "../../../scripts/apply-catalogue-enrichment.mjs";
import { cleanCatalogueBooks } from "../../../scripts/clean-catalogue-data.mjs";
import {
  needsEnrichment,
  parseArgs as parseEnrichArgs,
} from "../../../scripts/enrich-catalogue-books.mjs";

type RawCatalogueBook = {
  title: string;
  author: string;
  edition: string;
  shelf: number;
  position: string;
  top_category: string | null;
  sub_category: string | null;
  summary: string | null;
  tags: string[];
  publish_year: number | null;
};

function loadCatalogue(): RawCatalogueBook[] {
  const filePath = path.resolve(process.cwd(), "shelf_catalog_full.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as RawCatalogueBook[];
}

describe("stripAuthorAnnotations & extractAuthorSurname", () => {
  it("strips translator/editor parentheticals, slash qualifiers, and et al.", () => {
    expect(stripAuthorAnnotations("Lucretius (Rolfe Humphries trans.)")).toBe(
      "Lucretius",
    );
    expect(stripAuthorAnnotations("Thomas Hardy / Jude")).toBe("Thomas Hardy");
    expect(stripAuthorAnnotations("Mike Mignola, et al.")).toBe("Mike Mignola");
    expect(stripAuthorAnnotations("Greenblatt (Editor)")).toBe("Greenblatt");
    expect(stripAuthorAnnotations("H.D. (Hilda Doolittle)")).toBe("H.D.");
  });

  it("extracts primary author surnames consistently", () => {
    expect(extractAuthorSurname("Jorge Luis Borges")).toBe("Borges");
    expect(extractAuthorSurname("J.W. von Goethe")).toBe("Goethe");
    expect(extractAuthorSurname("Michel de Montaigne")).toBe("Montaigne");
    expect(extractAuthorSurname("Howell D. Chickering Jr.")).toBe("Chickering");
    expect(extractAuthorSurname("Gilles Deleuze & Félix Guattari")).toBe(
      "Deleuze",
    );
    expect(extractAuthorSurname("Hamilton, Madison, Jay")).toBe("Hamilton");
    expect(extractAuthorSurname("Homer (George Chapman trans.)")).toBe("Homer");
    expect(extractAuthorSurname("Various")).toBe("");
  });
});

describe("normalizeWorkTitle", () => {
  it("normalizes edition/volume qualifiers, diacritics, and punctuation", () => {
    expect(normalizeWorkTitle("Le Morte d'Arthur — Volume 1")).toBe(
      "le morte d arthur",
    );
    expect(
      normalizeWorkTitle("The Two Towers (The Lord of the Rings, Part 2)"),
    ).toBe("the two towers");
    expect(normalizeWorkTitle("Wheelock's Latin (7th Edition)")).toBe(
      "wheelock s latin",
    );
    expect(normalizeWorkTitle("Cien años de soledad")).toBe(
      "cien anos de soledad",
    );
    expect(normalizeWorkTitle("Moby-Dick")).toBe("moby dick");
  });
});

describe("cleanSummary", () => {
  it("cleans markdown, HTML, citation markers, OL links, quotes, and dashes", () => {
    const raw =
      '*** **Anarchy, State, and Utopia** is a 1974 book[1][citation needed] by Robert Nozick — named one of the “100 most influential books” (1945–1995)[2]. --Publisher description.';
    expect(cleanSummary(raw)).toBe(
      'Anarchy, State, and Utopia is a 1974 book by Robert Nozick — named one of the "100 most influential books" (1945–1995).',
    );

    const olLink =
      "org/works/OL23204W/Of_Mice_and_Men) They are an unlikely pair: George is ‘small’ and Lennie has the mind of a young child.";
    expect(cleanSummary(olLink)).toBe(
      "They are an unlikely pair: George is 'small' and Lennie has the mind of a young child.",
    );

    expect(
      cleanSummary(
        '"First published in 1931, the spellbinding novel Unclay glows with an unworldly light.',
      ),
    ).toBe(
      "First published in 1931, the spellbinding novel Unclay glows with an unworldly light.",
    );
    expect(cleanSummary("   ")).toBeNull();
    expect(cleanSummary(null)).toBeNull();
  });
});

describe("isBrokenSummary", () => {
  it("flags stubs, OL links, non-English prose, Pinyin, fragments, TOCs, and mismatches", () => {
    expect(isBrokenSummary(null)).toBe(true);
    expect(isBrokenSummary("Too short.")).toBe(true);

    expect(
      isBrokenSummary(
        "org/works/OL14937980W) [Facts in the Case of M. org/works/OL15646005W) Ligeia",
        { title: "Complete Stories", author: "Edgar Allan Poe" },
      ),
    ).toBe(true);

    // Portuguese Dracula
    expect(
      isBrokenSummary(
        "Na história, um casal e seus amigos são atormentados por Conde Drácula, uma entidade sobrenatural que pretende se mudar para Londres.",
        { title: "Dracula", author: "Bram Stoker" },
      ),
    ).toBe(true);

    // Pinyin Outline of History
    expect(
      isBrokenSummary(
        "Ben shu shang su ren lei wen ming de kai duan, xia zhi di er ci shi jie da zhan . jiang gu ai ji, gu xi la, gu luo ma deng guo.",
        { title: "The Outline of History", author: "H.G. Wells" },
      ),
    ).toBe(true);

    // Spanish Pope's Rhinoceros
    expect(
      isBrokenSummary(
        "En febrero de 1516, un barco portugués se hundió a una milla de las costas de Italia y perecieron todos sus tripulantes.",
        { title: "The Pope's Rhinoceros", author: "Lawrence Norfolk" },
      ),
    ).toBe(true);

    // Swedish Long Ships
    expect(
      isBrokenSummary(
        "Med en stor portion humor och en berättarglädje som knappast har något motstycke i den svenska litteraturen är Röde Orm en klassiker.",
        { title: "The Long Ships", author: "Frans G. Bengtsson" },
      ),
    ).toBe(true);

    // French Madame Bovary
    expect(
      isBrokenSummary(
        "Charles Bovary, médecin de campagne, fait lors d'une tournée la rencontre du père Rouault et de sa fille Emma.",
        { title: "Madame Bovary", author: "Gustave Flaubert" },
      ),
    ).toBe(true);

    // Non-Latin scripts
    expect(
      isBrokenSummary(
        "Роман Федора Михайловича Достоевского, написанный в 1871–1872 годах и впервые опубликованный в журнале «Русский вестник».",
        { title: "The Possessed", author: "Fyodor Dostoevsky" },
      ),
    ).toBe(true);

    // Broken cuts & TOC junk
    expect(
      isBrokenSummary(
        "D. The newcomers are a proud and bloody-minded people whose kings once changed themselves into wolves.",
      ),
    ).toBe(true);
    expect(
      isBrokenSummary(
        "Based on the text Spinoza's Short treatise on God, man and his well-being, translated by Dr. A.",
      ),
    ).toBe(true);
    expect(
      isBrokenSummary(
        "; The Indian Uprising; Views of My Father Weeping; Paraguay; On Angels; The Phantom of the Opera's Friend; City Life;",
      ),
    ).toBe(true);

    // Keats mismatch on Fredric Jameson's The Prison-House of Language
    expect(
      isBrokenSummary(
        "An analysis of Keats' poetry that traces his intellectual development against a backdrop of eighteenth- and nineteenth-century thought.",
        {
          title: "The Prison-House of Language",
          author: "Fredric Jameson",
          sub_category: "Literary Theory & Structuralism",
        },
      ),
    ).toBe(true);
  });

  it("accepts clean English summaries", () => {
    expect(
      isBrokenSummary(
        "Anarchy, State, and Utopia is a 1974 book by the American political philosopher Robert Nozick arguing in favor of a minimal state.",
        { title: "Anarchy, State, and Utopia", author: "Robert Nozick" },
      ),
    ).toBe(false);
    expect(
      isBrokenSummary(
        "The Prison-House of Language is a 1972 critical study by Fredric Jameson examining Russian Formalism and French Structuralism.",
        { title: "The Prison-House of Language", author: "Fredric Jameson" },
      ),
    ).toBe(false);
    expect(
      isBrokenSummary(
        "The Brothers Karamazov (Russian: Братья Карамазовы, romanized: Brat'ya Karamazovy) is the final novel by Russian author Fyodor Dostoevsky.",
        { title: "The Brothers Karamazov", author: "Fyodor Dostoevsky" },
      ),
    ).toBe(false);
    expect(
      isBrokenSummary(
        "Poetics (Ancient Greek: Περὶ ποιητικῆς, romanized: Perì poiētikês) by Aristotle is the earliest surviving work of Greek dramatic theory.",
        { title: "Poetics", author: "Aristotle" },
      ),
    ).toBe(false);
    expect(
      isBrokenSummary(
        "Les Fleurs du mal (French: Les Fleurs du mal, lit. 'The Flowers of Evil') is a volume of French poetry by Charles Baudelaire.",
        { title: "Les Fleurs du mal", author: "Charles Baudelaire" },
      ),
    ).toBe(false);
    expect(
      isBrokenSummary(
        "Ragtime is a 1975 historical fiction novel by the American writer E. L. Doctorow.",
        { title: "Ragtime", author: "E.L. Doctorow" },
      ),
    ).toBe(false);
    expect(
      isBrokenSummary(
        "The Fellowship of the Ring is the first of three volumes of the epic novel The Lord of the Rings by the English author J. R. R. Tolkien.",
        {
          title: "The Fellowship of the Ring (The Lord of the Rings, Part 1)",
          author: "J.R.R. Tolkien",
        },
      ),
    ).toBe(false);
  });
});

describe("parseWikidataYear & extractYearFromWikipediaExtract", () => {
  it("parses positive and negative BCE Wikidata timestamps within range", () => {
    expect(parseWikidataYear("+1925-04-10T00:00:00Z")).toBe(1925);
    expect(parseWikidataYear("-0375-00-00T00:00:00Z")).toBe(-375);
    expect(
      parseWikidataYear({
        mainsnak: {
          datavalue: { value: { time: "+0049-00-00T00:00:00Z", precision: 9 } },
        },
      }),
    ).toBe(49);
    // Rejects century-only precision (7) and out-of-range years
    expect(
      parseWikidataYear({ time: "+1600-00-00T00:00:00Z", precision: 7 }),
    ).toBeNull();
    expect(parseWikidataYear("-3500-00-00T00:00:00Z")).toBeNull();
    expect(parseWikidataYear("+0000-00-00T00:00:00Z")).toBeNull();
  });

  it("extracts original publication or composition dates from Wikipedia lead prose", () => {
    expect(
      extractYearFromWikipediaExtract(
        "The Republic is a Socratic dialogue, authored by Plato around 375 BC, concerning justice and the order of the city-state.",
      ),
    ).toBe(-375);
    expect(
      extractYearFromWikipediaExtract(
        "Nineteen Eighty-Four (also published as 1984) is a 1949 dystopian novel by George Orwell (1903–1950).",
      ),
    ).toBe(1949);
    expect(
      extractYearFromWikipediaExtract(
        "On the Shortness of Life is a moral essay written by Seneca the Younger around AD 49.",
      ),
    ).toBe(49);
    expect(
      extractYearFromWikipediaExtract(
        "Stephen Crane (1871–1900) wrote The Red Badge of Courage, originally published in 1895.",
      ),
    ).toBe(1895);
    expect(
      extractYearFromWikipediaExtract(
        "The novel was first published in French in 1942 and translated into English in 1946.",
      ),
    ).toBe(1942);
  });
});

describe("scoreWikipediaCandidate", () => {
  it("prefers matching literary works over films, albums, and stray author bios", () => {
    const book = {
      title: "Dracula",
      author: "Bram Stoker",
      sub_category: "Gothic Fiction",
    };

    const novelScore = scoreWikipediaCandidate({
      searchResult: {
        title: "Dracula",
        snippet: "1897 Gothic horror novel by Bram Stoker",
      },
      extract:
        "Dracula is an 1897 Gothic horror novel by Irish author Bram Stoker.",
      categories: ["1897 British novels", "Gothic horror novels"],
      book,
    });

    const filmScore = scoreWikipediaCandidate({
      searchResult: {
        title: "Dracula (1931 English-language film)",
        snippet: "1931 horror film directed by Tod Browning",
      },
      extract:
        "Dracula is a 1931 American pre-Code supernatural horror film based on the novel by Bram Stoker.",
      categories: ["1931 films", "American horror films"],
      book,
    });

    const authorBioScore = scoreWikipediaCandidate({
      searchResult: {
        title: "Bram Stoker",
        snippet: "Irish author best known for Dracula",
      },
      extract:
        "Abraham 'Bram' Stoker (1847–1912) was an Irish author who wrote Dracula.",
      categories: ["1847 births", "1912 deaths", "Irish novelists"],
      book,
    });

    expect(novelScore).toBeGreaterThan(50);
    expect(filmScore).toBeLessThan(0);
    expect(authorBioScore).toBeLessThan(novelScore);
  });

  it("allows biography books when the title itself names the biography", () => {
    const score = scoreWikipediaCandidate({
      searchResult: {
        title: "Coleridge: Early Visions",
        snippet: "1989 biography by Richard Holmes",
      },
      extract:
        "Coleridge: Early Visions is a 1989 biography of Samuel Taylor Coleridge by Richard Holmes.",
      categories: ["1989 non-fiction books", "Biographies"],
      book: {
        title: "Coleridge: Early Visions (1772–1804)",
        author: "Richard Holmes",
        sub_category: "Biography",
      },
    });
    expect(score).toBeGreaterThanOrEqual(MIN_WIKIPEDIA_SCORE);
  });

  it("rejects person bios, list/family/topic pages, and wrong books while keeping true literary matches", () => {
    expect(MIN_WIKIPEDIA_SCORE).toBe(48);

    // Person biographies rejected
    expect(
      scoreWikipediaCandidate({
        searchResult: { title: "Tennessee Williams", snippet: "American playwright" },
        extract:
          'Thomas Lanier "Tennessee" Williams III (March 26, 1911 – February 25, 1983) was an American playwright.',
        categories: ["1911 births", "1983 deaths", "American dramatists"],
        book: { title: "Tennessee Williams: Collected Stories", author: "Tennessee Williams" },
      }),
    ).toBeLessThan(0);

    expect(
      scoreWikipediaCandidate({
        searchResult: { title: "Frank O'Hara", snippet: "American poet" },
        extract:
          "Francis Russell O'Hara (March 27, 1926 – July 25, 1966) was an American writer, poet, and art critic.",
        categories: ["1926 births", "1966 deaths", "American male poets"],
        book: { title: "The Collected Poems of Frank O'Hara", author: "Frank O'Hara" },
      }),
    ).toBeLessThan(0);

    // Lists, family pages, rivers, and locomotives rejected
    expect(
      scoreWikipediaCandidate({
        searchResult: { title: "List of poems by Walt Whitman", snippet: "bibliography" },
        extract: "This article lists all known poems by Walt Whitman.",
        categories: ["Walt Whitman", "Bibliographies"],
        book: { title: "The Complete Poems", author: "Walt Whitman" },
      }),
    ).toBeLessThan(0);

    expect(
      scoreWikipediaCandidate({
        searchResult: { title: "Danube", snippet: "river in Europe" },
        extract: "The Danube is a river in Europe, the second-longest after the Volga.",
        categories: ["Danube", "Rivers of Europe"],
        book: { title: "Danube", author: "Claudio Magris" },
      }),
    ).toBeLessThan(0);

    expect(
      scoreWikipediaCandidate({
        searchResult: { title: "USRA Heavy Pacific", snippet: "steam locomotive" },
        extract: "The USRA Heavy Pacific is a USRA standard class of steam locomotive.",
        categories: ["Standard gauge locomotives"],
        book: { title: "Pacific", author: "Tom Drury" },
      }),
    ).toBeLessThan(0);

    // Wrong works rejected below threshold
    expect(
      scoreWikipediaCandidate({
        searchResult: {
          title: "Essay on the Life of Seneca",
          snippet: "final works of Denis Diderot",
        },
        extract:
          "Essay on the Life of Seneca (French: Essai sur Sénèque) was one of the final works of Denis Diderot.",
        categories: ["1778 non-fiction books", "Works by Denis Diderot"],
        book: { title: "On the Shortness of Life", author: "Seneca" },
      }),
    ).toBeLessThan(MIN_WIKIPEDIA_SCORE);

    expect(
      scoreWikipediaCandidate({
        searchResult: {
          title: "The Longest Journey (novel)",
          snippet: "preceding A Room with a View and Howards End",
        },
        extract:
          "The Longest Journey is a bildungsroman by E. M. Forster, first published in 1907, preceding A Room with a View (1908) and Howards End (1910).",
        categories: ["1907 British novels"],
        book: { title: "Howards End and A Room with a View", author: "E.M. Forster" },
      }),
    ).toBeLessThan(MIN_WIKIPEDIA_SCORE);

    expect(
      scoreWikipediaCandidate({
        searchResult: { title: "The Searcher (novel)", snippet: "2020 novel by Tana French" },
        extract: "The Searcher is a 2020 mystery novel by Tana French.",
        categories: ["2020 novels"],
        book: { title: "The Novel and the Police", author: "D.A. Miller" },
      }),
    ).toBeLessThan(MIN_WIKIPEDIA_SCORE);

    // Genuine works score >= 48
    expect(
      scoreWikipediaCandidate({
        searchResult: { title: "White Noise (novel)", snippet: "1985 novel by Don DeLillo" },
        extract:
          "White Noise is the eighth novel by Don DeLillo, published by Viking Press in 1985.",
        categories: ["1985 American novels", "National Book Award-winning works"],
        book: { title: "White Noise", author: "Don DeLillo" },
      }),
    ).toBeGreaterThanOrEqual(MIN_WIKIPEDIA_SCORE);

    expect(
      scoreWikipediaCandidate({
        searchResult: {
          title: "De rerum natura",
          snippet: "didactic poem by Lucretius",
        },
        extract:
          "De rerum natura (Latin: [deː ˈreːrʊn naːˈtuːraː]; On the Nature of Things) is a first-century BCE didactic poem by the Roman poet and philosopher Lucretius.",
        categories: ["1st-century BC poems", "Didactic poems", "Works by Lucretius"],
        book: {
          title: "Lucretius: The Way Things Are",
          author: "Lucretius (Rolfe Humphries trans.)",
        },
      }),
    ).toBeGreaterThanOrEqual(MIN_WIKIPEDIA_SCORE);

    expect(
      scoreWikipediaCandidate({
        searchResult: {
          title: "One Hundred Years of Solitude",
          snippet: "1967 novel by Gabriel García Márquez",
        },
        extract:
          "One Hundred Years of Solitude (Spanish: Cien años de soledad) is a 1967 novel by Colombian author Gabriel García Márquez.",
        categories: ["1967 Colombian novels", "Magical realism novels"],
        book: {
          title: "Cien años de soledad",
          author: "Gabriel García Márquez",
        },
      }),
    ).toBeGreaterThanOrEqual(MIN_WIKIPEDIA_SCORE);
  });
});

describe("summarizeText & splitSentences", () => {
  it("preserves abbreviations and initials without dropping sentence text", () => {
    const whiteNoiseExtract =
      "White Noise is the eighth novel by Don DeLillo, published by Viking Press in 1985. It won the U.S. National Book Award for Fiction.\n" +
      "White Noise is a cornerstone example of postmodern literature. It is widely considered DeLillo's breakout work and brought him to the attention of a much larger audience. The novel was included in Time's List of the 100 Best Novels. DeLillo originally wanted to call the book Panasonic, but the owner objected.";
    const summary = summarizeText(whiteNoiseExtract);
    expect(summary).toContain("It won the U.S. National Book Award for Fiction.");
    expect(summary).not.toContain("1985. S.");

    const popeText =
      "Alexander Pope (21 May 1688 O.S. – 30 May 1744) was an English poet. He is known for satire and D. H. Lawrence praised his craft. " +
      "A long trailing note extends past four hundred and twenty characters so the sentence splitter runs across every single clause safely without ever dropping anything before an abbreviation.";
    const popeSummary = summarizeText(popeText);
    expect(popeSummary).toContain("Alexander Pope (21 May 1688 O.S. — 30 May 1744)");
    expect(popeSummary).toContain("D. H. Lawrence praised his craft.");

    expect(splitSentences("First U.S. edition. Second sentence here.")).toEqual([
      "First U.S. edition.",
      "Second sentence here.",
    ]);
  });

  it("flags truncated initial-dot artifacts and full-date bio leads as broken summaries", () => {
    expect(
      isBrokenSummary(
        "White Noise is the eighth novel by Don DeLillo, published by Viking Press in 1985. S. National Book Award for Fiction.",
      ),
    ).toBe(true);
    expect(
      isBrokenSummary(
        "Through a series of readings, Miller investigates the novel as an oblique form of social control. A. Miller's remarkable book.",
      ),
    ).toBe(true);
    expect(
      isBrokenSummary(
        "Alexander Pope (21 May 1688 O.S. — 30 May 1744) was an English poet, translator, and satirist of the Enlightenment era.",
      ),
    ).toBe(true);
    expect(
      isBrokenSummary(
        "Thomas Lanier 'Tennessee' Williams III (March 26, 1911 — February 25, 1983) was an American playwright and screenwriter.",
      ),
    ).toBe(true);
  });
});

describe("resolvePublishYear", () => {
  it("prioritizes classicYear, replaces 1800/1900 placeholders & reprints, and protects valid dates", () => {
    expect(
      resolvePublishYear({
        existingYear: 1960,
        wikidataYear: 1960,
        classicYear: -375,
      }),
    ).toBe(-375);

    // Replaces suspicious 1800/1900 placeholders
    expect(
      resolvePublishYear({
        existingYear: 1900,
        wikidataYear: 2005,
        openLibraryYear: 1900,
      }),
    ).toBe(2005);

    // Replaces modern reprint year with earlier Wikidata original year
    expect(
      resolvePublishYear({
        existingYear: 2017,
        wikidataYear: 1605,
      }),
    ).toBe(1605);

    // Does NOT overwrite an already valid original year with a newer reprint
    expect(
      resolvePublishYear({
        existingYear: 1955,
        wikidataYear: 2004,
        openLibraryYear: 2010,
      }),
    ).toBe(1955);

    // Ignores 1900 OL noise when filling missing year if Wikipedia extract has a date
    expect(
      resolvePublishYear({
        existingYear: null,
        wikipediaExtractYear: 1978,
        openLibraryYear: 1900,
      }),
    ).toBe(1978);
  });
});

describe("normalizeTag & mergeTags", () => {
  it("filters noise tags, call numbers, campaign tags, and language tags", () => {
    expect(normalizeTag("Literature")).toBeNull();
    expect(normalizeTag("pq4809 a45 s3713")).toBeNull();
    expect(normalizeTag("823 912 f")).toBeNull();
    expect(normalizeTag("1000blackgirlbooks")).toBeNull();
    expect(normalizeTag("2013newaugust")).toBeNull();
    expect(normalizeTag("French language")).toBeNull();
    expect(normalizeTag("Philosophy of language")).toBe("philosophy of language");
    expect(normalizeTag("American fiction")).toBe("american fiction");
    expect(
      normalizeTag("Shakespeare, William, 1564-1616", {
        author: "William Shakespeare",
      }),
    ).toBeNull();
  });

  it("merges, deduplicates, and caps tags cleanly", () => {
    const manyTags = Array.from({ length: 20 }, (_, i) => `topic ${i + 1}`);
    const merged = mergeTags(
      ["Political Science", "literature", "Political Science"],
      ["Dystopian", ...manyTags],
    );
    expect(merged[0]).toBe("political science");
    expect(merged[1]).toBe("dystopian");
    expect(merged.length).toBe(MAX_TAGS);
  });
});

describe("mergeEnrichedBook", () => {
  it("preserves canonical identity fields while upgrading broken metadata", () => {
    const existing = {
      title: "Dracula",
      author: "Bram Stoker",
      edition: "Penguin Classics",
      shelf: 8,
      position: "Vertical (4)",
      top_category: "Literature",
      sub_category: "Gothic Fiction",
      summary:
        "Na história, um casal e seus amigos são atormentados por Conde Drácula na Transilvânia e em Londres.",
      tags: ["literature", "horror", "pq4809 a45 s3713"],
      publish_year: 1900,
    };

    const enriched = {
      summary:
        "**Dracula** is an 1897 Gothic horror novel by Irish author Bram Stoker[1].",
      wikidataYear: 1897,
      tags: ["Gothic Fiction", "Vampires", "1000blackgirlbooks"],
    };

    const merged = mergeEnrichedBook(existing, enriched, null);
    expect(merged.title).toBe(existing.title);
    expect(merged.author).toBe(existing.author);
    expect(merged.shelf).toBe(existing.shelf);
    expect(merged.position).toBe(existing.position);
    expect(merged.edition).toBe(existing.edition);
    expect(merged.top_category).toBe(existing.top_category);
    expect(merged.sub_category).toBe(existing.sub_category);
    expect(merged.publish_year).toBe(1897);
    expect(merged.summary).toBe(
      "Dracula is an 1897 Gothic horror novel by Irish author Bram Stoker.",
    );
    expect(merged.tags).toEqual(["horror", "gothic fiction", "vampires"]);
  });
});

describe("VERIFIED_CLASSIC_YEARS integrity against shelf_catalog_full.json", () => {
  it("contains only valid integer years and exact title/author pairs in shelf_catalog_full.json", () => {
    const catalogue = loadCatalogue();
    const pairKeys = new Set(
      catalogue.map((book) => getPairKey(book.title, book.author)),
    );

    expect(VERIFIED_CLASSIC_YEARS.size).toBeGreaterThan(150);

    for (const [key, year] of VERIFIED_CLASSIC_YEARS.entries()) {
      expect(Number.isInteger(year)).toBe(true);
      expect(year).not.toBe(0);
      expect(year).toBeGreaterThanOrEqual(MIN_PUBLISH_YEAR);
      expect(year).toBeLessThanOrEqual(MAX_PUBLISH_YEAR);
      expect(pairKeys.has(key)).toBe(true);
    }

    // Spot-check key historical corrections across BCE, CE, 1800/1900, and reprints
    expect(
      VERIFIED_CLASSIC_YEARS.get(getPairKey("The Iliad / Odyssey Homer", "Homer")),
    ).toBe(-750);
    expect(VERIFIED_CLASSIC_YEARS.get(getPairKey("The Republic", "Plato"))).toBe(
      -375,
    );
    expect(
      VERIFIED_CLASSIC_YEARS.get(getPairKey("Confessions", "Saint Augustine")),
    ).toBe(400);
    expect(
      VERIFIED_CLASSIC_YEARS.get(getPairKey("Don Quixote", "Miguel de Cervantes")),
    ).toBe(1605);
    expect(
      VERIFIED_CLASSIC_YEARS.get(getPairKey("Candide", "Voltaire")),
    ).toBe(1759);
    expect(
      VERIFIED_CLASSIC_YEARS.get(getPairKey("The Human Factor", "Graham Greene")),
    ).toBe(1978);
    expect(
      VERIFIED_CLASSIC_YEARS.get(
        getPairKey("No Country for Old Men", "Cormac McCarthy"),
      ),
    ).toBe(2005);
  });
});

describe("CLI scripts integration & invariants", () => {
  it("parses enrich-catalogue-books CLI options and flags incomplete books accurately", () => {
    const parsed = parseEnrichArgs([
      "--only-incomplete",
      "--concurrency=4",
      "--delay-ms=100",
      "--limit=25",
      "--output=/tmp/custom.json",
    ]);
    expect(parsed).toEqual({
      concurrency: 4,
      delayMs: 100,
      force: false,
      limit: 25,
      offset: 0,
      onlyIncomplete: true,
      outputPath: "/tmp/custom.json",
    });

    expect(
      needsEnrichment({
        title: "The Republic",
        author: "Plato",
        summary: "Plato's Socratic dialogue on justice and the ideal city-state.",
        publish_year: 1960,
        tags: ["philosophy"],
      }),
    ).toBe(true);
  });

  it("cleanCatalogueBooks is idempotent and preserves every book identity", () => {
    const catalogue = loadCatalogue();
    const firstPass = cleanCatalogueBooks(catalogue);
    const secondPass = cleanCatalogueBooks(firstPass.cleanedBooks);

    expect(firstPass.cleanedBooks.length).toBe(catalogue.length);
    expect(secondPass.stats.totalChanges).toBe(0);

    for (let i = 0; i < catalogue.length; i += 1) {
      expect(getBookIdentity(firstPass.cleanedBooks[i])).toBe(
        getBookIdentity(catalogue[i]),
      );
    }
  });

  it("applyCatalogueEnrichment merges records safely without mutating identities", () => {
    const sampleCatalogue = [
      {
        title: "The Prison-House of Language",
        author: "Fredric Jameson",
        edition: "Princeton",
        shelf: 14,
        position: "Vertical (8)",
        top_category: "Philosophy & Theory",
        sub_category: "Literary Theory",
        summary:
          "An analysis of Keats' poetry that traces his intellectual development against a backdrop of eighteenth- and nineteenth-century thought.",
        tags: ["literature", "structuralism"],
        publish_year: 1972,
      },
    ];
    const enrichmentRows = [
      {
        title: "The Prison-House of Language",
        author: "Fredric Jameson",
        shelf: 14,
        position: "Vertical (8)",
        summary:
          "**The Prison-House of Language** is a 1972 book by Fredric Jameson examining Formalism and Structuralism[1].",
        tags: ["literary theory", "formalism"],
        wikidataYear: 1972,
      },
    ];

    const { nextCatalogue, stats } = applyCatalogueEnrichment(
      sampleCatalogue,
      enrichmentRows,
    );

    expect(stats.brokenSummariesFixed).toBe(1);
    expect(nextCatalogue[0].summary).toBe(
      "The Prison-House of Language is a 1972 book by Fredric Jameson examining Formalism and Structuralism.",
    );
    expect(nextCatalogue[0].tags).toEqual([
      "structuralism",
      "literary theory",
      "formalism",
    ]);
    expect(getBookIdentity(nextCatalogue[0])).toBe(
      getBookIdentity(sampleCatalogue[0]),
    );
  });
});
