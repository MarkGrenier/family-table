import { createItem, deleteItem, listItems, updateItem } from "./db";
import {
  buildGroceryNote,
  groceryName,
  mergeGroceryNote,
  scaleIngredient,
  unmergeGroceryNote,
  type Ingredient,
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
  external_id: string | null;
  covers_nights: number | null;
  night_before_json: string;
  prep_steps_json: string;
  cook_steps_json: string;
  kids_plates: string | null;
  reheating: string | null;
  created_at: string;
  updated_at: string;
};

const RECIPE_COLUMNS =
  "id, name, image_url, servings, ingredients_json, steps_json, total_time, source_url, favorite, external_id, covers_nights, night_before_json, prep_steps_json, cook_steps_json, kids_plates, reheating, created_at, updated_at";

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
    externalId: row.external_id,
    coversNights: row.covers_nights == null ? null : Number(row.covers_nights),
    nightBefore: parseJson<string[]>(row.night_before_json, []),
    prepSteps: parseJson<string[]>(row.prep_steps_json, []),
    cookSteps: parseJson<CookStep[]>(row.cook_steps_json, []),
    kidsPlates: row.kids_plates,
    reheating: row.reheating,
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
      `INSERT INTO recipes (
         id, name, image_url, servings, ingredients_json, steps_json, total_time, source_url, favorite,
         external_id, covers_nights, night_before_json, prep_steps_json, cook_steps_json, kids_plates, reheating,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    externalId: patch.externalId === undefined ? existing.externalId : patch.externalId,
    coversNights: patch.coversNights === undefined ? existing.coversNights : patch.coversNights,
    nightBefore: patch.nightBefore ?? existing.nightBefore,
    prepSteps: patch.prepSteps ?? existing.prepSteps,
    cookSteps: patch.cookSteps ?? existing.cookSteps,
    kidsPlates: patch.kidsPlates === undefined ? existing.kidsPlates : patch.kidsPlates,
    reheating: patch.reheating === undefined ? existing.reheating : patch.reheating,
    updatedAt: nowIso(),
  };
  await db
    .prepare(
      `UPDATE recipes
       SET name = ?, image_url = ?, servings = ?, ingredients_json = ?, steps_json = ?, total_time = ?, source_url = ?, favorite = ?,
           external_id = ?, covers_nights = ?, night_before_json = ?, prep_steps_json = ?, cook_steps_json = ?, kids_plates = ?, reheating = ?,
           updated_at = ?
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

async function getPlan(db: D1Database, id: string): Promise<PlanEntry | null> {
  const row = await db.prepare(`${PLAN_SELECT} WHERE p.id = ?`).bind(id).first<PlanRow>();
  return row ? planFromRow(row) : null;
}

async function planOn(db: D1Database, date: string, meal: string): Promise<PlanEntry | null> {
  const row = await db.prepare(`${PLAN_SELECT} WHERE p.plan_date = ? AND p.meal = ?`).bind(date, meal).first<PlanRow>();
  return row ? planFromRow(row) : null;
}

export async function savePlan(db: D1Database, input: PlanInput): Promise<PlanEntry> {
  if (input.type === "recipe" && input.recipeId) {
    const recipe = await getRecipe(db, input.recipeId);
    if (!recipe) throw new HttpError(400, "That recipe isn't here anymore.");
  }
  const previous = await planOn(db, input.date, input.meal);
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
  const saved = await planOn(db, input.date, input.meal);
  if (!saved) throw new HttpError(500, "Something went wrong. Try again.");
  const sameRecipe =
    previous?.type === "recipe" && saved.type === "recipe" && previous.recipeId === saved.recipeId && Boolean(saved.recipeId);
  if (!sameRecipe) {
    if (previous?.type === "recipe") await removePlanGroceries(db, previous);
    if (saved.type === "recipe" && saved.recipeId) await addEntryGroceries(db, saved);
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
  return (rows.results ?? []).map(planFromRow);
}

export async function deletePlan(db: D1Database, id: string): Promise<void> {
  const existing = await getPlan(db, id);
  if (!existing) throw new HttpError(404, "That meal isn't planned anymore.");
  if (existing.type === "recipe") await removePlanGroceries(db, existing);
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

async function addEntryGroceries(db: D1Database, entry: PlanEntry): Promise<GroceryChange> {
  const totals = { added: 0, updated: 0, skipped: 0 };
  if (entry.type !== "recipe" || !entry.recipeId) return totals;
  const recipe = await getRecipe(db, entry.recipeId);
  if (!recipe) return totals;
  for (let index = 0; index < recipe.ingredients.length; index += 1) {
    const change = await addOneIngredient(db, recipe.ingredients[index], recipe.name, `plan:${entry.id}:${index}`);
    totals[change] += 1;
  }
  return totals;
}

export async function addPlanGroceries(db: D1Database, from: string, to: string, planId: string | null): Promise<GroceryChange> {
  const planned = await listPlan(db, from, to);
  const entries = planId ? planned.filter((entry) => entry.id === planId) : planned;
  const totals = { added: 0, updated: 0, skipped: 0 };
  for (const entry of entries) {
    const change = await addEntryGroceries(db, entry);
    totals.added += change.added;
    totals.updated += change.updated;
    totals.skipped += change.skipped;
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
      recipe: entry.recipeId ? await getRecipe(db, entry.recipeId) : null,
    });
  }
  return { weekStart, days };
}

