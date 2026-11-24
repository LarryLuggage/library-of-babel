import {
  buildTagFrequencyMap,
  type CatalogueBook,
  compareCatalogueBooks,
  filterDisplayTags,
  formatPublishYear,
  getBookKey,
  getDivision,
  type ReadingStatus,
  resolveEditorialConnectionMap,
} from "./catalogue";
import type { EditorialConnection } from "./connections";
import {
  buildTasteProfile,
  scoreBookAgainstTasteProfile,
} from "./recommender";

export type LibrarianMessage = {
  role: "user" | "assistant";
  text: string;
};

export type LibrarianRecommendation = {
  book: CatalogueBook;
  pitch: string;
  shelfNote?: string | null;
};

export type LibrarianResponse = {
  mode: "gemini" | "local";
  model?: string;
  reply: string;
  recommendations: LibrarianRecommendation[];
};

type ShelfRange = { min: number; max: number };

type EraRange = {
  min: number;
  max: number;
  label: string;
  exactYear?: number;
};

type ParsedPromptCues = {
  statusIntent: ReadingStatus | null;
  shelfRanges: ShelfRange[];
  eraRanges: EraRange[];
  keywords: string[];
  normalizedPrompt: string;
};

type ScoredShortlistItem = {
  book: CatalogueBook;
  score: number;
  matchedKeywords: string[];
  matchedStatus: boolean;
  matchedShelf: boolean;
  matchedEra: string | null;
  tasteReasons: string[];
};

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 15_000;
const MAX_HISTORY_TURNS = 6;
const SHORTLIST_LIMIT = 60;

const STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "already",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "best",
  "between",
  "book",
  "books",
  "but",
  "by",
  "can",
  "catalogue",
  "catalog",
  "century",
  "collection",
  "could",
  "do",
  "does",
  "don",
  "favorite",
  "favorites",
  "favourite",
  "favourites",
  "find",
  "finished",
  "for",
  "from",
  "get",
  "give",
  "good",
  "great",
  "have",
  "haven",
  "havent",
  "help",
  "here",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "library",
  "like",
  "list",
  "looking",
  "love",
  "loved",
  "matching",
  "me",
  "more",
  "most",
  "my",
  "need",
  "next",
  "not",
  "of",
  "on",
  "one",
  "or",
  "other",
  "our",
  "out",
  "own",
  "pick",
  "picks",
  "please",
  "read",
  "reading",
  "recommend",
  "recommendation",
  "recommendations",
  "related",
  "shelf",
  "shelves",
  "should",
  "show",
  "similar",
  "some",
  "something",
  "start",
  "suggest",
  "suggestion",
  "suggestions",
  "tbr",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "tonight",
  "top",
  "unread",
  "up",
  "volume",
  "volumes",
  "want",
  "was",
  "we",
  "were",
  "what",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

function getEnvValue(name: string): string {
  if (typeof process === "undefined" || !process.env) {
    return "";
  }
  return process.env[name]?.trim() ?? "";
}

export function isLibrarianConfigured(): boolean {
  return Boolean(getEnvValue("GEMINI_API_KEY"));
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US");
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 4 && token.endsWith("es") && !token.endsWith("ses")) {
    return token.slice(0, -2);
  }
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function formatShelfNote(book: CatalogueBook): string {
  const position = book.position.trim();
  return position ? `Shelf ${book.shelf} · ${position}` : `Shelf ${book.shelf}`;
}

function truncateText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  const sliced = trimmed.slice(0, maxLength - 1).trimEnd();
  return `${sliced}…`;
}

