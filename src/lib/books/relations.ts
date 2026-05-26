import {
  type CatalogueBook,
  type CatalogueConnection,
  getBookKey,
  getCatalogueConnection,
} from "./catalogue";

export type PathfinderPathStep = {
  book: CatalogueBook;
  reasons: string[];
  score: number;
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
};

/**
 * Performs BFS graph traversal to find the shortest path of connections between two books,
 * prioritizing highest connection scores in case of path length ties.
 */
export function getPathfinderConnection(
  source: CatalogueBook,
  target: CatalogueBook,
  books: CatalogueBook[],
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

  // BFS Queue level-by-level
  let currentLevel = [source];

  // state stores visited info: key -> { book, distance, scoreSum, parent, connection }
  const state = new Map<
    string,
    {
      book: CatalogueBook;
      distance: number;
      scoreSum: number;
      parent: CatalogueBook | null;
      connection: CatalogueConnection | null;
    }
  >();

  state.set(sourceKey, {
    book: source,
    distance: 0,
    scoreSum: 0,
    parent: null,
    connection: null,
  });

  let distance = 0;
  let foundTarget = false;

  while (currentLevel.length > 0 && !foundTarget) {
    distance++;
    const nextLevelMap = new Map<
      string,
      {
        book: CatalogueBook;
        scoreSum: number;
        parent: CatalogueBook;
        connection: CatalogueConnection;
      }
    >();

    for (const curr of currentLevel) {
      const currKey = getBookKey(curr);
      const currState = state.get(currKey)!;

      for (const candidate of books) {
        const candidateKey = getBookKey(candidate);

        // Skip if already visited in previous levels
        if (state.has(candidateKey)) {
          continue;
        }

        const conn = getCatalogueConnection(curr, candidate);
        if (!conn) {
          continue;
        }

        const candidateScoreSum = currState.scoreSum + conn.score;

        const existing = nextLevelMap.get(candidateKey);
        if (!existing || candidateScoreSum > existing.scoreSum) {
          nextLevelMap.set(candidateKey, {
            book: candidate,
            scoreSum: candidateScoreSum,
            parent: curr,
            connection: conn,
          });
        }
      }
    }

    const nextLevel: CatalogueBook[] = [];
    for (const [key, val] of nextLevelMap.entries()) {
      state.set(key, {
        book: val.book,
        distance,
        scoreSum: val.scoreSum,
        parent: val.parent,
        connection: val.connection,
      });
      nextLevel.push(val.book);
      if (key === targetKey) {
        foundTarget = true;
      }
    }

    currentLevel = nextLevel;
  }

  if (!state.has(targetKey)) {
    return null;
  }

  // Reconstruct path
  const pathSteps: PathfinderPathStep[] = [];
  let currKey = targetKey;

  while (currKey) {
    const currState = state.get(currKey);
    if (!currState) {
      break;
    }

    pathSteps.unshift({
      book: currState.book,
      reasons: currState.connection ? currState.connection.reasons : [],
      score: currState.connection ? currState.connection.score : 0,
    });

    currKey = currState.parent ? getBookKey(currState.parent) : "";
  }

  return pathSteps;
}

/**
 * Calculates tag frequencies and overlap links for the tag map constellation view.
 */
export function getTagCooccurrences(books: CatalogueBook[]): TagCooccurrenceData {
  const tagCounts = new Map<string, number>();
  const cooccurrenceCounts = new Map<string, number>();

  for (const book of books) {
    const tags = book.tags ?? [];
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    // Undirected pairs
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const tagA = tags[i];
        const tagB = tags[j];
        const key = tagA < tagB ? `${tagA}\u0000${tagB}` : `${tagB}\u0000${tagA}`;
        cooccurrenceCounts.set(key, (cooccurrenceCounts.get(key) || 0) + 1);
      }
    }
  }

  const nodes: TagNode[] = Array.from(tagCounts.entries()).map(([tag, count]) => ({
    tag,
    count,
  }));

  const links: TagLink[] = Array.from(cooccurrenceCounts.entries()).map(([key, count]) => {
    const [source, target] = key.split("\u0000");
    return {
      source,
      target,
      count,
    };
  });

  return { nodes, links };
}