export async function replaceWeek(db: D1Database, input: WeekInput): Promise<{ weekStart: string; days: WeekDay[] }> {
  const end = addDays(input.weekStart, 6);
  const existing = await listPlan(db, input.weekStart, end);
  for (const entry of existing) {
    if (entry.type === "recipe") await removePlanGroceries(db, entry);
  }
  await db.prepare(`DELETE FROM plan_entries WHERE plan_date >= ? AND plan_date <= ?`).bind(input.weekStart, end).run();
  const now = nowIso();
  for (const day of input.days) {
    let recipeId = day.recipeId;
    if (day.type === "recipe" && day.recipe) recipeId = (await upsertRecipe(db, day.recipe)).id;
    if (day.type === "recipe" && recipeId) {
      const recipe = await getRecipe(db, recipeId);
      if (!recipe) throw new HttpError(400, "That recipe isn't here anymore.");
    }
    await db
      .prepare(
        `INSERT INTO plan_entries (id, plan_date, meal, entry_type, recipe_id, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), day.date, day.meal, day.type, day.type === "recipe" ? recipeId : null, day.note, now, now)
      .run();
  }
  const saved = await listPlan(db, input.weekStart, end);
  for (const entry of saved) {
    if (entry.type === "recipe") await addEntryGroceries(db, entry);
  }
  return getWeek(db, input.weekStart);
}

async function removePlanGroceries(db: D1Database, entry: PlanEntry): Promise<void> {
  const recipe = entry.recipeId ? await getRecipe(db, entry.recipeId) : null;
  const rows = await db
    .prepare(`SELECT item_id, source_key FROM grocery_sources WHERE source_key GLOB ?`)
    .bind(`plan:${entry.id}:*`)
    .all<{ item_id: string; source_key: string }>();
  for (const row of rows.results ?? []) {
    const index = Number(row.source_key.slice(row.source_key.lastIndexOf(":") + 1));
    const ingredient = recipe && Number.isInteger(index) ? recipe.ingredients[index] : undefined;
    await removeOneSource(db, row.item_id, row.source_key, ingredient ?? null, recipe?.name ?? entry.recipeName ?? "");
  }
}

async function removeOneSource(
  db: D1Database,
  itemId: string,
  sourceKey: string,
  ingredient: Ingredient | null,
  recipeName: string,
): Promise<void> {
  const items = await listItems(db);
  const item = items.find((entry) => entry.id === itemId);
  if (!item || item.checked) {
    await db.prepare(`DELETE FROM grocery_sources WHERE item_id = ? AND source_key = ?`).bind(itemId, sourceKey).run();
    return;
  }
  const others = await db
    .prepare(`SELECT source_key FROM grocery_sources WHERE item_id = ? AND source_key != ?`)
    .bind(itemId, sourceKey)
    .all<{ source_key: string }>();
  if ((others.results ?? []).length === 0) {
    await deleteItem(db, itemId);
    return;
  }
  if (ingredient && recipeName) {
    await updateItem(db, itemId, { quantityNote: unmergeGroceryNote(item.quantityNote, ingredient, recipeName) });
  }
  await db.prepare(`DELETE FROM grocery_sources WHERE item_id = ? AND source_key = ?`).bind(itemId, sourceKey).run();
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
  const sourceCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM grocery_sources WHERE item_id = ?`)
    .bind(existing.id)
    .first<{ n: number }>();
  if (Number(sourceCount?.n ?? 0) === 0) {
    await db.prepare(`INSERT INTO grocery_sources (item_id, source_key) VALUES (?, ?)`).bind(existing.id, `user:${existing.id}`).run();
  }
  const note = mergeGroceryNote(existing.quantityNote, ingredient, recipeName);
  await updateItem(db, existing.id, { quantityNote: note || null });
  await db.prepare(`INSERT INTO grocery_sources (item_id, source_key) VALUES (?, ?)`).bind(existing.id, sourceKey).run();
  return "updated";
}
