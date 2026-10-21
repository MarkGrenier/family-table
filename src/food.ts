import { createItem, deleteItem, getItem, listItems, onHandKeys, updateItem, type Item } from "./db";
import {
  categoryForSection,
  groceryKey,
  groceryName,
  normalizeStoredIngredient,
  scaleIngredient,
  shoppingAmount,
  type Ingredient,
  type ShoppingPart,
} from "./ingredients";
import { HttpError } from "./http";
import { addDays, type CookStep, type EventInput, type PlanInput, type RecipeInput, type RecipePatch, type WeekInput } from "./food-validate";

export type Recipe = {
  id: string;
  name: string;
  imageUrl: string | null;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
  totalTime: string | null;
  sourceUrl: string | null;
  favorite: boolean;
  needsReview: boolean;
  lastMade: string | null;
  timesMade: number;
  cookedToday: boolean;
  averageRating: number | null;
  lastComment: string | null;
  cookware: string[];
  externalId: string | null;
  coversNights: number | null;
  nightBefore: string[];
  prepSteps: string[];
  cookSteps: CookStep[];
  kidsPlates: string | null;
  reheating: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WeekDay = {
  date: string;
  meal: PlanEntry["meal"];
  type: PlanEntry["type"];
  recipeId: string | null;
  note: string | null;
  alternates: string[];
  recipe: Recipe | null;
};

export type PlanEntry = {
  id: string;
  date: string;
  meal: "breakfast" | "lunch" | "dinner";
  type: "recipe" | "leftovers" | "note";
  recipeId: string | null;
  recipeName: string | null;
  imageUrl: string | null;
  note: string | null;
  alternates: string[];
  also: string[];
};

export type FamilyEvent = {
  id: string;
  date: string;
  time: string | null;
  title: string;
};

type RecipeRow = {
  id: string;
  name: string;
  image_url: string | null;
  servings: number;
  ingredients_json: string;
  steps_json: string;
  total_time: string | null;
  source_url: string | null;
  favorite: number;
  needs_review: number;
  external_id: string | null;
  covers_nights: number | null;
  night_before_json: string;
  prep_steps_json: string;
  cook_steps_json: string;
  kids_plates: string | null;
  reheating: string | null;
  cookware_json: string;
  created_at: string;
  updated_at: string;
};

const RECIPE_COLUMNS =
  "id, name, image_url, servings, ingredients_json, steps_json, total_time, source_url, favorite, external_id, covers_nights, night_before_json, prep_steps_json, cook_steps_json, kids_plates, reheating, cookware_json, needs_review, created_at, updated_at";

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cookStepFromStored(step: unknown): CookStep {
  if (typeof step === "string") return { text: step, minutes: null, ingredients: [] };
  const body = (step ?? {}) as { text?: string; minutes?: number | string | null; seconds?: unknown; ingredients?: Array<number | string> };
  const cooked: CookStep = {
    text: body.text ?? "",
    minutes: body.minutes ?? null,
    ingredients: Array.isArray(body.ingredients) ? body.ingredients : [],
  };
  if (typeof body.seconds === "number" && Number.isInteger(body.seconds) && body.seconds > 0) cooked.seconds = body.seconds;
  return cooked;
}

function recipeFromRow(row: RecipeRow): Recipe {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    servings: Number(row.servings) || 4,
    ingredients: parseJson<unknown[]>(row.ingredients_json, []).map((entry) => normalizeStoredIngredient(entry)).filter((entry): entry is Ingredient => Boolean(entry)),
    steps: parseJson<string[]>(row.steps_json, []),
    totalTime: row.total_time,
    sourceUrl: row.source_url,
    favorite: Boolean(row.favorite),
    needsReview: Number(row.needs_review) === 1,
    lastMade: null,
    timesMade: 0,
    externalId: row.external_id,
    coversNights: row.covers_nights == null ? null : Number(row.covers_nights),
    nightBefore: parseJson<string[]>(row.night_before_json, []),
    prepSteps: parseJson<string[]>(row.prep_steps_json, []),
    cookSteps: parseJson<unknown[]>(row.cook_steps_json, []).map((step) => cookStepFromStored(step)),
    kidsPlates: row.kids_plates,
    reheating: row.reheating,
    cookware: parseJson<string[]>(row.cookware_json, []),
    cookedToday: false,
    averageRating: null,
    lastComment: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function easternToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Monday of the week that contains `iso`. Weeks run Monday–Sunday. */
export function mondayOf(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}

/** This week and next week, Monday through Sunday, in Eastern time. */
export function groceryWindow(today = easternToday()): { from: string; to: string } {
  const from = mondayOf(today);
  return { from, to: addDays(from, 13) };
}

export function inGroceryWindow(date: string, today = easternToday()): boolean {
  const window = groceryWindow(today);
  return date >= window.from && date <= window.to;
}

type RecipeMeta = {
  lastMade: string | null;
  timesMade: number;
  cookedToday: boolean;
  averageRating: number | null;
  lastComment: string | null;
};

async function recipeMeta(db: D1Database): Promise<Map<string, RecipeMeta>> {
  const today = easternToday();
  const plans = await db
    .prepare(
      `SELECT recipe_id, plan_date FROM plan_entries
       WHERE entry_type = 'recipe' AND recipe_id IS NOT NULL AND plan_date <= ?`,
    )
    .bind(today)
    .all<{ recipe_id: string; plan_date: string }>();
  const cooks = await db
    .prepare(`SELECT recipe_id, made_on FROM recipe_made`)
    .all<{ recipe_id: string; made_on: string }>();
  const feedback = await db
    .prepare(`SELECT recipe_id, stars, comment, created_at FROM recipe_feedback ORDER BY created_at ASC`)
    .all<{ recipe_id: string; stars: number; comment: string | null; created_at: string }>();
  const stats = new Map<string, { count: number; dates: Set<string>; cookedToday: boolean; stars: number[]; lastComment: string | null }>();
  const bucket = (id: string) => {
    const current = stats.get(id);
    if (current) return current;
    const created = { count: 0, dates: new Set<string>(), cookedToday: false, stars: [] as number[], lastComment: null as string | null };
    stats.set(id, created);
    return created;
  };
  for (const row of plans.results ?? []) {
    const item = bucket(row.recipe_id);
    item.count += 1;
    item.dates.add(row.plan_date);
  }
  for (const row of cooks.results ?? []) {
    const item = bucket(row.recipe_id);
    if (row.made_on <= today && !item.dates.has(row.made_on)) {
      item.count += 1;
      item.dates.add(row.made_on);
    } else if (row.made_on <= today) item.dates.add(row.made_on);
    if (row.made_on === today) item.cookedToday = true;
  }
  for (const row of feedback.results ?? []) {
    const item = bucket(row.recipe_id);
    item.stars.push(Number(row.stars));
    if (row.comment && row.comment.trim()) item.lastComment = row.comment.trim();
  }
  const meta = new Map<string, RecipeMeta>();
  for (const [id, item] of stats) {
    const dates = [...item.dates].sort();
    const average = item.stars.length ? item.stars.reduce((sum, star) => sum + star, 0) / item.stars.length : null;
    meta.set(id, {
      lastMade: dates.length ? dates[dates.length - 1] : null,
      timesMade: item.count,
      cookedToday: item.cookedToday,
      averageRating: average == null ? null : Math.round(average * 10) / 10,
      lastComment: item.lastComment,
    });
  }
  return meta;
}

function withMeta(recipe: Recipe, stats: Map<string, RecipeMeta>): Recipe {
  const made = stats.get(recipe.id);
  if (!made) return recipe;
  return { ...recipe, ...made };
}

export async function listRecipes(db: D1Database, query = "", favoriteOnly = false, needsReviewOnly = false): Promise<Recipe[]> {
  const needle = query.trim().toLowerCase();
  const where: string[] = [];
  const binds: string[] = [];
  if (needle) {
    where.push(`lower(name) LIKE ? ESCAPE '\\'`);
    binds.push(`%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
  }
  if (favoriteOnly) where.push("favorite = 1");
  if (needsReviewOnly) where.push("needs_review = 1");
  const sql = `SELECT ${RECIPE_COLUMNS} FROM recipes${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY favorite DESC, name COLLATE NOCASE`;
  const rows = await db.prepare(sql).bind(...binds).all<RecipeRow>();
  const stats = await recipeMeta(db);
  return (rows.results ?? []).map((row) => withMeta(recipeFromRow(row), stats));
}

export async function getRecipe(db: D1Database, id: string): Promise<Recipe | null> {
  const row = await db.prepare(`SELECT ${RECIPE_COLUMNS} FROM recipes WHERE id = ?`).bind(id).first<RecipeRow>();
  if (!row) return null;
  const stats = await recipeMeta(db);
  return withMeta(recipeFromRow(row), stats);
}

export async function createRecipe(db: D1Database, input: RecipeInput): Promise<Recipe> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO recipes (
         id, name, image_url, servings, ingredients_json, steps_json, total_time, source_url, favorite,
         external_id, covers_nights, night_before_json, prep_steps_json, cook_steps_json, kids_plates, reheating, cookware_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.imageUrl ?? null,
      input.servings,
      JSON.stringify(input.ingredients),
      JSON.stringify(input.steps),
      input.totalTime,
      input.sourceUrl,
      input.favorite ? 1 : 0,
      input.externalId ?? null,
      input.coversNights ?? null,
      JSON.stringify(input.nightBefore ?? []),
      JSON.stringify(input.prepSteps ?? []),
      JSON.stringify(input.cookSteps ?? []),
      input.kidsPlates ?? null,
      input.reheating ?? null,
      JSON.stringify(input.cookware ?? []),
      now,
      now,
    )
    .run();
  if (input.needsReview) {
    await db.prepare(`UPDATE recipes SET needs_review = 1 WHERE id = ?`).bind(id).run();
  }
  const recipe = await getRecipe(db, id);
  if (!recipe) throw new HttpError(500, "Something went wrong. Try again.");
  return recipe;
}

function reviewAfterEdit(
  existing: Recipe,
  patch: RecipePatch,
  next: { name: string; ingredients: Ingredient[]; steps: string[]; cookSteps: CookStep[] },
): boolean {
  const edited = patch.ingredients !== undefined || patch.steps !== undefined || patch.cookSteps !== undefined;
  if (!edited) return existing.needsReview;
  const hasSteps = next.steps.some((step) => step.trim()) || next.cookSteps.some((step) => step.text.trim());
  return !(next.name.trim() && next.ingredients.length > 0 && hasSteps);
}

export async function updateRecipe(db: D1Database, id: string, patch: RecipePatch): Promise<Recipe> {
  const existing = await getRecipe(db, id);
  if (!existing) throw new HttpError(404, "That recipe isn't here anymore.");
  const next: Recipe = {
    ...existing,
    name: patch.name ?? existing.name,
    imageUrl: patch.imageUrl === undefined ? existing.imageUrl : patch.imageUrl,
    servings: patch.servings ?? existing.servings,
    ingredients: patch.ingredients ?? existing.ingredients,
    steps: patch.steps ?? existing.steps,
    totalTime: patch.totalTime === undefined ? existing.totalTime : patch.totalTime,
    sourceUrl: patch.sourceUrl === undefined ? existing.sourceUrl : patch.sourceUrl,
    favorite: patch.favorite ?? existing.favorite,
    externalId: patch.externalId === undefined ? existing.externalId : patch.externalId,
    coversNights: patch.coversNights === undefined ? existing.coversNights : patch.coversNights,
    nightBefore: patch.nightBefore ?? existing.nightBefore,
    prepSteps: patch.prepSteps ?? existing.prepSteps,
    cookSteps: patch.cookSteps ?? existing.cookSteps,
    kidsPlates: patch.kidsPlates === undefined ? existing.kidsPlates : patch.kidsPlates,
    reheating: patch.reheating === undefined ? existing.reheating : patch.reheating,
    cookware: patch.cookware ?? existing.cookware,
    needsReview: reviewAfterEdit(existing, patch, {
      name: patch.name ?? existing.name,
      ingredients: patch.ingredients ?? existing.ingredients,
      steps: patch.steps ?? existing.steps,
      cookSteps: patch.cookSteps ?? existing.cookSteps,
    }),
    updatedAt: nowIso(),
  };
  await db
    .prepare(
      `UPDATE recipes
       SET name = ?, image_url = ?, servings = ?, ingredients_json = ?, steps_json = ?, total_time = ?, source_url = ?, favorite = ?,
           external_id = ?, covers_nights = ?, night_before_json = ?, prep_steps_json = ?, cook_steps_json = ?, kids_plates = ?, reheating = ?, cookware_json = ?,
           needs_review = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      next.name,
      next.imageUrl,
      next.servings,
      JSON.stringify(next.ingredients),
      JSON.stringify(next.steps),
      next.totalTime,
      next.sourceUrl,
      next.favorite ? 1 : 0,
      next.externalId,
      next.coversNights,
      JSON.stringify(next.nightBefore),
      JSON.stringify(next.prepSteps),
      JSON.stringify(next.cookSteps),
      next.kidsPlates,
      next.reheating,
      JSON.stringify(next.cookware),
      next.needsReview ? 1 : 0,
      next.updatedAt,
      id,
    )
    .run();
  return next;
}

export async function deleteRecipe(db: D1Database, id: string): Promise<void> {
  const existing = await getRecipe(db, id);
  if (!existing) throw new HttpError(404, "That recipe isn't here anymore.");
  const planned = await db.prepare(`SELECT id FROM plan_entries WHERE recipe_id = ?`).bind(id).all<{ id: string }>();
  for (const row of planned.results ?? []) {
    const entry = await getPlan(db, row.id);
    if (entry) await removePlanGroceries(db, entry);
  }
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE plan_entries
         SET entry_type = 'note', recipe_id = NULL, note = ?, updated_at = ?
         WHERE recipe_id = ?`,
      )
      .bind(existing.name, now, id),
    db.prepare(`DELETE FROM recipes WHERE id = ?`).bind(id),
  ]);
}

type PlanRow = {
  id: string;
  plan_date: string;
  meal: PlanEntry["meal"];
  entry_type: PlanEntry["type"];
  recipe_id: string | null;
  note: string | null;
  alternates_json: string | null;
  also_json: string | null;
  recipe_name: string | null;
  image_url: string | null;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

async function linkLeftovers(db: D1Database, entries: PlanEntry[]): Promise<PlanEntry[]> {
  const pending = entries.filter((entry) => entry.type === "leftovers" && !entry.recipeId);
  if (!pending.length) return entries;
  const recipes = await db
    .prepare(`SELECT id, name, image_url, covers_nights FROM recipes`)
    .all<{ id: string; name: string; image_url: string | null; covers_nights: number | null }>();
  const library = recipes.results ?? [];
  const byName = new Map(library.map((recipe) => [recipe.name.trim().toLowerCase(), recipe]));
  const earliest = pending.map((entry) => entry.date).sort()[0];
  const prior = await db
    .prepare(
      `${PLAN_SELECT}
       WHERE p.plan_date >= ? AND p.plan_date < ? AND p.entry_type = 'recipe' AND p.recipe_id IS NOT NULL`,
    )
    .bind(addDays(earliest, -14), earliest)
    .all<PlanRow>();
  const sources = [...(prior.results ?? []).map(planFromRow), ...entries.filter((entry) => entry.type === "recipe" && entry.recipeId)];
  return entries.map((entry) => {
    if (entry.type !== "leftovers" || entry.recipeId) return entry;
    const named = entry.note ? byName.get(entry.note.trim().toLowerCase()) : undefined;
    const earlier = sources
      .filter((source) => source.meal === entry.meal && source.date < entry.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const previous = earlier[0];
    const previousRecipe = previous ? library.find((recipe) => recipe.id === previous.recipeId) : undefined;
    const gap = previous ? daysBetween(previous.date, entry.date) : 99;
    const cover = previousRecipe?.covers_nights && previousRecipe.covers_nights > 1 ? previousRecipe.covers_nights - 1 : 6;
    const picked = named ?? (previousRecipe && gap >= 1 && gap <= cover ? previousRecipe : undefined);
    if (!picked) return entry;
    return { ...entry, recipeId: picked.id, recipeName: picked.name, imageUrl: picked.image_url };
  });
}

function planFromRow(row: PlanRow): PlanEntry {
  return {
    id: row.id,
    date: row.plan_date,
    meal: row.meal,
    type: row.entry_type,
    recipeId: row.recipe_id,
    recipeName: row.recipe_name,
    imageUrl: row.image_url,
    note: row.note,
    alternates: parseAlternateIds(row.alternates_json),
    also: parseAlsoIds(row.also_json),
  };
}

function parseAlsoIds(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

function parseAlternateIds(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function resolveAlternateIds(db: D1Database, raw: string[], chosenId: string | null): Promise<string[]> {
  const resolved: string[] = [];
  for (const token of raw) {
    const recipe = (await getRecipe(db, token)) ?? (await findRecipeByExternalId(db, token));
    if (!recipe) throw new HttpError(400, "That alternate isn't in the cookbook.");
    if (recipe.id === chosenId || resolved.includes(recipe.id)) continue;
    resolved.push(recipe.id);
  }
  if (resolved.length > 3) throw new HttpError(400, "A meal can have up to 3 alternates.");
  return resolved;
}

const PLAN_SELECT = `
  SELECT p.id, p.plan_date, p.meal, p.entry_type, p.recipe_id, p.note, p.alternates_json, p.also_json, r.name AS recipe_name, r.image_url
  FROM plan_entries p
  LEFT JOIN recipes r ON r.id = p.recipe_id
`;

export async function listPlan(db: D1Database, from: string, to: string): Promise<PlanEntry[]> {
  const rows = await db
    .prepare(
      `${PLAN_SELECT}
       WHERE p.plan_date >= ? AND p.plan_date <= ?
       ORDER BY p.plan_date, CASE p.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END`,
    )
    .bind(from, to)
    .all<PlanRow>();
  return linkLeftovers(db, (rows.results ?? []).map(planFromRow));
}

async function getPlan(db: D1Database, id: string): Promise<PlanEntry | null> {
  const row = await db.prepare(`${PLAN_SELECT} WHERE p.id = ?`).bind(id).first<PlanRow>();
  return row ? planFromRow(row) : null;
}

async function planOn(db: D1Database, date: string, meal: string): Promise<PlanEntry | null> {
  const row = await db.prepare(`${PLAN_SELECT} WHERE p.plan_date = ? AND p.meal = ?`).bind(date, meal).first<PlanRow>();
  return row ? planFromRow(row) : null;
}

export async function savePlan(db: D1Database, input: PlanInput): Promise<PlanEntry> {
  if (input.recipeId && input.type !== "note") {
    const recipe = await getRecipe(db, input.recipeId);
    if (!recipe) throw new HttpError(400, "That recipe isn't here anymore.");
  }
  if (input.keep && input.recipeId) {
    const kept = await addPlanAlso(db, input.date, input.meal, input.recipeId);
    if (kept) return kept;
  }
  const previous = await planOn(db, input.date, input.meal);
  const now = nowIso();
  const id = crypto.randomUUID();
  let note = input.note;
  let recipeId = input.recipeId;
  if (input.type === "leftovers" && previous) {
    if (!note && previous.note) note = previous.note;
    if (!recipeId && previous.recipeId) recipeId = previous.recipeId;
  }
  const alternates =
    input.alternates !== undefined
      ? await resolveAlternateIds(db, input.alternates, recipeId)
      : (previous?.alternates ?? []).filter((alternateId) => alternateId !== recipeId);
  await db
    .prepare(
      `INSERT INTO plan_entries (id, plan_date, meal, entry_type, recipe_id, note, alternates_json, also_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
       ON CONFLICT (plan_date, meal) DO UPDATE SET
         entry_type = excluded.entry_type,
         recipe_id = excluded.recipe_id,
         note = excluded.note,
         alternates_json = excluded.alternates_json,
         also_json = '[]',
         updated_at = excluded.updated_at`,
    )
    .bind(id, input.date, input.meal, input.type, recipeId, note, JSON.stringify(alternates), now, now)
    .run();
  const saved = await planOn(db, input.date, input.meal);
  if (!saved) throw new HttpError(500, "Something went wrong. Try again.");
  const sameRecipe =
    previous?.type === "recipe" && saved.type === "recipe" && previous.recipeId === saved.recipeId && Boolean(saved.recipeId);
  const inWindow = inGroceryWindow(saved.date);
  if (previous && inWindow) {
    for (const extraId of previous.also) {
      await removePlanGroceries(db, { ...previous, id: alsoPlanId(previous.id, extraId) });
    }
  }
  if (!sameRecipe) {
    if (previous?.type === "recipe" && inWindow) await removePlanGroceries(db, previous);
    if (saved.type === "recipe" && saved.recipeId && inWindow) await addEntryGroceries(db, saved);
  }
  return saved;
}

export async function listAllPlan(db: D1Database): Promise<PlanEntry[]> {
  const rows = await db
    .prepare(
      `${PLAN_SELECT}
       ORDER BY p.plan_date, CASE p.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END`,
    )
    .all<PlanRow>();
  return linkLeftovers(db, (rows.results ?? []).map(planFromRow));
}

export async function setPlanAlternates(db: D1Database, id: string, raw: string[]): Promise<PlanEntry> {
  const existing = await getPlan(db, id);
  if (!existing) throw new HttpError(404, "That meal isn't planned anymore.");
  const alternates = await resolveAlternateIds(db, raw, existing.recipeId);
  await db
    .prepare(`UPDATE plan_entries SET alternates_json = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(alternates), nowIso(), id)
    .run();
  const saved = await getPlan(db, id);
  if (!saved) throw new HttpError(500, "Something went wrong. Try again.");
  return saved;
}

async function addPlanAlso(db: D1Database, date: string, meal: string, recipeId: string): Promise<PlanEntry | null> {
  const previous = await planOn(db, date, meal);
  if (!previous) return null;
  if (previous.recipeId === recipeId || previous.also.includes(recipeId)) return previous;
  if (previous.also.length >= 6) throw new HttpError(400, "That day already has several dinners.");
  const also = [...previous.also, recipeId];
  await db
    .prepare(`UPDATE plan_entries SET also_json = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(also), nowIso(), previous.id)
    .run();
  const saved = await planOn(db, date, meal);
  if (!saved) throw new HttpError(500, "Something went wrong. Try again.");
  if (inGroceryWindow(saved.date)) {
    await addEntryGroceries(db, { ...saved, id: alsoPlanId(saved.id, recipeId), type: "recipe", recipeId });
  }
  return saved;
}

export async function removePlanAlso(db: D1Database, id: string, recipeId: string): Promise<void> {
  const existing = await getPlan(db, id);
  if (!existing) throw new HttpError(404, "That meal isn't planned anymore.");
  const also = existing.also.filter((entryId) => entryId !== recipeId);
  await db
    .prepare(`UPDATE plan_entries SET also_json = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(also), nowIso(), id)
    .run();
  if (inGroceryWindow(existing.date)) await removePlanGroceries(db, { ...existing, id: alsoPlanId(id, recipeId) });
}

function alsoPlanId(planId: string, recipeId: string): string {
  return `${planId}:also:${recipeId}`;
}

export async function deletePlan(db: D1Database, id: string): Promise<void> {
  const existing = await getPlan(db, id);
  if (!existing) throw new HttpError(404, "That meal isn't planned anymore.");
  if (existing.type === "recipe" && inGroceryWindow(existing.date)) await removePlanGroceries(db, existing);
  await db.prepare(`DELETE FROM plan_entries WHERE id = ?`).bind(id).run();
}

type EventRow = {
  id: string;
  event_date: string;
  event_time: string | null;
  title: string;
};

function eventFromRow(row: EventRow): FamilyEvent {
  return { id: row.id, date: row.event_date, time: row.event_time, title: row.title };
}

export async function listEvents(db: D1Database, from: string, to: string): Promise<FamilyEvent[]> {
  const rows = await db
    .prepare(
      `SELECT id, event_date, event_time, title
       FROM family_events
       WHERE event_date >= ? AND event_date <= ?
       ORDER BY event_date, event_time IS NULL, event_time, title`,
    )
    .bind(from, to)
    .all<EventRow>();
  return (rows.results ?? []).map(eventFromRow);
}

export async function listAllEvents(db: D1Database): Promise<FamilyEvent[]> {
  const rows = await db
    .prepare(
      `SELECT id, event_date, event_time, title
       FROM family_events
       ORDER BY event_date, event_time IS NULL, event_time, title`,
    )
    .all<EventRow>();
  return (rows.results ?? []).map(eventFromRow);
}

export async function createEvent(db: D1Database, input: EventInput): Promise<FamilyEvent> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO family_events (id, event_date, event_time, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.date, input.time, input.title, now, now)
    .run();
  return { id, date: input.date, time: input.time, title: input.title };
}

export async function replaceEvents(
  db: D1Database,
  range: { from: string; to: string },
  events: EventInput[],
): Promise<FamilyEvent[]> {
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM family_events WHERE event_date >= ? AND event_date <= ?`).bind(range.from, range.to),
  ];
  const saved: FamilyEvent[] = [];
  for (const event of events) {
    const id = crypto.randomUUID();
    saved.push({ id, date: event.date, time: event.time, title: event.title });
    statements.push(
      db
        .prepare(
          `INSERT INTO family_events (id, event_date, event_time, title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, event.date, event.time, event.title, now, now),
    );
  }
  await db.batch(statements);
  saved.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
  return saved;
}

export async function deleteEvent(db: D1Database, id: string): Promise<void> {
  const result = await db.prepare(`DELETE FROM family_events WHERE id = ?`).bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, "That event isn't on the calendar anymore.");
}

