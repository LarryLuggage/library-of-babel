/**
 * Pure ESM helpers for bibliographic enrichment, summary hygiene,
 * Wikipedia/Wikidata candidate scoring, year resolution, and tag normalization.
 */

export const MIN_PUBLISH_YEAR = -3000;
export const MAX_PUBLISH_YEAR = 2100;
export const MAX_TAGS = 14;
export const MIN_WIKIPEDIA_SCORE = 48;

export const TAG_BLOCKLIST = new Set([
  "accessible book",
  "amerikanisches englisch",
  "audiobook",
  "audiobooks",
  "bibliography",
  "book club editions",
  "book reviews",
  "books and reading",
  "borrowable books",
  "classic",
  "classic fiction",
  "classic literature",
  "classics",
  "criticism",
  "criticism terminology",
  "criticism terminology dictionaries",
  "ebook",
  "ebooks",
  "english",
  "english language",
  "english translations",
  "ficcion",
  "ficcion juvenil",
  "fiction",
  "fiction general",
  "fictional works",
  "general",
  "geschichte",
  "guidebooks",
  "history and criticism",
  "history criticism",
  "history reference",
  "in english",
  "in library",
  "internet archive wishlist",
  "juvenile",
  "juvenile literature",
  "kurzgeschichte",
  "large print books",
  "large type books",
  "library",
  "litarature",
  "literatura",
  "literature",
  "new york times bestseller",
  "new york times reviewed",
  "novela",
  "novelas",
  "nyt",
  "open library staff picks",
  "philosophy theory",
  "protected daisy",
  "readers",
  "reading",
  "roman",
  "romans",
  "romans nouvelles",
  "short stories single author",
  "spanish language books",
  "study guides",
  "textbooks",
  "textbooks for foreign speakers",
  "translations into english",
  "vfiction",
]);

const TAG_PHRASE_BLOCKLIST = [
  "award winner",
  "criticism and interpretation",
  "fictional works by one author",
  "history and criticism",
  "language books",
  "language materials",
  "long now",
  "manual for civilization",
  "open syllabus",
  "prize winner",
  "reading level",
  "translations from ",
  "translations into ",
];

const SURNAME_PARTICLES = new Set([
  "da",
  "de",
  "del",
  "della",
  "di",
  "du",
  "la",
  "le",
  "san",
  "st.",
  "van",
  "von",
]);

const NAME_SUFFIX_PATTERN = /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i;

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "were",
  "with",
]);

const ENGLISH_STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "to",
  "in",
  "is",
  "a",
  "an",
  "that",
  "with",
  "for",
  "as",
  "on",
  "by",
  "from",
  "was",
  "are",
  "his",
  "her",
  "their",
  "this",
  "it",
  "at",
  "or",
  "be",
  "into",
  "which",
  "who",
  "about",
  "when",
  "has",
  "have",
  "but",
  "not",
  "one",
  "all",
]);

const FOREIGN_LANGUAGE_STOPWORDS = {
  pt: new Set([
    "não",
    "são",
    "está",
    "também",
    "uma",
    "para",
    "com",
    "pelo",
    "pela",
    "dos",
    "das",
    "como",
    "seu",
    "sua",
    "mais",
    "entre",
    "sobre",
    "história",
    "grupo",
    "amigos",
    "através",
    "onde",
    "após",
    "contra",
    "mesmo",
    "pretende",
    "ajuda",
  ]),
  es: new Set([
    "una",
    "para",
    "los",
    "las",
    "del",
    "por",
    "con",
    "pero",
    "como",
    "sobre",
    "este",
    "esta",
    "también",
    "más",
    "entre",
    "novela",
    "obra",
    "escritor",
    "publicada",
    "historia",
    "donde",
    "todos",
    "sus",
    "está",
    "desde",
    "hasta",
    "sin",
    "aunque",
    "sino",
    "hacia",
    "misión",
  ]),
  fr: new Set([
    "est",
    "une",
    "des",
    "du",
    "et",
    "dans",
    "pour",
    "les",
    "qui",
    "avec",
    "sur",
    "pas",
    "plus",
    "par",
    "recueil",
    "roman",
    "après",
    "leur",
    "leurs",
    "société",
    "siècle",
    "fait",
    "dont",
    "cette",
    "ces",
    "ses",
    "sous",
    "entre",
    "tout",
    "tous",
    "elle",
    "ils",
    "aussi",
    "au",
    "aux",
    "où",
  ]),
  sv: new Set([
    "och",
    "att",
    "som",
    "för",
    "med",
    "det",
    "den",
    "är",
    "av",
    "på",
    "till",
    "från",
    "inte",
    "ett",
    "har",
    "var",
    "när",
    "honom",
    "henne",
    "utan",
    "blir",
    "efter",
    "genom",
    "medan",
    "sina",
    "svenska",
    "berättarglädje",
    "klassiker",
  ]),
  de: new Set([
    "und",
    "der",
    "die",
    "das",
    "mit",
    "von",
    "für",
    "auf",
    "ein",
    "eine",
    "nicht",
    "ist",
    "einem",
    "einer",
    "über",
    "als",
    "auch",
    "sich",
    "dem",
    "den",
    "des",
    "aus",
    "nach",
    "bei",
    "wird",
    "werden",
    "geschichte",
  ]),
  it: new Set([
    "che",
    "per",
    "con",
    "una",
    "del",
    "della",
    "degli",
    "nel",
    "nella",
    "sono",
    "come",
    "più",
    "romanzo",
    "storia",
    "anche",
    "tra",
    "fra",
    "questo",
    "questa",
    "dopo",
    "tutti",
    "suo",
    "sua",
    "loro",
  ]),
};

const PINYIN_EXCLUSIVE_SYLLABLES = new Set([
  "ben",
  "shu",
  "shang",
  "ren",
  "wen",
  "ming",
  "kai",
  "duan",
  "xia",
  "zhi",
  "jie",
  "zhan",
  "jiang",
  "luo",
  "ying",
  "guo",
  "mei",
  "deng",
  "chao",
  "xing",
  "shuai",
  "tiao",
  "xian",
  "zai",
  "dou",
  "zhe",
  "mian",
  "qian",
  "zhong",
  "wei",
  "shuo",
  "dao",
  "xiang",
  "xiao",
  "nian",
  "hua",
  "xue",
  "zheng",
  "hui",
  "zuo",
  "yue",
  "yuan",
  "wang",
  "wai",
  "tui",
  "tou",
  "tian",
  "suo",
  "sui",
  "shui",
  "shou",
  "shen",
  "sheng",
  "shan",
  "ruo",
  "rong",
  "qing",
  "qie",
  "qiao",
  "qiang",
  "ping",
  "pian",
  "nong",
  "niu",
  "ning",
  "niang",
  "miao",
  "meng",
  "lue",
  "liu",
  "liang",
  "lian",
  "lao",
  "kuo",
  "kui",
  "kuai",
  "kua",
  "kong",
  "kao",
  "juan",
  "jue",
  "gei",
  "fei",
  "fou",
  "feng",
  "geng",
  "gou",
  "gua",
  "guai",
  "guan",
  "guang",
  "gui",
  "hei",
  "heng",
  "hou",
  "huai",
  "huan",
  "huang",
  "jia",
  "jian",
  "jiao",
  "jing",
  "jiong",
  "jiu",
]);

