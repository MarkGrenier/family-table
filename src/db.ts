import { HttpError } from "./http";
import type { FoodSection } from "./ingredients";
import {
  barcodeKeys,
  mergedCategory,
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
  "id, name, quantity_note, store, category, checked, brand, asin, barcode, staple, staple_id, section, image_url, substitute, notes, created_at, updated_at";

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

export async function listItems(db: D1Database): Promise<Item[]> {
  const result = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE deleted_at IS NULL ORDER BY created_at ASC`)
    .all<ItemRow>();
  return result.results.map(toItem);
}

export async function listStaples(db: D1Database): Promise<Staple[]> {
  const result = await db
    .prepare(`SELECT ${STAPLE_COLUMNS} FROM staples ORDER BY name COLLATE NOCASE ASC`)
    .all<StapleRow>();
  return result.results.map(toStaple);
}

export async function getItem(db: D1Database, id: string): Promise<Item | null> {
  const row = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).bind(id).first<ItemRow>();
  return row ? toItem(row) : null;
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

export async function createItem(db: D1Database, input: ItemInput): Promise<Item> {
  const id = crypto.randomUUID();
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
      .prepare(`INSERT INTO items (${ITEM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
        now,
        now,
      ),
  );

  try {
    await db.batch(statements);
  } catch (error) {
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

  const store = patch.store ?? existing.store;
  const category = mergedCategory(store, patch.category ?? existing.category);
  const next: Item = {
    ...existing,
    name: patch.name ?? existing.name,
    quantityNote: patch.quantityNote === undefined ? existing.quantityNote : patch.quantityNote,
    store,
    category,
    checked: patch.checked ?? existing.checked,
    brand: patch.brand === undefined ? existing.brand : patch.brand,
    asin: patch.asin === undefined ? existing.asin : patch.asin,
    barcode: patch.barcode === undefined ? existing.barcode : patch.barcode,
    staple: patch.staple ?? existing.staple,
    section: patch.section === undefined ? existing.section : patch.section,
    imageUrl: patch.imageUrl === undefined ? existing.imageUrl : patch.imageUrl,
    substitute: patch.substitute === undefined ? existing.substitute : patch.substitute,
    notes: patch.notes === undefined ? existing.notes : patch.notes,
  };

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
             section = ?, image_url = ?, substitute = ?, notes = ?, updated_at = ?
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

export async function clearChecked(db: D1Database, store: Store): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM items WHERE store = ? AND checked = 1`)
    .bind(store)
    .first<{ n: number }>();
  await db.batch([
    db
      .prepare(
        `DELETE FROM grocery_sources WHERE item_id IN (SELECT id FROM items WHERE store = ? AND checked = 1)`,
      )
      .bind(store),
    db.prepare(`DELETE FROM items WHERE store = ? AND checked = 1`).bind(store),
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
      .prepare(`INSERT INTO items (${ITEM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