type GroceryChange = { added: number; updated: number; skipped: number };

export async function addRecipeToGroceries(db: D1Database, recipeId: string, servings: number | null): Promise<GroceryChange> {
  const recipe = await getRecipe(db, recipeId);
  if (!recipe) throw new HttpError(404, "That recipe isn't here anymore.");
  const factor = servings == null ? 1 : servings / recipe.servings;
  const onHand = await onHandKeys(db);
  const items = await listItems(db);
  const totals = { added: 0, updated: 0, skipped: 0 };
  for (let index = 0; index < recipe.ingredients.length; index += 1) {
    const change = await addOneIngredient(db, scaleIngredient(recipe.ingredients[index], factor), `recipe:${recipe.id}:${index}`, onHand, items);
    totals[change] += 1;
  }
  return totals;
}

function planSourcePresent(keys: Set<string>, entryId: string): boolean {
  const prefix = `plan:${entryId}:`;
  const alsoPrefix = entryId.includes(":also:") ? null : `plan:${entryId}:also:`;
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    if (alsoPrefix && key.startsWith(alsoPrefix)) continue;
    return true;
  }
  return false;
}

/** Add groceries for in-window meals that do not have them yet. Safe to run on every list fetch. */
export async function syncWindowGroceries(db: D1Database): Promise<void> {
  const window = groceryWindow();
  const planned = await listPlan(db, window.from, window.to);
  const targets: PlanEntry[] = [];
  for (const entry of planned) {
    if (entry.type === "recipe" && entry.recipeId) targets.push(entry);
    for (const recipeId of entry.also) {
      targets.push({ ...entry, id: alsoPlanId(entry.id, recipeId), type: "recipe", recipeId });
    }
  }
  if (!targets.length) return;
  const rows = await db
    .prepare(`SELECT source_key FROM grocery_sources WHERE source_key LIKE 'plan:%'`)
    .all<{ source_key: string }>();
  const keys = new Set((rows.results ?? []).map((row) => row.source_key));
  const missing = targets.filter((entry) => !planSourcePresent(keys, entry.id));
  if (!missing.length) return;
  const onHand = await onHandKeys(db);
  for (const entry of missing) await addEntryGroceries(db, entry, onHand);
}

