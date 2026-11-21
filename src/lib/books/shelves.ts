import { type CatalogueBook, getBookKey } from "@/lib/books/catalogue";

export type SpineColorTone =
  | "rubric"
  | "pine"
  | "ochre"
  | "navy"
  | "slate"
  | "plum";

export type SpineHeightVariant = "short" | "medium" | "tall";

export type ParsedBookPosition = {
  kind: "standing" | "stack";
  stackLabel: string;
  slot: number;
};

export type ShelfSpine<T extends CatalogueBook = CatalogueBook> = {
  book: T;
  slot: number;
  rawPosition: string;
  colorTone: SpineColorTone;
  heightVariant: SpineHeightVariant;
};

export type ShelfHorizontalStack<T extends CatalogueBook = CatalogueBook> = {
  label: string;
  books: Array<{
    book: T;
    slot: number;
    rawPosition: string;
    colorTone: SpineColorTone;
  }>;
};

export type PhysicalShelfGroup<T extends CatalogueBook = CatalogueBook> = {
  shelf: number;
  totalBooks: number;
  standing: ShelfSpine<T>[];
  stacks: ShelfHorizontalStack<T>[];
};

const SPINE_COLOR_TONES: readonly SpineColorTone[] = [
  "rubric",
  "pine",
  "ochre",
  "navy",
  "slate",
  "plum",
];

const SPINE_HEIGHT_VARIANTS: readonly SpineHeightVariant[] = [
  "short",
  "medium",
  "tall",
];

const STACK_SPATIAL_ORDER: readonly string[] = [
  "Left Stack",
  "Top Stack Left",
  "Top Stack Center",
  "Top Stack",
  "Top Stack Right",
  "Top Stack Far Right",
  "Top Stack Overhead",
  "Overhead Stack A",
  "Overhead Stack B",
  "Front Stack",
  "Desk Stack",
  "Horizontal Stack",
  "Stack",
];

const STACK_ORDER_INDEX = new Map<string, number>(
  STACK_SPATIAL_ORDER.map((label, index) => [label, index]),
);

const labelCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function fnv1a32(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function getBookColorTone(book: CatalogueBook): SpineColorTone {
  const key = getBookKey(book);
  const hash = fnv1a32(`${key}\u0000${book.top_category ?? ""}`, 0x811c9dc5);
  return SPINE_COLOR_TONES[hash % SPINE_COLOR_TONES.length];
}

function getBookHeightVariant(book: CatalogueBook): SpineHeightVariant {
  const key = getBookKey(book);
  const hash = fnv1a32(`${key}\u0000${book.edition}`, 0x9e3779b9);
  return SPINE_HEIGHT_VARIANTS[hash % SPINE_HEIGHT_VARIANTS.length];
}

function parseHorizSlot(position: string): number {
  const horizMatch = /\(Horiz\.?\s*(\d+)\)/i.exec(position);
  if (horizMatch) {
    return Number.parseInt(horizMatch[1], 10);
  }
  return 99;
}

/**
 * Parses physical shelf position descriptions into standing vs horizontal stack coordinates.
 */
export function parseBookPosition(position: string): ParsedBookPosition {
  const trimmed = position.trim();

  if (!trimmed) {
    return { kind: "standing", stackLabel: "Standing", slot: 2000 };
  }

  const verticalMatch = /^Vertical\s*\((\d+)\)$/i.exec(trimmed);
  if (verticalMatch) {
    return {
      kind: "standing",
      stackLabel: "Standing",
      slot: Number.parseInt(verticalMatch[1], 10),
    };
  }

  const verticalRightMatch = /^Vertical\s+Right\s*\((\d+)\)$/i.exec(trimmed);
  if (verticalRightMatch) {
    return {
      kind: "standing",
      stackLabel: "Standing",
      slot: 1000 + Number.parseInt(verticalRightMatch[1], 10),
    };
  }

  if (/^Vertical$/i.test(trimmed)) {
    return { kind: "standing", stackLabel: "Standing", slot: 900 };
  }

  if (/^Center\s+Leaner\s*\(Vert\.?\)$/i.test(trimmed)) {
    return { kind: "standing", stackLabel: "Standing", slot: 950 };
  }

  if (/^Right\s+Anchor\s*\(Vert\.?\)$/i.test(trimmed)) {
    return { kind: "standing", stackLabel: "Standing", slot: 1999 };
  }

  if (/^Top Stack Left\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Top Stack Left",
      slot: parseHorizSlot(trimmed),
    };
  }

  if (/^Top Stack Center\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Top Stack Center",
      slot: parseHorizSlot(trimmed),
    };
  }

  if (/^Top Stack Right\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Top Stack Right",
      slot: parseHorizSlot(trimmed),
    };
  }

  if (/^Top Stack Far Right\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Top Stack Far Right",
      slot: parseHorizSlot(trimmed),
    };
  }

  if (/^Top Stack Overhead\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Top Stack Overhead",
      slot: parseHorizSlot(trimmed),
    };
  }

  const numberedTopStackMatch = /^Top Stack\s+(\d+)\s*\(Horiz\.?\)$/i.exec(
    trimmed,
  );
  if (numberedTopStackMatch) {
    return {
      kind: "stack",
      stackLabel: "Top Stack",
      slot: Number.parseInt(numberedTopStackMatch[1], 10),
    };
  }

  if (/^Top Stack\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Top Stack",
      slot: parseHorizSlot(trimmed),
    };
  }

  if (/^Left Stack\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Left Stack",
      slot: parseHorizSlot(trimmed),
    };
  }

  const horizStackNumMatch = /^Horizontal Stack\s*\((\d+)\)$/i.exec(trimmed);
  if (horizStackNumMatch) {
    return {
      kind: "stack",
      stackLabel: "Horizontal Stack",
      slot: Number.parseInt(horizStackNumMatch[1], 10),
    };
  }

  if (/^Horizontal Stack\s*\(Top\)$/i.test(trimmed)) {
    return { kind: "stack", stackLabel: "Horizontal Stack", slot: 1 };
  }

  if (/^Horizontal Stack\s*\(Base\)$/i.test(trimmed)) {
    return { kind: "stack", stackLabel: "Horizontal Stack", slot: 99 };
  }

  if (/^Horizontal Stack\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Horizontal Stack",
      slot: parseHorizSlot(trimmed),
    };
  }

  if (/^Desk Stack\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Desk Stack",
      slot: parseHorizSlot(trimmed),
    };
  }

  if (/^Front Stack\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Front Stack",
      slot: parseHorizSlot(trimmed),
    };
  }

  if (/^Overhead Stack A\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Overhead Stack A",
      slot: parseHorizSlot(trimmed),
    };
  }

  if (/^Overhead Stack B\b/i.test(trimmed)) {
    return {
      kind: "stack",
      stackLabel: "Overhead Stack B",
      slot: parseHorizSlot(trimmed),
    };
  }

  const genericNumMatch = /\b(\d+)\b/.exec(trimmed);
  return {
    kind: "stack",
    stackLabel: "Stack",
    slot: genericNumMatch ? Number.parseInt(genericNumMatch[1], 10) : 99,
  };
}

