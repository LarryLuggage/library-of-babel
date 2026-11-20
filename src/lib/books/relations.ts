import {
  buildTagFrequencyMap,
  type CatalogueBook,
  compareCatalogueBooks,
  filterDisplayTags,
  getBookKey,
  getCatalogueConnection,
} from "./catalogue";

export type PathfinderPathStep = {
  book: CatalogueBook;
  reasons: string[];
  score: number;
};

export type CatalogueEdge = {
  book: CatalogueBook;
  reasons: string[];
  score: number;
};

export type CatalogueGraph = {
  tagFrequency: Map<string, number>;
  booksByKey: Map<string, CatalogueBook>;
  highSignalEdges: Map<string, CatalogueEdge[]>;
  allEdges: Map<string, CatalogueEdge[]>;
};

export type TagNode = {
  tag: string;
  count: number;
};

export type TagLink = {
  source: string;
  target: string;
  count: number;
};

export type TagCooccurrenceData = {
  nodes: TagNode[];
  links: TagLink[];
  tagCounts: Map<string, number>;
  cooccurrenceMap: Map<string, Map<string, number>>;
};

const ALL_EDGES_MIN_SCORE = 2;
const HIGH_SIGNAL_MIN_SCORE = 4;

function compareEdges(first: CatalogueEdge, second: CatalogueEdge): number {
  return (
    second.score - first.score ||
    compareCatalogueBooks(first.book, second.book)
  );
}

/**
 * Builds an undirected similarity graph once from the catalogue, splitting
 * edges into high-signal connections (score >= 4) and all connections (score >= 2).
 */
export function buildCatalogueGraph(
  books: readonly CatalogueBook[],
): CatalogueGraph {
  const tagFrequency = buildTagFrequencyMap(books);
  const booksByKey = new Map<string, CatalogueBook>();
  const highSignalEdges = new Map<string, CatalogueEdge[]>();
  const allEdges = new Map<string, CatalogueEdge[]>();

  for (const book of books) {
    const key = getBookKey(book);
    if (!booksByKey.has(key)) {
      booksByKey.set(key, book);
      highSignalEdges.set(key, []);
      allEdges.set(key, []);
    }
  }

  const uniqueBooks = [...booksByKey.values()];

  for (let i = 0; i < uniqueBooks.length; i += 1) {
    const first = uniqueBooks[i];
    const firstKey = getBookKey(first);

    for (let j = i + 1; j < uniqueBooks.length; j += 1) {
      const second = uniqueBooks[j];
      const connectionAB = getCatalogueConnection(first, second, tagFrequency);

      if (!connectionAB || connectionAB.score < ALL_EDGES_MIN_SCORE) {
        continue;
      }

      const secondKey = getBookKey(second);
      const connectionBA = getCatalogueConnection(second, first, tagFrequency);

      const edgeAB: CatalogueEdge = {
        book: second,
        reasons: connectionAB.reasons,
        score: connectionAB.score,
      };
      const edgeBA: CatalogueEdge = {
        book: first,
        reasons: connectionBA?.reasons ?? connectionAB.reasons,
        score: connectionAB.score,
      };

      allEdges.get(firstKey)!.push(edgeAB);
      allEdges.get(secondKey)!.push(edgeBA);

      if (connectionAB.score >= HIGH_SIGNAL_MIN_SCORE) {
        highSignalEdges.get(firstKey)!.push(edgeAB);
        highSignalEdges.get(secondKey)!.push(edgeBA);
      }
    }
  }

  for (const edges of allEdges.values()) {
    edges.sort(compareEdges);
  }
  for (const edges of highSignalEdges.values()) {
    edges.sort(compareEdges);
  }

  return {
    tagFrequency,
    booksByKey,
    highSignalEdges,
    allEdges,
  };
}