async function addEntryGroceries(db: D1Database, entry: PlanEntry, onHand?: Set<string>): Promise<GroceryChange> {
  const totals = { added: 0, updated: 0, skipped: 0 };
  if (entry.type !== "recipe" || !entry.recipeId) return totals;
  const recipe = await getRecipe(db, entry.recipeId);
  if (!recipe) return totals;
  const keys = onHand ?? (await onHandKeys(db));
  const items = await listItems(db);
  for (let index = 0; index < recipe.ingredients.length; index += 1) {
    const change = await addOneIngredient(db, recipe.ingredients[index], `plan:${entry.id}:${index}`, keys, items);
    totals[change] += 1;
  }
  return totals;
}

export async function addPlanGroceries(db: D1Database, from: string, to: string, planId: string | null): Promise<GroceryChange> {
  const planned = await listPlan(db, from, to);
  const entries = (planId ? planned.filter((entry) => entry.id === planId) : planned).filter((entry) => inGroceryWindow(entry.date));
  const onHand = await onHandKeys(db);
  const totals = { added: 0, updated: 0, skipped: 0 };
  for (const entry of entries) {
    const change = await addEntryGroceries(db, entry, onHand);
    totals.added += change.added;
    totals.updated += change.updated;
    totals.skipped += change.skipped;
    for (const recipeId of entry.also) {
      const extra = await addEntryGroceries(db, { ...entry, id: alsoPlanId(entry.id, recipeId), type: "recipe", recipeId }, onHand);
      totals.added += extra.added;
      totals.updated += extra.updated;
      totals.skipped += extra.skipped;
    }
  }
  return totals;
}

