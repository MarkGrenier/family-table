export type Ingredient = {
  text: string;
  quantity: number | null;
  unit: string | null;
  name: string;
};

const FRACTIONS: Record<string, number> = {
  "½": 1 / 2,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};

const UNIT_WORDS: Record<string, string> = {
  cup: "cup",
  cups: "cup",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  tbs: "tbsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsp: "tsp",
  pound: "lb",
  pounds: "lb",
  lb: "lb",
  lbs: "lb",
  ounce: "oz",
  ounces: "oz",
  oz: "oz",
  gram: "g",
  grams: "g",
  g: "g",
  kilogram: "kg",
  kilograms: "kg",
  kg: "kg",
  milliliter: "ml",
  milliliters: "ml",
  ml: "ml",
  liter: "l",
  liters: "l",
  l: "l",
  clove: "clove",
  cloves: "clove",
  can: "can",
  cans: "can",
  package: "package",
  packages: "package",
  bunch: "bunch",
  bunches: "bunch",
  pinch: "pinch",
  slice: "slice",
  slices: "slice",
  piece: "piece",
  pieces: "piece",
  stalk: "stalk",
  stalks: "stalk",
  head: "head",
  heads: "head",
  bag: "bag",
  bags: "bag",
  jar: "jar",
  jars: "jar",
  box: "box",
  boxes: "box",
};

const PLURAL: Record<string, string> = {
  cup: "cups",
  clove: "cloves",
  can: "cans",
  package: "packages",
  bunch: "bunches",
  slice: "slices",
  piece: "pieces",
  stalk: "stalks",
  head: "heads",
  bag: "bags",
  jar: "jars",
  box: "boxes",
};

const NICE_FRACTIONS: Array<[number, number]> = [
  [1, 2],
  [1, 3],
  [2, 3],
  [1, 4],
  [3, 4],
  [1, 8],
  [3, 8],
  [5, 8],
  [7, 8],
  [1, 6],
  [5, 6],
];

export function parseIngredientLine(raw: string): Ingredient | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const leading = readQuantity(text);
  if (!leading) {
    return { text, quantity: null, unit: null, name: text };
  }
  let rest = leading.rest;
  let unit: string | null = null;
  const unitMatch = /^([A-Za-z]+)\b\s*/.exec(rest);
  if (unitMatch && UNIT_WORDS[unitMatch[1].toLowerCase()]) {
    unit = UNIT_WORDS[unitMatch[1].toLowerCase()];
    rest = rest.slice(unitMatch[0].length);
  }
  rest = rest.replace(/^of\s+/i, "").replace(/^\(.*\)\s*/, "").trim();
  if (!rest) return { text, quantity: null, unit: null, name: text };
  return { text, quantity: leading.quantity, unit, name: rest };
}

function readQuantity(text: string): { quantity: number; rest: string } | null {
  const mixed = /^(\d+)\s+(\d+)\/(\d+)\b\s*/.exec(text);
  if (mixed) {
    const quantity = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    if (quantity > 0) return { quantity, rest: text.slice(mixed[0].length) };
  }
  const glyph = /^(\d+)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])\s*/.exec(text);
  if (glyph) {
    const quantity = (glyph[1] ? Number(glyph[1]) : 0) + (FRACTIONS[glyph[2]] ?? 0);
    if (quantity > 0) return { quantity, rest: text.slice(glyph[0].length) };
  }
  const fraction = /^(\d+)\/(\d+)\b\s*/.exec(text);
  if (fraction) {
    const quantity = Number(fraction[1]) / Number(fraction[2]);
    if (quantity > 0) return { quantity, rest: text.slice(fraction[0].length) };
  }
  const number = /^(\d+(?:\.\d+)?)\b\s*/.exec(text);
  if (number) {
    const quantity = Number(number[1]);
    if (quantity > 0) return { quantity, rest: text.slice(number[0].length) };
  }
  return null;
}

export function formatQuantity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round(value * 1000) / 1000;
  const whole = Math.floor(rounded + 1e-8);
  const fraction = rounded - whole;
  if (fraction < 0.02) return String(whole);
  let best: { text: string; diff: number } | null = null;
  for (const [numerator, denominator] of NICE_FRACTIONS) {
    const diff = Math.abs(fraction - numerator / denominator);
    if (diff < 0.03 && (!best || diff < best.diff)) {
      best = { text: `${numerator}/${denominator}`, diff };
    }
  }
  if (best) return whole > 0 ? `${whole} ${best.text}` : best.text;
  return String(Math.round(rounded * 100) / 100);
}

export function unitLabel(unit: string | null, quantity: number): string {
  if (!unit) return "";
  if (quantity > 1 && PLURAL[unit]) return PLURAL[unit];
  return unit;
}

export function scaleIngredient(ingredient: Ingredient, factor: number): Ingredient {
  if (ingredient.quantity == null || !Number.isFinite(factor) || factor <= 0) return ingredient;
  const quantity = ingredient.quantity * factor;
  const unit = unitLabel(ingredient.unit, quantity);
  const name = ingredient.name;
  const amount = `${formatQuantity(quantity)}${unit ? ` ${unit}` : ""}`.trim();
  return {
    ...ingredient,
    quantity,
    text: `${amount} ${name}`.trim(),
  };
}

export function groceryName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  const titled = clean.charAt(0).toUpperCase() + clean.slice(1);
  return titled.slice(0, 80);
}

type RecipeCounts = Map<string, number>;

