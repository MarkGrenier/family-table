/**
 * Remove grocery contributions for every meal planned after the grocery window.
 *
 * The window is this Monday through Sunday of next week (Eastern time), the same
 * boundary as src/food.ts. Meals dated after that stay on the calendar. Their
 * grocery sources are removed, amounts are recomputed, and an unchecked line with
 * nothing left is dropped. A checked line stays, including its amount. A line you
 * added by hand stays. Each of those meals is marked groceries_deferred = 1 so it
 * is shopped once when its date later enters the window.
 *
 * Dry-run reads a sqlite copy and writes nothing to it. --sql writes statements
 * for `wrangler d1 execute --remote --file`. Apply migration 0011 first so
 * groceries_deferred exists on the live database.
 *
 *   npm run cleanup-future -- --db live.sqlite
 *   npm run cleanup-future -- --db live.sqlite --sql cleanup-future-groceries.sql
 *   npm run cleanup-future -- --db live.sqlite --today 2026-10-21
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeStoredIngredient, shoppingAmount } from "../src/ingredients.ts";

function easternToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(iso, count) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** Monday–Sunday, this week and next. Same boundary as groceryWindow in src/food.ts. */
function groceryWindow(today) {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const from = addDays(today, weekday === 0 ? -6 : 1 - weekday);
  return { from, to: addDays(from, 13) };
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function walk(dir, found) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) walk(path, found);
    else if (name.name.endsWith(".sqlite")) found.push(path);
  }
}

