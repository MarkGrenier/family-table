import { HttpError } from "./http";
import { parseIngredientLine, type Ingredient } from "./ingredients";

export type ImportedRecipe = {
  name: string;
  imageUrl: string | null;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
  totalTime: string | null;
  sourceUrl: string;
};

const MAX_HTML = 1_500_000;

export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "That link doesn't look right.");
  }
  if (url.protocol !== "https:") throw new HttpError(400, "Paste a full https link.");
  if (url.username || url.password) throw new HttpError(400, "That link doesn't look right.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost") ||
    isPrivateHost(host)
  ) {
    throw new HttpError(400, "That link isn't a recipe page.");
  }
  return url;
}

function isPrivateHost(host: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return host === "::1" || host.startsWith("[");
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export async function importRecipeFromUrl(rawUrl: string): Promise<ImportedRecipe> {
  const url = assertPublicHttpsUrl(rawUrl);
  let response: Response;
  try {
    response = await fetch(url.href, {
      headers: {
        Accept: "text/html,application/json",
        "User-Agent": "FamilyFood/1.0 (private family recipe import)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new HttpError(422, "Couldn't open that page. You can type the recipe in instead.");
  }
  if (!response.ok) {
    throw new HttpError(422, "Couldn't open that page. You can type the recipe in instead.");
  }
  const finalUrl = response.url ? assertPublicHttpsUrl(response.url).href : url.href;
  const html = await response.text();
  if (html.length > MAX_HTML) {
    throw new HttpError(422, "That page was too large to read. You can type the recipe in instead.");
  }
  const recipe = recipeFromDocument(html);
  if (!recipe) {
    throw new HttpError(422, "Couldn't find a recipe on that page. You can type it in instead.");
  }
  return { ...recipe, sourceUrl: finalUrl };
}

export function recipeFromDocument(html: string): Omit<ImportedRecipe, "sourceUrl"> | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    const parsed = parseLd(block[1] ?? "");
    if (!parsed) continue;
    const found = findRecipes(parsed)[0];
    if (found) return normalizeRecipe(found);
  }
  const asJson = parseLd(html.trim());
  if (asJson) {
    const found = findRecipes(asJson)[0];
    if (found) return normalizeRecipe(found);
  }
  return null;
}

function parseLd(raw: string): unknown {
  let text = raw.trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&"));
    } catch {
      return null;
    }
  }
}

function findRecipes(data: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!data) return out;
  if (Array.isArray(data)) {
    for (const entry of data) findRecipes(entry, out);
    return out;
  }
  if (typeof data !== "object") return out;
  const node = data as Record<string, unknown>;
  if (typesOf(node).some((type) => type === "recipe" || type.endsWith("/recipe"))) out.push(node);
  if (node["@graph"]) findRecipes(node["@graph"], out);
  return out;
}

function typesOf(node: Record<string, unknown>): string[] {
  const value = node["@type"];
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map((entry) => String(entry).toLowerCase());
}

function normalizeRecipe(node: Record<string, unknown>): Omit<ImportedRecipe, "sourceUrl"> | null {
  const name = textOf(node.name).slice(0, 120);
  if (!name) return null;
  const ingredients = asList(node.recipeIngredient)
    .map((entry) => parseIngredientLine(textOf(entry)))
    .filter((entry): entry is Ingredient => Boolean(entry))
    .slice(0, 80);
  const steps = stepsFrom(node.recipeInstructions).slice(0, 40);
  return {
    name,
    imageUrl: imageFrom(node.image),
    servings: servingsFrom(node.recipeYield),
    ingredients,
    steps,
    totalTime: durationOf(node.totalTime) ?? durationOf(node.cookTime),
  };
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
  if (typeof value === "number") return String(value);
  return "";
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function imageFrom(value: unknown): string | null {
  if (typeof value === "string") return httpsImage(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = imageFrom(entry);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    return imageFrom(node.url ?? node.contentUrl);
  }
  return null;
}

function httpsImage(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    return url.href.slice(0, 500);
  } catch {
    return null;
  }
}

function servingsFrom(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "number" && raw >= 1) return Math.min(99, Math.round(raw));
  const match = textOf(raw).match(/(\d+)/);
  if (!match) return 4;
  return Math.min(99, Math.max(1, Number(match[1])));
}

function durationOf(value: unknown): string | null {
  const text = textOf(value);
  if (!text) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(text);
  if (!match) return text.slice(0, 40);
  const hours = Number(match[2] || 0) + Number(match[1] || 0) * 24;
  const mins = Number(match[3] || 0);
  const parts = [];
  if (hours) parts.push(`${hours} hr`);
  if (mins) parts.push(`${mins} min`);
  return parts.join(" ") || null;
}

function stepsFrom(value: unknown, out: string[] = []): string[] {
  if (!value) return out;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return out;
    const pieces = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    out.push(...(pieces.length > 1 ? pieces : [trimmed.replace(/\s+/g, " ")]));
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) stepsFrom(entry, out);
    return out;
  }
  if (typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (typesOf(node).some((type) => type.includes("howtosection")) && node.itemListElement) {
      stepsFrom(node.itemListElement, out);
      return out;
    }
    const text = textOf(node.text) || textOf(node.name);
    if (text) out.push(text.slice(0, 1000));
  }
  return out;
}