function parsePromptCues(prompt: string): ParsedPromptCues {
  const normalizedPrompt = normalizeText(prompt);

  let statusIntent: ReadingStatus | null = null;
  if (
    /\b(unread|haven'?t read|not read|to read|tbr|read next|haven'?t finished|unopened)\b/i.test(
      normalizedPrompt,
    )
  ) {
    statusIntent = "unread";
  } else if (
    /\b(finished|already read|have read|books i'?ve read|completed)\b/i.test(
      normalizedPrompt,
    )
  ) {
    statusIntent = "finished";
  } else if (/\b(currently reading|reading now)\b/i.test(normalizedPrompt)) {
    statusIntent = "reading";
  }

  const shelfRanges: ShelfRange[] = [];
  const shelfRangePattern =
    /\bshelves?\s+(\d{1,2})\s*(?:-|–|—|to|through)\s*(\d{1,2})\b/gi;
  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = shelfRangePattern.exec(normalizedPrompt)) !== null) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (Number.isInteger(a) && Number.isInteger(b)) {
      shelfRanges.push({ min: Math.min(a, b), max: Math.max(a, b) });
    }
  }

  const singleShelfPattern = /\bshelf\s+#?(\d{1,2})\b/gi;
  let singleMatch: RegExpExecArray | null;
  while ((singleMatch = singleShelfPattern.exec(normalizedPrompt)) !== null) {
    const shelfNum = Number(singleMatch[1]);
    if (Number.isInteger(shelfNum)) {
      const alreadyCovered = shelfRanges.some(
        (range) => shelfNum >= range.min && shelfNum <= range.max,
      );
      if (!alreadyCovered) {
        shelfRanges.push({ min: shelfNum, max: shelfNum });
      }
    }
  }

  const eraRanges: EraRange[] = [];
  const consumedYears = new Set<number>();

  if (/\b(ancient|antiquity|classical|bce|b\.c\.|bc)\b/i.test(normalizedPrompt)) {
    eraRanges.push({ min: -3000, max: -1, label: "Antiquity (BCE)" });
  }
  if (/\b(medieval|middle ages)\b/i.test(normalizedPrompt)) {
    eraRanges.push({ min: 500, max: 1499, label: "Medieval" });
  }
  if (/\b(renaissance|early modern)\b/i.test(normalizedPrompt)) {
    eraRanges.push({ min: 1400, max: 1699, label: "Renaissance / Early Modern" });
  }

  const centuryPattern = /\b(\d{1,2})(?:st|nd|rd|th)\s+century\b/gi;
  let centuryMatch: RegExpExecArray | null;
  while ((centuryMatch = centuryPattern.exec(normalizedPrompt)) !== null) {
    const century = Number(centuryMatch[1]);
    if (Number.isInteger(century) && century >= 1 && century <= 21) {
      const min = (century - 1) * 100;
      const max = century * 100 - 1;
      eraRanges.push({ min, max, label: `${centuryMatch[0]}` });
    }
  }

  const decadeOrCenturyPluralPattern = /\b(1[5-9]\d0|20[0-2]0)s\b/gi;
  let pluralYearMatch: RegExpExecArray | null;
  while (
    (pluralYearMatch = decadeOrCenturyPluralPattern.exec(normalizedPrompt)) !==
    null
  ) {
    const startYear = Number(pluralYearMatch[1]);
    consumedYears.add(startYear);
    if (startYear % 100 === 0) {
      eraRanges.push({
        min: startYear,
        max: startYear + 99,
        label: `${startYear}s`,
      });
    } else {
      eraRanges.push({
        min: startYear,
        max: startYear + 9,
        label: `${startYear}s`,
      });
    }
  }

  if (/\b(modern|contemporary)\b/i.test(normalizedPrompt)) {
    eraRanges.push({ min: 1900, max: 2100, label: "Modern" });
  }

  const explicitYearPattern = /\b(1[0-9]{3}|20[0-2][0-9])\b/g;
  let yearMatch: RegExpExecArray | null;
  while ((yearMatch = explicitYearPattern.exec(normalizedPrompt)) !== null) {
    const year = Number(yearMatch[1]);
    if (!consumedYears.has(year)) {
      eraRanges.push({
        min: year - 15,
        max: year + 15,
        label: `${year}`,
        exactYear: year,
      });
    }
  }

  const rawTokens = normalizedPrompt
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const keywordSet = new Set<string>();
  const keywords: string[] = [];
  for (const token of rawTokens) {
    if (token.length < 2) continue;
    if (/^\d+$/.test(token)) continue;
    if (STOPWORDS.has(token)) continue;
    if (
      token === "ancient" ||
      token === "antiquity" ||
      token === "medieval" ||
      token === "modern" ||
      token === "contemporary" ||
      token === "bce"
    ) {
      continue;
    }
    if (!keywordSet.has(token)) {
      keywordSet.add(token);
      keywords.push(token);
    }
  }

  return {
    statusIntent,
    shelfRanges,
    eraRanges,
    keywords,
    normalizedPrompt,
  };
}