const REBUILD_BATCH = 400;

type RebuildPlanRow = {
  id: string;
  plan_date: string;
  meal: string;
  entry_type: string;
  recipe_id: string | null;
  also_json: string | null;
};

type RebuildItemRow = {
  id: string;
  name: string;
  quantity_note: string | null;
  section: string | null;
  checked: number;
  created_at: string;
};

type RebuildSourceRow = {
  item_id: string;
  source_key: string;
  quantity: number | null;
  unit: string | null;
};

type MemSource = { sourceKey: string; quantity: number | null; unit: string | null };

type MemItem = {
  id: string;
  name: string;
  quantityNote: string | null;
  section: Ingredient["section"] | null;
  checked: boolean;
  createdAt: string;
  removed: boolean;
  fresh: boolean;
  sources: MemSource[];
};

export async function rebuildPlanGroceries(
  db: D1Database,
  range: { from: string; to: string } | null,
): Promise<GroceryChange & { removed: number }> {
  // One read batch, then the whole menu is applied in memory and written in chunks.
  // A year of meals used to issue a query per ingredient and hit D1's per-request cap.
  const loaded = await db.batch([
    db.prepare(
      `SELECT id, plan_date, meal, entry_type, recipe_id, also_json
       FROM plan_entries
       ORDER BY plan_date, CASE meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END`,
    ),
    db.prepare(`SELECT id, ingredients_json FROM recipes`),
    db.prepare(
      `SELECT id, name, quantity_note, section, checked, created_at
       FROM items WHERE deleted_at IS NULL ORDER BY created_at ASC`,
    ),
    db.prepare(`SELECT item_id, source_key, quantity, unit FROM grocery_sources`),
    db.prepare(`SELECT name_key FROM on_hand`),
  ]);
  const planRows = (loaded[0]?.results ?? []) as RebuildPlanRow[];
  const recipeRows = (loaded[1]?.results ?? []) as { id: string; ingredients_json: string }[];
  const itemRows = (loaded[2]?.results ?? []) as RebuildItemRow[];
  const sourceRows = (loaded[3]?.results ?? []) as RebuildSourceRow[];
  const handRows = (loaded[4]?.results ?? []) as { name_key: string }[];

  const recipeIngredients = new Map<string, Ingredient[]>();
  for (const row of recipeRows) {
    recipeIngredients.set(
      row.id,
      parseJson<unknown[]>(row.ingredients_json, [])
        .map((entry) => normalizeStoredIngredient(entry))
        .filter((entry): entry is Ingredient => Boolean(entry)),
    );
  }
  const planRecipe = new Map<string, string>();
  for (const row of planRows) {
    if (row.recipe_id) planRecipe.set(row.id, row.recipe_id);
  }
  const window = groceryWindow();
  const entries = planRows.filter((row) => {
    const isRecipe = row.entry_type === "recipe" && Boolean(row.recipe_id);
    const hasAlso = parseAlsoIds(row.also_json).length > 0;
    if (!isRecipe && !hasAlso) return false;
    if (row.plan_date < window.from || row.plan_date > window.to) return false;
    if (!range) return true;
    return row.plan_date >= range.from && row.plan_date <= range.to;
  });
  const rebuilding = new Set(entries.map((row) => row.id));

  const items: MemItem[] = itemRows.map((row) => ({
    id: row.id,
    name: row.name,
    quantityNote: row.quantity_note,
    section: (row.section as Ingredient["section"] | null) ?? null,
    checked: Number(row.checked) === 1,
    createdAt: row.created_at,
    removed: false,
    fresh: false,
    sources: [],
  }));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const original = new Map<string, { quantityNote: string | null; section: MemItem["section"]; keys: Set<string> }>();
  for (const item of items) original.set(item.id, { quantityNote: item.quantityNote, section: item.section, keys: new Set() });

  const liveKeys = new Set<string>();
  const orphanKeys = new Set<string>();
  for (const row of sourceRows) {
    const item = itemById.get(row.item_id);
    if (!item) {
      orphanKeys.add(row.source_key);
      continue;
    }
    item.sources.push({ sourceKey: row.source_key, quantity: row.quantity, unit: row.unit });
    liveKeys.add(row.source_key);
    original.get(item.id)?.keys.add(row.source_key);
  }
  const onHand = new Set(handRows.map((row) => row.name_key));

  function ingredientForKey(sourceKey: string): Ingredient | null {
    const parts = sourceKey.split(":");
    if (parts[0] === "plan" && parts[2] === "also") {
      const index = Number(parts[4]);
      if (!Number.isInteger(index) || index < 0) return null;
      return recipeIngredients.get(parts[3] ?? "")?.[index] ?? null;
    }
    const index = Number(parts[2]);
    if (!Number.isInteger(index) || index < 0) return null;
    const recipeId = parts[0] === "plan" ? (planRecipe.get(parts[1] ?? "") ?? null) : parts[0] === "recipe" ? (parts[1] ?? null) : null;
    if (!recipeId) return null;
    return recipeIngredients.get(recipeId)?.[index] ?? null;
  }

  function noteFor(item: MemItem): string | null {
    const parts: ShoppingPart[] = [];
    const identities = new Set<string>();
    let hand: { known: boolean; note: string | null } | null = null;
    for (const row of item.sources) {
      const manual = readHandSource(row.sourceKey);
      if (manual) {
        hand = manual;
        continue;
      }
      const identity = recipeIdentity(row.sourceKey);
      if (!identity) continue;
      identities.add(identity);
      if (row.quantity == null && (row.unit == null || row.unit === "")) {
        const ingredient = ingredientForKey(row.sourceKey);
        parts.push({ quantity: ingredient?.quantity ?? null, unit: ingredient?.unit ?? null });
      } else {
        parts.push({ quantity: row.quantity, unit: row.unit });
      }
    }
    const shop = shoppingAmount(parts, identities.size);
    const summed = shop != null && !/^for \d+ recipes$/.test(shop);
    if (summed) return shop;
    if (hand?.known && hand.note) return hand.note;
    if (hand && !hand.known && item.quantityNote && !isDisposableNote(item.quantityNote)) return item.quantityNote;
    return shop;
  }

  function keyTaken(sourceKey: string): boolean {
    return liveKeys.has(sourceKey) || orphanKeys.has(sourceKey);
  }

  let removed = 0;
  for (const item of items) {
    if (item.checked) continue;
    const kept: MemSource[] = [];
    let changed = false;
    for (const source of item.sources) {
      const planId = source.sourceKey.split(":")[1] ?? "";
      if (source.sourceKey.startsWith(`plan:${planId}:`) && rebuilding.has(planId)) {
        liveKeys.delete(source.sourceKey);
        changed = true;
        continue;
      }
      kept.push(source);
    }
    if (!changed) continue;
    item.sources = kept;
    if (item.sources.length === 0) {
      item.removed = true;
      removed += 1;
    } else {
      item.quantityNote = noteFor(item);
    }
  }

  const totals = { added: 0, updated: 0, skipped: 0, removed };
  let clock = Date.now();
  const stamp = (): string => {
    clock += 1;
    return new Date(clock).toISOString();
  };

  function placeIngredient(ingredient: Ingredient, sourceKey: string): keyof GroceryChange {
    if (ingredient.buy === false || (ingredient.optional && ingredient.buy !== true)) return "skipped";
    if (onHand.has(groceryKey(ingredient.name))) return "skipped";
    if (keyTaken(sourceKey)) return "skipped";
    const name = groceryName(ingredient.name);
    const key = groceryKey(name);
    const existing = items.find(
      (item) => !item.removed && !item.checked && groceryKey(item.name) === key && sectionsMatch(item.section, ingredient.section),
    );
    if (!existing) {
      const created = stamp();
      const item: MemItem = {
        id: crypto.randomUUID(),
        name,
        quantityNote: null,
        section: ingredient.section,
        checked: false,
        createdAt: created,
        removed: false,
        fresh: true,
        sources: [{ sourceKey, quantity: ingredient.quantity ?? null, unit: ingredient.unit ?? null }],
      };
      item.quantityNote = noteFor(item);
      liveKeys.add(sourceKey);
      items.push(item);
      return "added";
    }
    if (existing.sources.length === 0) {
      const handKey = handSourceKey(existing.id, existing.quantityNote);
      existing.sources.push({ sourceKey: handKey, quantity: null, unit: null });
      liveKeys.add(handKey);
    }
    if (existing.section == null) existing.section = ingredient.section;
    existing.sources.push({ sourceKey, quantity: ingredient.quantity ?? null, unit: ingredient.unit ?? null });
    liveKeys.add(sourceKey);
    existing.quantityNote = noteFor(existing);
    return "updated";
  }

  for (const entry of entries) {
    if (entry.entry_type === "recipe" && entry.recipe_id) {
      const ingredients = recipeIngredients.get(entry.recipe_id) ?? [];
      for (let index = 0; index < ingredients.length; index += 1) {
        totals[placeIngredient(ingredients[index], `plan:${entry.id}:${index}`)] += 1;
      }
    }
    for (const recipeId of parseAlsoIds(entry.also_json)) {
      const ingredients = recipeIngredients.get(recipeId) ?? [];
      for (let index = 0; index < ingredients.length; index += 1) {
        totals[placeIngredient(ingredients[index], `plan:${entry.id}:also:${recipeId}:${index}`)] += 1;
      }
    }
  }

  const statements: D1PreparedStatement[] = [];
  const now = stamp();
  const insertSource = (itemId: string, source: MemSource) =>
    db
      .prepare(`INSERT INTO grocery_sources (item_id, source_key, quantity, unit) VALUES (?, ?, ?, ?)`)
      .bind(itemId, source.sourceKey, source.quantity, source.unit);
  for (const item of items) {
    if (item.fresh) {
      statements.push(
        db
          .prepare(
            `INSERT INTO items (id, name, quantity_note, store, category, checked, brand, asin, barcode, staple, staple_id, section, image_url, substitute, notes, created_at, updated_at)
             VALUES (?, ?, ?, 'local', ?, 0, NULL, NULL, NULL, 0, NULL, ?, NULL, NULL, NULL, ?, ?)`,
          )
          .bind(item.id, item.name, item.quantityNote, categoryForSection(item.section ?? "pantry"), item.section, item.createdAt, item.createdAt),
      );
      for (const source of item.sources) statements.push(insertSource(item.id, source));
      continue;
    }
    if (item.removed) {
      statements.push(db.prepare(`DELETE FROM grocery_sources WHERE item_id = ?`).bind(item.id));
      statements.push(db.prepare(`DELETE FROM items WHERE id = ?`).bind(item.id));
      continue;
    }
    const snap = original.get(item.id);
    if (!snap) continue;
    for (const key of snap.keys) {
      if (!item.sources.some((source) => source.sourceKey === key)) {
        statements.push(db.prepare(`DELETE FROM grocery_sources WHERE item_id = ? AND source_key = ?`).bind(item.id, key));
      }
    }
    for (const source of item.sources) {
      if (!snap.keys.has(source.sourceKey)) statements.push(insertSource(item.id, source));
    }
    if (item.quantityNote !== snap.quantityNote || item.section !== snap.section) {
      statements.push(
        db.prepare(`UPDATE items SET quantity_note = ?, section = ?, updated_at = ? WHERE id = ?`).bind(item.quantityNote, item.section, now, item.id),
      );
    }
  }
  for (let index = 0; index < statements.length; index += REBUILD_BATCH) {
    await db.batch(statements.slice(index, index + REBUILD_BATCH));
  }
  return totals;
}

