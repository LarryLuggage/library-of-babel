import {
  buildTagFrequencyMap,
  type CatalogueBook,
  compareCatalogueBooks,
  filterDisplayTags,
  formatPublishYear,
  getAuthorSortKey,
  getBookKey,
  getCatalogueConnection,
  getDivision,
  resolveEditorialConnectionMap,
} from "./catalogue";
import {
  CONNECTION_TYPE_LABELS,
  type EditorialConnection,
  normalizeConnectionPairKey,
} from "./connections";

export type RecommenderMode = "best_match" | "stretch" | "same_authors";

export type RecommenderEra =
  | ""
  | "antiquity"
  | "early_ce"
  | "1500_1899"
  | "1900_1969"
  | "1970_plus";

export type ShelfRecommendationOptions = {
  mode?: RecommenderMode;
  division?: string;
  era?: RecommenderEra;
  excludeLoaned?: boolean;
  seedBookId?: string | null;
  limit?: number;
};

export type ShelfRecommendation = {
  book: CatalogueBook;
  score: number;
  reasons: string[];
  anchorTitles: string[];
};

export type TasteProfileSummary = {
  ratedCount: number;
  finishedCount: number;
  readingCount: number;
  isPersonalized: boolean;
  topDivisions: string[];
  topTags: string[];
  topAuthors: string[];
};

export type ShelfRecommendationResult = {
  profile: TasteProfileSummary;
  recommendations: ShelfRecommendation[];
  totalUnreadPool: number;
  seedBook: CatalogueBook | null;
};

type WeightedSeed = {
  book: CatalogueBook;
  key: string;
  weight: number;
};

type AuthorAccumulator = {
  weight: number;
  displayName: string;
  anchorTitle: string;
  topSeedWeight: number;
};

type TagAccumulator = {
  weight: number;
  anchorTitle: string;
  topSeedWeight: number;
};