function fieldMatchesKeyword(haystack: string, keyword: string): boolean {
  if (!haystack) return false;
  if (haystack.includes(keyword)) return true;
  const stemmed = stemToken(keyword);
  if (stemmed !== keyword && stemmed.length >= 3 && haystack.includes(stemmed)) {
    return true;
  }
  return false;
}

function scoreBooksForPrompt(
  books: readonly CatalogueBook[],
  connections: readonly EditorialConnection[],
  prompt: string,
): { cues: ParsedPromptCues; scored: ScoredShortlistItem[] } {
  const cues = parsePromptCues(prompt);
  const tagFrequency = buildTagFrequencyMap(books);
  const editorialMap = resolveEditorialConnectionMap(connections);
  const profile = buildTasteProfile(books, tagFrequency);

  const scored: ScoredShortlistItem[] = books.map((book) => {
    let score = 0;
    const matchedKeywords: string[] = [];

    const normTitle = normalizeText(book.title);
    const normAuthor = normalizeText(book.author);
    const normTop = normalizeText(book.top_category ?? "");
    const normSub = normalizeText(book.sub_category ?? "");
    const normSummary = normalizeText(book.summary ?? "");
    const normEdition = normalizeText(book.edition);
    const displayTags = filterDisplayTags(book.tags);
    const normTags = displayTags.map((tag) => normalizeText(tag)).join(" | ");

    for (const keyword of cues.keywords) {
      let keywordPoints = 0;
      if (fieldMatchesKeyword(normTitle, keyword)) keywordPoints += 12;
      if (fieldMatchesKeyword(normAuthor, keyword)) keywordPoints += 11;
      if (fieldMatchesKeyword(normTags, keyword)) keywordPoints += 9;
      if (
        fieldMatchesKeyword(normTop, keyword) ||
        fieldMatchesKeyword(normSub, keyword)
      ) {
        keywordPoints += 8;
      }
      if (fieldMatchesKeyword(normSummary, keyword)) keywordPoints += 5;
      if (fieldMatchesKeyword(normEdition, keyword)) keywordPoints += 2;

      if (keywordPoints > 0) {
        score += keywordPoints;
        matchedKeywords.push(keyword);
      }
    }

    // Bonus for matching multiple distinct keywords in the same prompt
    if (matchedKeywords.length >= 2) {
      score += matchedKeywords.length * 4;
    }

    // Status intent cue
    let matchedStatus = false;
    if (cues.statusIntent) {
      if (book.reading_status === cues.statusIntent) {
        score += 14;
        matchedStatus = true;
      } else {
        score -= 10;
      }
    }

    // Shelf range cue
    let matchedShelf = false;
    if (cues.shelfRanges.length > 0) {
      const inRange = cues.shelfRanges.some(
        (range) => book.shelf >= range.min && book.shelf <= range.max,
      );
      if (inRange) {
        score += 16;
        matchedShelf = true;
      } else {
        score -= 8;
      }
    }

    // Era/century/year cue
    let matchedEra: string | null = null;
    if (cues.eraRanges.length > 0) {
      if (book.publish_year !== null) {
        for (const range of cues.eraRanges) {
          if (book.publish_year >= range.min && book.publish_year <= range.max) {
            score += 15;
            if (range.exactYear === book.publish_year) {
              score += 8;
            }
            matchedEra = range.label;
            break;
          }
        }
        if (!matchedEra) {
          score -= 6;
        }
      } else {
        score -= 3;
      }
    }

    // Taste-profile affinity boost so broad prompts reflect reader taste
    let tasteReasons: string[] = [];
    if (profile.summary.isPersonalized) {
      const taste = scoreBookAgainstTasteProfile(
        book,
        profile,
        tagFrequency,
        books.length,
        editorialMap,
      );
      const tasteWeight = cues.keywords.length === 0 ? 0.5 : 0.25;
      score += Math.max(-4, Math.min(10, taste.score * tasteWeight));
      tasteReasons = taste.reasons;
    }

    // Subtle metadata richness tie-breaker
    if (book.summary) score += 0.8;
    if (displayTags.length > 0) score += 0.4;
    if (book.publish_year !== null) score += 0.3;

    return {
      book,
      score,
      matchedKeywords,
      matchedStatus,
      matchedShelf,
      matchedEra,
      tasteReasons,
    };
  });

  scored.sort(
    (a, b) => b.score - a.score || compareCatalogueBooks(a.book, b.book),
  );

  return { cues, scored };
}

