import { HttpError } from "./http";
import { isFoodSection, type FoodSection } from "./ingredients";

export const STORES = ["costco", "local", "amazon"] as const;
export type Store = (typeof STORES)[number];

export const CATEGORIES: Record<Store, readonly string[]> = {
  costco: ["shelf", "refrigerated", "frozen"],
  local: ["produce", "shelf", "refrigerated", "frozen"],
  amazon: ["general"],
};

export type ItemInput = {
  name: string;
  quantityNote: string | null;
  store: Store;
  category: string;
  checked: boolean;
  brand: string | null;
  asin: string | null;
  barcode: string | null;
  staple: boolean;
  section?: FoodSection | null;
  imageUrl?: string | null;
  substitute?: string | null;
  notes?: string | null;
  storeTag?: string | null;
  storeRequest?: string;
};

export type ItemPatch = {
  name?: string;
  quantityNote?: string | null;
  store?: Store;
  category?: string;
  checked?: boolean;
  brand?: string | null;
  asin?: string | null;
  barcode?: string | null;
  staple?: boolean;
  section?: FoodSection | null;
  imageUrl?: string | null;
  substitute?: string | null;
  notes?: string | null;
  storeTag?: string | null;
  storeRequest?: string;
  deleted?: boolean;
};

export type StapleInput = {
  name: string;
  store: Store;
  category: string;
  brand: string | null;
  asin: string | null;
  barcode: string | null;
};

export function isStore(value: string): value is Store {
  return (STORES as readonly string[]).includes(value);
}

export function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "Add a name.");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new HttpError(400, "Add a name.");
  if (name.length > 80) throw new HttpError(400, "That name is too long. Keep it under 80 characters.");
  return name;
}

export function cleanStore(value: unknown): Store {
  if (typeof value === "string" && isStore(value)) return value;
  throw new HttpError(400, "Pick Costco, the local store, or Amazon.");
}

const AISLES = ["produce", "shelf", "refrigerated", "frozen", "general"] as const;

export function cleanStoreRequest(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "The store name should be words.");
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) throw new HttpError(400, "Type a store name.");
  if (text.length > 40) throw new HttpError(400, "That store name is too long.");
  return text;
}

export function cleanAisle(value: unknown, storeHint?: string): string {
  if (value == null || value === "") {
    if (storeHint === "amazon") return "general";
    throw new HttpError(400, "Pick an aisle for that store.");
  }
  if (typeof value !== "string" || !(AISLES as readonly string[]).includes(value)) {
    throw new HttpError(400, "Pick an aisle for that store.");
  }
  return value;
}

export function cleanCategory(value: unknown, store: Store): string {
  const allowed = CATEGORIES[store];
  if ((value == null || value === "") && store === "amazon") return "general";
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new HttpError(
      400,
      store === "amazon" ? "Amazon items don't use aisles." : "Pick an aisle for that store.",
    );
  }
  return value;
}

function cleanOptional(value: unknown, label: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new HttpError(400, `${label} should be words.`);
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > max) throw new HttpError(400, `${label} is too long.`);
  return text;
}

function cleanBool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new HttpError(400, `${label} needs to be yes or no.`);
  return value;
}

export function cleanBarcode(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new HttpError(400, "The barcode should be numbers.");
  }
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length < 6 || digits.length > 14) {
    throw new HttpError(400, "That barcode should be 6 to 14 numbers.");
  }
  return digits;
}

export function barcodeKeys(code: string): string[] {
  const keys = new Set<string>([code]);
  if (code.length === 12) keys.add(`0${code}`);
  if (code.length === 13 && code.startsWith("0")) keys.add(code.slice(1));
  const stripped = code.replace(/^0+/, "");
  if (stripped.length >= 6) keys.add(stripped);
  return [...keys];
}

export function cleanAsin(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new HttpError(400, "The Amazon code should be text.");
  const text = value.trim();
  if (!text) return null;
  const urlMatch = text.match(/\/(?:dp|gp\/product|ASIN)\/([A-Za-z0-9]{10})(?:[/?#]|$)/i);
  if (urlMatch) return urlMatch[1].toUpperCase();
  if (/^[A-Za-z0-9]{10}$/.test(text)) return text.toUpperCase();
  if (/^https?:/i.test(text) || text.length > 16) {
    throw new HttpError(400, "Use the 10-character Amazon code, or paste the product link.");
  }
  return text.toUpperCase();
}

export function parseNewItem(body: Record<string, unknown>): ItemInput {
  const storeRequest = body.store === "" ? "" : cleanStoreRequest(body.store);
  const category = cleanAisle(body.category, storeRequest);
  return {
    name: cleanName(body.name),
    quantityNote: cleanOptional(body.quantityNote, "The note", 140),
    store: "local",
    storeRequest,
    category,
    checked: body.checked == null ? false : cleanBool(body.checked, "Bought"),
    brand: cleanOptional(body.brand, "Brand", 80),
    asin: cleanAsin(body.asin),
    barcode: body.barcode == null || body.barcode === "" ? null : cleanBarcode(body.barcode),
    staple: body.staple == null ? false : cleanBool(body.staple, "Staple"),
    section: cleanFoodSection(body.section),
    imageUrl: cleanOptional(body.imageUrl, "The photo", 500),
    substitute: cleanOptional(body.substitute, "The substitute", 280),
    notes: cleanOptional(body.notes, "The note", 500),
  };
}

function cleanFoodSection(value: unknown): FoodSection | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !isFoodSection(value)) throw new HttpError(400, "Pick a grocery section.");
  return value;
}

export function parseItemPatch(body: Record<string, unknown>): ItemPatch {
  const patch: ItemPatch = {};
  if ("name" in body) patch.name = cleanName(body.name);
  if ("quantityNote" in body) patch.quantityNote = cleanOptional(body.quantityNote, "The note", 140);
  if ("store" in body) patch.storeRequest = body.store === "" ? "" : cleanStoreRequest(body.store);
  if ("category" in body) patch.category = cleanAisle(body.category, typeof body.store === "string" ? body.store : undefined);
  if ("checked" in body) patch.checked = cleanBool(body.checked, "Bought");
  if ("brand" in body) patch.brand = cleanOptional(body.brand, "Brand", 80);
  if ("asin" in body) patch.asin = cleanAsin(body.asin);
  if ("barcode" in body) patch.barcode = cleanBarcode(body.barcode);
  if ("staple" in body) patch.staple = cleanBool(body.staple, "Staple");
  if ("section" in body) patch.section = cleanFoodSection(body.section);
  if ("imageUrl" in body) patch.imageUrl = cleanOptional(body.imageUrl, "The photo", 500);
  if ("substitute" in body) patch.substitute = cleanOptional(body.substitute, "The substitute", 280);
  if ("notes" in body) patch.notes = cleanOptional(body.notes, "The note", 500);
  if ("deleted" in body) patch.deleted = cleanBool(body.deleted, "Deleted");
  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, "Nothing to change.");
  }
  return patch;
}

export function parseStaple(body: Record<string, unknown>): StapleInput {
  const store = cleanStore(body.store);
  return {
    name: cleanName(body.name),
    store,
    category: cleanCategory(body.category, store),
    brand: cleanOptional(body.brand, "Brand", 80),
    asin: cleanAsin(body.asin),
    barcode: body.barcode == null || body.barcode === "" ? null : cleanBarcode(body.barcode),
  };
}

export function mergedCategory(store: Store, category: string): string {
  return cleanCategory(category, store);
}