async function findRecipeByExternalId(db: D1Database, externalId: string): Promise<Recipe | null> {
  const row = await db.prepare(`SELECT ${RECIPE_COLUMNS} FROM recipes WHERE external_id = ?`).bind(externalId).first<RecipeRow>();
  return row ? recipeFromRow(row) : null;
}

async function findRecipeByName(db: D1Database, name: string): Promise<Recipe | null> {
  const row = await db
    .prepare(`SELECT ${RECIPE_COLUMNS} FROM recipes WHERE lower(name) = ? ORDER BY updated_at DESC LIMIT 1`)
    .bind(name.toLowerCase())
    .first<RecipeRow>();
  return row ? recipeFromRow(row) : null;
}

async function upsertRecipe(db: D1Database, input: RecipeInput): Promise<Recipe> {
  const byExternal = input.externalId ? await findRecipeByExternalId(db, input.externalId) : null;
  let existing = byExternal;
  if (!existing) {
    const byName = await findRecipeByName(db, input.name);
    if (byName && !(input.externalId && byName.externalId && byName.externalId !== input.externalId)) existing = byName;
  }
  if (!existing) return createRecipe(db, input);
  return updateRecipe(db, existing.id, {
    name: input.name,
    servings: input.servings,
    ingredients: input.ingredients,
    steps: input.steps,
    totalTime: input.totalTime,
    sourceUrl: input.sourceUrl,
    externalId: input.externalId ?? existing.externalId,
    coversNights: input.coversNights ?? null,
    nightBefore: input.nightBefore ?? [],
    prepSteps: input.prepSteps ?? [],
    cookSteps: input.cookSteps ?? [],
    kidsPlates: input.kidsPlates ?? null,
    reheating: input.reheating ?? null,
    cookware: input.cookware ?? [],
    imageUrl: input.imageUrl === undefined ? existing.imageUrl : input.imageUrl,
    favorite: input.favorite === undefined ? existing.favorite : input.favorite,
  });
}