export function shortlistCatalogueForPrompt(
  books: readonly CatalogueBook[],
  connections: readonly EditorialConnection[],
  prompt: string,
  limit = SHORTLIST_LIMIT,
): CatalogueBook[] {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const { scored } = scoreBooksForPrompt(books, connections, prompt);
  return scored.slice(0, safeLimit).map((item) => item.book);
}

function buildLocalPitch(item: ScoredShortlistItem): string {
  const cues: string[] = [];
  if (item.matchedKeywords.length > 0) {
    cues.push(`Matches ${item.matchedKeywords.slice(0, 3).join(", ")}`);
  }
  if (item.matchedEra && item.book.publish_year !== null) {
    cues.push(`Published ${formatPublishYear(item.book.publish_year)}`);
  }
  if (item.matchedShelf) {
    cues.push(`Located on Shelf ${item.book.shelf}`);
  }
  if (item.matchedStatus) {
    cues.push(`Status: ${item.book.reading_status}`);
  }
  if (cues.length === 0 && item.tasteReasons.length > 0) {
    cues.push(item.tasteReasons[0]);
  }
  if (cues.length === 0) {
    cues.push(`Shelved under ${getDivision(item.book)}`);
  }

  const prefix = `${cues.join(" · ")}.`;
  if (item.book.summary) {
    return `${prefix} ${truncateText(item.book.summary, 150)}`;
  }

  return prefix;
}

export function runLocalLibrarianQuery(
  books: readonly CatalogueBook[],
  connections: readonly EditorialConnection[],
  prompt: string,
  limit = 6,
): LibrarianResponse {
  const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
  const { cues, scored } = scoreBooksForPrompt(books, connections, prompt);

  if (scored.length === 0) {
    return {
      mode: "local",
      reply:
        "Your catalogue is currently empty, so there are no volumes to search yet.",
      recommendations: [],
    };
  }

  const topItems = scored.slice(0, safeLimit);
  const recommendations: LibrarianRecommendation[] = topItems.map((item) => ({
    book: item.book,
    pitch: buildLocalPitch(item),
    shelfNote: formatShelfNote(item.book),
  }));

  const appliedCues: string[] = [];
  if (cues.statusIntent) {
    appliedCues.push(`${cues.statusIntent} volumes`);
  }
  if (cues.shelfRanges.length > 0) {
    const labels = cues.shelfRanges.map((r) =>
      r.min === r.max ? `Shelf ${r.min}` : `Shelves ${r.min}–${r.max}`,
    );
    appliedCues.push(labels.join(", "));
  }
  if (cues.eraRanges.length > 0) {
    appliedCues.push(cues.eraRanges.map((r) => r.label).join(", "));
  }
  if (cues.keywords.length > 0) {
    appliedCues.push(`keywords: ${cues.keywords.slice(0, 4).join(", ")}`);
  }

  const cueSummary =
    appliedCues.length > 0 ? ` (${appliedCues.join(" · ")})` : "";
  const reply = `Searched your ${books.length}-volume catalogue locally${cueSummary} and selected ${recommendations.length} grounded ${recommendations.length === 1 ? "match" : "matches"} from your shelves.`;

  return {
    mode: "local",
    reply,
    recommendations,
  };
}

function serializeBookForPrompt(book: CatalogueBook): string {
  const year = formatPublishYear(book.publish_year) || "Undated";
  const division = getDivision(book);
  const tags = filterDisplayTags(book.tags).slice(0, 5).join(", ");
  const rating = book.rating !== null ? `, rating:${book.rating}/5` : "";
  const summary = book.summary ? ` | ${truncateText(book.summary, 140)}` : "";
  return `- id=${book.id} | "${book.title}" by ${book.author} (${year}) | ${division} | status:${book.reading_status}${rating} | ${formatShelfNote(book)}${tags ? ` | tags:${tags}` : ""}${summary}`;
}