/**
 * Groups books into ordered physical shelf elevations with standing spines and horizontal stacks.
 */
export function buildPhysicalShelves<T extends CatalogueBook>(
  books: readonly T[],
): PhysicalShelfGroup<T>[] {
  const shelfBuckets = new Map<
    number,
    {
      standing: ShelfSpine<T>[];
      stacksByLabel: Map<
        string,
        Array<{
          book: T;
          slot: number;
          rawPosition: string;
          colorTone: SpineColorTone;
        }>
      >;
    }
  >();

  for (const book of books) {
    let bucket = shelfBuckets.get(book.shelf);
    if (!bucket) {
      bucket = {
        standing: [],
        stacksByLabel: new Map(),
      };
      shelfBuckets.set(book.shelf, bucket);
    }

    const parsed = parseBookPosition(book.position);
    const colorTone = getBookColorTone(book);

    if (parsed.kind === "standing") {
      bucket.standing.push({
        book,
        slot: parsed.slot,
        rawPosition: book.position,
        colorTone,
        heightVariant: getBookHeightVariant(book),
      });
    } else {
      let stackEntries = bucket.stacksByLabel.get(parsed.stackLabel);
      if (!stackEntries) {
        stackEntries = [];
        bucket.stacksByLabel.set(parsed.stackLabel, stackEntries);
      }
      stackEntries.push({
        book,
        slot: parsed.slot,
        rawPosition: book.position,
        colorTone,
      });
    }
  }

  const compareSlotEntries = <E extends { slot: number; book: T }>(
    first: E,
    second: E,
  ): number =>
    first.slot - second.slot ||
    labelCollator.compare(first.book.title, second.book.title) ||
    labelCollator.compare(first.book.author, second.book.author);

  return [...shelfBuckets.entries()]
    .sort(([shelfA], [shelfB]) => shelfA - shelfB)
    .map(([shelf, bucket]) => {
      const standing = [...bucket.standing].sort(compareSlotEntries);

      const stacks: ShelfHorizontalStack<T>[] = [...bucket.stacksByLabel.entries()]
        .sort(([labelA], [labelB]) => {
          const indexA = STACK_ORDER_INDEX.get(labelA) ?? STACK_SPATIAL_ORDER.length;
          const indexB = STACK_ORDER_INDEX.get(labelB) ?? STACK_SPATIAL_ORDER.length;
          return indexA - indexB || labelCollator.compare(labelA, labelB);
        })
        .map(([label, entries]) => ({
          label,
          books: [...entries].sort(compareSlotEntries),
        }));

      const totalBooks =
        standing.length +
        stacks.reduce((sum, stack) => sum + stack.books.length, 0);

      return {
        shelf,
        totalBooks,
        standing,
        stacks,
      };
    });
}
