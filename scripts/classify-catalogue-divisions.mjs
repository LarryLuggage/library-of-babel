import { readFile, writeFile } from "node:fs/promises";

const SUBJECTS_PATH =
  process.argv[2] ?? "/private/tmp/library-of-babel-open-library-subjects.json";
const REPORT_PATH =
  process.argv[3] ?? "/private/tmp/library-of-babel-division-report.json";

const LITERATURE_TERMS = [
  "antholog",
  "classic literature",
  "drama",
  "fiction",
  "literary",
  "literature",
  "novel",
  "poem",
  "poet",
  "short stor",
  "story",
  "stories",
];

const PHILOSOPHY_TERMS = [
  "aesthetic",
  "critical theory",
  "ethic",
  "existential",
  "logic",
  "marx",
  "metaphys",
  "mystic",
  "ontology",
  "philosoph",
  "political theory",
  "psychoanal",
  "religio",
  "theolog",
];

const HISTORY_REFERENCE_TERMS = [
  "advertis",
  "biograph",
  "business",
  "dictionary",
  "grammar",
  "history",
  "journalis",
  "language",
  "linguist",
  "management",
  "memoir",
  "music",
  "reference",
  "travel",
  "writing",
];

const LITERATURE_TITLE_TERMS = [
  "anthology",
  "chronicles",
  "collected stories",
  "complete odes",
  "complete plays",
  "complete stories",
  "novels",
  "poems",
  "poesias",
  "poetry",
  "selected stories",
  "short stories",
  "tales",
];

const PHILOSOPHY_TITLE_TERMS = [
  "biopolitics",
  "christ",
  "critical theory",
  "philosoph",
  "pragmatism",
  "religio",
  "systematic theology",
  "theology",
];

const HISTORY_REFERENCE_TITLE_TERMS = [
  "advertising",
  "dictionary",
  "grammar",
  "handbook",
  "history",
  "marketing",
  "self-editing",
  "style",
  "writing",
];