export type InternalTasteProfile = {
  summary: TasteProfileSummary;
  positiveSeeds: WeightedSeed[];
  negativeSeeds: WeightedSeed[];
  authorWeights: Map<string, AuthorAccumulator>;
  divisionWeights: Map<string, number>;
  subCategoryWeights: Map<string, number>;
  topCategoryWeights: Map<string, number>;
  tagWeights: Map<string, TagAccumulator>;
  eraWeights: Map<RecommenderEra, number>;
  exploredDivisions: Set<string>;
  exploredEras: Set<RecommenderEra>;
  positiveSeedYears: Array<{ year: number; weight: number }>;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 24;
const MAX_AUTHOR_CAP = 2;

const GENERIC_AUTHORS = new Set([
  "",
  "#",
  "various",
  "anonymous",
  "unknown",
  "editor",
  "editors",
]);

export function normalizeRecommenderAuthor(author: string): string {
  const trimmed = author.trim();
  if (!trimmed) {
    return "";
  }
  return getAuthorSortKey(trimmed).toLocaleLowerCase("en-US").trim();
}

function isTrackableAuthor(normalizedAuthor: string): boolean {
  return !GENERIC_AUTHORS.has(normalizedAuthor);
}

export function getRecommenderEra(
  year: number | null | undefined,
): RecommenderEra {
  if (year === null || year === undefined || !Number.isFinite(year)) {
    return "";
  }
  const whole = Math.trunc(year);
  if (whole < 0) return "antiquity";
  if (whole <= 1499) return "early_ce";
  if (whole <= 1899) return "1500_1899";
  if (whole <= 1969) return "1900_1969";
  return "1970_plus";
}

export function matchesRecommenderEra(
  year: number | null | undefined,
  era: RecommenderEra,
): boolean {
  if (!era) {
    return true;
  }
  return getRecommenderEra(year) === era;
}

function getTasteSeedWeight(book: CatalogueBook): number {
  if (
    book.reading_status === "dnf" ||
    (book.rating !== null && book.rating <= 2)
  ) {
    return -1.2;
  }

  if (book.rating === 5) return 3.0;
  if (book.rating === 4) return 2.0;
  if (book.rating === 3) return 0.6;

  if (book.reading_status === "finished") return 1.0;
  if (book.reading_status === "reading") return 0.7;

  return 0;
}

function computeTagIdf(tagFreq: number, totalBooks: number): number {
  const safeTotal = Math.max(1, totalBooks);
  const safeFreq = Math.max(1, tagFreq);
  return Math.log(1 + safeTotal / safeFreq);
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function pushUnique(target: string[], value: string, maxItems: number): void {
  if (!value || target.length >= maxItems || target.includes(value)) {
    return;
  }
  target.push(value);
}

/**
 * Builds the reader's taste profile from ratings, finished/reading history, and DNF/low-rated penalties.
 */
export function buildTasteProfile(
  books: readonly CatalogueBook[],
  tagFrequency: ReadonlyMap<string, number>,
): InternalTasteProfile {
  let ratedCount = 0;
  let finishedCount = 0;
  let readingCount = 0;

  const positiveSeeds: WeightedSeed[] = [];
  const negativeSeeds: WeightedSeed[] = [];
  const authorWeights = new Map<string, AuthorAccumulator>();
  const divisionWeights = new Map<string, number>();
  const subCategoryWeights = new Map<string, number>();
  const topCategoryWeights = new Map<string, number>();
  const tagWeights = new Map<string, TagAccumulator>();
  const eraWeights = new Map<RecommenderEra, number>();
  const exploredDivisions = new Set<string>();
  const exploredEras = new Set<RecommenderEra>();
  const positiveSeedYears: Array<{ year: number; weight: number }> = [];

  for (const book of books) {
    if (book.rating !== null) ratedCount += 1;
    if (book.reading_status === "finished") finishedCount += 1;
    if (book.reading_status === "reading") readingCount += 1;

    const weight = getTasteSeedWeight(book);
    if (weight === 0) {
      continue;
    }

    const key = getBookKey(book);
    if (weight > 0) {
      positiveSeeds.push({ book, key, weight });
    } else {
      negativeSeeds.push({ book, key, weight });
    }

    const division = getDivision(book);
    divisionWeights.set(division, (divisionWeights.get(division) ?? 0) + weight);
    if (book.sub_category) {
      subCategoryWeights.set(
        book.sub_category,
        (subCategoryWeights.get(book.sub_category) ?? 0) + weight,
      );
    }
    if (book.top_category) {
      topCategoryWeights.set(
        book.top_category,
        (topCategoryWeights.get(book.top_category) ?? 0) + weight,
      );
    }

    const era = getRecommenderEra(book.publish_year);
    if (era) {
      eraWeights.set(era, (eraWeights.get(era) ?? 0) + weight);
    }

    if (weight > 0) {
      exploredDivisions.add(division);
      if (era) {
        exploredEras.add(era);
      }
      if (book.publish_year !== null) {
        positiveSeedYears.push({ year: book.publish_year, weight });
      }
    }

    const normAuthor = normalizeRecommenderAuthor(book.author);
    if (isTrackableAuthor(normAuthor)) {
      const existing = authorWeights.get(normAuthor);
      if (!existing) {
        authorWeights.set(normAuthor, {
          weight,
          displayName: book.author,
          anchorTitle: weight > 0 ? book.title : "",
          topSeedWeight: weight > 0 ? weight : 0,
        });
      } else {
        existing.weight += weight;
        if (weight > existing.topSeedWeight) {
          existing.topSeedWeight = weight;
          existing.anchorTitle = book.title;
          existing.displayName = book.author;
        }
      }
    }

    for (const tag of filterDisplayTags(book.tags)) {
      const existing = tagWeights.get(tag);
      if (!existing) {
        tagWeights.set(tag, {
          weight,
          anchorTitle: weight > 0 ? book.title : "",
          topSeedWeight: weight > 0 ? weight : 0,
        });
      } else {
        existing.weight += weight;
        if (weight > existing.topSeedWeight) {
          existing.topSeedWeight = weight;
          existing.anchorTitle = book.title;
        }
      }
    }
  }

  const totalBooks = books.length;

  const topDivisions = [...divisionWeights.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([division]) => division);

  const topTags = [...tagWeights.entries()]
    .filter(([, acc]) => acc.weight > 0)
    .map(([tag, acc]) => ({
      tag,
      weightedIdf: acc.weight * computeTagIdf(tagFrequency.get(tag) ?? 1, totalBooks),
    }))
    .sort((a, b) => b.weightedIdf - a.weightedIdf || a.tag.localeCompare(b.tag))
    .slice(0, 6)
    .map((entry) => entry.tag);

  const topAuthors = [...authorWeights.entries()]
    .filter(([, acc]) => acc.weight > 0)
    .sort(
      (a, b) =>
        b[1].weight - a[1].weight ||
        a[1].displayName.localeCompare(b[1].displayName),
    )
    .slice(0, 4)
    .map(([, acc]) => acc.displayName);

  const isPersonalized = positiveSeeds.length > 0 || negativeSeeds.length > 0;

  return {
    summary: {
      ratedCount,
      finishedCount,
      readingCount,
      isPersonalized,
      topDivisions,
      topTags,
      topAuthors,
    },
    positiveSeeds,
    negativeSeeds,
    authorWeights,
    divisionWeights,
    subCategoryWeights,
    topCategoryWeights,
    tagWeights,
    eraWeights,
    exploredDivisions,
    exploredEras,
    positiveSeedYears,
  };
}

/**
 * Evaluates a book's alignment with the reader's taste profile.
 */
export function scoreBookAgainstTasteProfile(
  candidate: CatalogueBook,
  profile: InternalTasteProfile,
  tagFrequency: ReadonlyMap<string, number>,
  totalBooks: number,
  editorialMap?: ReadonlyMap<string, EditorialConnection>,
): { score: number; reasons: string[]; anchorTitles: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const anchorTitles: string[] = [];
  const candidateKey = getBookKey(candidate);

  // 1. Direct curated editorial connections to positive/negative seeds
  if (editorialMap && editorialMap.size > 0) {
    let bestEditorialBoost = 0;
    let bestEditorialReason = "";
    let bestEditorialAnchor = "";

    for (const seed of profile.positiveSeeds) {
      const editorial = editorialMap.get(
        normalizeConnectionPairKey(seed.key, candidateKey),
      );
      if (!editorial) continue;

      const clampedWeight = Math.min(3, Math.max(1, Math.trunc(editorial.weight)));
      const boost = 12 * seed.weight + (clampedWeight - 1) * 2;
      score += boost;

      if (boost > bestEditorialBoost) {
        bestEditorialBoost = boost;
        const label = CONNECTION_TYPE_LABELS[editorial.connection_type];
        bestEditorialReason = editorial.description
          ? `Curator link (${label}) to ${seed.book.title}: ${editorial.description}`
          : `Curator link (${label}) to ${seed.book.title}`;
        bestEditorialAnchor = seed.book.title;
      }
    }

    if (bestEditorialReason) {
      pushUnique(reasons, bestEditorialReason, 4);
      pushUnique(anchorTitles, bestEditorialAnchor, 3);
    }

    for (const seed of profile.negativeSeeds) {
      if (editorialMap.has(normalizeConnectionPairKey(seed.key, candidateKey))) {
        score -= 2.5;
      }
    }
  }

  // 2. Author affinity
  const normAuthor = normalizeRecommenderAuthor(candidate.author);
  if (isTrackableAuthor(normAuthor)) {
    const authorAcc = profile.authorWeights.get(normAuthor);
    if (authorAcc) {
      if (authorAcc.weight > 0) {
        const boost = Math.min(20, authorAcc.weight * 6.5);
        score += boost;
        pushUnique(
          reasons,
          authorAcc.anchorTitle
            ? `Same author as ${authorAcc.anchorTitle} (${candidate.author})`
            : `Unread volume by favorite author ${candidate.author}`,
          4,
        );
        pushUnique(anchorTitles, authorAcc.anchorTitle, 3);
      } else if (authorAcc.weight < 0) {
        score += Math.max(-10, authorAcc.weight * 5);
      }
    }
  }

  // 3. IDF-weighted tag affinity
  const candidateTags = filterDisplayTags(candidate.tags);
  if (candidateTags.length > 0) {
    let positiveTagScore = 0;
    let negativeTagPenalty = 0;
    const matchedPositiveTags: Array<{
      tag: string;
      contribution: number;
      anchorTitle: string;
    }> = [];

    for (const tag of candidateTags) {
      const acc = profile.tagWeights.get(tag);
      if (!acc) continue;
      const idf = computeTagIdf(tagFrequency.get(tag) ?? 1, totalBooks);
      const contribution = acc.weight * idf * 1.1;
      if (contribution > 0) {
        positiveTagScore += contribution;
        matchedPositiveTags.push({
          tag,
          contribution,
          anchorTitle: acc.anchorTitle,
        });
      } else if (contribution < 0) {
        negativeTagPenalty += contribution;
      }
    }

    score += Math.min(18, positiveTagScore);
    score += Math.max(-6, negativeTagPenalty);

    if (matchedPositiveTags.length > 0) {
      matchedPositiveTags.sort(
        (a, b) => b.contribution - a.contribution || a.tag.localeCompare(b.tag),
      );
      const topTagLabels = matchedPositiveTags.slice(0, 3).map((item) => item.tag);
      pushUnique(reasons, `Shared themes: ${topTagLabels.join(", ")}`, 4);
      for (const item of matchedPositiveTags.slice(0, 2)) {
        pushUnique(anchorTitles, item.anchorTitle, 3);
      }
    }
  }

  // 4. Division & sub-category affinity
  const division = getDivision(candidate);
  const divisionWeight = profile.divisionWeights.get(division) ?? 0;
  const subWeight = candidate.sub_category
    ? (profile.subCategoryWeights.get(candidate.sub_category) ?? 0)
    : 0;
  const topWeight = candidate.top_category
    ? (profile.topCategoryWeights.get(candidate.top_category) ?? 0)
    : 0;

  const combinedCategoryWeight = divisionWeight * 1.1 + subWeight * 0.6 + topWeight * 0.35;
  if (combinedCategoryWeight > 0) {
    score += Math.min(8, combinedCategoryWeight);
    pushUnique(reasons, `Matches your interest in ${division}`, 4);
  } else if (combinedCategoryWeight < 0) {
    score += Math.max(-4, combinedCategoryWeight * 0.7);
  }

  // 5. Era proximity
  if (candidate.publish_year !== null) {
    const era = getRecommenderEra(candidate.publish_year);
    const eraWeight = era ? (profile.eraWeights.get(era) ?? 0) : 0;

    let closestYearBonus = 0;
    for (const seedYear of profile.positiveSeedYears) {
      const gap = Math.abs(candidate.publish_year - seedYear.year);
      if (gap <= 25) {
        closestYearBonus = Math.max(closestYearBonus, 2.2);
      } else if (gap <= 60) {
        closestYearBonus = Math.max(closestYearBonus, 1.2);
      }
    }

    const eraScore =
      (eraWeight > 0 ? Math.min(2.5, eraWeight * 0.5) : Math.max(-1.5, eraWeight * 0.4)) +
      closestYearBonus;
    score += eraScore;

    if (eraScore >= 2) {
      pushUnique(
        reasons,
        `From an era you enjoy (${formatPublishYear(candidate.publish_year)})`,
        4,
      );
    }
  }

  // 6. Gentle metadata richness bonus
  if (candidate.summary) score += 0.6;
  if (candidate.publish_year !== null) score += 0.2;
  if (candidateTags.length > 0) score += 0.2;

  return { score, reasons, anchorTitles };
}

function scoreSeedModeCandidate(
  seedBook: CatalogueBook,
  candidate: CatalogueBook,
  profile: InternalTasteProfile,
  tagFrequency: ReadonlyMap<string, number>,
  totalBooks: number,
  editorialMap?: ReadonlyMap<string, EditorialConnection>,
): ShelfRecommendation {
  const reasons: string[] = [];
  const anchorTitles: string[] = [seedBook.title];
  const seedKey = getBookKey(seedBook);
  const candidateKey = getBookKey(candidate);

  const connection = getCatalogueConnection(
    seedBook,
    candidate,
    tagFrequency,
    editorialMap,
  );
  let score = connection?.score ?? 0;

  const editorial = editorialMap?.get(
    normalizeConnectionPairKey(seedKey, candidateKey),
  );
  if (editorial) {
    const label = CONNECTION_TYPE_LABELS[editorial.connection_type];
    pushUnique(
      reasons,
      editorial.description
        ? `Curator link to ${seedBook.title} (${label}): ${editorial.description}`
        : `Curator link to ${seedBook.title} (${label})`,
      4,
    );
  }

  const seedNormAuthor = normalizeRecommenderAuthor(seedBook.author);
  const candidateNormAuthor = normalizeRecommenderAuthor(candidate.author);
  if (
    isTrackableAuthor(seedNormAuthor) &&
    seedNormAuthor === candidateNormAuthor
  ) {
    if (seedBook.author !== candidate.author) {
      score += 14;
    }
    pushUnique(reasons, `Same author as ${seedBook.title}`, 4);
  }

  const candidateTags = new Set(filterDisplayTags(candidate.tags));
  const sharedTags = filterDisplayTags(seedBook.tags)
    .filter((tag) => candidateTags.has(tag))
    .sort(
      (a, b) =>
        (tagFrequency.get(a) ?? 999) - (tagFrequency.get(b) ?? 999) ||
        a.localeCompare(b),
    );
  if (sharedTags.length > 0) {
    pushUnique(reasons, `Shared themes: ${sharedTags.slice(0, 3).join(", ")}`, 4);
  }

  const seedDivision = getDivision(seedBook);
  const candidateDivision = getDivision(candidate);
  if (seedDivision === candidateDivision) {
    if (!seedBook.sub_category || seedBook.sub_category !== candidate.sub_category) {
      score += 4;
    }
    pushUnique(reasons, `Same division (${candidateDivision})`, 4);
  }

  if (seedBook.publish_year !== null && candidate.publish_year !== null) {
    const gap = Math.abs(seedBook.publish_year - candidate.publish_year);
    if (gap <= 40) {
      score += 2.5;
      pushUnique(
        reasons,
        `Contemporary era (${formatPublishYear(candidate.publish_year)})`,
        4,
      );
    }
  }

  if (profile.summary.isPersonalized) {
    const taste = scoreBookAgainstTasteProfile(
      candidate,
      profile,
      tagFrequency,
      totalBooks,
      editorialMap,
    );
    const gentleTasteBoost = Math.max(-3, Math.min(6, taste.score * 0.25));
    score += gentleTasteBoost;
    if (gentleTasteBoost >= 2) {
      pushUnique(reasons, "Aligned with your reading history", 4);
    }
  }

  if (candidate.summary) score += 0.5;
  if (candidate.publish_year !== null) score += 0.25;
  if (candidateTags.size > 0) score += 0.25;

  if (reasons.length === 0) {
    reasons.push(`Unread companion in ${candidateDivision}`);
  }

  return {
    book: candidate,
    score: roundScore(score),
    reasons,
    anchorTitles,
  };
}

function scoreStretchCandidate(
  candidate: CatalogueBook,
  profile: InternalTasteProfile,
  tagFrequency: ReadonlyMap<string, number>,
  editorialMap?: ReadonlyMap<string, EditorialConnection>,
): ShelfRecommendation {
  let score = 0;
  const reasons: string[] = [];
  const anchorTitles: string[] = [];
  const division = getDivision(candidate);
  const era = getRecommenderEra(candidate.publish_year);
  const tags = filterDisplayTags(candidate.tags);
  const normAuthor = normalizeRecommenderAuthor(candidate.author);

  // Reward well-annotated unread books
  if (candidate.summary) score += 5;
  if (tags.length > 0) score += Math.min(4, tags.length * 1.2);
  if (candidate.publish_year !== null) score += 1.5;

  // Reward under-explored division
  if (!profile.exploredDivisions.has(division)) {
    score += 9;
    pushUnique(reasons, `Unexplored division: ${division}`, 4);
  } else {
    const divWeight = profile.divisionWeights.get(division) ?? 0;
    if (divWeight <= 1) {
      score += 3;
      pushUnique(reasons, `Lightly explored division: ${division}`, 4);
    } else {
      score -= Math.min(5, divWeight * 0.9);
    }
  }

  // Reward under-explored era
  if (era && !profile.exploredEras.has(era)) {
    score += 6;
    pushUnique(
      reasons,
      `New era to explore (${formatPublishYear(candidate.publish_year)})`,
      4,
    );
  }

  // Discourage already-read authors in stretch mode
  if (isTrackableAuthor(normAuthor)) {
    const authorAcc = profile.authorWeights.get(normAuthor);
    if (authorAcc && authorAcc.weight > 0) {
      score -= 4.5;
    } else if (authorAcc && authorAcc.weight < 0) {
      score -= 6;
    }
  }

  // Subtle bridge: 1-2 shared themes or a curator link to a positive seed
  if (editorialMap && editorialMap.size > 0) {
    const candidateKey = getBookKey(candidate);
    for (const seed of profile.positiveSeeds) {
      if (editorialMap.has(normalizeConnectionPairKey(seed.key, candidateKey))) {
        score += 5;
        pushUnique(reasons, `Curator bridge from ${seed.book.title}`, 4);
        pushUnique(anchorTitles, seed.book.title, 3);
        break;
      }
    }
  }

  const bridgingTags = tags
    .filter((tag) => (profile.tagWeights.get(tag)?.weight ?? 0) > 0)
    .sort(
      (a, b) =>
        (tagFrequency.get(a) ?? 999) - (tagFrequency.get(b) ?? 999) ||
        a.localeCompare(b),
    );
  if (bridgingTags.length > 0) {
    score += bridgingTags.length <= 2 ? 3.5 : 2;
    const bridgeTag = bridgingTags[0];
    pushUnique(reasons, `Bridges your interest in ${bridgeTag}`, 4);
    const anchor = profile.tagWeights.get(bridgeTag)?.anchorTitle ?? "";
    pushUnique(anchorTitles, anchor, 3);
  }

  if (reasons.length === 0) {
    reasons.push(`Distinct voice in ${division}`);
  }

  return {
    book: candidate,
    score: roundScore(score),
    reasons,
    anchorTitles,
  };
}

function buildConnectionCounts(
  connections: readonly EditorialConnection[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const conn of connections) {
    counts.set(conn.source_book_id, (counts.get(conn.source_book_id) ?? 0) + 1);
    counts.set(conn.target_book_id, (counts.get(conn.target_book_id) ?? 0) + 1);
  }
  return counts;
}

function buildAuthorCatalogueCounts(
  books: readonly CatalogueBook[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const book of books) {
    const normAuthor = normalizeRecommenderAuthor(book.author);
    if (!isTrackableAuthor(normAuthor)) continue;
    counts.set(normAuthor, (counts.get(normAuthor) ?? 0) + 1);
  }
  return counts;
}

function selectWithDiversity(
  ranked: readonly ShelfRecommendation[],
  limit: number,
  options: { maxPerAuthor: number | null; balanceDivisions?: boolean },
): ShelfRecommendation[] {
  const selected: ShelfRecommendation[] = [];
  const authorCounts = new Map<string, number>();
  const divisionCounts = new Map<string, number>();

  const canTakeAuthor = (book: CatalogueBook): boolean => {
    if (options.maxPerAuthor === null) return true;
    const normAuthor = normalizeRecommenderAuthor(book.author);
    if (!isTrackableAuthor(normAuthor)) return true;
    return (authorCounts.get(normAuthor) ?? 0) < options.maxPerAuthor;
  };

  const recordBook = (item: ShelfRecommendation): void => {
    selected.push(item);
    const normAuthor = normalizeRecommenderAuthor(item.book.author);
    if (isTrackableAuthor(normAuthor)) {
      authorCounts.set(normAuthor, (authorCounts.get(normAuthor) ?? 0) + 1);
    }
    const division = getDivision(item.book);
    divisionCounts.set(division, (divisionCounts.get(division) ?? 0) + 1);
  };

  if (options.balanceDivisions) {
    // First pass: at most 2 per division to ensure balanced cold-start spread
    const deferred: ShelfRecommendation[] = [];
    for (const item of ranked) {
      if (selected.length >= limit) break;
      if (!canTakeAuthor(item.book)) continue;

      const division = getDivision(item.book);
      if ((divisionCounts.get(division) ?? 0) >= 2) {
        deferred.push(item);
        continue;
      }
      recordBook(item);
    }

    for (const item of deferred) {
      if (selected.length >= limit) break;
      if (!canTakeAuthor(item.book)) continue;
      recordBook(item);
    }

    return selected;
  }

  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (!canTakeAuthor(item.book)) continue;
    recordBook(item);
  }

  return selected;
}

export function getShelfRecommendations(
  books: readonly CatalogueBook[],
  connections: readonly EditorialConnection[] = [],
  options: ShelfRecommendationOptions = {},
): ShelfRecommendationResult {
  const mode: RecommenderMode = options.mode ?? "best_match";
  const divisionFilter = options.division?.trim() ?? "";
  const eraFilter: RecommenderEra = options.era ?? "";
  const excludeLoaned = options.excludeLoaned !== false;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)),
  );

  const tagFrequency = buildTagFrequencyMap(books);
  const editorialMap = resolveEditorialConnectionMap(connections);
  const profile = buildTasteProfile(books, tagFrequency);

  const requestedSeedId = options.seedBookId?.trim() ?? "";
  const seedBook = requestedSeedId
    ? books.find(
        (book) =>
          book.id === requestedSeedId || getBookKey(book) === requestedSeedId,
      ) ?? null
    : null;
  const seedKey = seedBook ? getBookKey(seedBook) : null;

  const candidatePool = books.filter((book) => {
    if (book.reading_status !== "unread") return false;
    if (seedKey && getBookKey(book) === seedKey) return false;
    if (excludeLoaned && Boolean(book.loaned_to)) return false;
    if (divisionFilter && getDivision(book) !== divisionFilter) return false;
    if (eraFilter && !matchesRecommenderEra(book.publish_year, eraFilter)) {
      return false;
    }
    return true;
  });

  const totalUnreadPool = candidatePool.length;

  if (totalUnreadPool === 0) {
    return {
      profile: profile.summary,
      recommendations: [],
      totalUnreadPool: 0,
      seedBook,
    };
  }

  // 1. Seed-book anchored mode
  if (seedBook) {
    const scored = candidatePool
      .map((candidate) =>
        scoreSeedModeCandidate(
          seedBook,
          candidate,
          profile,
          tagFrequency,
          books.length,
          editorialMap,
        ),
      )
      .sort(
        (a, b) => b.score - a.score || compareCatalogueBooks(a.book, b.book),
      );

    return {
      profile: profile.summary,
      recommendations: selectWithDiversity(scored, limit, {
        maxPerAuthor: MAX_AUTHOR_CAP,
      }),
      totalUnreadPool,
      seedBook,
    };
  }

  // 2. Same-authors mode
  if (mode === "same_authors") {
    const positiveAuthors = new Set<string>();
    for (const [normAuthor, acc] of profile.authorWeights.entries()) {
      if (acc.weight > 0) {
        positiveAuthors.add(normAuthor);
      }
    }

    let targetAuthors = positiveAuthors;
    const isColdStartFallback = targetAuthors.size === 0;
    const authorCatalogueCounts = buildAuthorCatalogueCounts(books);

    if (isColdStartFallback) {
      targetAuthors = new Set<string>();
      for (const [normAuthor, count] of authorCatalogueCounts.entries()) {
        if (count >= 2) {
          targetAuthors.add(normAuthor);
        }
      }
    }

    const matchingCandidates = candidatePool.filter((book) =>
      targetAuthors.has(normalizeRecommenderAuthor(book.author)),
    );

    const scored: ShelfRecommendation[] = matchingCandidates
      .map((candidate) => {
        const normAuthor = normalizeRecommenderAuthor(candidate.author);
        const authorAcc = profile.authorWeights.get(normAuthor);
        const taste = profile.summary.isPersonalized
          ? scoreBookAgainstTasteProfile(
              candidate,
              profile,
              tagFrequency,
              books.length,
              editorialMap,
            )
          : { score: 0, reasons: [], anchorTitles: [] };

        const catalogueCount = authorCatalogueCounts.get(normAuthor) ?? 1;
        const baseScore = authorAcc
          ? authorAcc.weight * 10 + taste.score * 0.5
          : catalogueCount * 3 +
            (candidate.summary ? 2 : 0) +
            (candidate.publish_year !== null ? 1 : 0);

        const reasons: string[] = [];
        const anchorTitles: string[] = [];

        if (authorAcc && authorAcc.anchorTitle) {
          pushUnique(
            reasons,
            `Unread volume by ${candidate.author} (after ${authorAcc.anchorTitle})`,
            4,
          );
          pushUnique(anchorTitles, authorAcc.anchorTitle, 3);
        } else if (isColdStartFallback) {
          pushUnique(
            reasons,
            `Collected author (${catalogueCount} volumes on your shelves)`,
            4,
          );
        } else {
          pushUnique(reasons, `Unread volume by ${candidate.author}`, 4);
        }

        for (const reason of taste.reasons) {
          if (!reason.startsWith("Same author as ")) {
            pushUnique(reasons, reason, 4);
          }
        }
        for (const anchor of taste.anchorTitles) {
          pushUnique(anchorTitles, anchor, 3);
        }

        return {
          book: candidate,
          score: roundScore(baseScore),
          reasons,
          anchorTitles,
        };
      })
      .sort(
        (a, b) => b.score - a.score || compareCatalogueBooks(a.book, b.book),
      );

    return {
      profile: profile.summary,
      recommendations: selectWithDiversity(scored, limit, {
        maxPerAuthor: null,
      }),
      totalUnreadPool,
      seedBook: null,
    };
  }

  // 3. Stretch mode
  if (mode === "stretch") {
    const scored = candidatePool
      .map((candidate) =>
        scoreStretchCandidate(candidate, profile, tagFrequency, editorialMap),
      )
      .sort(
        (a, b) => b.score - a.score || compareCatalogueBooks(a.book, b.book),
      );

    return {
      profile: profile.summary,
      recommendations: selectWithDiversity(scored, limit, {
        maxPerAuthor: MAX_AUTHOR_CAP,
        balanceDivisions: !profile.summary.isPersonalized,
      }),
      totalUnreadPool,
      seedBook: null,
    };
  }

  // 4. Cold-start fallback for best_match when no reading/rating history exists
  if (!profile.summary.isPersonalized) {
    const connectionCounts = buildConnectionCounts(connections);
    const authorCatalogueCounts = buildAuthorCatalogueCounts(books);

    const scored: ShelfRecommendation[] = candidatePool
      .map((candidate) => {
        const reasons: string[] = [];
        const tags = filterDisplayTags(candidate.tags);
        const connCount =
          connectionCounts.get(candidate.id) ??
          connectionCounts.get(getBookKey(candidate)) ??
          0;
        const normAuthor = normalizeRecommenderAuthor(candidate.author);
        const authorCount = authorCatalogueCounts.get(normAuthor) ?? 1;

        let score = 0;
        if (connCount > 0) {
          score += connCount * 6;
          pushUnique(
            reasons,
            connCount === 1
              ? "Curated editorial link in your catalogue"
              : `${connCount} curated editorial links in your catalogue`,
            4,
          );
        }

        if (candidate.summary) {
          score += 4;
          pushUnique(reasons, `Annotated entry in ${getDivision(candidate)}`, 4);
        }

        if (tags.length > 0) {
          score += Math.min(4, tags.length);
          pushUnique(reasons, `Topics: ${tags.slice(0, 3).join(", ")}`, 4);
        }

        if (candidate.publish_year !== null) {
          score += 2;
          pushUnique(
            reasons,
            `Published ${formatPublishYear(candidate.publish_year)}`,
            4,
          );
        }

        if (authorCount >= 2) {
          score += 1.5;
        }

        if (reasons.length === 0) {
          reasons.push(`Unread volume in ${getDivision(candidate)}`);
        }

        return {
          book: candidate,
          score: roundScore(score),
          reasons,
          anchorTitles: [],
        };
      })
      .sort(
        (a, b) => b.score - a.score || compareCatalogueBooks(a.book, b.book),
      );

    return {
      profile: profile.summary,
      recommendations: selectWithDiversity(scored, limit, {
        maxPerAuthor: MAX_AUTHOR_CAP,
        balanceDivisions: true,
      }),
      totalUnreadPool,
      seedBook: null,
    };
  }

  // 5. Personalized best_match
  const scored: ShelfRecommendation[] = candidatePool
    .map((candidate) => {
      const result = scoreBookAgainstTasteProfile(
        candidate,
        profile,
        tagFrequency,
        books.length,
        editorialMap,
      );

      const reasons =
        result.reasons.length > 0
          ? result.reasons
          : [`Unread volume in ${getDivision(candidate)}`];

      return {
        book: candidate,
        score: roundScore(result.score),
        reasons,
        anchorTitles: result.anchorTitles,
      };
    })
    .sort((a, b) => b.score - a.score || compareCatalogueBooks(a.book, b.book));

  return {
    profile: profile.summary,
    recommendations: selectWithDiversity(scored, limit, {
      maxPerAuthor: MAX_AUTHOR_CAP,
    }),
    totalUnreadPool,
    seedBook: null,
  };
}
