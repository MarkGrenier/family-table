import { HttpError } from "./http";
import { isFoodSection, normalizeIngredient, parseIngredientLines, type FoodSection, type Ingredient } from "./ingredients";

export type Meal = "breakfast" | "lunch" | "dinner";
export type PlanType = "recipe" | "leftovers" | "note";

export type CookStep = { text: string; minutes: number | null; ingredients: Array<number | string> };

export type RecipeInput = {
  name: string;
  imageUrl: string | null;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
  totalTime: string | null;
  sourceUrl: string | null;
  favorite: boolean;
  externalId?: string | null;
  cookware?: string[];
  coversNights?: number | null;
  nightBefore?: string[];
  prepSteps?: string[];
  cookSteps?: CookStep[];
  kidsPlates?: string | null;
  reheating?: string | null;
};

export type WeekDayInput = {
  date: string;
  meal: Meal;
  type: PlanType;
  recipeId: string | null;
  recipe: RecipeInput | null;
  note: string | null;
};

export type WeekInput = {
  weekStart: string;
  days: WeekDayInput[];
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
    if (typeof entry === "string") {
      if (entry.trim().length > 200) throw new HttpError(400, "One of those ingredients is too long.");
      ingredients.push(...parseIngredientLines(entry));
      continue;
    }
    if (entry && typeof entry === "object") {
      const text = typeof (entry as { text?: unknown }).text === "string" ? (entry as { text: string }).text : "";
      if (text.length > 200) throw new HttpError(400, "One of those ingredients is too long.");
      const parsed = normalizeIngredient(entry);
      if (parsed) ingredients.push(parsed);
      continue;
    }
    throw new HttpError(400, "Each ingredient should be a line of text.");
  }
  return ingredients;
}

export function cleanCookware(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Cookware should be a list.");
  if (value.length > 40) throw new HttpError(400, "That's too much cookware.");
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw new HttpError(400, "Each piece of cookware should be a few words.");
    const text = entry.trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (text.length > 80) throw new HttpError(400, "One of those cookware lines is too long.");
    items.push(text);
  }
  return items;
}

export function cleanSection(value: unknown): FoodSection | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !isFoodSection(value)) {
    throw new HttpError(400, "Pick a grocery section.");
  }
  return value;
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

function cleanCoversNights(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < 1 || number > 14) {
    throw new HttpError(400, "coversNights should be a whole number from 1 to 14.");
  }
  return number;
}

export function cleanExternalId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "externalId should be a short id.");
  const text = value.trim();
  if (!text) return null;
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(text)) {
    throw new HttpError(400, "externalId should be a short id, without spaces.");
  }
  return text;
}

export function cleanCookSteps(value: unknown): CookStep[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Cook steps should be a list.");
  if (value.length > 40) throw new HttpError(400, "That's too many steps.");
  const steps: CookStep[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const text = entry.trim().replace(/\s+/g, " ");
      if (!text) continue;
      if (text.length > 1000) throw new HttpError(400, "One of those steps is too long.");
      steps.push({ text, minutes: null, ingredients: [] });
      continue;
    }
    if (!entry || typeof entry !== "object" || typeof (entry as { text?: unknown }).text !== "string") {
      throw new HttpError(400, "Each cook step needs words.");
    }
    const text = (entry as { text: string }).text.trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (text.length > 1000) throw new HttpError(400, "One of those steps is too long.");
    const rawMinutes = (entry as { minutes?: unknown }).minutes;
    let minutes: number | null = null;
    if (rawMinutes != null && rawMinutes !== "") {
      const number = typeof rawMinutes === "number" ? rawMinutes : Number(rawMinutes);
      if (!Number.isInteger(number) || number < 1 || number > 600) {
        throw new HttpError(400, "A timer should be a whole number of minutes, up to 600.");
      }
      minutes = number;
    }
    const ingredients = cleanStepIngredients((entry as { ingredients?: unknown }).ingredients);
    steps.push({ text, minutes, ingredients });
  }
  return steps;
}

function cleanStepIngredients(value: unknown): Array<number | string> {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "A step's ingredients should be a list.");
  const refs: Array<number | string> = [];
  for (const entry of value) {
    if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry < 80) {
      refs.push(entry);
      continue;
    }
    if (typeof entry === "string" && entry.trim()) {
      refs.push(entry.trim().slice(0, 120));
      continue;
    }
    throw new HttpError(400, "A step ingredient should be a number or a name.");
  }
  return refs;
}