function stripJsonCodeFence(rawText: string): string {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

type RawGeminiPayload = {
  reply?: unknown;
  recommendations?: unknown;
};

type GeminiApiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export async function queryGeminiLibrarian(params: {
  prompt: string;
  history?: readonly LibrarianMessage[];
  books: readonly CatalogueBook[];
  connections: readonly EditorialConnection[];
  fetchImpl?: typeof fetch;
}): Promise<LibrarianResponse> {
  const apiKey = getEnvValue("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = getEnvValue("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  const fetchImpl = params.fetchImpl ?? fetch;
  const shortlist = shortlistCatalogueForPrompt(
    params.books,
    params.connections,
    params.prompt,
    SHORTLIST_LIMIT,
  );

  const tagFrequency = buildTagFrequencyMap(params.books);
  const tasteProfile = buildTasteProfile(params.books, tagFrequency).summary;

  const tasteSummaryLines = tasteProfile.isPersonalized
    ? [
        `Reader taste profile (${tasteProfile.ratedCount} rated, ${tasteProfile.finishedCount} finished, ${tasteProfile.readingCount} reading):`,
        tasteProfile.topAuthors.length > 0
          ? `- Top authors: ${tasteProfile.topAuthors.join(", ")}`
          : "",
        tasteProfile.topDivisions.length > 0
          ? `- Top divisions: ${tasteProfile.topDivisions.join(", ")}`
          : "",
        tasteProfile.topTags.length > 0
          ? `- Top themes: ${tasteProfile.topTags.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "Reader taste profile: No books rated or finished yet.";

  const catalogueContext = shortlist.map(serializeBookForPrompt).join("\n");

  const systemPrompt = [
    "You are the Reference Librarian for a personal physical library catalogue (Library of Babel).",
    "CRITICAL GROUNDING RULES:",
    "1. You may ONLY recommend books from the PROVIDED CATALOGUE SHORTLIST below, using their exact `id` value in `book_id`.",
    "2. NEVER invent, guess, or recommend any book not in the shortlist.",
    "3. Return strictly valid JSON with shape:",
    '   { "reply": string, "recommendations": [{ "book_id": string, "pitch": string, "shelf_note"?: string }] }',
    "4. Keep `reply` concise (2-4 sentences) and recommend 3-6 volumes when appropriate.",
    "",
    tasteSummaryLines,
    "",
    `PROVIDED CATALOGUE SHORTLIST (${shortlist.length} volumes):`,
    catalogueContext,
  ].join("\n");

  const recentHistory = (params.history ?? []).slice(-MAX_HISTORY_TURNS);
  const contents = [
    ...recentHistory.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.text }],
    })),
    {
      role: "user",
      parts: [{ text: params.prompt }],
    },
  ];

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API request failed with status ${response.status}.`);
  }

  const apiPayload = (await response.json()) as GeminiApiResponse;
  const rawText =
    apiPayload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!rawText) {
    throw new Error("Gemini API returned an empty response.");
  }

  let parsed: RawGeminiPayload;
  try {
    parsed = JSON.parse(stripJsonCodeFence(rawText)) as RawGeminiPayload;
  } catch {
    throw new Error("Gemini API returned malformed JSON.");
  }

  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim().length > 0
      ? parsed.reply.trim()
      : "Here are the closest matches from your catalogue.";

  const booksById = new Map<string, CatalogueBook>();
  for (const book of params.books) {
    booksById.set(book.id, book);
    booksById.set(getBookKey(book), book);
  }

  const rawRecs = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
    : [];
  const seenKeys = new Set<string>();
  const validated: LibrarianRecommendation[] = [];

  for (const rawRec of rawRecs) {
    if (typeof rawRec !== "object" || rawRec === null || Array.isArray(rawRec)) {
      continue;
    }
    const rec = rawRec as Record<string, unknown>;
    const rawId = typeof rec.book_id === "string" ? rec.book_id.trim() : "";
    if (!rawId) continue;

    const matchedBook = booksById.get(rawId);
    if (!matchedBook) {
      // Strictly drop hallucinated or unknown book IDs
      continue;
    }

    const canonicalKey = getBookKey(matchedBook);
    if (seenKeys.has(canonicalKey)) {
      continue;
    }
    seenKeys.add(canonicalKey);

    const pitch =
      typeof rec.pitch === "string" && rec.pitch.trim().length > 0
        ? rec.pitch.trim()
        : matchedBook.summary
          ? truncateText(matchedBook.summary, 160)
          : `Shelved under ${getDivision(matchedBook)}.`;

    const shelfNote =
      typeof rec.shelf_note === "string" && rec.shelf_note.trim().length > 0
        ? rec.shelf_note.trim()
        : formatShelfNote(matchedBook);

    validated.push({
      book: matchedBook,
      pitch,
      shelfNote,
    });
  }

  return {
    mode: "gemini",
    model,
    reply,
    recommendations: validated,
  };
}
