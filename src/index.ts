import { clearSessionCookie, passcodeMatches, requestAuthed, rollingSessionCookie, sessionCookie, sessionOk, sessionToken } from "./auth";
import { addStapleToList, clearChecked, createItem, createStaple, deleteItem, deleteStaple, listItems, listStaples, lookupBarcode, updateItem } from "./db";
import {
  addPlanGroceries,
  addRecipeToGroceries,
  createEvent,
  createRecipe,
  deleteEvent,
  deletePlan,
  deleteRecipe,
  listAllEvents,
  listAllPlan,
  listEvents,
  listPlan,
  listRecipes,
  replaceEvents,
  savePlan,
  setPlanAlternates,
  updateRecipe,
  getRecipe,
  getWeek,
  replaceWeek,
  markCooked,
  listFeedback,
  addFeedback,
  deleteRecipeSourcedItems,
  withGroceryRecipes,
} from "./food";
import { cleanWeekStart, dateRange, parseEvent, parseEventList, parsePlan, parsePlanAlternates, parseRecipe, parseRecipePatch, parseServingsOverride, parseWeek } from "./food-validate";
import { HttpError, json, readJson } from "./http";
import { importRecipeFromUrl } from "./import-recipe";
import { cleanBarcode, cleanStore, parseItemPatch, parseNewItem, parseStaple } from "./validate";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PASSCODE?: string;
  API_TOKEN?: string;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https:",
  "manifest-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function pathOf(request: Request): string {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

async function serveAsset(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) return new Response("Not found", { status: 404 });
  const upstream = await env.ASSETS.fetch(request);
  const headers = new Headers(upstream.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex");
  const type = headers.get("Content-Type") ?? "";
  const assetPath = pathOf(request);
  if (type.includes("text/html")) {
    headers.set("Content-Security-Policy", CSP);
  }
  if (
    type.includes("text/html") ||
    type.includes("javascript") ||
    type.includes("text/css") ||
    type.includes("json") ||
    assetPath.endsWith(".js") ||
    assetPath.endsWith(".css")
  ) {
    headers.set("Cache-Control", "no-cache");
  }
  const document = request.method.toUpperCase() === "GET" && (type.includes("text/html") || assetPath === "/" || assetPath === "/index.html");
  if (!document) {
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }
  headers.set("Cache-Control", "private, no-cache");
  headers.set("Vary", "Cookie");
  const authed = await sessionOk(request, env.PASSCODE);
  const shell = authed
    ? `<div id="app" data-session="1"><main class="splash"><img class="app-mark" src="/mark.svg" alt="" width="72" height="72"></main></div>`
    : `<div id="app" data-session="0"></div>`;
  const html = (await upstream.text()).replace("<div id=\"app\"></div>", shell);
  return new Response(html, { status: upstream.status, statusText: upstream.statusText, headers });
}

async function withRollingSession(request: Request, env: Env, response: Response): Promise<Response> {
  if (response.headers.has("Set-Cookie")) return response;
  const cookie = await rollingSessionCookie(request, env.PASSCODE);
  if (!cookie) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function login(request: Request, env: Env): Promise<Response> {
  if (!env.PASSCODE) {
    throw new HttpError(503, "The list isn't ready yet. The passcode hasn't been set.");
  }
  const body = await readJson(request);
  const passcode = body.passcode;
  if (typeof passcode !== "string" || passcode.trim() === "") {
    throw new HttpError(400, "Type the passcode.");
  }
  if (!passcodeMatches(passcode, env.PASSCODE)) {
    throw new HttpError(401, "That passcode didn't work.");
  }
  const token = await sessionToken(env.PASSCODE);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, request) });
}