function findShortestHighestScorePath(
  source: CatalogueBook,
  targetKey: string,
  edgesByKey: ReadonlyMap<string, readonly CatalogueEdge[]>,
): PathfinderPathStep[] | null {
  const sourceKey = getBookKey(source);

  if (!edgesByKey.has(sourceKey) || !edgesByKey.has(targetKey)) {
    return null;
  }

  const visited = new Map<
    string,
    {
      book: CatalogueBook;
      scoreSum: number;
      parentKey: string | null;
      reasons: string[];
      score: number;
    }
  >();

  visited.set(sourceKey, {
    book: source,
    scoreSum: 0,
    parentKey: null,
    reasons: [],
    score: 0,
  });

  const queue: string[] = [sourceKey];
  let head = 0;

  while (head < queue.length) {
    const levelEnd = queue.length;
    const nextLevelBest = new Map<
      string,
      {
        book: CatalogueBook;
        scoreSum: number;
        parentKey: string;
        reasons: string[];
        score: number;
      }
    >();

    while (head < levelEnd) {
      const currKey = queue[head++];
      const currState = visited.get(currKey)!;
      const neighbors = edgesByKey.get(currKey) ?? [];

      for (const edge of neighbors) {
        const nextKey = getBookKey(edge.book);
        if (visited.has(nextKey)) {
          continue;
        }

        const candidateScoreSum = currState.scoreSum + edge.score;
        const existing = nextLevelBest.get(nextKey);

        if (!existing || candidateScoreSum > existing.scoreSum) {
          nextLevelBest.set(nextKey, {
            book: edge.book,
            scoreSum: candidateScoreSum,
            parentKey: currKey,
            reasons: edge.reasons,
            score: edge.score,
          });
        }
      }
    }

    for (const [nextKey, nextState] of nextLevelBest.entries()) {
      visited.set(nextKey, nextState);
      queue.push(nextKey);
    }

    if (nextLevelBest.has(targetKey)) {
      break;
    }
  }

  if (!visited.has(targetKey)) {
    return null;
  }

  const reversedPath: PathfinderPathStep[] = [];
  let cursorKey: string | null = targetKey;

  while (cursorKey) {
    const step = visited.get(cursorKey);
    if (!step) {
      break;
    }
    reversedPath.push({
      book: step.book,
      reasons: step.reasons,
      score: step.score,
    });
    cursorKey = step.parentKey;
  }

  return reversedPath.reverse();
}

/**
 * Finds the shortest path of semantic connections between two books,
 * maximizing cumulative score on shortest-hop ties. Searches high-signal edges
 * (score >= 4) first, falling back to all edges (score >= 2) if disconnected.
 */
export function getPathfinderConnection(
  source: CatalogueBook,
  target: CatalogueBook,
  books: readonly CatalogueBook[],
  graph?: CatalogueGraph,
): PathfinderPathStep[] | null {
  const sourceKey = getBookKey(source);
  const targetKey = getBookKey(target);

  if (sourceKey === targetKey) {
    return [
      {
        book: source,
        reasons: [],
        score: 0,
      },
    ];
  }

  const resolvedGraph = graph ?? buildCatalogueGraph(books);

  return (
    findShortestHighestScorePath(
      source,
      targetKey,
      resolvedGraph.highSignalEdges,
    ) ??
    findShortestHighestScorePath(source, targetKey, resolvedGraph.allEdges)
  );
}

/**
 * Calculates noise-free tag frequencies, co-occurrence links, and an O(1)
 * lookup map for the tag constellation view.
 */
export function getTagCooccurrences(
  books: readonly CatalogueBook[],
): TagCooccurrenceData {
  const tagCounts = new Map<string, number>();
  const cooccurrenceCounts = new Map<string, number>();
  const cooccurrenceMap = new Map<string, Map<string, number>>();

  const getTagNeighbors = (tag: string) => {
    let map = cooccurrenceMap.get(tag);
    if (!map) {
      map = new Map<string, number>();
      cooccurrenceMap.set(tag, map);
    }
    return map;
  };

  for (const book of books) {
    const tags = filterDisplayTags(book.tags);

    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      getTagNeighbors(tag);
    }

    for (let i = 0; i < tags.length; i += 1) {
      for (let j = i + 1; j < tags.length; j += 1) {
        const tagA = tags[i];
        const tagB = tags[j];

        const neighborsA = getTagNeighbors(tagA);
        neighborsA.set(tagB, (neighborsA.get(tagB) ?? 0) + 1);

        const neighborsB = getTagNeighbors(tagB);
        neighborsB.set(tagA, (neighborsB.get(tagA) ?? 0) + 1);

        const pairKey =
          tagA < tagB ? `${tagA}\u0000${tagB}` : `${tagB}\u0000${tagA}`;
        cooccurrenceCounts.set(
          pairKey,
          (cooccurrenceCounts.get(pairKey) ?? 0) + 1,
        );
      }
    }
  }

  const nodes: TagNode[] = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort(
      (first, second) =>
        second.count - first.count || first.tag.localeCompare(second.tag),
    );

  const links: TagLink[] = Array.from(cooccurrenceCounts.entries())
    .map(([key, count]) => {
      const [source, target] = key.split("\u0000");
      return { source, target, count };
    })
    .sort(
      (first, second) =>
        second.count - first.count ||
        first.source.localeCompare(second.source) ||
        first.target.localeCompare(second.target),
    );

  return {
    nodes,
    links,
    tagCounts,
    cooccurrenceMap,
  };
}