export function buildGroceryNote(quantity: number | null, unit: string | null, recipes: RecipeCounts): string {
  const amount =
    quantity == null
      ? ""
      : `${formatQuantity(quantity)}${unit ? ` ${unitLabel(unit, quantity)}` : ""}`.trim();
  const names = [...recipes.entries()].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
  const recipeText = names.join(", ");
  const note = amount && recipeText ? `${amount} · ${recipeText}` : amount || recipeText;
  return note.slice(0, 140);
}

export function parseGroceryNote(note: string | null): {
  structured: boolean;
  quantity: number | null;
  unit: string | null;
  amountText: string;
  recipes: RecipeCounts;
} {
  const recipes: RecipeCounts = new Map();
  const empty = { structured: true, quantity: null, unit: null, amountText: "", recipes };
  if (!note || !note.trim()) return empty;
  const marker = note.lastIndexOf(" · ");
  const recipeText = marker === -1 ? note : note.slice(marker + 3);
  const amountText = marker === -1 ? "" : note.slice(0, marker).trim();
  if (amountText && !amountText.split("+").every((chunk) => isAmountChunk(chunk))) {
    return { structured: false, quantity: null, unit: null, amountText: "", recipes };
  }
  if (marker === -1 && /^\d/.test(note.trim())) {
    return { structured: false, quantity: null, unit: null, amountText: "", recipes };
  }
  for (const part of recipeText.split(",")) {
    const match = /^(.*?)(?:\s×(\d+))?$/.exec(part.trim());
    if (!match || !match[1].trim()) continue;
    recipes.set(match[1].trim(), Math.max(1, Number(match[2] || 1)));
  }
  if (!amountText) return { structured: true, quantity: null, unit: null, amountText: "", recipes };
  const chunks = amountText.split("+").map((chunk) => chunk.trim());
  if (chunks.length !== 1) return { structured: true, quantity: null, unit: null, amountText, recipes };
  const read = readQuantity(chunks[0]);
  if (!read) return { structured: true, quantity: null, unit: null, amountText, recipes };
  const unitWord = read.rest.trim().toLowerCase();
  const unit = unitWord ? (UNIT_WORDS[unitWord] ?? null) : null;
  if (unitWord && !unit) return { structured: false, quantity: null, unit: null, amountText: "", recipes };
  return { structured: true, quantity: read.quantity, unit, amountText, recipes };
}

function isAmountChunk(chunk: string): boolean {
  const text = chunk.trim();
  const read = readQuantity(text);
  if (!read) return false;
  const unitWord = read.rest.trim().toLowerCase();
  return unitWord === "" || Boolean(UNIT_WORDS[unitWord]);
}

export function mergeGroceryNote(existing: string | null, addition: Ingredient, recipeName: string): string {
  const parsed = parseGroceryNote(existing);
  if (!parsed.structured) {
    if (!existing) return recipeName.slice(0, 140);
    if (existing.toLowerCase().includes(recipeName.toLowerCase())) return existing.slice(0, 140);
    return `${existing}, ${recipeName}`.slice(0, 140);
  }
  parsed.recipes.set(recipeName, (parsed.recipes.get(recipeName) ?? 0) + 1);
  const piece = amountPiece(addition);
  let amount = parsed.amountText;
  if (piece) {
    if (!amount) amount = piece;
    else if (parsed.quantity != null && parsed.unit === addition.unit) {
      amount = amountPiece({ ...addition, quantity: parsed.quantity + (addition.quantity ?? 0) });
    } else amount = `${amount} + ${piece}`;
  }
  const names = [...parsed.recipes.entries()].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
  const recipeText = names.join(", ");
  const note = amount && recipeText ? `${amount} · ${recipeText}` : amount || recipeText;
  return note.slice(0, 140);
}

function amountPiece(ingredient: Ingredient): string {
  if (ingredient.quantity == null) return "";
  const unit = unitLabel(ingredient.unit, ingredient.quantity);
  return `${formatQuantity(ingredient.quantity)}${unit ? ` ${unit}` : ""}`.trim();
}

export function unmergeGroceryNote(existing: string | null, addition: Ingredient, recipeName: string): string | null {
  const parsed = parseGroceryNote(existing);
  if (!parsed.structured) {
    if (!existing) return null;
    const suffix = `, ${recipeName}`;
    if (existing.endsWith(suffix)) {
      const rest = existing.slice(0, -suffix.length).trim();
      return rest || null;
    }
    return existing;
  }
  const count = parsed.recipes.get(recipeName) ?? 0;
  if (count <= 1) parsed.recipes.delete(recipeName);
  else parsed.recipes.set(recipeName, count - 1);
  const piece = amountPiece(addition);
  let amount = parsed.amountText;
  if (piece) {
    if (parsed.quantity != null && parsed.unit === addition.unit && addition.quantity != null) {
      const next = parsed.quantity - addition.quantity;
      amount = next > 0.001 ? amountPiece({ ...addition, quantity: next }) : "";
    } else if (amount === piece) amount = "";
    else if (amount.endsWith(` + ${piece}`)) amount = amount.slice(0, -(piece.length + 3));
    else if (amount.startsWith(`${piece} + `)) amount = amount.slice(piece.length + 3);
  }
  const names = [...parsed.recipes.entries()].map(([name, times]) => (times > 1 ? `${name} ×${times}` : name));
  const recipeText = names.join(", ");
  if (!amount && !recipeText) return null;
  const note = amount && recipeText ? `${amount} · ${recipeText}` : amount || recipeText;
  return note.slice(0, 140);
}