function recipeSections(body: Record<string, unknown>, steps: string[]) {
  const cookSteps = cleanCookSteps(body.cookSteps);
  const resolvedSteps = steps.length ? steps : cookSteps.map((step) => step.text);
  return {
    steps: resolvedSteps,
    externalId: cleanExternalId(body.externalId),
    coversNights: cleanCoversNights(body.coversNights),
    nightBefore: cleanSteps(body.nightBefore),
    prepSteps: cleanSteps(body.prepSteps),
    cookSteps,
    cookware: cleanCookware(body.cookware),
    kidsPlates: optionalText(body.kidsPlates, "Kids' plates", 500),
    reheating: optionalText(body.reheating, "Reheating", 500),
  };
}

export function parseRecipe(body: Record<string, unknown>): RecipeInput {
  return {
    name: cleanLine(body.name, "Name", 120),
    imageUrl: cleanImageUrl(body.imageUrl),
    servings: body.servings == null ? 4 : cleanServings(body.servings),
    ingredients: cleanIngredients(body.ingredients),
    totalTime: optionalText(body.totalTime, "The time", 40),
    sourceUrl: cleanSourceUrl(body.sourceUrl),
    favorite: body.favorite == null ? false : cleanFlag(body.favorite),
    ...recipeSections(body, cleanSteps(body.steps)),
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
  if ("externalId" in body) patch.externalId = cleanExternalId(body.externalId);
  if ("coversNights" in body) patch.coversNights = cleanCoversNights(body.coversNights);
  if ("nightBefore" in body) patch.nightBefore = cleanSteps(body.nightBefore);
  if ("prepSteps" in body) patch.prepSteps = cleanSteps(body.prepSteps);
  if ("cookSteps" in body) patch.cookSteps = cleanCookSteps(body.cookSteps);
  if ("cookware" in body) patch.cookware = cleanCookware(body.cookware);
  if ("kidsPlates" in body) patch.kidsPlates = optionalText(body.kidsPlates, "Kids' plates", 500);
  if ("reheating" in body) patch.reheating = optionalText(body.reheating, "Reheating", 500);
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

export function cleanWeekStart(value: unknown): string {
  const date = cleanDate(value, "weekStart");
  const [year, month, day] = date.split("-").map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 1) {
    throw new HttpError(400, "weekStart needs to be a Monday.");
  }
  return date;
}

export function addDays(iso: string, count: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function parseWeek(body: Record<string, unknown>): WeekInput {
  const weekStart = cleanWeekStart(body.weekStart);
  const end = addDays(weekStart, 6);
  if (!Array.isArray(body.days)) throw new HttpError(400, "Send the days as a list.");
  if (body.days.length > 21) throw new HttpError(400, "That's too many meals for one week.");
  const seen = new Set<string>();
  const days = body.days.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError(400, "Each day needs a date, a meal, and a type.");
    }
    const day = entry as Record<string, unknown>;
    const date = cleanDate(day.date);
    if (date < weekStart || date > end) {
      throw new HttpError(400, "Each day needs to fall in the week that starts on weekStart.");
    }
    const meal = day.meal;
    const type = day.type;
    if (typeof meal !== "string" || !MEALS.has(meal)) {
      throw new HttpError(400, "Meal should be breakfast, lunch, or dinner.");
    }
    if (typeof type !== "string" || !PLAN_TYPES.has(type)) {
      throw new HttpError(400, "Choose a recipe, leftovers, or a note.");
    }
    const key = `${date}:${meal}`;
    if (seen.has(key)) throw new HttpError(400, "A day can only have one entry for each meal.");
    seen.add(key);
    const note = optionalText(day.note, "The note", 140);
    if (type === "note" && !note) throw new HttpError(400, "Write a short note.");
    let recipe: RecipeInput | null = null;
    let recipeId: string | null = null;
    if (type === "recipe") {
      if (day.recipe && typeof day.recipe === "object" && !Array.isArray(day.recipe)) {
        const recipeBody = day.recipe as Record<string, unknown>;
        recipe = parseRecipe(recipeBody);
        if (!("favorite" in recipeBody)) recipe.favorite = undefined as unknown as boolean;
        if (!("imageUrl" in recipeBody)) recipe.imageUrl = undefined as unknown as null;
      } else {
        recipeId = optionalText(day.recipeId, "The recipe", 80);
        if (!recipeId) throw new HttpError(400, "Each recipe day needs a recipe or a recipeId.");
      }
    }
    return {
      date,
      meal: meal as Meal,
      type: type as PlanType,
      recipeId,
      recipe,
      note: type === "recipe" ? null : note,
    };
  });
  return { weekStart, days };
}
