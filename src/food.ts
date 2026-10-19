import { createItem, listItems, updateItem } from "./db";
import {
  buildGroceryNote,
  groceryName,
  mergeGroceryNote,
  scaleIngredient,
  type Ingredient,
} from "./ingredients";
import { HttpError } from "./http";
import type { EventInput, PlanInput, RecipeInput, RecipePatch } from "./food-validate";

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
  createdAt: string;
  updatedAt: string;
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
  created_at: string;
  updated_at: string;
};

const RECIPE_COLUMNS =
  "id, name, image_url, servings, ingredients_json, steps_json, total_time, source_url, favorite, created_at, updated_at";

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

function recipeFromRow(row: RecipeRow): Recipe {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    servings: Number(row.servings) || 4,
    ingredients: parseJson<Ingredient[]>(row.ingredients_json, []),
    steps: parseJson<string[]>(row.steps_json, []),
    totalTime: row.total_time,
    sourceUrl: row.source_url,
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listRecipes(db: D1Database, query = ""): Promise<Recipe[]> {
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? await db
        .prepare(
          `SELECT ${RECIPE_COLUMNS} FROM recipes WHERE lower(name) LIKE ? ESCAPE '\\' ORDER BY favorite DESC, name COLLATE NOCASE`,
        )
        .bind(`%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
        .all<RecipeRow>()
    : await db.prepare(`SELECT ${RECIPE_COLUMNS} FROM recipes ORDER BY favorite DESC, name COLLATE NOCASE`).all<RecipeRow>();
  return (rows.results ?? []).map(recipeFromRow);
}

export async function getRecipe(db: D1Database, id: string): Promise<Recipe | null> {
  const row = await db.prepare(`SELECT ${RECIPE_COLUMNS} FROM recipes WHERE id = ?`).bind(id).first<RecipeRow>();
  return row ? recipeFromRow(row) : null;
}

export async function createRecipe(db: D1Database, input: RecipeInput): Promise<Recipe> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO recipes (id, name, image_url, servings, ingredients_json, steps_json, total_time, source_url, favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.imageUrl,
      input.servings,
      JSON.stringify(input.ingredients),
      JSON.stringify(input.steps),
      input.totalTime,
      input.sourceUrl,
      input.favorite ? 1 : 0,
      now,
      now,
    )
    .run();
  const recipe = await getRecipe(db, id);
  if (!recipe) throw new HttpError(500, "Something went wrong. Try again.");
  return recipe;
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
    updatedAt: nowIso(),
  };
  await db
    .prepare(
      `UPDATE recipes
       SET name = ?, image_url = ?, servings = ?, ingredients_json = ?, steps_json = ?, total_time = ?, source_url = ?, favorite = ?, updated_at = ?
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
      next.updatedAt,
      id,
    )
    .run();
  return next;
}

export async function deleteRecipe(db: D1Database, id: string): Promise<void> {
  const existing = await getRecipe(db, id);
  if (!existing) throw new HttpError(404, "That recipe isn't here anymore.");
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
  recipe_name: string | null;
  image_url: string | null;
};

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
  };
}

const PLAN_SELECT = `
  SELECT p.id, p.plan_date, p.meal, p.entry_type, p.recipe_id, p.note, r.name AS recipe_name, r.image_url
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
  return (rows.results ?? []).map(planFromRow);
}

export async function savePlan(db: D1Database, input: PlanInput): Promise<PlanEntry> {
  if (input.type === "recipe" && input.recipeId) {
    const recipe = await getRecipe(db, input.recipeId);
    if (!recipe) throw new HttpError(400, "That recipe isn't here anymore.");
  }
  const now = nowIso();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO plan_entries (id, plan_date, meal, entry_type, recipe_id, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (plan_date, meal) DO UPDATE SET
         entry_type = excluded.entry_type,
         recipe_id = excluded.recipe_id,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    )
    .bind(id, input.date, input.meal, input.type, input.recipeId, input.note, now, now)
    .run();
  const row = await db
    .prepare(`${PLAN_SELECT} WHERE p.plan_date = ? AND p.meal = ?`)
    .bind(input.date, input.meal)
    .first<PlanRow>();
  if (!row) throw new HttpError(500, "Something went wrong. Try again.");
  return planFromRow(row);
}

export async function listAllPlan(db: D1Database): Promise<PlanEntry[]> {
  const rows = await db
    .prepare(
      `${PLAN_SELECT}
       ORDER BY p.plan_date, CASE p.meal WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END`,
    )
    .all<PlanRow>();
  return (rows.results ?? []).map(planFromRow);
}

export async function deletePlan(db: D1Database, id: string): Promise<void> {
  const result = await db.prepare(`DELETE FROM plan_entries WHERE id = ?`).bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, "That meal isn't planned anymore.");
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
  const totals = { added: 0, updated: 0, skipped: 0 };
  for (let index = 0; index < recipe.ingredients.length; index += 1) {
    const change = await addOneIngredient(
      db,
      scaleIngredient(recipe.ingredients[index], factor),
      recipe.name,
      `recipe:${recipe.id}:${index}`,
    );
    totals[change] += 1;
  }
  return totals;
}

export async function addPlanGroceries(db: D1Database, from: string, to: string, planId: string | null): Promise<GroceryChange> {
  const planned = await listPlan(db, from, to);
  const entries = planId ? planned.filter((entry) => entry.id === planId) : planned;
  const totals = { added: 0, updated: 0, skipped: 0 };
  for (const entry of entries) {
    if (entry.type !== "recipe" || !entry.recipeId) continue;
    const recipe = await getRecipe(db, entry.recipeId);
    if (!recipe) continue;
    for (let index = 0; index < recipe.ingredients.length; index += 1) {
      const change = await addOneIngredient(db, recipe.ingredients[index], recipe.name, `plan:${entry.id}:${index}`);
      totals[change] += 1;
    }
  }
  return totals;
}

async function addOneIngredient(
  db: D1Database,
  ingredient: Ingredient,
  recipeName: string,
  sourceKey: string,
): Promise<keyof GroceryChange> {
  const name = groceryName(ingredient.name);
  const items = await listItems(db);
  const existing = items.find((item) => !item.checked && item.name.toLowerCase() === name.toLowerCase());
  if (!existing) {
    const recipes = new Map<string, number>([[recipeName, 1]]);
    const item = await createItem(db, {
      name,
      quantityNote: buildGroceryNote(ingredient.quantity, ingredient.unit, recipes),
      store: "local",
      category: "shelf",
      checked: false,
      brand: null,
      asin: null,
      barcode: null,
      staple: false,
    });
    await db.prepare(`INSERT INTO grocery_sources (item_id, source_key) VALUES (?, ?)`).bind(item.id, sourceKey).run();
    return "added";
  }
  const seen = await db
    .prepare(`SELECT 1 AS ok FROM grocery_sources WHERE item_id = ? AND source_key = ?`)
    .bind(existing.id, sourceKey)
    .first<{ ok: number }>();
  if (seen) return "skipped";
  const note = mergeGroceryNote(existing.quantityNote, ingredient, recipeName);
  await updateItem(db, existing.id, { quantityNote: note || null });
  await db.prepare(`INSERT INTO grocery_sources (item_id, source_key) VALUES (?, ?)`).bind(existing.id, sourceKey).run();
  return "updated";
}