function logout(request: Request): Response {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method.toUpperCase();

  if (path === "/api/login") {
    if (method !== "POST") throw new HttpError(405, "That action isn't available.");
    return login(request, env);
  }
  if (path === "/api/logout") {
    if (method !== "POST") throw new HttpError(405, "That action isn't available.");
    return logout(request);
  }

  const allowed = await requestAuthed(request, env.PASSCODE, env.API_TOKEN);
  if (!allowed) throw new HttpError(401, "Sign in, or send the helper password.");

  if (path === "/api/items" && method === "GET") {
    return json({ items: await withGroceryRecipes(env.DB, await listItems(env.DB)) });
  }
  if (path === "/api/items" && method === "DELETE") {
    const source = new URL(request.url).searchParams.get("source");
    if (source !== "recipe") throw new HttpError(400, "Use source=recipe to clear ingredients added from recipes.");
    return json({ deleted: await deleteRecipeSourcedItems(env.DB) });
  }
  if (path === "/api/items" && method === "POST") {
    const item = await createItem(env.DB, parseNewItem(await readJson(request)));
    return json({ item }, 201);
  }
  if (path === "/api/items/clear-checked" && method === "POST") {
    const body = await readJson(request);
    const removed = await clearChecked(env.DB, cleanStore(body.store));
    return json({ removed });
  }
  if (path === "/api/staples" && method === "GET") {
    return json({ staples: await listStaples(env.DB) });
  }
  if (path === "/api/staples" && method === "POST") {
    const staple = await createStaple(env.DB, parseStaple(await readJson(request)));
    return json({ staple }, 201);
  }
  const barcodeMatch = /^\/api\/barcode\/(\d{6,14})$/.exec(path);
  if (barcodeMatch && method === "GET") {
    const code = cleanBarcode(barcodeMatch[1]);
    if (!code) throw new HttpError(400, "That barcode should be 6 to 14 numbers.");
    const known = await lookupBarcode(env.DB, code);
    if (known) return json({ ...known, barcode: code, known: true });
    const suggestion = await suggestProduct(code);
    return json({ barcode: code, known: false, suggestion });
  }
  if (path === "/api/export" && method === "GET") {
    const [items, staples, recipes, plan, events] = await Promise.all([
      listItems(env.DB),
      listStaples(env.DB),
      listRecipes(env.DB),
      listAllPlan(env.DB),
      listAllEvents(env.DB),
    ]);
    return json({ exportedAt: new Date().toISOString(), items, staples, recipes, plan, events });
  }

  const food = await handleFood(request, env, path, method);
  if (food) return food;

  const itemMatch = /^\/api\/items\/([A-Za-z0-9-]{1,80})$/.exec(path);
  if (itemMatch) {
    const id = itemMatch[1];
    if (method === "PATCH") {
      const item = await updateItem(env.DB, id, parseItemPatch(await readJson(request)));
      return json({ item });
    }
    if (method === "DELETE") {
      await deleteItem(env.DB, id);
      return json({ ok: true });
    }
    throw new HttpError(405, "That action isn't available.");
  }

  const stapleAdd = /^\/api\/staples\/([A-Za-z0-9-]{1,80})\/add$/.exec(path);
  if (stapleAdd) {
    if (method !== "POST") throw new HttpError(405, "That action isn't available.");
    const result = await addStapleToList(env.DB, stapleAdd[1]);
    return json(result);
  }

  const stapleMatch = /^\/api\/staples\/([A-Za-z0-9-]{1,80})$/.exec(path);
  if (stapleMatch) {
    if (method !== "DELETE") throw new HttpError(405, "That action isn't available.");
    await deleteStaple(env.DB, stapleMatch[1]);
    return json({ ok: true });
  }

  throw new HttpError(404, "That address isn't part of the list.");
}

