import { HttpError } from "./http";
import {
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
  staple: boolean;
  stapleId: string | null;
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
  createdAt: string;
  updatedAt: string;
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
  staple: number;
  staple_id: string | null;
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
  created_at: string;
  updated_at: string;
};

const ITEM_COLUMNS =
  "id, name, quantity_note, store, category, checked, brand, asin, staple, staple_id, created_at, updated_at";

const STAPLE_COLUMNS = "id, name, store, category, brand, asin, created_at, updated_at";

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
    staple: row.staple === 1,
    stapleId: row.staple_id,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const INSERT_STAPLE = `INSERT INTO staples (${STAPLE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

export async function listItems(db: D1Database): Promise<Item[]> {
  const result = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY created_at ASC`).all<ItemRow>();
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

async function openItemForStaple(db: D1Database, stapleId: string): Promise<Item | null> {
  const row = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE staple_id = ? AND checked = 0 LIMIT 1`)
    .bind(stapleId)
    .first<ItemRow>();
  return row ? toItem(row) : null;
}

export async function createItem(db: D1Database, input: ItemInput): Promise<Item> {
  const id = crypto.randomUUID();
  const now = nowIso();
  const stapleId = input.staple ? crypto.randomUUID() : null;
  const statements: D1PreparedStatement[] = [];
  if (stapleId) {
    statements.push(
      db
        .prepare(INSERT_STAPLE)
        .bind(stapleId, input.name, input.store, input.category, input.brand, input.asin, now, now),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO items (${ITEM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.quantityNote,
        input.store,
        input.category,
        input.checked ? 1 : 0,
        input.brand,
        input.asin,
        input.staple ? 1 : 0,
        stapleId,
        now,
        now,
      ),
  );
  await db.batch(statements);
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
    staple: patch.staple ?? existing.staple,
  };

  const now = nowIso();
  const stapleFields: StapleInput = {
    name: next.name,
    store: next.store,
    category: next.category,
    brand: next.brand,
    asin: next.asin,
  };
  const touchesTemplate =
    patch.staple !== undefined ||
    patch.name !== undefined ||
    patch.store !== undefined ||
    patch.category !== undefined ||
    patch.brand !== undefined ||
    patch.asin !== undefined;

  const statements: D1PreparedStatement[] = [];
  let stapleId = existing.stapleId;

  if (next.staple && (touchesTemplate || !stapleId)) {
    if (!stapleId) {
      stapleId = crypto.randomUUID();
      statements.push(
        db
          .prepare(INSERT_STAPLE)
          .bind(stapleId, stapleFields.name, stapleFields.store, stapleFields.category, stapleFields.brand, stapleFields.asin, now, now),
      );
    } else if (touchesTemplate) {
      statements.push(
        db
          .prepare(
            `UPDATE staples SET name = ?, store = ?, category = ?, brand = ?, asin = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(stapleFields.name, stapleFields.store, stapleFields.category, stapleFields.brand, stapleFields.asin, now, stapleId),
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
         SET name = ?, quantity_note = ?, store = ?, category = ?, checked = ?, brand = ?, asin = ?, staple = ?, staple_id = ?, updated_at = ?
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
        next.staple ? 1 : 0,
        stapleId,
        now,
        id,
      ),
  );

  await db.batch(statements);
  const updated = await getItem(db, id);
  if (!updated) throw new HttpError(500, "Something went wrong. Try again.");
  return updated;
}

export async function deleteItem(db: D1Database, id: string): Promise<void> {
  const existing = await getItem(db, id);
  if (!existing) throw new HttpError(404, "That item isn't on the list anymore.");
  await db.prepare(`DELETE FROM items WHERE id = ?`).bind(id).run();
}

export async function clearChecked(db: D1Database, store: Store): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM items WHERE store = ? AND checked = 1`)
    .bind(store)
    .first<{ n: number }>();
  await db.prepare(`DELETE FROM items WHERE store = ? AND checked = 1`).bind(store).run();
  return Number(row?.n ?? 0);
}

export async function createStaple(db: D1Database, input: StapleInput): Promise<Staple> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(INSERT_STAPLE)
    .bind(id, input.name, input.store, input.category, input.brand, input.asin, now, now)
    .run();
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
      .prepare(`INSERT INTO items (${ITEM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(itemId, staple.name, null, staple.store, staple.category, 0, staple.brand, staple.asin, 1, staple.id, now, now)
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