const MANUAL_DIVISIONS = new Map(
  [
    ["A Dance to the Music of Time: 1st Movement", "Literature"],
    ["A New Dawn for Politics", "Philosophy & Theory"],
    ["A Plan for Escape", "Literature"],
    ["A Walk to An Ant Hill", "Literature"],
    ["A Year with Hafiz: Daily Contemplations", "Literature"],
    ["All Will Have Vengeance", "Literature"],
    ["Alchemy: The Dark Art and Curious Science of Creating Magic", "History & Reference"],
    ["Antivorlds", "Literature"],
    ["Armageddon Averted: The Soviet Collapse", "History & Reference"],
    ["At the Mind's Limits", "Philosophy & Theory"],
    ["B.P.R.D. Plague of Frogs — Volume 1", "Literature"],
    ["B.P.R.D. Plague of Frogs — Volume 3", "Literature"],
    ["Ben Jonson and the Cavalier Poets", "Literature"],
    ["Bobby Fischer Teaches Chess", "History & Reference"],
    ["Boxers & Saints: Boxers (Vol 1)", "Literature"],
    ["Boxers & Saints: Saints (Vol 2)", "Literature"],
    ["Brewer's Rogues, Villains, and Eccentrics", "History & Reference"],
    ["Burning Down the Haus: Punk Rock, Revolution, and the Fall of the Berlin Wall", "History & Reference"],
    ["Cassirer: An Essay on Man", "Philosophy & Theory"],
    ["Chaucer's London", "History & Reference"],
    ["Cobra and Maitreya", "Literature"],
    ["Complete Collected Essays", "Literature"],
    ["Conversation in the Cathedral", "Literature"],
    ["Creating Capabilities", "Philosophy & Theory"],
    ["Diccionario Mapudungun - Olimpo", "History & Reference"],
    ["Disionario secreto, I", "History & Reference"],
    ["Dona Flor and Her Two Husbands", "Literature"],
    ["Don Quixote", "Literature"],
    ["Dostoevsky Reads Hegel in Siberia and Buries the Cat", "Philosophy & Theory"],
    ["East Bay Greas", "Literature"],
    ["Economics and the Left", "Philosophy & Theory"],
    ["El espejo enterrado", "History & Reference"],
    ["Emerson's Essays", "Literature"],
    ["Essays of Elia & Last Essays of Elia", "Literature"],
    ["Eugene Onegin", "Literature"],
    ["Famous Speeches and Public Speaking", "History & Reference"],
    ["Fiabe Italiane", "Literature"],
    ["Fireflies", "Literature"],
    ["Gods, Determinations and Preparatory Meditations", "Literature"],
    ["Iron Maiden: Album by Album", "History & Reference"],
    ["Il Gattopardo (The Leopard)", "Literature"],
    ["Joseph Conrad / Various", "History & Reference"],
    ["Kaputt (goes europe!)", "Literature"],
    ["La Historia", "Literature"],
    ["Landscapes", "Philosophy & Theory"],
    ["Los relatos, 4", "Literature"],
    ["Los relatos, 3", "Literature"],
    ["Los relatos, 2", "Literature"],
    ["Los relatos, 1", "Literature"],
    ["Lucretius: The Way Things Are", "Philosophy & Theory"],
    ["Magister Ludi / The Glass Bead Game", "Literature"],
    ["Marginalia on Casanova — St. Orpheus Breviary", "Literature"],
    ["Midnight in Sicily", "History & Reference"],
    ["Molière: The Complete Richard Wilbur Translations (Vol 1)", "Literature"],
    ["Molière: The Complete Richard Wilbur Translations (Vol 2)", "Literature"],
    ["Nature / Walking", "Literature"],
    ["Narcoland", "History & Reference"],
    ["New Yorker Book of Food and Drink", "Literature"],
    ["O. Henry's New York", "Literature"],
    ["Obras Completas 6: El oro de los tigres / El libro de arena / La rosa profunda", "Literature"],
    ["On the Shortness of Life", "Philosophy & Theory"],
    ["Pietr the Latvian", "Literature"],
    ["Pharr - Homeric Greek", "History & Reference"],
    ["Peasants and Other Stories", "Literature"],
    ["Plays and Masques", "Literature"],
    ["Raza de bronce", "Literature"],
    ["Rimbaud: Complete Works, Selected Letters", "Literature"],
    ["Rising Up and Rising Down: Some Thoughts on Violence, Freedom, and Urgent Means", "Philosophy & Theory"],
    ["Satires and Epistles", "Literature"],
    ["Schattenform (Shadow Form)", "Literature"],
    ["Selected Prose 1909–1965", "Literature"],
    ["Selected Satires of Lucian", "Literature"],
    ["Society of the Spectacle", "Philosophy & Theory"],
    ["Tereza Batista: Home from the Wars", "Literature"],
    ["The Art of Love and Other Love Books of Ovid", "Literature"],
    ["The Book of Culture", "History & Reference"],
    ["The Book of Disquiet", "Literature"],
    ["The Creative Act", "History & Reference"],
    ["The Dialogic Imagination", "Literature"],
    ["The Earth Dies Streaming", "History & Reference"],
    ["The Emporium / Mind Bending Conundrums", "History & Reference"],
    ["The Enlightenment: The Science of Freedom", "History & Reference"],
    ["The Federalist Papers", "Philosophy & Theory"],
    ["The Fellowship of the Ring (The Lord of the Rings, Part 1)", "Literature"],
    ["The Geography of Rebel Light", "Literature"],
    ["The Innocence and Wisdom of Father Brown", "Literature"],
    ["The Jewel in the Crown / The Day of the Scorpion", "Literature"],
    ["The Life and Work of D.H. Lawrence / Flame Into Being", "Literature"],
    ["The Man Who Was Thursday", "Literature"],
    ["The Nature of the Gods", "Philosophy & Theory"],
    ["The New Yorker Book of Food and Drink", "Literature"],
    ["The Old Gringo", "Literature"],
    ["The Pursuit of Glory: Europe 1648–1815", "History & Reference"],
    ["The Radetzky March", "Literature"],
    ["The Revolt of the Masses", "Philosophy & Theory"],
    ["The Rolling Stones: All the Songs", "History & Reference"],
    ["The Total Art of Stalinism", "Philosophy & Theory"],
    ["Theodor W. Adorno: Notes to Literature (Volume One)", "Philosophy & Theory"],
    ["The Two Towers (The Lord of the Rings, Part 2)", "Literature"],
    ["Tim Blanning", "History & Reference"],
    ["Twentieth-Century Russian Reader", "Literature"],
    ["U.S.A. (The 42nd Parallel)", "Literature"],
    ["Understanding Günter Grass", "Literature"],
    ["Vergil's Aeneid", "Literature"],
    ["Vicente Huidobro: Altazor", "Literature"],
    ["Villains of All Nations: Atlantic Pirates in the Golden Age", "History & Reference"],
    ["What is Cinema? Volume 1", "Philosophy & Theory"],
    ["Wheelock's Latin (7th Edition)", "History & Reference"],
    ["William Shakespeare: The Complete Works (Second Edition)", "Literature"],
    ["Wonderful Adventures by Land and Sea", "History & Reference"],
    ["Works of Love", "Philosophy & Theory"],
    ["delete", "Philosophy & Theory"],
    ["n+1: Agitation (Number Forty-Six)", "Literature"],
    ["n+1: Attachment Issue (Number Forty-Five)", "Literature"],
    ["n+1: Inside Job (Number Forty-Eight)", "Literature"],
    ["n+1: Middlemen (Number Forty-Four)", "Literature"],
    ["n+1: Passage (Number Forty-Seven)", "Literature"],
    ["n+1: Unreal (Number Forty-Three)", "Literature"],
  ],
);