/**
 * Returns the canonical `(title, author)` pair key used by `VERIFIED_CLASSIC_YEARS`.
 */
export function getPairKey(title, author) {
  return `${title}\u0000${author}`;
}

/**
 * Returns the unique copy identity key matching `apply-catalogue-enrichment.mjs`.
 */
export function getBookIdentity(book) {
  return [book.author, book.title, book.shelf, book.position].join("\u0000");
}

function foldAscii(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Strips translator/editor parentheticals, slash annotations, and `et al.` markers from an author string.
 */
export function stripAuthorAnnotations(author) {
  return String(author ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s*\/.*$/g, "")
    .replace(/,\s*et\s+al\.?$/i, "")
    .replace(/,?\s*\b(?:editors?|eds?\.|translators?|trans\.)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts the primary author's surname (consistent with `catalogue.ts` surname indexing).
 */
export function extractAuthorSurname(author) {
  const cleaned = stripAuthorAnnotations(author);
  if (!cleaned || /^(?:various|anonymous|unknown|multiple authors?)$/i.test(cleaned)) {
    return "";
  }

  let primary = cleaned.split(";")[0].trim();

  if (primary.includes(",")) {
    const parts = primary
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const firstTokens = parts[0].split(/\s+/).filter(Boolean);
      if (firstTokens.length === 1) {
        return firstTokens[0];
      }
      primary = parts[0];
    }
  }

  const multiSplit = primary.split(/\s+(?:&|and)\s+/i);
  if (multiSplit.length > 1) {
    primary = multiSplit[0].trim();
  }

  const tokens = primary.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIX_PATTERN.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  if (tokens.length === 0) {
    return "";
  }

  // Handle single-word names and particle surnames (e.g., "Homer", "von Goethe" -> "Goethe")
  const surname = tokens[tokens.length - 1];
  if (
    tokens.length === 1 &&
    SURNAME_PARTICLES.has(surname.toLocaleLowerCase("en-US"))
  ) {
    return surname;
  }

  return surname;
}

/**
 * Normalizes a work title by removing edition/volume/parenthetical suffixes, diacritics, and punctuation.
 */
export function normalizeWorkTitle(title) {
  const stripped = String(title ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*[—–:-]\s*(?:vol(?:ume)?\.?|part|book|bk\.?)\s+[ivxlcdm0-9]+\b.*$/i, "")
    .replace(/,?\s+(?:vol(?:ume)?\.?|part)\s+[ivxlcdm0-9]+\b.*$/i, "")
    .replace(
      /,?\s+\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+edition\b.*$/i,
      "",
    );

  return foldAscii(stripped);
}

/**
 * Cleans book summary text: removes HTML, raw Open Library `/works/OL...` fragments,
 * citation markers, Markdown emphasis, publisher wrappers, and normalizes quotes/dashes/whitespace.
 */
export function cleanSummary(text) {
  if (typeof text !== "string") {
    return null;
  }

  let cleaned = text
    // Decode HTML entities and strip HTML tags
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "...")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&ldquo;/gi, '"')
    .replace(/&rdquo;/gi, '"')
    // Strip markdown reference link definitions and inline links
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, " ")
    .replace(/\[\d+\]:\s*(?:https?:\/\/\S+|\/works\/\S+|\S*openlibrary\.org\S*)/gi, " ")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+|\/works\/[^)]+)\)/gi, "$1")
    .replace(/\[([^\]]+)\]\[\d+\]/g, "$1")
    // Strip raw Open Library fragments and URLs
    .replace(/(?:https?:\/\/)?(?:www\.)?openlibrary\.org\/works\/OL\w+(?:\/[^\s)]*)?\)?/gi, " ")
    .replace(/\borg\/works\/OL\w+(?:\/[^\s)]*)?\)?/gi, " ")
    .replace(/\/works\/OL\w+(?:\/[^\s)]*)?\)?/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    // Strip citation markers and empty brackets
    .replace(
      /\[(?:\d+|note\s+\d+|[a-z]|citation\s+needed|clarification\s+needed|who\?|when\?|which\?|where\?|by\s+whom\?|needs\s+update|edit)\]/gi,
      "",
    )
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    // Strip markdown headings and emphasis
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/\*{2,3}([^*]+?)\*{2,3}/g, "$1")
    .replace(/\*([^*\n]+?)\*/g, "$1")
    .replace(/__([^_]+?)__/g, "$1")
    .replace(/\*{2,}/g, " ")
    // Normalize quotes and dashes
    .replace(/''/g, '"')
    .replace(/[‘’‚‛ʼʹ]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[\u2012\u2015\u2212]/g, "—")
    .replace(/---/g, "—")
    .replace(/(\S)--(\S)/g, "$1—$2")
    .replace(/\s+--\s+/g, " — ")
    .replace(/\s+–\s+/g, " — ")
    .replace(/--/g, "—")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

  // Strip publisher / back-cover boilerplate prefixes & suffixes
  cleaned = cleaned
    .replace(
      /^(?:From\s+(?:the\s+)?Publisher|Publisher\s+Description|From\s+inside\s+the\s+book|Excerpt\s+from\s+back\s+cover|From\s+back\s+cover)\s*:\s*/i,
      "",
    )
    .replace(
      /\s*[—–-]?\s*(?:From\s+(?:the\s+)?Publisher|Publisher\s+description|From\s+back\s+cover|From\s+publisher's\s+information)\.?["']?\s*$/i,
      "",
    )
    .replace(/\(\s*;\s*/g, "(")
    .replace(/(\S)\s+([,.;:!?])(?=\s|$)/g, "$1$2")
    .replace(/\s*[—–]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  // Unwrap clean outer quotes or remove stray unmatched leading quote
  if (cleaned.startsWith('"')) {
    const quoteCount = (cleaned.match(/"/g) ?? []).length;
    if (cleaned.endsWith('"') && quoteCount === 2) {
      cleaned = cleaned.slice(1, -1).trim();
    } else if (quoteCount % 2 === 1) {
      cleaned = cleaned.slice(1).trim();
    }
  } else if (cleaned.endsWith('"') && (cleaned.match(/"/g) ?? []).length === 1) {
    cleaned = cleaned.slice(0, -1).trim();
  }

  return cleaned.length > 0 ? cleaned : null;
}

const NON_TERMINAL_ABBREVIATIONS = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "rev.",
  "st.",
  "jr.",
  "sr.",
  "vs.",
  "etc.",
  "vol.",
  "no.",
  "ed.",
  "eds.",
  "trans.",
  "pp.",
  "c.",
  "ca.",
  "cf.",
  "e.g.",
  "i.e.",
  "u.s.",
  "u.k.",
  "o.s.",
  "n.s.",
  "a.d.",
  "b.c.",
  "b.c.e.",
  "c.e.",
  "d.c.",
  "ll.d.",
  "d.c.l.",
  "ph.d.",
  "m.d.",
  "inc.",
  "ltd.",
  "co.",
]);

const SENTENCE_STARTER_AFTER_INITIAL = new Set([
  "the",
  "it",
  "he",
  "she",
  "they",
  "we",
  "this",
  "these",
  "those",
  "there",
  "here",
  "later",
  "however",
  "meanwhile",
  "although",
  "though",
  "after",
  "before",
  "during",
  "since",
  "published",
  "written",
]);

function isNonBreakingPeriod(text, periodIndex) {
  let tokenStart = periodIndex;
  while (tokenStart > 0 && !/[\s(—–\[]/.test(text[tokenStart - 1])) {
    tokenStart -= 1;
  }
  const token = text.slice(tokenStart, periodIndex + 1).toLocaleLowerCase("en-US");

  if (NON_TERMINAL_ABBREVIATIONS.has(token)) {
    return true;
  }

  // Never split internal dotted abbreviations like U.S., O.S., Ph.D., D.C.L.
  if (/(?:[a-z]{1,4}\.){2,}$/i.test(token)) {
    return true;
  }

  // Handle single-letter initials followed by spaces (e.g., "D. H. Lawrence", "E. M. Forster")
  if (/^[a-z]\.$/.test(token)) {
    const after = text.slice(periodIndex + 1).match(/^\s+([A-Z]\.|[A-Z][a-z'’-]+)/);
    if (after) {
      if (/^[A-Z]\.$/.test(after[1])) {
        return true;
      }
      const nextWordLower = after[1].toLocaleLowerCase("en-US");
      const prevContext = text.slice(Math.max(0, tokenStart - 16), tokenStart);
      if (
        !SENTENCE_STARTER_AFTER_INITIAL.has(nextWordLower) &&
        !/\b(?:Part|Volume|Vol\.|Book|Chapter|Ch\.|War|Appendix|Section)\s*$/i.test(
          prevContext,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Splits prose into complete sentences without dropping characters across abbreviations/initials.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const input = String(text ?? "").trim();
  if (!input) {
    return [];
  }

  const sentences = [];
  let start = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== "." && ch !== "!" && ch !== "?") {
      continue;
    }

    // Consume consecutive terminal marks like "..." or "?!"
    let end = i;
    while (end + 1 < input.length && ".!?".includes(input[end + 1])) {
      end += 1;
    }

    if (ch === "." && end === i && isNonBreakingPeriod(input, i)) {
      continue;
    }

    let afterClosers = end + 1;
    while (afterClosers < input.length && "\"'”’)]".includes(input[afterClosers])) {
      afterClosers += 1;
    }

    if (afterClosers === input.length || /\s/.test(input[afterClosers])) {
      const sentence = input.slice(start, afterClosers).trim();
      if (sentence) {
        sentences.push(sentence);
      }
      start = afterClosers;
      while (start < input.length && /\s/.test(input[start])) {
        start += 1;
      }
      i = Math.max(i, start - 1);
    }
  }

  if (start < input.length) {
    const trailing = input.slice(start).trim();
    if (trailing) {
      sentences.push(trailing);
    }
  }

  return sentences;
}

/**
 * Summarizes a longer extract into up to 2-3 clean complete sentences capped at `maxLength`.
 */
export function summarizeText(text, maxLength = 420) {
  const cleaned = cleanSummary(text);
  if (!cleaned) {
    return null;
  }

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const sentences = splitSentences(cleaned);
  let result = "";

  for (const sentence of sentences.slice(0, 3)) {
    const candidate = result ? `${result} ${sentence}` : sentence;
    if (candidate.length <= maxLength) {
      result = candidate;
    } else {
      break;
    }
  }

  if (result.length >= 80) {
    return result;
  }

  const fallback = sentences.slice(0, 2).join(" ").trim() || cleaned;
  if (fallback.length <= maxLength) {
    return fallback;
  }

  return `${fallback.slice(0, maxLength - 3).replace(/\s+\S*$/, "")}...`;
}

function isNonEnglishSummary(text) {
  // Ignore foreign-language parenthetical glosses inside English prose, e.g. "(Russian: Братья Карамазовы)"
  const prose =
    String(text ?? "")
      .replace(/\([^)]{1,180}\)/g, " ")
      .replace(/\s+/g, " ")
      .trim() || String(text ?? "");

  const nonLatinMatches =
    prose.match(
      /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g,
    ) ?? [];
  const allLetters = prose.match(/\p{L}/gu) ?? [];
  if (
    nonLatinMatches.length >= 12 ||
    (nonLatinMatches.length >= 4 &&
      allLetters.length > 0 &&
      nonLatinMatches.length / allLetters.length > 0.1)
  ) {
    return true;
  }

  const unicodeWords = prose.toLocaleLowerCase("en-US").match(/\p{L}+/gu) ?? [];
  if (unicodeWords.length === 0) {
    return false;
  }

  const englishHits = unicodeWords.filter((word) => ENGLISH_STOPWORDS.has(word)).length;

  for (const stopwordSet of Object.values(FOREIGN_LANGUAGE_STOPWORDS)) {
    const hits = unicodeWords.filter((word) => stopwordSet.has(word)).length;
    if (hits >= 3 && hits >= englishHits) {
      return true;
    }
  }

  const asciiWords = prose.toLowerCase().match(/[a-z]+/g) ?? [];
  const pinyinHits = asciiWords.filter((word) =>
    PINYIN_EXCLUSIVE_SYLLABLES.has(word),
  ).length;
  if (pinyinHits >= 5 && englishHits <= 2) {
    return true;
  }

  return false;
}

function hasTitleOrAuthorMismatch(cleaned, book) {
  if (!book) {
    return false;
  }

  const titleAndAuthor = foldAscii(
    `${book.title ?? ""} ${book.author ?? ""} ${book.sub_category ?? ""}`,
  );
  const titleAuthorWords = new Set(titleAndAuthor.split(/\s+/).filter(Boolean));

  // Catch mismatches like "An analysis of Keats' poetry..." on Jameson's The Prison-House of Language
  const subjectAnalysisMatch = cleaned.match(
    /^(?:An?\s+)?(?:analysis|study|biography|life|critical\s+study|portrait|history)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:'s|'|’s?)\s+(?:poetry|poems|novels|fiction|work|works|writings|life|thought)\b/,
  );
  if (subjectAnalysisMatch) {
    const subjectTokens = foldAscii(subjectAnalysisMatch[1])
      .split(/\s+/)
      .filter((token) => token.length >= 3);
    if (
      subjectTokens.length > 0 &&
      !subjectTokens.some((token) => titleAuthorWords.has(token))
    ) {
      return true;
    }
  }

  // Catch explicit "<Work> is a novel/book by <Other Author>" or "was one of the final works of <Other Author>" mismatches
  const cleanAuthor = stripAuthorAnnotations(book.author);
  if (cleanAuthor && !/^(?:various|anonymous)$/i.test(cleanAuthor)) {
    const byAuthorMatch =
      cleaned.match(
        /^.{2,110}?\b(?:is|was)\s+(?:a|an|the)?\s*(?:\d{4}\s+)?(?:[a-z-]+\s+){0,3}(?:novel|novella|book|poem|play|treatise|collection|essay|essays|memoir|biography|autobiography|history|monograph|work)\s+(?:written\s+by|authored\s+by|by)\s+([^,;()]+?)(?=[,;()]|\s+\b(?:that|which|who|first|originally|published|written|serialized|set|about|concerning|exploring|examining)\b|\.\s+(?:It|He|She|They|We|The|This|These|Those|There|Here|In|On|At|As|For|From|By|First|Originally|Initially|Later|Written|Published|Set|A|An)\b|\.$|$)/i,
      ) ??
      cleaned.match(
        /^.{2,110}?\b(?:is|was)\s+one\s+of\s+the\s+(?:final\s+|last\s+|major\s+|best-known\s+|greatest\s+)works\s+of\s+([^,;()]+?)(?=[,;()]|\.$|$)/i,
      );
    if (byAuthorMatch && !/\b(?:translat|edit)/i.test(byAuthorMatch[0])) {
      const claimedTokens = foldAscii(byAuthorMatch[1])
        .split(/\s+/)
        .filter((token) => token.length >= 3);
      const expectedTokens = foldAscii(cleanAuthor)
        .split(/\s+/)
        .filter((token) => token.length >= 3);
      if (
        claimedTokens.length > 0 &&
        expectedTokens.length > 0 &&
        !expectedTokens.some((token) => claimedTokens.includes(token))
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detects broken, stub, raw Open Library, non-English, citation/UI junk, person-bio, or mismatched summaries.
 * @param {string | null | undefined} summary
 * @param {{ title?: string; author?: string; sub_category?: string | null } | null} [book]
 * @returns {boolean}
 */
export function isBrokenSummary(summary, book = null) {
  if (typeof summary !== "string" || !summary.trim()) {
    return true;
  }

  // Raw URL / Open Library work-link / template markup check
  if (
    /(?:https?:\/\/|www\.|openlibrary\.org|\borg\/works\/OL|\/works\/OL|\{\{|\}\}|\[citation needed\]|\[\d+\]:)/i.test(
      summary,
    )
  ) {
    return true;
  }

  const cleaned = cleanSummary(summary);
  if (!cleaned || cleaned.length < 60) {
    return true;
  }

  // Broken fragment starts/endings, truncated initial-dot artifacts, and UI/TOC junk
  if (
    /^[;:,.\-\)\]\[]/.test(cleaned) ||
    /^[A-Z]\.\s+[A-Z]/.test(cleaned) ||
    /(?:^|(?:[a-z]{2,}|\d)[.!?]\s+)[A-Z]\.\s+(?:[—–-]|bestseller\b|by\b|National\b|Miller['’]s\b)/.test(
      cleaned,
    ) ||
    /^[a-z]/.test(cleaned) ||
    /^(?:Contains|Table of Contents)\s*:/i.test(cleaned) ||
    /^This (?:article|is a) (?:lists|list of|bibliography)\b/i.test(cleaned) ||
    /\b(?:Dr|Mr|Mrs|Ms|[A-Z])\.\s*[A-Z]\.?$/.test(cleaned) ||
    /\.\s+[A-Z]\.$/.test(cleaned) ||
    /\.\s*,\s*[a-z]/.test(cleaned) ||
    /\.\s+000\b/.test(cleaned) ||
    /For contents, see Author Catalog|Read a complete short story at|Click here|Buy now/i.test(
      cleaned,
    )
  ) {
    return true;
  }

  // Reject Wikipedia person-biography leads (e.g. "Author Name (1803 — 1882) was an American writer...")
  if (
    /^.{2,110}?\([^)]*(?:\b\d{4}\b[^)]*[–—-][^)]*\b\d{4}\b|born\s+[^)]+)\)\s*,?\s*(?:who\b[^,]+,\s*)?(?:was|is)\s+(?:a|an|the|born)\b(?![^.]*\b(?:novel|novella|book|poem|play|essay|collection|biography|history|work|volume|monograph|study)\b)/i.test(
      cleaned,
    )
  ) {
    return true;
  }

  // Title-list / table-of-contents dumps without normal sentence structure
  const withoutTrailingEllipsis = cleaned.replace(/\.\.\.$/, "").trim();
  if (
    cleaned.length >= 100 &&
    !/[.!?]["']?(?:\s|$)/.test(withoutTrailingEllipsis)
  ) {
    const tokens = withoutTrailingEllipsis.split(/\s+/).filter(Boolean);
    const capitalizedCount = tokens.filter((t) => /^[A-Z]/.test(t)).length;
    const proseMarkers = tokens.filter((t) =>
      /^(?:is|are|was|were|has|have|had|that|which|who|whose|when|where|while|about|through|between|their|they|into|from|with|for)$/.test(
        t,
      ),
    ).length;
    if (tokens.length >= 10 && capitalizedCount / tokens.length > 0.5 && proseMarkers <= 2) {
      return true;
    }
  }
  if (
    cleaned.split(";").length >= 5 &&
    !/\b(?:is|are|was|were|has|have|had|follows|traces|tells|examines|explores|draws|focuses|chronicles|describes)\b/i.test(
      cleaned,
    )
  ) {
    return true;
  }
  if (cleaned.split("—").length >= 5 && !/[.!?]\s+[A-Z]/.test(cleaned)) {
    return true;
  }

  if (isNonEnglishSummary(cleaned)) {
    return true;
  }

  if (hasTitleOrAuthorMismatch(cleaned, book)) {
    return true;
  }

  return false;
}

/**
 * Parses a Wikidata time claim (`+YYYY-MM-DDT...` or `-0375-00-00T...`) into an integer year in `-3000..2100`.
 */
export function parseWikidataYear(claimValue) {
  if (!claimValue) {
    return null;
  }

  let timeString = null;
  let precision = null;

  if (typeof claimValue === "string") {
    timeString = claimValue;
  } else if (typeof claimValue === "object") {
    const valueNode =
      claimValue.mainsnak?.datavalue?.value ??
      claimValue.datavalue?.value ??
      claimValue.value ??
      claimValue;

    if (typeof valueNode === "string") {
      timeString = valueNode;
    } else if (valueNode && typeof valueNode === "object") {
      timeString = valueNode.time ?? null;
      if (typeof valueNode.precision === "number") {
        precision = valueNode.precision;
      }
    }
  }

  if (typeof timeString !== "string") {
    return null;
  }

  // Reject century-level (7) or coarser precision where +1600 means "16th century"
  if (precision !== null && precision < 8) {
    return null;
  }

  const match = timeString.trim().match(/^([+-]?\d{1,4})-\d{2}-\d{2}T/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  if (
    !Number.isInteger(year) ||
    year === 0 ||
    year < MIN_PUBLISH_YEAR ||
    year > MAX_PUBLISH_YEAR
  ) {
    return null;
  }

  return year;
}

function parseEraYearToken(rawToken) {
  if (!rawToken) {
    return null;
  }

  const token = rawToken.trim();
  const bceMatch = token.match(/^(\d{1,4})\s*(?:BC|BCE|B\.C\.E?\.?)$/i);
  if (bceMatch) {
    const year = -Number.parseInt(bceMatch[1], 10);
    return year >= MIN_PUBLISH_YEAR && year < 0 ? year : null;
  }

  const cePrefixMatch = token.match(/^(?:AD|CE|A\.D\.?|C\.E\.?)\s*(\d{1,4})$/i);
  if (cePrefixMatch) {
    const year = Number.parseInt(cePrefixMatch[1], 10);
    return year > 0 && year <= MAX_PUBLISH_YEAR ? year : null;
  }

  const ceSuffixMatch = token.match(/^(\d{1,4})\s*(?:AD|CE|A\.D\.?|C\.E\.?)$/i);
  if (ceSuffixMatch) {
    const year = Number.parseInt(ceSuffixMatch[1], 10);
    return year > 0 && year <= MAX_PUBLISH_YEAR ? year : null;
  }

  if (/^\d{4}$/.test(token)) {
    const year = Number.parseInt(token, 10);
    return year > 0 && year <= MAX_PUBLISH_YEAR ? year : null;
  }

  return null;
}

/**
 * Extracts original publication or composition year (BCE/CE) from Wikipedia lead prose.
 */
export function extractYearFromWikipediaExtract(extract) {
  if (typeof extract !== "string" || !extract.trim()) {
    return null;
  }

  // Strip parenthetical author lifespans e.g. "(1871–1900)" or "(born 1958)" to avoid false hits
  const sanitized = extract
    .replace(/\(\s*(?:c\.\s*)?\d{3,4}\s*[–—-]\s*\d{3,4}\s*\)/g, " ")
    .replace(/\(\s*(?:born|b\.|died|d\.)\s+[^)]+\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const yearAtom =
    "(?:(?:AD|CE|A\\.D\\.?|C\\.E\\.?)\\s*\\d{1,4}|\\d{1,4}\\s*(?:BC|BCE|B\\.C\\.E?\\.?|AD|CE|A\\.D\\.?|C\\.E\\.?)|\\d{4})";
  const monthOrDay =
    "(?:(?:on|in)\\s+)?(?:\\d{1,2}\\s+[A-Z][a-z]+\\s+|[A-Z][a-z]+\\s+\\d{1,2},?\\s+)?";
  const approx = "(?:(?:c\\.|ca\\.|circa|around|about)\\s+)?";

  const patterns = [
    // 1. Explicit "originally/first published ... YYYY"
    new RegExp(
      `\\b(?:first|originally)\\s+published\\b[^.;]{0,50}?${monthOrDay}${approx}(${yearAtom})\\b`,
      "gi",
    ),
    // 2. Definitional lead "<Work> is a 1974 novel/book/treatise..."
    new RegExp(
      `\\b(?:is|was)\\s+(?:a|an)\\s+(${yearAtom})\\s+(?:[a-z-]+\\s+){0,3}(?:novel|novella|book|poem|epic|play|tragedy|comedy|dialogue|treatise|essay|essays|memoir|biography|autobiography|collection|anthology|history|monograph|work|satire|chronicle|trilogy|tetralogy)\\b`,
      "gi",
    ),
    // 3. Explicit composition/writing verbs (great for ancient & classical works)
    new RegExp(
      `\\b(?:written|composed|authored|completed|dated|finished)\\b[^.;]{0,45}?${monthOrDay}${approx}(${yearAtom})\\b`,
      "gi",
    ),
    // 4. General publication verbs, excluding English-translation / adaptation clauses
    new RegExp(
      `\\b(?:published|printed|issued|released|first\\s+appeared)\\b[^.;]{0,50}?${monthOrDay}${approx}(${yearAtom})\\b`,
      "gi",
    ),
    // 5. Serialization fallback
    new RegExp(
      `\\bserialized\\b[^.;]{0,50}?${monthOrDay}${approx}(${yearAtom})\\b`,
      "gi",
    ),
  ];

  for (const pattern of patterns) {
    for (const match of sanitized.matchAll(pattern)) {
      const contextStart = Math.max(0, (match.index ?? 0) - 35);
      const contextSlice = sanitized.slice(
        contextStart,
        (match.index ?? 0) + match[0].length,
      );
      if (
        /\b(?:translated|translation|adapted|adaptation|film|reprinted|published\s+in\s+english|set\s+in)\b/i.test(
          contextSlice,
        )
      ) {
        continue;
      }

      const parsed = parseEraYearToken(match[1]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

function stripWikiDisambiguator(wikiTitle) {
  return String(wikiTitle ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function getTitleVariants(title) {
  const variants = new Set();
  const normalizedMain = normalizeWorkTitle(title);
  if (normalizedMain) {
    variants.add(normalizedMain);
  }

  // Also capture alternate translated title inside parentheses, e.g. "Il Gattopardo (The Leopard)"
  for (const match of String(title ?? "").matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1].trim();
    if (!/^(?:vol|part|book|ninth|seventh|third|second|first|\d)/i.test(inner)) {
      const normalizedInner = foldAscii(inner);
      if (normalizedInner.length >= 4) {
        variants.add(normalizedInner);
      }
    }
  }

  return [...variants];
}

/**
 * Scores an English Wikipedia search candidate for relevance to `book`,
 * boosting literary/book/philosophy/history works and penalizing films, TV, albums, games, and stray biographies.
 * @param {{
 *   searchResult?: { title?: string; snippet?: string; pageid?: number };
 *   extract?: string;
 *   categories?: string[];
 *   book?: { title?: string; author?: string; top_category?: string | null; sub_category?: string | null } | null;
 * }} params
 * @returns {number}
 */
export function scoreWikipediaCandidate({
  searchResult = {},
  extract = "",
  categories = [],
  book,
}) {
  const wikiTitle = String(searchResult?.title ?? "");
  const snippet = String(searchResult?.snippet ?? "").replace(/<[^>]+>/g, " ");
  const extractText = String(extract ?? "");
  const lead = extractText.slice(0, 320);
  const categoryText = (Array.isArray(categories) ? categories : []).join(" ");
  const leadEvidence = foldAscii(`${wikiTitle} ${extractText.slice(0, 450)}`);
  const combinedEvidence = foldAscii(`${extractText} ${snippet}`);

  const bookCategoryPattern =
    /\b(?:books?|novels?|novellas?|short stor|poems?|poetry|plays?|drama|traged|comed|essays?|treatises?|dialogues?|non-fiction|memoirs?|autobiograph|literature|literary|philosophy|history books|antholog|chronicles?|satires?)\b/i;
  const bookLeadPattern =
    /\b(?:is|was)\s+(?:a|an)\s+(?:(?:\d{4}|\d{1,2}(?:st|nd|rd|th)-century|first-century|second-century|third-century|fourth-century|fifth-century|ancient|medieval|classic|modernist|postmodern|didactic|philosophical|historical|political|satirical|gothic|epic|literary|short|non-fiction|incomplete|unfinished|posthumous|debut|seminal|famous|influential|renowned|[a-z-]+)\s+){0,4}(?:novel|novella|book|poem|epic poem|play|tragedy|comedy|dialogue|treatise|essay|collection|anthology|memoir|biography|autobiography|monograph|history|dictionary|encyclopedia|text|work|volume|pamphlet|trilogy|tetralogy|chronicle)\b/i;

  const hasBookCategory = bookCategoryPattern.test(categoryText);
  const hasBookLead = bookLeadPattern.test(lead);

  // Hard rejections for person biographies, list/bibliography stubs, and non-book topics
  if (/\b(?:births|deaths|living people)\b/i.test(categoryText) && !hasBookLead) {
    return -100;
  }
  if (
    /^(?:List of|Bibliography of|Index of)\b|\b(?:bibliography|discography)\b|\(family\)$/i.test(
      wikiTitle,
    ) ||
    /^This (?:article|is a) (?:lists|list of|bibliography)\b|may refer to:/i.test(
      lead,
    )
  ) {
    return -100;
  }
  if (
    /\b(?:is|was)\s+(?:a|an|the)\s+(?:[a-z0-9-]+\s+){0,4}(?:river|country|city|state|island|mountain|locomotive|steam locomotive|railway|political slogan|ideology|advertisement strategy|medical|form of literary art|literary genre|subgenre|bookkeeping|traditional books used in bookkeeping|sea lane|period between|body of music)\b/i.test(
      lead,
    ) &&
    !hasBookLead
  ) {
    return -100;
  }

  let score = 0;

  // 1. Disambiguator in Wikipedia title
  const disambigMatch = wikiTitle.match(/\(([^)]+)\)\s*$/);
  if (disambigMatch) {
    const tag = disambigMatch[1].toLowerCase();
    if (
      /\b(?:novel|novella|book|poem|epic poem|play|drama|short story collection|short stories|essay|essays|treatise|dialogue|memoir|autobiography|biography|philosophy|non-fiction)\b/.test(
        tag,
      )
    ) {
      score += 14;
    } else if (
      /\b(?:film|television|tv series|miniseries|album|song|ep|video game|board game|musical|opera|band|disambiguation)\b/.test(
        tag,
      )
    ) {
      score -= 60;
    }
  }

  // 2. Title similarity (including translated/alternate opening-clause titles)
  const normalizedWikiTitle = normalizeWorkTitle(stripWikiDisambiguator(wikiTitle));
  const titleVariants = getTitleVariants(book?.title);
  const openingSubjectRaw =
    extractText.match(/^.{1,220}?(?=\s+(?:is|was)\s+(?:a|an|the)\b|[.\n]|$)/i)?.[0] ??
    extractText.slice(0, 200);
  const openingSubject = foldAscii(openingSubjectRaw);
  const openingParens = foldAscii(
    [...openingSubjectRaw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]).join(" "),
  );

  const cleanAuthor = stripAuthorAnnotations(book?.author);
  const surname = extractAuthorSurname(book?.author);
  const normalizedAuthor = foldAscii(cleanAuthor);
  const normalizedSurname = foldAscii(surname);
  const isVariousAuthor =
    !cleanAuthor || /^(?:various|anonymous|unknown)$/i.test(cleanAuthor);

  let bestTitleScore = -25;
  for (const expectedTitle of titleVariants) {
    if (!expectedTitle || !normalizedWikiTitle) {
      continue;
    }
    if (normalizedWikiTitle === expectedTitle) {
      bestTitleScore = Math.max(bestTitleScore, 30);
    } else if (
      expectedTitle.length >= 5 &&
      openingSubject.includes(expectedTitle)
    ) {
      bestTitleScore = Math.max(bestTitleScore, 22);
    } else if (
      normalizedWikiTitle.length >= 4 &&
      expectedTitle.length >= 4 &&
      (normalizedWikiTitle.includes(expectedTitle) ||
        expectedTitle.includes(normalizedWikiTitle))
    ) {
      bestTitleScore = Math.max(bestTitleScore, 18);
    } else {
      const expectedTokens = expectedTitle
        .split(/\s+/)
        .filter((token) => token.length > 2 && !TITLE_STOPWORDS.has(token));
      const wikiTokens = new Set(normalizedWikiTitle.split(/\s+/).filter(Boolean));
      if (expectedTokens.length > 0) {
        const overlap = expectedTokens.filter((token) =>
          wikiTokens.has(token),
        ).length;
        if (overlap > 0) {
          const ratio = overlap / expectedTokens.length;
          bestTitleScore = Math.max(bestTitleScore, Math.round(ratio * 16));
        }
      }

      // Check parenthetical English/original subtitle in opening lead for author-prefixed titles (e.g., "Lucretius: The Way Things Are" -> "On the Nature of Things")
      if (
        normalizedSurname &&
        openingParens &&
        expectedTitle.startsWith(`${normalizedSurname} `) &&
        new RegExp(`\\b${normalizedSurname}\\b`).test(leadEvidence)
      ) {
        const strippedTokens = expectedTitle
          .slice(normalizedSurname.length)
          .trim()
          .split(/\s+/)
          .filter((token) => token.length > 2 && !TITLE_STOPWORDS.has(token));
        const parenTokens = new Set(openingParens.split(/\s+/).filter(Boolean));
        if (strippedTokens.length > 0) {
          const parenOverlap = strippedTokens.filter((token) =>
            parenTokens.has(token),
          ).length;
          if (parenOverlap / strippedTokens.length >= 0.5) {
            bestTitleScore = Math.max(bestTitleScore, 14);
          }
        }
      }
    }
  }
  score += bestTitleScore;
  if (bestTitleScore < 12) {
    score -= 35;
  }

  // 3. Author / surname presence in title + lead (not just deep snippet)
  if (!isVariousAuthor) {
    if (normalizedAuthor && leadEvidence.includes(normalizedAuthor)) {
      score += 28;
    } else if (
      normalizedSurname &&
      normalizedSurname.length >= 3 &&
      new RegExp(`\\b${normalizedSurname}\\b`).test(leadEvidence)
    ) {
      score += 20;
    } else if (
      normalizedSurname &&
      normalizedSurname.length >= 3 &&
      new RegExp(`\\b${normalizedSurname}\\b`).test(combinedEvidence)
    ) {
      score += 8;
    } else if (extractText || snippet) {
      score -= 30;
    }

    if (hasTitleOrAuthorMismatch(lead, book)) {
      score -= 45;
    }

    // Penalize author bio pages when the book title isn't the author's name
    if (
      normalizedWikiTitle &&
      (normalizedWikiTitle === normalizedAuthor ||
        normalizedWikiTitle === normalizedSurname) &&
      !titleVariants.some(
        (variant) =>
          variant === normalizedAuthor ||
          (normalizedSurname.length >= 4 && variant.includes(normalizedSurname)),
      )
    ) {
      score -= 40;
    }
  }

  // 4. Literary / scholarly work signals
  if (hasBookCategory) {
    score += 10;
  }
  if (hasBookLead) {
    score += 12;
  }
  if (!hasBookCategory && !hasBookLead) {
    score -= 35;
  }

  // 5. Media penalties (avoid mistaking film/album/game articles for the book)
  const nonBookCategoryPattern =
    /(?:^|\b)(?:\d{4}\s+films?|american\s+films?|british\s+films?|french\s+films?|television\s+series|tv\s+series|studio\s+albums?|soundtrack\s+albums?|video\s+games?|disambiguation\s+pages?)\b/i;
  const nonBookLeadPattern =
    /\b(?:is|was)\s+(?:a|an)\s+(?:\d{4}\s+)?(?:[a-z-]+\s+){0,3}(?:film|movie|motion picture|television series|tv series|miniseries|sitcom|studio album|debut album|album|song|single|video game|board game|role-playing game|musical|opera|rock band|band)\b/i;

  if (
    nonBookCategoryPattern.test(categoryText) &&
    !hasBookLead &&
    !/\badapted into\b/i.test(categoryText)
  ) {
    score -= 45;
  }
  if (nonBookLeadPattern.test(lead)) {
    score -= 55;
  }

  // 6. Person-biography penalty unless the book itself is a biography/autobiography
  const bookIsBiography =
    /\b(?:biography|autobiography|memoir)\b/i.test(book?.sub_category ?? "") ||
    /\b(?:biography|autobiography|memoirs?|confessions|life of|early visions|restless genius|life in letters)\b/i.test(
      book?.title ?? "",
    );

  const pageLooksLikePersonBio =
    (/\b(?:births|deaths|living people)\b/i.test(categoryText) ||
      /\b(?:was|is)\s+(?:a|an)\s+(?:[a-z-]+\s+){0,3}(?:writer|author|novelist|poet|philosopher|historian|playwright|journalist|critic|politician|statesman)\b/i.test(
        lead,
      )) &&
    !hasBookLead &&
    !hasBookCategory;

  if (pageLooksLikePersonBio && !bookIsBiography) {
    score -= 40;
  }

  return score;
}

function isValidPublishYear(year) {
  return (
    typeof year === "number" &&
    Number.isInteger(year) &&
    year !== 0 &&
    year >= MIN_PUBLISH_YEAR &&
    year <= MAX_PUBLISH_YEAR
  );
}

function isSuspiciousPlaceholderYear(year) {
  return year === 1800 || year === 1900;
}

/**
 * Resolves the best publication year from curated classics, Wikidata, Wikipedia prose,
 * Open Library, and existing catalogue values without overwriting valid original dates with newer reprints.
 * @param {{
 *   existingYear?: number | null;
 *   wikidataYear?: number | null;
 *   wikipediaExtractYear?: number | null;
 *   openLibraryYear?: number | null;
 *   classicYear?: number | null;
 *   book?: { title?: string; author?: string } | null;
 * }} [params]
 * @returns {number | null}
 */
export function resolvePublishYear({
  existingYear = null,
  wikidataYear = null,
  wikipediaExtractYear = null,
  openLibraryYear = null,
  classicYear = null,
} = {}) {
  if (isValidPublishYear(classicYear)) {
    return classicYear;
  }

  const currentYear = new Date().getUTCFullYear() + 1;
  const validWikidata = isValidPublishYear(wikidataYear) ? wikidataYear : null;
  const validWikiExtract = isValidPublishYear(wikipediaExtractYear)
    ? wikipediaExtractYear
    : null;
  const validOpenLibrary = isValidPublishYear(openLibraryYear)
    ? openLibraryYear
    : null;

  // Prefer structured Wikidata year unless it looks like a modern reprint while Wikipedia extract found an older original year
  let wikiYear = validWikidata ?? validWikiExtract;
  if (
    validWikidata !== null &&
    validWikiExtract !== null &&
    validWikiExtract < validWikidata - 10 &&
    validWikidata >= 1950
  ) {
    wikiYear = validWikiExtract;
  }

  const nonPlaceholderOpenLibrary =
    validOpenLibrary !== null && !isSuspiciousPlaceholderYear(validOpenLibrary)
      ? validOpenLibrary
      : null;

  if (!isValidPublishYear(existingYear) || existingYear > currentYear) {
    return wikiYear ?? nonPlaceholderOpenLibrary ?? validOpenLibrary ?? null;
  }

  if (isSuspiciousPlaceholderYear(existingYear)) {
    return wikiYear ?? nonPlaceholderOpenLibrary ?? existingYear;
  }

  // Replace a modern reprint year when Wikipedia/Wikidata provides a clearly earlier original year
  if (wikiYear !== null && wikiYear < existingYear - 3) {
    return wikiYear;
  }

  // Never overwrite an already valid original year with a newer reprint date
  return existingYear;
}

/**
 * Normalizes a subject tag to lowercase catalogue form and filters out noise, call numbers,
 * foreign-language library tags, and author self-tags.
 * @param {string} tag
 * @param {{ author?: string } | null} [book]
 * @returns {string | null}
 */
export function normalizeTag(tag, book = null) {
  const rawNormalized = foldAscii(tag);
  if (!rawNormalized || TAG_BLOCKLIST.has(rawNormalized)) {
    return null;
  }

  const normalized = rawNormalized
    .replace(/\bfictional works by one author\b/g, "")
    .replace(/^fiction\s+/, "")
    .replace(/\s+general$/g, "")
    .replace(/\s+traditional$/g, "")
    .replace(/\s+in$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !normalized ||
    normalized.length < 3 ||
    normalized.length > 48 ||
    TAG_BLOCKLIST.has(normalized) ||
    TAG_PHRASE_BLOCKLIST.some((phrase) => normalized.includes(phrase)) ||
    /\b\d{4}\b/.test(normalized) ||
    /\d{3,}/.test(normalized)
  ) {
    return null;
  }

  // Filter "<Language> language" metadata tags without dropping "philosophy of language"
  if (
    /^(?:english|spanish|french|german|italian|portuguese|russian|swedish|japanese|chinese|greek|latin|arabic|polish|dutch|korean|low german|ancient greek)\s+language$/.test(
      normalized,
    )
  ) {
    return null;
  }

  // Filter Library of Congress / Dewey call numbers (e.g. "pq4809 a45 s3713", "hc253 h57", "823 912 f")
  if (
    /^(?:[a-z]{1,3}\d+[a-z0-9\s]*)$/.test(normalized) ||
    /^\d{3}(?:\s+[a-z0-9]+)*$/.test(normalized)
  ) {
    return null;
  }

  if (book?.author) {
    const authorTerms = foldAscii(stripAuthorAnnotations(book.author))
      .split(/\s+/)
      .filter((term) => term.length > 4);
    if (authorTerms.some((term) => normalized.includes(term))) {
      return null;
    }
  }

  const words = normalized.split(" ");
  if (words.length > 5 || words.every((word) => /^\d+$/.test(word))) {
    return null;
  }

  return normalized;
}

/**
 * Normalizes, merges, and deduplicates existing and newly discovered tags up to `MAX_TAGS`.
 * @param {string[] | null | undefined} [existingTags]
 * @param {string[] | null | undefined} [newTags]
 * @param {{ author?: string } | null} [book]
 * @returns {string[]}
 */
export function mergeTags(existingTags = [], newTags = [], book = null) {
  const seen = new Set();
  const merged = [];

  for (const sourceList of [existingTags, newTags]) {
    if (!Array.isArray(sourceList)) {
      continue;
    }
    for (const rawTag of sourceList) {
      const normalized = normalizeTag(rawTag, book);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(normalized);
      if (merged.length >= MAX_TAGS) {
        return merged;
      }
    }
  }

  return merged;
}

/**
 * Non-destructively merges an enrichment record and optional curated `classicYear` into an existing book
 * while keeping identifying and edition fields (`title`, `author`, `shelf`, `position`, etc.) immutable.
 * @template {Record<string, any>} TBook
 * @param {TBook} existingBook
 * @param {{
 *   summary?: string | null;
 *   tags?: string[] | null;
 *   publish_year?: number | null;
 *   wikidataYear?: number | null;
 *   wikipediaExtractYear?: number | null;
 *   openLibraryYear?: number | null;
 *   sources?: {
 *     wikidata?: { publish_year?: number | null } | null;
 *     wikipedia?: { extract_year?: number | null } | null;
 *     open_library?: { first_publish_year?: number | null } | null;
 *   } | null;
 * } | null} [enrichedRecord]
 * @param {number | null} [classicYear]
 * @returns {TBook}
 */
export function mergeEnrichedBook(existingBook, enrichedRecord = null, classicYear = null) {
  const cleanedExistingSummary = cleanSummary(existingBook.summary);
  const existingIsBroken =
    !cleanedExistingSummary ||
    isBrokenSummary(existingBook.summary, existingBook) ||
    isBrokenSummary(cleanedExistingSummary, existingBook);

  const cleanedCandidateSummary = cleanSummary(enrichedRecord?.summary);
  const candidateIsValid = Boolean(
    cleanedCandidateSummary &&
      !isBrokenSummary(cleanedCandidateSummary, existingBook),
  );

  const nextSummary = !existingIsBroken
    ? cleanedExistingSummary
    : candidateIsValid
      ? cleanedCandidateSummary
      : cleanedExistingSummary &&
          !isBrokenSummary(cleanedExistingSummary, existingBook)
        ? cleanedExistingSummary
        : null;

  const wikidataYear =
    enrichedRecord?.wikidataYear ??
    enrichedRecord?.sources?.wikidata?.publish_year ??
    (enrichedRecord &&
    enrichedRecord.wikidataYear === undefined &&
    enrichedRecord.wikipediaExtractYear === undefined &&
    enrichedRecord.sources === undefined &&
    typeof enrichedRecord.publish_year === "number"
      ? enrichedRecord.publish_year
      : null);

  const wikipediaExtractYear =
    enrichedRecord?.wikipediaExtractYear ??
    enrichedRecord?.sources?.wikipedia?.extract_year ??
    null;

  const openLibraryYear =
    enrichedRecord?.openLibraryYear ??
    enrichedRecord?.sources?.open_library?.first_publish_year ??
    null;

  const nextYear = resolvePublishYear({
    existingYear: existingBook.publish_year ?? null,
    wikidataYear,
    wikipediaExtractYear,
    openLibraryYear,
    classicYear,
    book: existingBook,
  });

  const nextTags = mergeTags(existingBook.tags, enrichedRecord?.tags ?? [], existingBook);

  return {
    ...existingBook,
    title: existingBook.title,
    author: existingBook.author,
    shelf: existingBook.shelf,
    position: existingBook.position,
    top_category: existingBook.top_category,
    sub_category: existingBook.sub_category,
    edition: existingBook.edition,
    summary: nextSummary,
    tags: nextTags,
    publish_year: nextYear,
  };
}
