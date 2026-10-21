/**
 * One-time cleanup for the Nov 13 Chili-Lime Chicken Breast Burrito Bowls dinner.
 *
 * That meal was planned past the grocery window and still contributed amounts.
 * This removes only that plan's grocery_sources rows. Checked lines stay checked.
 * Other meals and hand-typed items stay, including their amounts when this meal
 * was not their only source.
 *
 * Dry-run is the default. It prints the before/after diff and writes nothing.
 *
 *   node --experimental-strip-types scripts/cleanup-nov13-groceries.mjs
 *   node --experimental-strip-types scripts/cleanup-nov13-groceries.mjs --apply
 *
 * GROCERY_DB can point at a D1 sqlite file. Otherwise the local wrangler database
 * that contains plan_entries is used.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeStoredIngredient, shoppingAmount } from "../src/ingredients.ts";

const TARGET_DATE = "2026-11-13";
const apply = process.argv.includes("--apply");

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

const dbPath = findDatabase();
if (!dbPath) {
  console.error("No local grocery database found. Set GROCERY_DB to the sqlite file.");
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: !apply });
const plans = db
  .prepare(
    `SELECT p.id, p.plan_date, p.meal, p.entry_type, r.name
     FROM plan_entries p
     LEFT JOIN recipes r ON r.id = p.recipe_id
     WHERE p.plan_date = ?
       AND (
         lower(coalesce(r.name, '')) LIKE '%chili-lime%burrito%'
         OR lower(coalesce(r.name, '')) LIKE '%chili lime%burrito%'
         OR lower(coalesce(r.name, '')) LIKE '%burrito bowl%'
       )`,
  )
  .all(TARGET_DATE);

console.log(`cleanup-nov13-groceries`);
console.log(`mode: ${apply ? "apply" : "dry-run"}`);
console.log(`database: ${dbPath}`);
console.log("");

if (plans.length !== 1) {
  if (!plans.length) {
    console.log(`No dinner on ${TARGET_DATE} matches Chili-Lime Chicken Breast Burrito Bowls.`);
  } else {
    console.log(`Expected one ${TARGET_DATE} burrito-bowl dinner, found ${plans.length}:`);
    for (const plan of plans) console.log(`  ${plan.id}  ${plan.meal}  ${plan.name}`);
    console.log("Nothing was changed.");
    process.exit(1);
  }
  console.log("Grocery list: no difference.");
  console.log("Checked state: unchanged.");
  process.exit(0);
}

const plan = plans[0];
const prefix = `plan:${plan.id}:`;
console.log(`meal: ${plan.plan_date} ${plan.meal} — ${plan.name}`);
console.log(`plan: ${plan.id}`);
console.log("");

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

const sources = db.prepare(`SELECT item_id, source_key, quantity, unit FROM grocery_sources WHERE instr(source_key, ?) = 1`).all(prefix);
if (!sources.length) {
  console.log("That meal has no grocery contributions.");
  console.log("Grocery list: no difference.");
  console.log("Checked state: unchanged.");
  process.exit(0);
}

const byItem = new Map();
for (const source of sources) {
  const list = byItem.get(source.item_id) ?? [];
  list.push(source);
  byItem.set(source.item_id, list);
}

const changes = [];
for (const [itemId, dropping] of byItem) {
  const item = db.prepare(`SELECT id, name, quantity_note, checked, deleted_at FROM items WHERE id = ?`).get(itemId);
  const all = db.prepare(`SELECT source_key, quantity, unit FROM grocery_sources WHERE item_id = ?`).all(itemId);
  const dropKeys = new Set(dropping.map((row) => row.source_key));
  const kept = all.filter((row) => !dropKeys.has(row.source_key));
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
    sources: dropping.length,
  });
}

changes.sort((a, b) => a.name.localeCompare(b.name));
let different = 0;
for (const change of changes) {
  const amountChanged = change.removed || change.before !== change.after;
  if (amountChanged || change.action.startsWith("remove")) different += 1;
  console.log(`- ${change.name}`);
  console.log(`  quantity: ${quote(change.before)} -> ${change.removed ? "(line removed)" : quote(change.after)}`);
  console.log(`  checked: ${change.checked} -> ${change.checked}`);
  console.log(`  action: ${change.action} (${change.sources} source${change.sources === 1 ? "" : "s"})`);
}
console.log("");
console.log(`${changes.length} grocery line${changes.length === 1 ? "" : "s"} touched by this meal.`);
console.log("Checked flags stay as they are. Other lines are not listed because they do not change.");

if (!apply) {
  console.log("Dry-run only. Re-run with --apply to write this diff.");
  process.exit(0);
}

db.exec("BEGIN");
try {
  db.prepare(`DELETE FROM grocery_sources WHERE instr(source_key, ?) = 1`).run(prefix);
  const now = new Date().toISOString();
  for (const change of changes) {
    if (change.checked || change.action === "remove leftover source") continue;
    if (change.removed) {
      db.prepare(`DELETE FROM items WHERE id = ? AND checked = 0`).run(change.itemId);
      continue;
    }
    if (change.before !== change.after) {
      db.prepare(`UPDATE items SET quantity_note = ?, updated_at = ? WHERE id = ? AND checked = 0`).run(change.after, now, change.itemId);
    }
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
console.log("Applied.");