export async function getWeek(db: D1Database, weekStart: string): Promise<{ weekStart: string; days: WeekDay[] }> {
  const entries = await listPlan(db, weekStart, addDays(weekStart, 6));
  const days: WeekDay[] = [];
  for (const entry of entries) {
    days.push({
      date: entry.date,
      meal: entry.meal,
      type: entry.type,
      recipeId: entry.recipeId,
      note: entry.note,
      alternates: entry.alternates,
      recipe: entry.recipeId ? await getRecipe(db, entry.recipeId) : null,
    });
  }
  return { weekStart, days };
}

export async function replaceWeek(db: D1Database, input: WeekInput): Promise<{ weekStart: string; days: WeekDay[] }> {
  const end = addDays(input.weekStart, 6);
  const existing = await listPlan(db, input.weekStart, end);
  for (const entry of existing) {
    if (entry.type === "recipe" && inGroceryWindow(entry.date)) await removePlanGroceries(db, entry);
  }
  // Recipes stay in the cookbook. Replacing a week only changes that week's meals.
  await db.prepare(`DELETE FROM plan_entries WHERE plan_date >= ? AND plan_date <= ?`).bind(input.weekStart, end).run();
  const now = nowIso();
  for (const day of input.days) {
    let recipeId = day.recipeId;
    if (day.type === "recipe" && day.recipe) recipeId = (await upsertRecipe(db, day.recipe)).id;
    if (recipeId && day.type !== "note") {
      const recipe = await getRecipe(db, recipeId);
      if (!recipe) throw new HttpError(400, "That recipe isn't here anymore.");
    }
    const chosenId = day.type === "note" ? null : recipeId;
    const alternates = await resolveAlternateIds(db, day.alternates, chosenId);
    await db
      .prepare(
        `INSERT INTO plan_entries (id, plan_date, meal, entry_type, recipe_id, note, alternates_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), day.date, day.meal, day.type, chosenId, day.note, JSON.stringify(alternates), now, now)
      .run();
  }
  const saved = await listPlan(db, input.weekStart, end);
  for (const entry of saved) {
    if (entry.type === "recipe" && inGroceryWindow(entry.date)) await addEntryGroceries(db, entry);
  }
  return getWeek(db, input.weekStart);
}

async function removePlanGroceries(db: D1Database, entry: PlanEntry): Promise<void> {
  const rows = await db
    .prepare(`SELECT item_id, source_key FROM grocery_sources WHERE instr(source_key, ?) = 1`)
    .bind(`plan:${entry.id}:`)
    .all<{ item_id: string; source_key: string }>();
  const items = await listItems(db);
  for (const row of rows.results ?? []) {
    await removeOneSource(db, row.item_id, row.source_key, items);
  }
}

async function removeOneSource(db: D1Database, itemId: string, sourceKey: string, items?: Item[]): Promise<void> {
  const list = items ?? (await listItems(db));
  const item = list.find((entry) => entry.id === itemId);
  if (!item || item.checked) {
    await db.prepare(`DELETE FROM grocery_sources WHERE item_id = ? AND source_key = ?`).bind(itemId, sourceKey).run();
    return;
  }
  await db.prepare(`DELETE FROM grocery_sources WHERE item_id = ? AND source_key = ?`).bind(itemId, sourceKey).run();
  const others = await db
    .prepare(`SELECT COUNT(*) AS n FROM grocery_sources WHERE item_id = ?`)
    .bind(itemId)
    .first<{ n: number }>();
  if (Number(others?.n ?? 0) === 0) {
    await deleteItem(db, itemId);
    const index = list.findIndex((entry) => entry.id === itemId);
    if (index >= 0) list.splice(index, 1);
    return;
  }
  await refreshItemQuantity(db, itemId);
}

function sectionsMatch(existing: Item["section"], incoming: Ingredient["section"]): boolean {
  return existing == null || existing === incoming;
}

function handSourceKey(itemId: string, note: string | null): string {
  return `user:${itemId}:${encodeURIComponent(note ?? "")}`;
}

function readHandSource(sourceKey: string): { known: boolean; note: string | null } | null {
  if (!sourceKey.startsWith("user:")) return null;
  const rest = sourceKey.slice("user:".length);
  const split = rest.indexOf(":");
  if (split === -1) return { known: false, note: null };
  const encoded = rest.slice(split + 1);
  if (!encoded) return { known: true, note: null };
  try {
    const note = decodeURIComponent(encoded);
    return { known: true, note: note || null };
  } catch {
    return { known: true, note: null };
  }
}

function recipeIdentity(sourceKey: string): string | null {
  const parts = sourceKey.split(":");
  if (parts[0] === "plan" && parts[2] === "also" && parts[1] && parts[3]) return `plan:${parts[1]}:also:${parts[3]}`;
  if ((parts[0] === "plan" || parts[0] === "recipe") && parts[1]) return `${parts[0]}:${parts[1]}`;
  return null;
}

function isDisposableNote(note: string | null): boolean {
  if (!note) return true;
  if (/^for \d+ recipes$/.test(note)) return true;
  if (/\b(tsp|tbsp|teaspoons?|tablespoons?|cups?)\b/i.test(note)) return true;
  if (note.includes("+")) return true;
  if (/\bcubes?\b/i.test(note)) return true;
  return false;
}

async function ingredientForSource(db: D1Database, sourceKey: string): Promise<Ingredient | null> {
  const parts = sourceKey.split(":");
  if (parts[0] === "plan" && parts[2] === "also" && parts[3]) {
    const index = Number(parts[4]);
    if (!Number.isInteger(index) || index < 0) return null;
    const recipe = await getRecipe(db, parts[3]);
    return recipe?.ingredients[index] ?? null;
  }
  const index = Number(parts[2]);
  if (!Number.isInteger(index) || index < 0) return null;
  if (parts[0] === "plan" && parts[1]) {
    const entry = await getPlan(db, parts[1]);
    if (!entry?.recipeId) return null;
    const recipe = await getRecipe(db, entry.recipeId);
    return recipe?.ingredients[index] ?? null;
  }
  if (parts[0] === "recipe" && parts[1]) {
    const recipe = await getRecipe(db, parts[1]);
    return recipe?.ingredients[index] ?? null;
  }
  return null;
}

async function refreshItemQuantity(db: D1Database, itemId: string): Promise<void> {
  const item = await getItem(db, itemId);
  if (!item) return;
  const rows = await db
    .prepare(`SELECT source_key, quantity, unit FROM grocery_sources WHERE item_id = ?`)
    .bind(itemId)
    .all<{ source_key: string; quantity: number | null; unit: string | null }>();
  const parts: ShoppingPart[] = [];
  const identities = new Set<string>();
  let hand: { known: boolean; note: string | null } | null = null;
  for (const row of rows.results ?? []) {
    const manual = readHandSource(row.source_key);
    if (manual) {
      hand = manual;
      continue;
    }
    const identity = recipeIdentity(row.source_key);
    if (!identity) continue;
    identities.add(identity);
    if (row.quantity == null && (row.unit == null || row.unit === "")) {
      const ingredient = await ingredientForSource(db, row.source_key);
      parts.push({ quantity: ingredient?.quantity ?? null, unit: ingredient?.unit ?? null });
    } else {
      parts.push({ quantity: row.quantity, unit: row.unit });
    }
  }
  const shop = shoppingAmount(parts, identities.size);
  const summed = shop != null && !/^for \d+ recipes$/.test(shop);
  let next: string | null;
  if (summed) next = shop;
  else if (hand?.known && hand.note) next = hand.note;
  else if (hand && !hand.known && item.quantityNote && !isDisposableNote(item.quantityNote)) next = item.quantityNote;
  else next = shop;
  if (next !== item.quantityNote) await updateItem(db, itemId, { quantityNote: next });
}

async function insertContribution(db: D1Database, itemId: string, sourceKey: string, ingredient: Ingredient): Promise<void> {
  await db
    .prepare(`INSERT INTO grocery_sources (item_id, source_key, quantity, unit) VALUES (?, ?, ?, ?)`)
    .bind(itemId, sourceKey, ingredient.quantity ?? null, ingredient.unit ?? null)
    .run();
}

async function addOneIngredient(
  db: D1Database,
  ingredient: Ingredient,
  sourceKey: string,
  onHand: Set<string>,
  items?: Item[],
): Promise<keyof GroceryChange> {
  if (ingredient.buy === false || (ingredient.optional && ingredient.buy !== true)) return "skipped";
  if (onHand.has(groceryKey(ingredient.name))) return "skipped";
  const seen = await db
    .prepare(`SELECT item_id FROM grocery_sources WHERE source_key = ?`)
    .bind(sourceKey)
    .first<{ item_id: string }>();
  if (seen) return "skipped";
  const name = groceryName(ingredient.name);
  const key = groceryKey(name);
  const list = items ?? (await listItems(db));
  const existing = list.find((item) => !item.checked && groceryKey(item.name) === key && sectionsMatch(item.section, ingredient.section));
  if (!existing) {
    const item = await createItem(db, {
      name,
      quantityNote: null,
      store: "local",
      category: categoryForSection(ingredient.section),
      checked: false,
      brand: null,
      asin: null,
      barcode: null,
      staple: false,
      section: ingredient.section,
    });
    list.push(item);
    await insertContribution(db, item.id, sourceKey, ingredient);
    await refreshItemQuantity(db, item.id);
    return "added";
  }
  const sourceCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM grocery_sources WHERE item_id = ?`)
    .bind(existing.id)
    .first<{ n: number }>();
  if (Number(sourceCount?.n ?? 0) === 0) {
    await db
      .prepare(`INSERT INTO grocery_sources (item_id, source_key) VALUES (?, ?)`)
      .bind(existing.id, handSourceKey(existing.id, existing.quantityNote))
      .run();
  }
  if (existing.section == null) {
    await updateItem(db, existing.id, { section: ingredient.section });
    existing.section = ingredient.section;
  }
  await insertContribution(db, existing.id, sourceKey, ingredient);
  await refreshItemQuantity(db, existing.id);
  return "updated";
}

export type ItemRecipe = { id: string; name: string; imageUrl: string | null };

export async function recipesForGroceries(db: D1Database): Promise<Record<string, ItemRecipe[]>> {
  const sources = await db.prepare(`SELECT item_id, source_key FROM grocery_sources`).all<{ item_id: string; source_key: string }>();
  const plans = await db
    .prepare(`SELECT id, recipe_id FROM plan_entries WHERE recipe_id IS NOT NULL`)
    .all<{ id: string; recipe_id: string }>();
  const recipes = await db.prepare(`SELECT id, name, image_url FROM recipes`).all<{ id: string; name: string; image_url: string | null }>();
  const planRecipe = new Map((plans.results ?? []).map((row) => [row.id, row.recipe_id]));
  const recipeById = new Map((recipes.results ?? []).map((row) => [row.id, row]));
  const linked: Record<string, ItemRecipe[]> = {};
  for (const source of sources.results ?? []) {
    const parts = source.source_key.split(":");
    let recipeId: string | null = null;
    if (parts[0] === "recipe") recipeId = parts[1] ?? null;
    if (parts[0] === "plan") recipeId = planRecipe.get(parts[1] ?? "") ?? null;
    if (!recipeId) continue;
    const recipe = recipeById.get(recipeId);
    if (!recipe) continue;
    const list = linked[source.item_id] ?? [];
    if (!list.some((entry) => entry.id === recipe.id)) {
      list.push({ id: recipe.id, name: recipe.name, imageUrl: recipe.image_url });
    }
    linked[source.item_id] = list;
  }
  return linked;
}

export async function deleteRecipeSourcedItems(db: D1Database): Promise<number> {
  const rows = await db
    .prepare(`SELECT DISTINCT item_id FROM grocery_sources WHERE source_key LIKE 'plan:%' OR source_key LIKE 'recipe:%'`)
    .all<{ item_id: string }>();
  let deleted = 0;
  for (const row of rows.results ?? []) {
    const item = (await listItems(db)).find((entry) => entry.id === row.item_id);
    if (!item) continue;
    await deleteItem(db, row.item_id);
    deleted += 1;
  }
  return deleted;
}

export async function markCooked(db: D1Database, recipeId: string): Promise<Recipe> {
  const existing = await getRecipe(db, recipeId);
  if (!existing) throw new HttpError(404, "That recipe isn't here anymore.");
  const today = easternToday();
  const already = await db
    .prepare(`SELECT id FROM recipe_made WHERE recipe_id = ? AND made_on = ?`)
    .bind(recipeId, today)
    .first<{ id: string }>();
  if (!already) {
    await db
      .prepare(`INSERT INTO recipe_made (id, recipe_id, made_on, created_at) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), recipeId, today, nowIso())
      .run();
  }
  const recipe = await getRecipe(db, recipeId);
  if (!recipe) throw new HttpError(404, "That recipe isn't here anymore.");
  return recipe;
}

export type RecipeFeedback = { id: string; recipeId: string; stars: number; comment: string | null; date: string };

export async function listFeedback(db: D1Database, recipeId: string): Promise<RecipeFeedback[]> {
  const recipe = await getRecipe(db, recipeId);
  if (!recipe) throw new HttpError(404, "That recipe isn't here anymore.");
  const rows = await db
    .prepare(`SELECT id, recipe_id, stars, comment, created_at FROM recipe_feedback WHERE recipe_id = ? ORDER BY created_at DESC`)
    .bind(recipeId)
    .all<{ id: string; recipe_id: string; stars: number; comment: string | null; created_at: string }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    recipeId: row.recipe_id,
    stars: Number(row.stars),
    comment: row.comment,
    date: row.created_at.slice(0, 10),
  }));
}

export async function addFeedback(
  db: D1Database,
  recipeId: string,
  stars: number,
  comment: string | null,
): Promise<RecipeFeedback> {
  const recipe = await getRecipe(db, recipeId);
  if (!recipe) throw new HttpError(404, "That recipe isn't here anymore.");
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  await db
    .prepare(`INSERT INTO recipe_feedback (id, recipe_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, recipeId, stars, comment, createdAt)
    .run();
  return { id, recipeId, stars, comment, date: createdAt.slice(0, 10) };
}

export async function withGroceryRecipes<T extends Item>(db: D1Database, items: T[]): Promise<Array<T & { recipes: ItemRecipe[] }>> {
  const linked = await recipesForGroceries(db);
  return items.map((item) => ({ ...item, recipes: linked[item.id] ?? [] }));
}
