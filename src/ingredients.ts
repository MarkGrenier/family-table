export const FOOD_SECTIONS = [
  "produce",
  "meat",
  "dairy",
  "bakery",
  "frozen",
  "pantry",
  "baking",
  "oils",
  "snacks",
  "beverages",
  "household",
  "other",
] as const;

export type FoodSection = (typeof FOOD_SECTIONS)[number];

export const SECTION_LABELS: Record<FoodSection, string> = {
  produce: "Produce",
  meat: "Meat & Seafood",
  dairy: "Dairy Cheese & Eggs",
  bakery: "Bakery",
  frozen: "Frozen",
  pantry: "Pantry",
  baking: "Baking & Spices",
  oils: "Oils Sauces & Condiments",
  snacks: "Snacks",
  beverages: "Beverages",
  household: "Household",
  other: "Other",
};

export type Ingredient = {
  text: string;
  quantity: number | null;
  qty: number | null;
  unit: string | null;
  name: string;
  section: FoodSection;
  buy: boolean;
  optional: boolean;
  note: string | null;
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
  pinches: "pinch",
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
  pint: "pint",
  pints: "pint",
  quart: "quart",
  quarts: "quart",
  gallon: "gallon",
  gallons: "gallon",
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
  pint: "pints",
  quart: "quarts",
  gallon: "gallons",
  pinch: "pinches",
};

const NICE_FRACTIONS: Array<[number, number, string]> = [
  [1, 2, "½"],
  [1, 3, "⅓"],
  [2, 3, "⅔"],
  [1, 4, "¼"],
  [3, 4, "¾"],
  [1, 8, "⅛"],
  [3, 8, "⅜"],
  [5, 8, "⅝"],
  [7, 8, "⅞"],
  [1, 6, "⅙"],
  [5, 6, "⅚"],
];

const PANTRY_BASICS = new Set([
  "water",
  "ice",
  "salt",
  "kosher salt",
  "sea salt",
  "table salt",
  "pepper",
  "black pepper",
  "white pepper",
  "oil",
  "olive oil",
  "extra virgin olive oil",
  "vegetable oil",
  "canola oil",
  "cooking spray",
  "nonstick spray",
]);

const SPICES = [
  "cumin",
  "paprika",
  "oregano",
  "thyme",
  "cinnamon",
  "chili powder",
  "garlic powder",
  "onion powder",
  "cayenne",
  "nutmeg",
  "bay leaf",
  "bay leaves",
  "red pepper flakes",
  "italian seasoning",
  "chili flakes",
  "ground pepper",
  "cracked pepper",
];

export function isFoodSection(value: string): value is FoodSection {
  return (FOOD_SECTIONS as readonly string[]).includes(value);
}

export function isPantryBasic(name: string): boolean {
  const clean = name.trim().toLowerCase();
  if (!clean) return false;
  if (PANTRY_BASICS.has(clean)) return true;
  if (SPICES.some((spice) => clean === spice || clean.endsWith(` ${spice}`))) return true;
  if (/\b(salt|cooking spray)\b/.test(clean) && !/salted/.test(clean)) return true;
  if (/^(black|white|ground|cracked)\s+pepper$/.test(clean)) return true;
  if (/^(olive|vegetable|canola|sesame|avocado|cooking)\s+oil$/.test(clean)) return true;
  if (clean === "water" || clean.endsWith(" water")) return true;
  return false;
}

