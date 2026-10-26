import { HttpError } from "./http";
import { groceryKey, groceryName, type FoodSection } from "./ingredients";
import {
  barcodeKeys,
  CATEGORIES,
  type ItemInput,
  type ItemPatch,
  type StapleInput,
  type Store,
} from "./validate";

export type Item = {
  id: string;
  name: string;
  quantityNote: string | null;
  store: Store;
  category: string;
  checked: boolean;
  brand: string | null;
  asin: string | null;
  barcode: string | null;
  staple: boolean;
  stapleId: string | null;
  section: FoodSection | null;
  imageUrl: string | null;
  substitute: string | null;
  notes: string | null;
  storeTag: string | null;
  storeName: string | null;
  fresh: boolean;
  buyDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Staple = {
  id: string;
  name: string;
  store: Store;
  category: string;
  brand: string | null;
  asin: string | null;
  barcode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BarcodeHit = {
  stapleId: string | null;
  alreadyOnList: boolean;
  name: string;
  store: Store;
  category: string;
  brand: string | null;
  asin: string | null;
  barcode: string;
};

type ItemRow = {
  id: string;
  name: string;
  quantity_note: string | null;
  store: Store;
  category: string;
  checked: number;
  brand: string | null;
  asin: string | null;
  barcode: string | null;
  staple: number;
  staple_id: string | null;
  section: string | null;
  image_url: string | null;
  substitute: string | null;
  notes: string | null;
  store_tag: string | null;
  fresh: number;
  buy_date: string | null;
  created_at: string;
  updated_at: string;
};

type StapleRow = {
  id: string;
  name: string;
  store: Store;
  category: string;
  brand: string | null;
  asin: string | null;
  barcode: string | null;
  created_at: string;
  updated_at: string;
};

const ITEM_COLUMNS =
  "id, name, quantity_note, store, category, checked, brand, asin, barcode, staple, staple_id, section, image_url, substitute, notes, store_tag, fresh, buy_date, created_at, updated_at";

const STAPLE_COLUMNS = "id, name, store, category, brand, asin, barcode, created_at, updated_at";

function nowIso(): string {
  return new Date().toISOString();
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    quantityNote: row.quantity_note,
    store: row.store,
    category: row.category,
    checked: row.checked === 1,
    brand: row.brand,
    asin: row.asin,
    barcode: row.barcode,
    staple: row.staple === 1,
    stapleId: row.staple_id,
    section: (row.section as FoodSection | null) ?? null,
    imageUrl: row.image_url,
    substitute: row.substitute,
    notes: row.notes,
    storeTag: row.store_tag,
    storeName: null,
    fresh: row.fresh === 1,
    buyDate: row.buy_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStaple(row: StapleRow): Staple {
  return {
    id: row.id,
    name: row.name,
    store: row.store,
    category: row.category,
    brand: row.brand,
    asin: row.asin,
    barcode: row.barcode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const INSERT_STAPLE = `INSERT INTO staples (${STAPLE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function barcodeClause(code: string): { sql: string; keys: string[] } {
  const keys = barcodeKeys(code);
  return { sql: `barcode IN (${keys.map(() => "?").join(", ")})`, keys };
}

export type GroceryStore = { id: string; name: string };

const PRESET_STORE_NAMES: Record<string, string> = {
  local: "Local store",
  costco: "Costco",
  amazon: "Amazon",
};

export async function listStores(db: D1Database): Promise<GroceryStore[]> {
  const rows = await db.prepare(`SELECT id, name FROM stores ORDER BY created_at ASC, name COLLATE NOCASE ASC`).all<GroceryStore>();
  return rows.results ?? [];
}

export async function findStore(db: D1Database, requested: string): Promise<GroceryStore | null> {
  const row = await db
    .prepare(`SELECT id, name FROM stores WHERE id = ? OR name = ? LIMIT 1`)
    .bind(requested, requested)
    .first<GroceryStore>();
  return row ?? null;
}

export async function ensureStore(db: D1Database, requested: string): Promise<{ store: GroceryStore; created: boolean }> {
  const found = await findStore(db, requested);
  if (found) return { store: found, created: false };
  const preset = requested === "local" || requested === "costco" || requested === "amazon";
  const id = preset ? requested : crypto.randomUUID();
  const name = PRESET_STORE_NAMES[requested] || requested;
  try {
    await db.prepare(`INSERT INTO stores (id, name, created_at) VALUES (?, ?, ?)`).bind(id, name, nowIso()).run();
    return { store: { id, name }, created: true };
  } catch (error) {
    const raced = await findStore(db, name);
    if (raced) return { store: raced, created: false };
    throw error;
  }
}

export async function renameStore(db: D1Database, id: string, name: string): Promise<GroceryStore> {
  const existing = await db.prepare(`SELECT id, name FROM stores WHERE id = ?`).bind(id).first<GroceryStore>();
  if (!existing) throw new HttpError(404, "That store is already gone.");
  const clash = await db.prepare(`SELECT id FROM stores WHERE name = ? AND id <> ?`).bind(name, id).first<{ id: string }>();
  if (clash) throw new HttpError(400, "That store is already on the list.");
  await db.prepare(`UPDATE stores SET name = ? WHERE id = ?`).bind(name, id).run();
  return { id, name };
}

export async function deleteStore(db: D1Database, id: string): Promise<void> {
  const existing = await db.prepare(`SELECT id FROM stores WHERE id = ?`).bind(id).first<{ id: string }>();
  if (!existing) throw new HttpError(404, "That store is already gone.");
  const now = nowIso();
  await db.batch([
    db
      .prepare(`UPDATE items SET store_tag = '', updated_at = ? WHERE store_tag = ? OR (store_tag IS NULL AND store = ?)`)
      .bind(now, id, id),
    db.prepare(`DELETE FROM stores WHERE id = ?`).bind(id),
  ]);
}

function legalPair(store: Store, category: string): boolean {
  return (CATEGORIES[store] as readonly string[]).includes(category);
}

function localAisle(category: string): string {
  if (category === "produce" || category === "shelf" || category === "refrigerated" || category === "frozen") return category;
  return "shelf";
}

export async function placeStore(
  db: D1Database,
  requested: string,
  category: string,
): Promise<{ store: Store; category: string; storeTag: string }> {
  if (!requested) return { store: "local", category: localAisle(category), storeTag: "" };
  const { store: row } = await ensureStore(db, requested);
  if ((row.id === "costco" || row.id === "local" || row.id === "amazon") && legalPair(row.id, category)) {
    return { store: row.id, category, storeTag: row.id };
  }
  return { store: "local", category: localAisle(category), storeTag: row.id };
}

async function attachStoreNames(db: D1Database, items: Item[]): Promise<Item[]> {
  if (!items.length) return items;
  const stores = await listStores(db);
  const names = new Map(stores.map((store) => [store.id, store.name]));
  return items.map((item) => {
    const id = item.storeTag === "" ? "" : item.storeTag || item.store;
    return { ...item, storeName: id ? names.get(id) ?? null : null };
  });
}

export async function listItems(db: D1Database): Promise<Item[]> {
  const result = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE deleted_at IS NULL ORDER BY created_at ASC`)
    .all<ItemRow>();
  return attachStoreNames(db, result.results.map(toItem));
}

export type ItemHistory = {
  name: string;
  store: Store;
  storeTag: string | null;
  category: string;
  section: string | null;
  brand: string | null;
  asin: string | null;
  checked: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type HistoryRow = {
  name: string;
  store: Store;
  store_tag: string | null;
  category: string;
  section: string | null;
  brand: string | null;
  asin: string | null;
  checked: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listItemHistory(db: D1Database): Promise<ItemHistory[]> {
  const result = await db
    .prepare(
      `SELECT name, store, store_tag, category, section, brand, asin, checked, deleted_at, created_at, updated_at
       FROM items ORDER BY updated_at DESC`,
    )
    .all<HistoryRow>();
  return (result.results ?? []).map((row) => ({
    name: row.name,
    store: row.store,
    storeTag: row.store_tag,
    category: row.category,
    section: row.section,
    brand: row.brand,
    asin: row.asin,
    checked: row.checked === 1,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listStaples(db: D1Database): Promise<Staple[]> {
  const result = await db
    .prepare(`SELECT ${STAPLE_COLUMNS} FROM staples ORDER BY name COLLATE NOCASE ASC`)
    .all<StapleRow>();
  return result.results.map(toStaple);
}

export async function getItem(db: D1Database, id: string): Promise<Item | null> {
  const row = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).bind(id).first<ItemRow>();
  return row ? (await attachStoreNames(db, [toItem(row)]))[0] : null;
}

async function getStaple(db: D1Database, id: string): Promise<Staple | null> {
  const row = await db.prepare(`SELECT ${STAPLE_COLUMNS} FROM staples WHERE id = ?`).bind(id).first<StapleRow>();
  return row ? toStaple(row) : null;
}

async function findStapleByBarcode(db: D1Database, code: string): Promise<Staple | null> {
  const { sql, keys } = barcodeClause(code);
  const row = await db.prepare(`SELECT ${STAPLE_COLUMNS} FROM staples WHERE ${sql} LIMIT 1`).bind(...keys).first<StapleRow>();
  return row ? toStaple(row) : null;
}

async function openItemForStaple(db: D1Database, stapleId: string): Promise<Item | null> {
  const row = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE staple_id = ? AND checked = 0 AND deleted_at IS NULL LIMIT 1`)
    .bind(stapleId)
    .first<ItemRow>();
  return row ? toItem(row) : null;
}

async function openItemForBarcode(db: D1Database, code: string): Promise<Item | null> {
  const { sql, keys } = barcodeClause(code);
  const row = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE ${sql} AND checked = 0 AND deleted_at IS NULL LIMIT 1`)
    .bind(...keys)
    .first<ItemRow>();
  return row ? toItem(row) : null;
}

export async function lookupBarcode(db: D1Database, code: string): Promise<BarcodeHit | null> {
  const staple = await findStapleByBarcode(db, code);
  if (staple) {
    const open = await openItemForStaple(db, staple.id);
    return {
      stapleId: staple.id,
      alreadyOnList: Boolean(open),
      name: staple.name,
      store: staple.store,
      category: staple.category,
      brand: staple.brand,
      asin: staple.asin,
      barcode: staple.barcode || code,
    };
  }
  const { sql, keys } = barcodeClause(code);
  const row = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE ${sql} ORDER BY updated_at DESC LIMIT 1`)
    .bind(...keys)
    .first<ItemRow>();
  if (!row) return null;
  const item = toItem(row);
  const open = await openItemForBarcode(db, code);
  return {
    stapleId: item.stapleId,
    alreadyOnList: Boolean(open),
    name: item.name,
    store: item.store,
    category: item.category,
    brand: item.brand,
    asin: item.asin,
    barcode: item.barcode || code,
  };
}

function stapleBind(id: string, fields: StapleInput, now: string) {
  return [id, fields.name, fields.store, fields.category, fields.brand, fields.asin, fields.barcode, now, now] as const;
}

export async function createItem(db: D1Database, input: ItemInput, requestId?: string): Promise<Item> {
  // A retry of the same Add uses the item's primary key, including across workers.
  // A changed payload must use a new key; never silently substitute another item.
  const id = requestId || crypto.randomUUID();
  const replay = async () => {
    const existing = requestId ? await getItem(db, id) : null;
    if (!existing) return null;
    const expected = { ...input, fresh: Boolean(input.fresh), buyDate: input.fresh ? input.buyDate ?? null : null, staple: Boolean(input.barcode) || input.staple };
    const fields = ["name", "quantityNote", "store", "category", "section", "notes", "fresh", "buyDate", "brand", "asin", "barcode", "checked", "staple", "storeTag", "imageUrl", "substitute"] as const;
    if (fields.some((field) => (existing[field] ?? null) !== (expected[field] ?? null))) {
      throw new HttpError(409, "This add request has already been used. Try adding again.");
    }
    return existing;
  };
  const previous = await replay();
  if (previous) return previous;
  const now = nowIso();
  const remember = Boolean(input.barcode) || input.staple;
  let stapleId: string | null = null;
  const statements: D1PreparedStatement[] = [];
  const stapleFields: StapleInput = {
    name: input.name,
    store: input.store,
    category: input.category,
    brand: input.brand,
    asin: input.asin,
    barcode: input.barcode,
  };

  if (input.barcode) {
    const existing = await findStapleByBarcode(db, input.barcode);
    if (existing) {
      stapleId = existing.id;
      statements.push(
        db
          .prepare(
            `UPDATE staples SET name = ?, store = ?, category = ?, brand = ?, asin = ?, barcode = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(stapleFields.name, stapleFields.store, stapleFields.category, stapleFields.brand, stapleFields.asin, stapleFields.barcode, now, stapleId),
      );
    }
  }

  if (remember && !stapleId) {
    stapleId = crypto.randomUUID();
    statements.push(db.prepare(INSERT_STAPLE).bind(...stapleBind(stapleId, stapleFields, now)));
  }

  const stapleFlag = remember ? 1 : 0;
  statements.push(
    db
      .prepare(`INSERT INTO items (${ITEM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        input.name,
        input.quantityNote,
        input.store,
        input.category,
        input.checked ? 1 : 0,
        input.brand,
        input.asin,
        input.barcode,
        stapleFlag,
        stapleId,
        input.section ?? null,
        input.imageUrl ?? null,
        input.substitute ?? null,
        input.notes ?? null,
        input.storeTag === undefined ? null : input.storeTag,
        input.fresh ? 1 : 0,
        input.fresh ? input.buyDate ?? null : null,
        now,
        now,
      ),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    const previous = await replay();
    if (previous) return previous;
    if (stapleId) {
      const existing = await openItemForStaple(db, stapleId);
      if (existing) return existing;
    }
    throw error;
  }

  const created = await getItem(db, id);
  if (!created) throw new HttpError(500, "Something went wrong. Try again.");
  return created;
}

export async function updateItem(db: D1Database, id: string, patch: ItemPatch): Promise<Item> {
  const existing = await getItem(db, id);
  if (!existing) throw new HttpError(404, "That item isn't on the list anymore.");

  let store = existing.store;
  let category = existing.category;
  let storeTag = existing.storeTag;
  if (patch.storeRequest !== undefined || patch.category !== undefined) {
    const requested = patch.storeRequest !== undefined ? patch.storeRequest : existing.storeTag === "" ? "" : existing.storeTag || existing.store;
    const placed = await placeStore(db, requested, patch.category ?? existing.category);
    store = placed.store;
    category = placed.category;
    storeTag = placed.storeTag;
  }
  const next: Item = {
    ...existing,
    name: patch.name ?? existing.name,
    quantityNote: patch.quantityNote === undefined ? existing.quantityNote : patch.quantityNote,
    store,
    category,
    storeTag,
    checked: patch.checked ?? existing.checked,
    brand: patch.brand === undefined ? existing.brand : patch.brand,
    asin: patch.asin === undefined ? existing.asin : patch.asin,
    barcode: patch.barcode === undefined ? existing.barcode : patch.barcode,
    staple: patch.staple ?? existing.staple,
    section: patch.section === undefined ? existing.section : patch.section,
    imageUrl: patch.imageUrl === undefined ? existing.imageUrl : patch.imageUrl,
    substitute: patch.substitute === undefined ? existing.substitute : patch.substitute,
    notes: patch.notes === undefined ? existing.notes : patch.notes,
    fresh: patch.fresh === undefined ? existing.fresh : patch.fresh,
    buyDate: patch.buyDate === undefined ? existing.buyDate : patch.buyDate,
  };
  if (!next.fresh) next.buyDate = null;

  const now = nowIso();
  const stapleFields: StapleInput = {
    name: next.name,
    store: next.store,
    category: next.category,
    brand: next.brand,
    asin: next.asin,
    barcode: next.barcode,
  };
  const touchesTemplate =
    patch.staple !== undefined ||
    patch.name !== undefined ||
    patch.storeRequest !== undefined ||
    patch.store !== undefined ||
    patch.category !== undefined ||
    patch.brand !== undefined ||
    patch.asin !== undefined ||
    patch.barcode !== undefined;

  const statements: D1PreparedStatement[] = [];
  let stapleId = existing.stapleId;

  if (next.staple && (touchesTemplate || !stapleId)) {
    if (!stapleId) {
      stapleId = crypto.randomUUID();
      statements.push(db.prepare(INSERT_STAPLE).bind(...stapleBind(stapleId, stapleFields, now)));
    } else if (touchesTemplate) {
      statements.push(
        db
          .prepare(
            `UPDATE staples SET name = ?, store = ?, category = ?, brand = ?, asin = ?, barcode = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(
            stapleFields.name,
            stapleFields.store,
            stapleFields.category,
            stapleFields.brand,
            stapleFields.asin,
            stapleFields.barcode,
            now,
            stapleId,
          ),
      );
    }
  } else if (!next.staple && patch.staple === false && existing.stapleId) {
    statements.push(
      db.prepare(`UPDATE items SET staple = 0, staple_id = NULL, updated_at = ? WHERE staple_id = ?`).bind(now, existing.stapleId),
    );
    statements.push(db.prepare(`DELETE FROM staples WHERE id = ?`).bind(existing.stapleId));
    stapleId = null;
  }

  statements.push(
    db
      .prepare(
        `UPDATE items
         SET name = ?, quantity_note = ?, store = ?, category = ?, checked = ?, brand = ?, asin = ?, barcode = ?, staple = ?, staple_id = ?,
             section = ?, image_url = ?, substitute = ?, notes = ?, store_tag = ?, fresh = ?, buy_date = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        next.name,
        next.quantityNote,
        next.store,
        next.category,
        next.checked ? 1 : 0,
        next.brand,
        next.asin,
        next.barcode,
        next.staple ? 1 : 0,
        stapleId,
        next.section,
        next.imageUrl,
        next.substitute,
        next.notes,
        next.storeTag,
        next.fresh ? 1 : 0,
        next.buyDate,
        now,
        id,
      ),
  );

  if (patch.deleted !== undefined) {
    statements.push(
      db.prepare(`UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(patch.deleted ? now : null, now, id),
    );
  }

  try {
    await db.batch(statements);
  } catch (error) {
    if (patch.deleted === false) throw new HttpError(409, "That item is already on the list.");
    throw error;
  }
  const updated = await getItem(db, id);
  if (!updated) throw new HttpError(500, "Something went wrong. Try again.");
  return updated;
}

export async function deleteItem(db: D1Database, id: string): Promise<void> {
  const existing = await getItem(db, id);
  if (!existing) throw new HttpError(404, "That item isn't on the list anymore.");
  await db.batch([
    db.prepare(`DELETE FROM grocery_sources WHERE item_id = ?`).bind(id),
    db.prepare(`DELETE FROM items WHERE id = ?`).bind(id),
  ]);
}

export async function clearChecked(db: D1Database, storeId: string): Promise<number> {
  const match = `checked = 1 AND (store_tag = ? OR (store_tag IS NULL AND store = ?))`;
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM items WHERE ${match}`).bind(storeId, storeId).first<{ n: number }>();
  await db.batch([
    db.prepare(`DELETE FROM grocery_sources WHERE item_id IN (SELECT id FROM items WHERE ${match})`).bind(storeId, storeId),
    db.prepare(`DELETE FROM items WHERE ${match}`).bind(storeId, storeId),
  ]);
  return Number(row?.n ?? 0);
}

export async function createStaple(db: D1Database, input: StapleInput): Promise<Staple> {
  if (input.barcode) {
    const existing = await findStapleByBarcode(db, input.barcode);
    if (existing) {
      const now = nowIso();
      await db
        .prepare(
          `UPDATE staples SET name = ?, store = ?, category = ?, brand = ?, asin = ?, barcode = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(input.name, input.store, input.category, input.brand, input.asin, input.barcode, now, existing.id)
        .run();
      const updated = await getStaple(db, existing.id);
      if (!updated) throw new HttpError(500, "Something went wrong. Try again.");
      return updated;
    }
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.prepare(INSERT_STAPLE).bind(...stapleBind(id, input, now)).run();
  const created = await getStaple(db, id);
  if (!created) throw new HttpError(500, "Something went wrong. Try again.");
  return created;
}

export async function deleteStaple(db: D1Database, id: string): Promise<void> {
  const existing = await getStaple(db, id);
  if (!existing) throw new HttpError(404, "That staple is already gone.");
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE items SET staple = 0, staple_id = NULL, updated_at = ? WHERE staple_id = ?`).bind(now, id),
    db.prepare(`DELETE FROM staples WHERE id = ?`).bind(id),
  ]);
}

export async function addStapleToList(
  db: D1Database,
  id: string,
): Promise<{ item: Item; alreadyOnList: boolean }> {
  const staple = await getStaple(db, id);
  if (!staple) throw new HttpError(404, "That staple is already gone.");

  const existing = await openItemForStaple(db, id);
  if (existing) return { item: existing, alreadyOnList: true };

  const itemId = crypto.randomUUID();
  const now = nowIso();
  try {
    await db
      .prepare(`INSERT INTO items (${ITEM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        itemId,
        staple.name,
        null,
        staple.store,
        staple.category,
        0,
        staple.brand,
        staple.asin,
        staple.barcode,
        1,
        staple.id,
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        now,
        now,
      )
      .run();
  } catch (error) {
    const raced = await openItemForStaple(db, id);
    if (raced) return { item: raced, alreadyOnList: true };
    throw error;
  }

  const created = await getItem(db, itemId);
  if (!created) throw new HttpError(500, "Something went wrong. Try again.");
  return { item: created, alreadyOnList: false };
}

export type OnHandItem = { id: string; name: string };

export async function listOnHand(db: D1Database): Promise<OnHandItem[]> {
  const rows = await db
    .prepare(`SELECT id, name FROM on_hand ORDER BY created_at ASC`)
    .all<OnHandItem>();
  return rows.results ?? [];
}

export async function onHandKeys(db: D1Database): Promise<Set<string>> {
  const rows = await db.prepare(`SELECT name_key FROM on_hand`).all<{ name_key: string }>();
  return new Set((rows.results ?? []).map((row) => row.name_key));
}

export async function addOnHand(db: D1Database, rawName: string): Promise<{ item: OnHandItem; created: boolean }> {
  const name = groceryName(rawName);
  const key = groceryKey(name);
  if (!name || !key) throw new HttpError(400, "Type a name.");
  const existing = await db.prepare(`SELECT id, name FROM on_hand WHERE name_key = ?`).bind(key).first<OnHandItem>();
  if (existing) return { item: existing, created: false };
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(`INSERT INTO on_hand (id, name, name_key, created_at) VALUES (?, ?, ?, ?)`)
      .bind(id, name, key, nowIso())
      .run();
  } catch (error) {
    const raced = await db.prepare(`SELECT id, name FROM on_hand WHERE name_key = ?`).bind(key).first<OnHandItem>();
    if (raced) return { item: raced, created: false };
    throw error;
  }
  return { item: { id, name }, created: true };
}

export async function deleteOnHand(db: D1Database, id: string): Promise<void> {
  const result = await db.prepare(`DELETE FROM on_hand WHERE id = ?`).bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, "That isn't on the usually-on-hand list.");
}

export async function deleteOnHandByName(db: D1Database, rawName: string): Promise<void> {
  const key = groceryKey(rawName);
  if (!key) throw new HttpError(400, "Type a name.");
  const result = await db.prepare(`DELETE FROM on_hand WHERE name_key = ?`).bind(key).run();
  if (!result.meta.changes) throw new HttpError(404, "That isn't on the usually-on-hand list.");
}
