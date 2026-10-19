import { HttpError } from "./http";
import { parseIngredientLine, type Ingredient } from "./ingredients";

export type Meal = "breakfast" | "lunch" | "dinner";
export type PlanType = "recipe" | "leftovers" | "note";

export type RecipeInput = {
  name: string;
  imageUrl: string | null;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
  totalTime: string | null;
  sourceUrl: string | null;
  favorite: boolean;
};

export type RecipePatch = Partial<RecipeInput>;

export type PlanInput = {
  date: string;
  meal: Meal;
  type: PlanType;
  recipeId: string | null;
  note: string | null;
};

export type EventInput = {
  date: string;
  time: string | null;
  title: string;
};

const MEALS = new Set(["breakfast", "lunch", "dinner"]);
const PLAN_TYPES = new Set(["recipe", "leftovers", "note"]);

export function cleanDate(value: unknown, label = "The date"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${label} should look like 2026-10-19.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, `${label} isn't a real day.`);
  }
  return value;
}

export function dateRange(from: unknown, to: unknown, maxDays: number): { from: string; to: string } {
  const start = cleanDate(from, "The start date");
  const end = cleanDate(to, "The end date");
  if (start > end) throw new HttpError(400, "The start date needs to be before the end date.");
  const span = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  if (span > maxDays) throw new HttpError(400, "That range is too long.");
  return { from: start, to: end };
}

function cleanLine(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${label} should be words.`);
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) throw new HttpError(400, `Add a ${label.toLowerCase()}.`);
  if (text.length > max) throw new HttpError(400, `${label} is too long.`);
  return text;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${label} should be words.`);
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > max) throw new HttpError(400, `${label} is too long.`);
  return text;
}

export function cleanImageUrl(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "The photo link doesn't look right.");
  const text = value.trim();
  if (!text) return null;
  if (text.startsWith("/") && !text.startsWith("//") && !text.includes("..")) return text.slice(0, 500);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") throw new HttpError(400, "The photo link needs to start with https.");
    return url.href.slice(0, 500);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "The photo link doesn't look right.");
  }
}

export function cleanSourceUrl(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "The source link doesn't look right.");
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") throw new HttpError(400, "The source link needs to start with https.");
    return url.href.slice(0, 500);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "The source link doesn't look right.");
  }
}

function cleanServings(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 4;
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw new HttpError(400, "Servings should be a number from 1 to 99.");
  }
  return number;
}

export function cleanIngredients(value: unknown): Ingredient[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Ingredients should be a list, one per line.");
  if (value.length > 80) throw new HttpError(400, "That's too many ingredients.");
  const ingredients: Ingredient[] = [];
  for (const entry of value) {
    const line =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && typeof (entry as { text?: unknown }).text === "string"
          ? (entry as { text: string }).text
          : "";
    if (typeof line !== "string") throw new HttpError(400, "Each ingredient should be a line of text.");
    if (line.trim().length > 200) throw new HttpError(400, "One of those ingredients is too long.");
    const parsed = parseIngredientLine(line);
    if (parsed) ingredients.push(parsed);
  }
  return ingredients;
}

export function cleanSteps(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Steps should be a list, one per line.");
  if (value.length > 40) throw new HttpError(400, "That's too many steps.");
  const steps: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw new HttpError(400, "Each step should be a line of text.");
    const text = entry.trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (text.length > 1000) throw new HttpError(400, "One of those steps is too long.");
    steps.push(text);
  }
  return steps;
}

export function parseRecipe(body: Record<string, unknown>): RecipeInput {
  return {
    name: cleanLine(body.name, "Name", 120),
    imageUrl: cleanImageUrl(body.imageUrl),
    servings: body.servings == null ? 4 : cleanServings(body.servings),
    ingredients: cleanIngredients(body.ingredients),
    steps: cleanSteps(body.steps),
    totalTime: optionalText(body.totalTime, "The time", 40),
    sourceUrl: cleanSourceUrl(body.sourceUrl),
    favorite: body.favorite == null ? false : cleanFlag(body.favorite),
  };
}

export function parseRecipePatch(body: Record<string, unknown>): RecipePatch {
  const patch: RecipePatch = {};
  if ("name" in body) patch.name = cleanLine(body.name, "Name", 120);
  if ("imageUrl" in body) patch.imageUrl = cleanImageUrl(body.imageUrl);
  if ("servings" in body) patch.servings = cleanServings(body.servings);
  if ("ingredients" in body) patch.ingredients = cleanIngredients(body.ingredients);
  if ("steps" in body) patch.steps = cleanSteps(body.steps);
  if ("totalTime" in body) patch.totalTime = optionalText(body.totalTime, "The time", 40);
  if ("sourceUrl" in body) patch.sourceUrl = cleanSourceUrl(body.sourceUrl);
  if ("favorite" in body) patch.favorite = cleanFlag(body.favorite);
  if (Object.keys(patch).length === 0) throw new HttpError(400, "Nothing to change.");
  return patch;
}

function cleanFlag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new HttpError(400, "Favorite needs to be yes or no.");
  return value;
}

export function parsePlan(body: Record<string, unknown>): PlanInput {
  const meal = body.meal;
  const type = body.type;
  if (typeof meal !== "string" || !MEALS.has(meal)) {
    throw new HttpError(400, "Meal should be breakfast, lunch, or dinner.");
  }
  if (typeof type !== "string" || !PLAN_TYPES.has(type)) {
    throw new HttpError(400, "Choose a recipe, leftovers, or a note.");
  }
  const recipeId = optionalText(body.recipeId, "The recipe", 80);
  const note = optionalText(body.note, "The note", 140);
  if (type === "recipe" && !recipeId) throw new HttpError(400, "Choose a recipe.");
  if (type === "note" && !note) throw new HttpError(400, "Write a short note.");
  return {
    date: cleanDate(body.date),
    meal: meal as Meal,
    type: type as PlanType,
    recipeId: type === "recipe" ? recipeId : null,
    note: type === "recipe" ? null : note,
  };
}

export function parseEvent(body: Record<string, unknown>): EventInput {
  return {
    date: cleanDate(body.date),
    time: optionalText(body.time, "The time", 40),
    title: cleanLine(body.title, "Title", 120),
  };
}

export function parseEventList(body: Record<string, unknown>, range: { from: string; to: string }): EventInput[] {
  const events = body.events;
  if (!Array.isArray(events)) throw new HttpError(400, "Send the events as a list.");
  if (events.length > 200) throw new HttpError(400, "That's too many events.");
  return events.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError(400, "Each event needs a date and a title.");
    }
    const event = parseEvent(entry as Record<string, unknown>);
    if (event.date < range.from || event.date > range.to) {
      throw new HttpError(400, "Each event needs to fall inside the dates you asked to replace.");
    }
    return event;
  });
}

export function parseServingsOverride(body: Record<string, unknown>): number | null {
  if (body.servings == null) return null;
  return cleanServings(body.servings);
}