export function sectionForName(name: string): FoodSection {
  const n = name.toLowerCase();
  if (isPantryBasic(n) && /pepper|cumin|paprika|oregano|thyme|cinnamon|chili|cayenne|nutmeg|bay|seasoning|powder|salt/.test(n) && !/bell|chicken/.test(n)) {
    return /oil/.test(n) ? "oils" : "baking";
  }
  if (/soap|detergent|paper towel|trash bag|foil|sponge|cleaner|bleach/.test(n)) return "household";
  if (/frozen|ice cream/.test(n)) return "frozen";
  if (/bread|bagel|bun|roll|tortilla|pita|baguette/.test(n)) return "bakery";
  if (/milk|cheese|yogurt|butter|cream|egg/.test(n) && !/eggplant|cream of/.test(n)) return "dairy";
  if (/chicken|beef|pork|turkey|salmon|shrimp|fish|bacon|sausage|steak|lamb|cod|tuna|meat/.test(n)) return "meat";
  if (/flour|sugar|yeast|baking powder|baking soda|vanilla|cornstarch|cocoa|chocolate chip/.test(n)) return "baking";
  if (/soy sauce|vinegar|ketchup|mustard|mayonnaise|mayo|salsa|hot sauce|sriracha|dressing|broth|stock/.test(n)) return "oils";
  if (/\boil\b|sauce|condiment/.test(n)) return "oils";
  if (/chip|cracker|pretzel|popcorn|cookie|granola bar/.test(n)) return "snacks";
  if (/juice|soda|coffee|tea|wine|beer|kombucha|sparkling/.test(n)) return "beverages";
  if (/onion|garlic|tomato|lettuce|cilantro|lime|lemon|avocado|potato|apple|banana|spinach|carrot|celery|cucumber|broccoli|zucchini|pepper|herb|scallion|ginger|mushroom|cabbage|kale|berry|berries|corn|peas|green bean/.test(n)) {
    if (/powder|flake|seasoning|black pepper|white pepper/.test(n)) return "baking";
    return "produce";
  }
  if (/rice|pasta|bean|lentil|oat|cereal|noodle|spaghetti|tortilla chip|canned|can of|broth/.test(n)) return "pantry";
  return "pantry";
}

export function categoryForSection(section: FoodSection): "produce" | "shelf" | "refrigerated" | "frozen" {
  if (section === "produce") return "produce";
  if (section === "frozen") return "frozen";
  if (section === "dairy" || section === "meat") return "refrigerated";
  return "shelf";
}