function findDatabase() {
  if (process.env.GROCERY_DB) return process.env.GROCERY_DB;
  const root = join(process.cwd(), ".wrangler/state/v3/d1");
  const files = [];
  try {
    walk(root, files);
  } catch {
    return null;
  }
  const matches = [];
  for (const path of files) {
    let db;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const table = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plan_entries'`).get();
      if (table) matches.push(path);
    } catch {
      /* Not a grocery database. */
    } finally {
      db?.close();
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return matches[0];
}

function recipeIdentity(sourceKey) {
  const parts = sourceKey.split(":");
  if (parts[0] === "plan" && parts[2] === "also" && parts[1] && parts[3]) return `plan:${parts[1]}:also:${parts[3]}`;
  if ((parts[0] === "plan" || parts[0] === "recipe") && parts[1]) return `${parts[0]}:${parts[1]}`;
  return null;
}

function readHandSource(sourceKey) {
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

function isDisposableNote(note) {
  if (!note) return true;
  if (/^for \d+ recipes$/.test(note)) return true;
  if (/\b(tsp|tbsp|teaspoons?|tablespoons?|cups?)\b/i.test(note)) return true;
  if (note.includes("+")) return true;
  if (/\bcubes?\b/i.test(note)) return true;
  return false;
}

function quote(value) {
  return value == null || value === "" ? "(none)" : JSON.stringify(value);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlValue(value) {
  return value == null ? "NULL" : sqlString(value);
}

const todayArg = option("--today");
const today = todayArg ?? easternToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
  console.error("--today must be YYYY-MM-DD");
  process.exit(1);
}
const window = groceryWindow(today);
const sqlPath = option("--sql");
const dbPath = option("--db") ?? findDatabase();
if (!dbPath) {
  console.error("No sqlite database. Pass --db path/to/live.sqlite");
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const plans = db
  .prepare(
    `SELECT p.id, p.plan_date, p.meal, p.entry_type, p.note, r.name AS recipe_name
     FROM plan_entries p
     LEFT JOIN recipes r ON r.id = p.recipe_id
     WHERE p.plan_date > ?
     ORDER BY p.plan_date, p.meal`,
  )
  .all(window.to);

const futureIds = new Set(plans.map((plan) => plan.id));
const recipes = new Map();
for (const row of db.prepare(`SELECT id, ingredients_json FROM recipes`).all()) {
  let parsed = [];
  try {
    parsed = JSON.parse(row.ingredients_json || "[]");
  } catch {
    parsed = [];
  }
  recipes.set(
    row.id,
    (Array.isArray(parsed) ? parsed : []).map((entry) => normalizeStoredIngredient(entry)).filter(Boolean),
  );
}
const planRecipe = new Map(
  db
    .prepare(`SELECT id, recipe_id FROM plan_entries WHERE recipe_id IS NOT NULL`)
    .all()
    .map((row) => [row.id, row.recipe_id]),
);

function ingredientFor(sourceKey) {
  const parts = sourceKey.split(":");
  if (parts[0] === "plan" && parts[2] === "also" && parts[3]) {
    const index = Number(parts[4]);
    if (!Number.isInteger(index) || index < 0) return null;
    return recipes.get(parts[3])?.[index] ?? null;
  }
  const index = Number(parts[2]);
  if (!Number.isInteger(index) || index < 0) return null;
  const recipeId = parts[0] === "plan" ? planRecipe.get(parts[1] ?? "") ?? null : parts[0] === "recipe" ? parts[1] ?? null : null;
  if (!recipeId) return null;
  return recipes.get(recipeId)?.[index] ?? null;
}

function noteFor(item, sources) {
  const parts = [];
  const identities = new Set();
  let hand = null;
  for (const row of sources) {
    const manual = readHandSource(row.source_key);
    if (manual) {
      hand = manual;
      continue;
    }
    const identity = recipeIdentity(row.source_key);
    if (!identity) continue;
    identities.add(identity);
    if (row.quantity == null && (row.unit == null || row.unit === "")) {
      const ingredient = ingredientFor(row.source_key);
      parts.push({ quantity: ingredient?.quantity ?? null, unit: ingredient?.unit ?? null });
    } else {
      parts.push({ quantity: row.quantity, unit: row.unit });
    }
  }
  const shop = shoppingAmount(parts, identities.size);
  const summed = shop != null && !/^for \d+ recipes$/.test(shop);
  if (summed) return shop;
  if (hand?.known && hand.note) return hand.note;
  if (hand && !hand.known && item.quantity_note && !isDisposableNote(item.quantity_note)) return item.quantity_note;
  return shop;
}

function isFutureSource(sourceKey) {
  const parts = sourceKey.split(":");
  return parts[0] === "plan" && futureIds.has(parts[1] ?? "");
}

const allSources = db.prepare(`SELECT item_id, source_key, quantity, unit FROM grocery_sources`).all();
const byItem = new Map();
for (const source of allSources) {
  if (!isFutureSource(source.source_key)) continue;
  const list = byItem.get(source.item_id) ?? [];
  list.push(source);
  byItem.set(source.item_id, list);
}

const changes = [];
for (const [itemId, dropping] of byItem) {
  const item = db.prepare(`SELECT id, name, quantity_note, checked, deleted_at FROM items WHERE id = ?`).get(itemId);
  const all = allSources.filter((row) => row.item_id === itemId);
  const dropKeys = new Set(dropping.map((row) => row.source_key));
  const kept = all.filter((row) => !dropKeys.has(row.source_key));
  const manual = all.some((row) => row.source_key.startsWith("user:"));
  const checked = item ? Number(item.checked) === 1 : false;
  const before = item?.quantity_note ?? null;
  let action = "remove source only";
  let after = before;
  let removed = false;
  if (!item || item.deleted_at) {
    action = "remove leftover source";
    after = before;
  } else if (checked) {
    action = "remove source, keep checked line";
    after = before;
  } else if (!kept.length && manual) {
    action = "keep hand-added line";
    after = before;
  } else if (!kept.length) {
    action = "remove line";
    after = null;
    removed = true;
  } else {
    after = noteFor(item, kept);
    action = after === before ? "remove source, amount unchanged" : "update amount";
  }
  changes.push({
    itemId,
    name: item?.name ?? "(missing item)",
    checked,
    before,
    after,
    action,
    removed,
    sources: dropping.map((row) => row.source_key),
  });
}
changes.sort((a, b) => a.name.localeCompare(b.name) || a.itemId.localeCompare(b.itemId));

const stamp = new Date().toISOString();
const statements = [];
for (const change of changes) {
  for (const sourceKey of change.sources) {
    statements.push(
      `DELETE FROM grocery_sources WHERE item_id = ${sqlString(change.itemId)} AND source_key = ${sqlString(sourceKey)};`,
    );
  }
  if (change.removed) {
    statements.push(`DELETE FROM items WHERE id = ${sqlString(change.itemId)} AND checked = 0 AND deleted_at IS NULL;`);
  } else if (change.action === "update amount") {
    statements.push(
      `UPDATE items SET quantity_note = ${sqlValue(change.after)}, updated_at = ${sqlString(stamp)} WHERE id = ${sqlString(change.itemId)} AND checked = 0 AND deleted_at IS NULL;`,
    );
  }
}
for (const plan of plans) {
  statements.push(
    `UPDATE plan_entries SET groceries_deferred = 1, updated_at = ${sqlString(stamp)} WHERE id = ${sqlString(plan.id)} AND plan_date > ${sqlString(window.to)};`,
  );
}

const header = [
  "-- Grocery cleanup for meals planned after the current window.",
  `-- Today ${today}. Window ${window.from} through ${window.to}. Meals after ${window.to} are included.`,
  "-- Apply migrations/0011_groceries_deferred.sql first (wrangler d1 migrations apply grocery --remote).",
  "-- Plan rows stay. groceries_deferred is set to 1 so each meal is shopped once when it enters the window.",
  "-- Checked lines stay checked. A line added by hand stays. An unchecked line with no sources left is removed.",
  `-- Generated ${stamp}.`,
  "",
];

console.log("cleanup-future-groceries");
console.log("mode: dry-run");
console.log(`database: ${dbPath}`);
console.log(`today: ${today}`);
console.log(`window: ${window.from} through ${window.to}`);
console.log(`meals after ${window.to}: ${plans.length}`);
console.log("");

if (!plans.length) {
  console.log(`No planned meals after ${window.to}.`);
  console.log("Grocery list: no difference.");
  console.log("The sqlite copy was not modified.");
} else {
  for (const plan of plans) {
    const title = plan.recipe_name || plan.note || plan.entry_type;
    console.log(`- ${plan.plan_date} ${plan.meal} — ${title}`);
    console.log(`  plan ${plan.id} stays, groceries_deferred = 1`);
  }
  console.log("");
  if (!changes.length) {
    console.log("Those meals have no grocery contributions.");
  } else {
    for (const change of changes) {
      console.log(`- ${change.name}`);
      console.log(`  quantity: ${quote(change.before)} -> ${change.removed ? "(line removed)" : quote(change.after)}`);
      console.log(`  checked: ${change.checked} -> ${change.checked}`);
      console.log(`  action: ${change.action} (${change.sources.length} source${change.sources.length === 1 ? "" : "s"})`);
    }
  }
  console.log("");
  console.log(`${plans.length} plan${plans.length === 1 ? "" : "s"} kept and marked deferred.`);
  console.log(`${changes.length} grocery line${changes.length === 1 ? "" : "s"} touched.`);
  console.log("The sqlite copy was not modified.");
}

db.close();

if (sqlPath) {
  const body = plans.length
    ? `${header.join("\n")}${statements.join("\n")}\n`
    : `${header.join("\n")}-- No planned meals after ${window.to}. Nothing to change.\n`;
  writeFileSync(sqlPath, body);
  console.log(`Wrote ${statements.length} statement${statements.length === 1 ? "" : "s"} to ${sqlPath}`);
} else {
  console.log("Pass --sql cleanup-future-groceries.sql to write the wrangler file.");
}
