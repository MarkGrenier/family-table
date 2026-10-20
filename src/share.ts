import { deriveShareKey, sha256Hex } from "./auth";
import { createRecipe } from "./food";
import { HttpError } from "./http";
import { assertPublicHttpsUrl, fetchPublicPage, pagePhoto, pageTitle, recipeFromDocument } from "./import-recipe";

export const SHARE_PEOPLE = ["Mark", "Emma"] as const;

export type SharePerson = { person: string; key: string };

function nowIso(): string {
  return new Date().toISOString();
}

export async function ensureShareKeys(db: D1Database, passcode: string): Promise<SharePerson[]> {
  if (!passcode) throw new HttpError(503, "The list isn't ready yet. The passcode hasn't been set.");
  const people: SharePerson[] = [];
  for (const person of SHARE_PEOPLE) {
    const key = await deriveShareKey(passcode, person);
    const keyHash = await sha256Hex(key);
    const existing = await db
      .prepare(`SELECT id, key_hash FROM share_keys WHERE person = ?`)
      .bind(person)
      .first<{ id: string; key_hash: string }>();
    if (!existing) {
      await db
        .prepare(`INSERT INTO share_keys (id, person, key_hash, created_at) VALUES (?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), person, keyHash, nowIso())
        .run();
    } else if (existing.key_hash !== keyHash) {
      await db.prepare(`UPDATE share_keys SET key_hash = ? WHERE id = ?`).bind(keyHash, existing.id).run();
    }
    people.push({ person, key });
  }
  return people;
}

export async function personForShareKey(db: D1Database, passcode: string, token: string): Promise<string | null> {
  await ensureShareKeys(db, passcode);
  const hash = await sha256Hex(token);
  const row = await db.prepare(`SELECT person FROM share_keys WHERE key_hash = ?`).bind(hash).first<{ person: string }>();
  return row?.person ?? null;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

export async function importSharedRecipe(db: D1Database, rawUrl: string): Promise<{ title: string; needsReview: boolean }> {
  let finalUrl = "";
  let html = "";
  try {
    const page = await fetchPublicPage(rawUrl);
    finalUrl = page.finalUrl;
    html = page.html;
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) throw error;
    finalUrl = assertPublicHttpsUrl(rawUrl).href;
  }
  const parsed = html ? recipeFromDocument(html, finalUrl) : null;
  const complete = Boolean(parsed && parsed.ingredients.length > 0 && parsed.steps.length > 0);
  const name = oneLine(parsed?.name || (html ? pageTitle(html) : "") || "Recipe") || "Recipe";
  const recipe = await createRecipe(db, {
    name,
    imageUrl: parsed?.imageUrl || (html ? pagePhoto(html, finalUrl) : null),
    servings: parsed?.servings ?? 4,
    ingredients: parsed?.ingredients ?? [],
    steps: parsed?.steps ?? [],
    totalTime: parsed?.totalTime ?? null,
    sourceUrl: finalUrl,
    favorite: false,
    needsReview: !complete,
  });
  return { title: recipe.name, needsReview: Boolean(recipe.needsReview) };
}

export function shareNotice(title: string, needsReview: boolean): string {
  const name = oneLine(title) || "Recipe";
  return needsReview ? `Saved for Chef to finish: ${name}` : `Added: ${name}`;
}