function normalizeRaw(raw: string): string {
  return raw
    .trim()
    .replace(/[⁄]/g, "/")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

export function parseIngredientLine(raw: string): Ingredient | null {
  return parseIngredientLines(raw)[0] ?? null;
}

export function parseIngredientLines(raw: string): Ingredient[] {
  const original = raw.trim().replace(/\s+/g, " ");
  if (!original) return [];
  const pieces = splitCompound(normalizeRaw(original));
  return pieces.flatMap((piece) => {
    const parsed = parseOne(piece);
    if (!parsed) return [];
    return [{ ...parsed, text: pieces.length === 1 ? original : piece }];
  });
}

function splitCompound(line: string): string[] {
  const parts = line
    .split(/,\s*(?=(?:[–\-]\s*)?\d|[½¼¾⅓⅔⅛⅜⅝⅞])|\s+and\s+(?=(?:[–\-]\s*)?\d|[½¼¾⅓⅔⅛⅜⅝⅞])/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [line];
}

function parseOne(input: string): Omit<Ingredient, "text"> | null {
  let text = input.trim();
  if (!text) return null;
  let optional = /\boptional\b/i.test(text);
  const notes: string[] = [];
  text = text
    .replace(/\(([^)]*)\)/g, (_all, inner: string) => {
      const bit = inner.trim();
      if (!bit) return " ";
      if (/optional/i.test(bit)) optional = true;
      else notes.push(bit.replace(/^~\s*/, "~"));
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/^[•*]\s*/, "");
  text = text.replace(/^-\s*(\d)/, "$1");
  text = text.replace(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/, (_all, _low: string, high: string) => high);

  let qty: number | null = null;
  let unit: string | null = null;
  let rest = text;
  const slashUnit = /^(\d+)\s*\/\s*([A-Za-z]+)\b\.?\s*/.exec(text);
  const impliedUnit = /^\/\s*([A-Za-z]+)\b\.?\s*/.exec(text);
  if (slashUnit && UNIT_WORDS[slashUnit[2].toLowerCase().replace(/\.$/, "")]) {
    qty = Number(slashUnit[1]);
    unit = UNIT_WORDS[slashUnit[2].toLowerCase().replace(/\.$/, "")];
    rest = text.slice(slashUnit[0].length);
  } else if (impliedUnit && UNIT_WORDS[impliedUnit[1].toLowerCase().replace(/\.$/, "")]) {
    qty = 1;
    unit = UNIT_WORDS[impliedUnit[1].toLowerCase().replace(/\.$/, "")];
    rest = text.slice(impliedUnit[0].length);
  } else {
    const leading = readQuantity(text);
    if (leading) {
      qty = leading.quantity;
      rest = leading.rest;
      const unitMatch = /^([A-Za-z]+)\b\.?\s*/.exec(rest);
      const word = unitMatch?.[1].toLowerCase().replace(/\.$/, "") ?? "";
      if (unitMatch && UNIT_WORDS[word]) {
        unit = UNIT_WORDS[word];
        rest = rest.slice(unitMatch[0].length);
      }
    }
  }
  rest = rest.replace(/^of\s+/i, "").replace(/^-\s*/, "").trim();
  const purpose = /^(.*?)\s+(to\s+.+)$/i.exec(rest);
  if (purpose && purpose[1].trim().length > 1 && !/^to$/i.test(purpose[1])) {
    notes.push(purpose[2].trim());
    rest = purpose[1].trim();
  }
  const comma = rest.indexOf(",");
  if (comma > 0) {
    const extra = rest.slice(comma + 1).trim();
    if (extra) notes.push(extra);
    rest = rest.slice(0, comma).trim();
  }
  rest = rest.replace(/^(small|medium|large)\s+/i, (word) => {
    notes.push(word.trim().toLowerCase());
    return "";
  });
  const name = rest.replace(/\s+/g, " ").trim();
  if (!name) return null;
  const section = sectionForName(name);
  const buy = !optional && !isPantryBasic(name);
  return {
    quantity: qty,
    qty,
    unit,
    name,
    section,
    buy,
    optional,
    note: notes.length ? notes.join(", ").slice(0, 140) : null,
  };
}

function readQuantity(text: string): { quantity: number; rest: string } | null {
  const mixed = /^(\d+)\s+(\d+)\/(\d+)\b\s*/.exec(text);
  if (mixed && Number(mixed[3]) !== 0) {
    const quantity = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    if (quantity > 0) return { quantity, rest: text.slice(mixed[0].length) };
  }
  const glyph = /^(\d+)?\s*([½¼¾⅓⅔⅛⅜⅝⅞])\s*/.exec(text);
  if (glyph) {
    const quantity = (glyph[1] ? Number(glyph[1]) : 0) + (FRACTIONS[glyph[2]] ?? 0);
    if (quantity > 0) return { quantity, rest: text.slice(glyph[0].length) };
  }
  const fraction = /^(\d+)\/(\d+)\b\s*/.exec(text);
  if (fraction && Number(fraction[2]) !== 0) {
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

export function normalizeIngredient(raw: unknown): Ingredient | null {
  if (typeof raw === "string") return parseIngredientLine(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const parsed = text ? parseIngredientLine(text) : null;
  const nameSource = typeof body.name === "string" && body.name.trim() ? body.name.trim() : parsed?.name;
  if (!nameSource) return null;
  const qty = readLooseQty(body.qty ?? body.quantity, parsed?.qty ?? null);
  const unit = typeof body.unit === "string" && body.unit.trim() ? normalizeUnit(body.unit) : body.unit === null ? null : parsed?.unit ?? null;
  const section = typeof body.section === "string" && isFoodSection(body.section) ? body.section : parsed?.section ?? sectionForName(nameSource);
  const optional = typeof body.optional === "boolean" ? body.optional : parsed?.optional ?? false;
  const buy = typeof body.buy === "boolean" ? body.buy : optional ? false : parsed?.buy ?? !isPantryBasic(nameSource);
  const note = typeof body.note === "string" ? body.note.trim() || null : body.note === null ? null : parsed?.note ?? null;
  const name = nameSource.replace(/\s+/g, " ");
  const display = text || [formatQuantity(qty ?? 0), unit, name].filter(Boolean).join(" ");
  return {
    text: display,
    quantity: qty,
    qty,
    unit,
    name,
    section,
    buy,
    optional,
    note,
  };
}

function readLooseQty(value: unknown, fallback: number | null): number | null {
  if (value == null || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const read = readQuantity(value.trim());
    if (read && !read.rest.trim()) return read.quantity;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return fallback;
}

function normalizeUnit(value: string): string | null {
  const word = value.trim().toLowerCase().replace(/\.$/, "");
  if (!word) return null;
  return UNIT_WORDS[word] ?? word.slice(0, 20);
}

export function formatQuantity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round(value * 1000) / 1000;
  const whole = Math.floor(rounded + 1e-8);
  const fraction = rounded - whole;
  if (fraction < 0.02) return String(whole);
  let best: { text: string; diff: number } | null = null;
  for (const [numerator, denominator, glyph] of NICE_FRACTIONS) {
    const diff = Math.abs(fraction - numerator / denominator);
    if (diff < 0.03 && (!best || diff < best.diff)) {
      best = { text: glyph, diff };
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

export function amountText(quantity: number | null, unit: string | null): string {
  if (quantity == null) return "";
  const label = unitLabel(unit, quantity);
  return `${formatQuantity(quantity)}${label ? ` ${label}` : ""}`.trim();
}

export function scaleIngredient(ingredient: Ingredient, factor: number): Ingredient {
  if (ingredient.quantity == null || !Number.isFinite(factor) || factor <= 0) return ingredient;
  const quantity = ingredient.quantity * factor;
  const unit = unitLabel(ingredient.unit, quantity);
  const name = ingredient.name;
  const amount = amountText(quantity, ingredient.unit);
  return {
    ...ingredient,
    quantity,
    qty: quantity,
    unit: ingredient.unit,
    text: `${amount} ${name}`.trim(),
  };
}

export function groceryName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  const titled = clean.charAt(0).toUpperCase() + clean.slice(1);
  return titled.slice(0, 80);
}

export function combineAmounts(existing: string | null, addition: Ingredient): string | null {
  const piece = amountText(addition.quantity, addition.unit);
  if (!existing) return piece || null;
  const parsed = parseAmount(existing);
  if (!parsed) return existing;
  if (!piece || addition.quantity == null) return existing;
  if (parsed.quantity != null && parsed.unit === addition.unit) {
    return amountText(parsed.quantity + addition.quantity, addition.unit) || null;
  }
  if (existing === piece) return existing;
  return `${existing} + ${piece}`.slice(0, 140);
}

export function subtractAmount(existing: string | null, addition: Ingredient): string | null {
  if (!existing) return null;
  const parsed = parseAmount(existing);
  const piece = amountText(addition.quantity, addition.unit);
  if (!parsed) {
    if (piece && existing.endsWith(` + ${piece}`)) return existing.slice(0, -(piece.length + 3)) || null;
    if (piece && existing.startsWith(`${piece} + `)) return existing.slice(piece.length + 3) || null;
    return existing;
  }
  if (addition.quantity == null) return existing;
  if (parsed.quantity != null && parsed.unit === addition.unit) {
    const next = parsed.quantity - addition.quantity;
    return next > 0.001 ? amountText(next, addition.unit) : null;
  }
  if (existing === piece) return null;
  if (piece && existing.endsWith(` + ${piece}`)) return existing.slice(0, -(piece.length + 3)) || null;
  if (piece && existing.startsWith(`${piece} + `)) return existing.slice(piece.length + 3) || null;
  return existing;
}

export function parseAmount(note: string | null): { quantity: number | null; unit: string | null } | null {
  if (!note || !note.trim()) return { quantity: null, unit: null };
  const text = note.trim();
  if (text.includes("+") || text.includes("·")) return null;
  const read = readQuantity(text);
  if (!read) return null;
  const unitWord = read.rest.trim().toLowerCase().replace(/\.$/, "");
  if (!unitWord) return { quantity: read.quantity, unit: null };
  const unit = UNIT_WORDS[unitWord];
  if (!unit || read.rest.trim().split(/\s+/).length > 1) return null;
  return { quantity: read.quantity, unit };
}

export function normalizeStoredIngredient(raw: unknown): Ingredient | null {
  return normalizeIngredient(raw);
}