async function handleFood(request: Request, env: Env, path: string, method: string): Promise<Response | null> {
  if (path === "/api/recipes/import") {
    if (method !== "POST") throw new HttpError(405, "That action isn't available.");
    const body = await readJson(request);
    if (typeof body.url !== "string" || !body.url.trim()) throw new HttpError(400, "Paste a link to the recipe.");
    const imported = await importRecipeFromUrl(body.url);
    const recipe = await createRecipe(env.DB, { ...imported, favorite: false });
    return json({ recipe }, 201);
  }
  if (path === "/api/recipes" && method === "GET") {
    const params = new URL(request.url).searchParams;
    return json({ recipes: await listRecipes(env.DB, params.get("q") ?? "", params.get("favorite") === "true") });
  }
  if (path === "/api/recipes" && method === "POST") {
    const recipe = await createRecipe(env.DB, parseRecipe(await readJson(request)));
    return json({ recipe }, 201);
  }
  const recipeCooked = /^\/api\/recipes\/([A-Za-z0-9-]{1,80})\/cooked$/.exec(path);
  if (recipeCooked) {
    if (method !== "POST") throw new HttpError(405, "That action isn't available.");
    return json({ recipe: await markCooked(env.DB, recipeCooked[1]) });
  }
  const recipeFeedback = /^\/api\/recipes\/([A-Za-z0-9-]{1,80})\/feedback$/.exec(path);
  if (recipeFeedback) {
    if (method === "GET") return json({ feedback: await listFeedback(env.DB, recipeFeedback[1]) });
    if (method !== "POST") throw new HttpError(405, "That action isn't available.");
    const body = await readJson(request);
    const stars = typeof body.stars === "number" ? body.stars : Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, "Pick 1 to 5 stars.");
    const comment = body.comment == null || body.comment === "" ? null : body.comment;
    if (comment != null && typeof comment !== "string") throw new HttpError(400, "The comment should be words.");
    if (typeof comment === "string" && comment.trim().length > 1000) throw new HttpError(400, "That comment is too long.");
    const saved = await addFeedback(env.DB, recipeFeedback[1], stars, typeof comment === "string" ? comment.trim() || null : null);
    const recipe = await getRecipe(env.DB, recipeFeedback[1]);
    return json({ feedback: saved, recipe }, 201);
  }
  const recipeGroceries = /^\/api\/recipes\/([A-Za-z0-9-]{1,80})\/groceries$/.exec(path);
  if (recipeGroceries) {
    if (method !== "POST") throw new HttpError(405, "That action isn't available.");
    const result = await addRecipeToGroceries(env.DB, recipeGroceries[1], parseServingsOverride(await readJson(request)));
    return json(result);
  }
  const recipeMatch = /^\/api\/recipes\/([A-Za-z0-9-]{1,80})$/.exec(path);
  if (recipeMatch) {
    const id = recipeMatch[1];
    if (method === "GET") {
      const recipe = await getRecipe(env.DB, id);
      if (!recipe) throw new HttpError(404, "That recipe isn't here anymore.");
      return json({ recipe });
    }
    if (method === "PATCH") {
      return json({ recipe: await updateRecipe(env.DB, id, parseRecipePatch(await readJson(request))) });
    }
    if (method === "DELETE") {
      await deleteRecipe(env.DB, id);
      return json({ ok: true });
    }
    throw new HttpError(405, "That action isn't available.");
  }

  if (path === "/api/week" && method === "GET") {
    return json(await getWeek(env.DB, cleanWeekStart(new URL(request.url).searchParams.get("start"))));
  }
  if (path === "/api/week" && method === "PUT") {
    return json(await replaceWeek(env.DB, parseWeek(await readJson(request))));
  }

  if (path === "/api/plan/groceries") {
    if (method !== "POST") throw new HttpError(405, "That action isn't available.");
    const body = await readJson(request);
    const range = dateRange(body.from, body.to, 21);
    const planId = body.planId == null || body.planId === "" ? null : body.planId;
    if (planId != null && (typeof planId !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(planId))) {
      throw new HttpError(400, "That meal isn't planned anymore.");
    }
    return json(await addPlanGroceries(env.DB, range.from, range.to, planId));
  }
  if (path === "/api/plan" && method === "GET") {
    const range = dateRange(new URL(request.url).searchParams.get("from"), new URL(request.url).searchParams.get("to"), 62);
    return json({ plan: await listPlan(env.DB, range.from, range.to) });
  }
  if (path === "/api/plan" && method === "POST") {
    const entry = await savePlan(env.DB, parsePlan(await readJson(request)));
    return json({ entry });
  }
  const planMatch = /^\/api\/plan\/([A-Za-z0-9-]{1,80})$/.exec(path);
  if (planMatch) {
    if (method === "PATCH") {
      const entry = await setPlanAlternates(env.DB, planMatch[1], parsePlanAlternates(await readJson(request)));
      return json({ entry });
    }
    if (method !== "DELETE") throw new HttpError(405, "That action isn't available.");
    await deletePlan(env.DB, planMatch[1]);
    return json({ ok: true });
  }

  if (path === "/api/events" && method === "GET") {
    const range = dateRange(new URL(request.url).searchParams.get("from"), new URL(request.url).searchParams.get("to"), 62);
    return json({ events: await listEvents(env.DB, range.from, range.to) });
  }
  if (path === "/api/events" && method === "POST") {
    const event = await createEvent(env.DB, parseEvent(await readJson(request)));
    return json({ event }, 201);
  }
  if (path === "/api/events" && method === "PUT") {
    const range = dateRange(new URL(request.url).searchParams.get("from"), new URL(request.url).searchParams.get("to"), 62);
    const events = await replaceEvents(env.DB, range, parseEventList(await readJson(request), range));
    return json({ events });
  }
  const eventMatch = /^\/api\/events\/([A-Za-z0-9-]{1,80})$/.exec(path);
  if (eventMatch) {
    if (method !== "DELETE") throw new HttpError(405, "That action isn't available.");
    await deleteEvent(env.DB, eventMatch[1]);
    return json({ ok: true });
  }

  return null;
}

async function suggestProduct(code: string): Promise<{ name: string; brand: string | null } | null> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_en,brands`,
      {
        headers: { Accept: "application/json", "User-Agent": "FamilyGroceries/1.0 (private family list)" },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      status?: number;
      product?: { product_name?: string; product_name_en?: string; brands?: string };
    };
    if (data.status !== 1 || !data.product) return null;
    const name = (data.product.product_name_en || data.product.product_name || "").trim().replace(/\s+/g, " ");
    if (!name) return null;
    const brand = (data.product.brands || "").split(",")[0]?.trim() || "";
    return { name: name.slice(0, 80), brand: brand ? brand.slice(0, 80) : null };
  } catch {
    return null;
  }
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const path = pathOf(request);
    try {
      if (path.startsWith("/api/")) return await withRollingSession(request, env, await handleApi(request, env, path));
      if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
        throw new HttpError(405, "That action isn't available.");
      }
      return await withRollingSession(request, env, await serveAsset(request, env));
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "Something went wrong. Try again." }, 500);
    }
  },
};

export default handler;