const AUTOMATIC_OVERRIDES = new Map(
  [
    ["Aftermath: Life in the Fallout of the Third Reich, 1945–1955", "History & Reference"],
    ["Albert Camus: The Rebel", "Philosophy & Theory"],
    ["Kaputt (goes europe!)", "Literature"],
    ["Liberalism: A Counter-History", "Philosophy & Theory"],
    ["Los relatos, 4", "Literature"],
    ["Rules for Radicals", "Philosophy & Theory"],
    ["The 7 Habits of Highly Effective People", "History & Reference"],
    ["The Waste Books", "Philosophy & Theory"],
  ],
);

function normalize(value) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasTerm(text, terms) {
  return terms.find((term) => text.includes(term)) ?? null;
}

function getEvidenceText(row) {
  return normalize(
    [
      row.author,
      row.title,
      row.edition,
      ...(row.match?.subject ?? []),
    ].join(" | "),
  );
}

function classify(row) {
  const evidence = getEvidenceText(row);
  const subjectText = normalize((row.match?.subject ?? []).join(" | "));
  const titleText = normalize(row.title);
  const manualDivision =
    AUTOMATIC_OVERRIDES.get(row.title) ??
    MANUAL_DIVISIONS.get(row.title) ??
    MANUAL_DIVISIONS.get(row.author);
  const literatureSubject = hasTerm(subjectText, LITERATURE_TERMS);
  const philosophySubject = hasTerm(subjectText, PHILOSOPHY_TERMS);
  const historyReferenceSubject = hasTerm(
    subjectText,
    HISTORY_REFERENCE_TERMS,
  );
  const literatureTitle = hasTerm(titleText, LITERATURE_TITLE_TERMS);
  const philosophyTitle = hasTerm(titleText, PHILOSOPHY_TITLE_TERMS);
  const historyReferenceTitle = hasTerm(
    titleText,
    HISTORY_REFERENCE_TITLE_TERMS,
  );

  if (manualDivision) {
    return {
      division: manualDivision,
      reason: "Manual review override.",
    };
  }

  if (literatureSubject) {
    return {
      division: "Literature",
      reason: `Open Library subject contains "${literatureSubject}".`,
    };
  }

  if (literatureTitle) {
    return {
      division: "Literature",
      reason: `Title contains "${literatureTitle}".`,
    };
  }

  if (philosophySubject) {
    return {
      division: "Philosophy & Theory",
      reason: `Open Library subject contains "${philosophySubject}".`,
    };
  }

  if (philosophyTitle) {
    return {
      division: "Philosophy & Theory",
      reason: `Title contains "${philosophyTitle}".`,
    };
  }

  if (historyReferenceSubject) {
    return {
      division: "History & Reference",
      reason: `Open Library subject contains "${historyReferenceSubject}".`,
    };
  }

  if (historyReferenceTitle) {
    return {
      division: "History & Reference",
      reason: `Title contains "${historyReferenceTitle}".`,
    };
  }

  if (hasTerm(evidence, ["penguin classics", "nyrb", "vintage"])) {
    return {
      division: "Literature",
      reason: "Edition signal suggests a literary work.",
    };
  }

  return {
    division: null,
    reason: "Needs review.",
  };
}

const rows = JSON.parse(await readFile(SUBJECTS_PATH, "utf8")).map((row) => ({
  ...row,
  classification: classify(row),
}));

await writeFile(REPORT_PATH, `${JSON.stringify(rows, null, 2)}\n`);

const summary = Object.groupBy(
  rows,
  (row) => row.classification.division ?? "Needs review",
);

for (const [division, divisionRows] of Object.entries(summary)) {
  process.stdout.write(`${division}: ${divisionRows.length}\n`);
}

process.stdout.write(`Saved report to ${REPORT_PATH}\n`);
