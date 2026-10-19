import { clearSessionCookie, passcodeMatches, requestAuthed, sessionCookie, sessionToken } from "./auth";
import { addStapleToList, clearChecked, createItem, createStaple, deleteItem, deleteStaple, listItems, listStaples, updateItem } from "./db";
import { HttpError, json, readJson } from "./http";
import { cleanStore, parseItemPatch, parseNewItem, parseStaple } from "./validate";

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
  "img-src 'self'",
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
  if (type.includes("text/html")) {
    headers.set("Content-Security-Policy", CSP);
    headers.set("Cache-Control", "no-cache");
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
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
    return json({ items: await listItems(env.DB) });
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
  if (path === "/api/export" && method === "GET") {
    const [items, staples] = await Promise.all([listItems(env.DB), listStaples(env.DB)]);
    return json({ exportedAt: new Date().toISOString(), items, staples });
  }

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

const handler: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const path = pathOf(request);
    try {
      if (path.startsWith("/api/")) return await handleApi(request, env, path);
      if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
        throw new HttpError(405, "That action isn't available.");
      }
      return await serveAsset(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "Something went wrong. Try again." }, 500);
    }
  },
};

export default handler;
