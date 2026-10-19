import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

type Json = Record<string, unknown>;

async function call(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; cookie?: string } = {},
) {
  const headers = new Headers();
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (opts.cookie) headers.set("Cookie", opts.cookie);
  const response = await exports.default.fetch(
    new Request("https://grocery.test" + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const text = await response.text();
  let json: Json | null = null;
  if (text) json = JSON.parse(text) as Json;
  return { status: response.status, json, setCookie: response.headers.get("Set-Cookie") };
}

async function signIn(): Promise<string> {
  const response = await call("/api/login", { method: "POST", body: { passcode: env.PASSCODE } });
  expect(response.status).toBe(200);
  expect(response.setCookie).toBeTruthy();
  return response.setCookie!.split(";")[0];
}

describe("grocery API", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM items").run();
    await env.DB.prepare("DELETE FROM staples").run();
  });

  it("starts empty, with no practice items from the seed file", async () => {
    const cookie = await signIn();
    const items = await call("/api/items", { cookie });
    const staples = await call("/api/staples", { cookie });
    expect(items.json).toEqual({ items: [] });
    expect(staples.json).toEqual({ staples: [] });
  });

  it("rejects a missing or wrong sign-in", async () => {
    expect((await call("/api/items")).status).toBe(401);
    expect((await call("/api/export")).status).toBe(401);
    expect((await call("/api/staples")).status).toBe(401);

    const wrong = await call("/api/login", { method: "POST", body: { passcode: "nope" } });
    expect(wrong.status).toBe(401);
    expect(wrong.setCookie).toBeNull();

    const empty = await call("/api/login", { method: "POST", body: { passcode: "  " } });
    expect(empty.status).toBe(400);

    const passcodeAsToken = await call("/api/items", { token: env.PASSCODE });
    expect(passcodeAsToken.status).toBe(401);
    const tokenAsPasscode = await call("/api/login", { method: "POST", body: { passcode: env.API_TOKEN } });
    expect(tokenAsPasscode.status).toBe(401);
  });

  it("keeps a phone signed in with a long-lived cookie", async () => {
    const cookie = await signIn();
    const header = (await call("/api/login", { method: "POST", body: { passcode: env.PASSCODE } })).setCookie ?? "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("Max-Age=34560000");
    expect(header).toContain("SameSite=Lax");

    const items = await call("/api/items", { cookie });
    expect(items.status).toBe(200);

    const loggedOut = await call("/api/logout", { method: "POST", cookie });
    expect(loggedOut.setCookie).toContain("Max-Age=0");
  });

  it("lets a helper use the bearer token", async () => {
    const ok = await call("/api/items", { token: env.API_TOKEN });
    expect(ok.status).toBe(200);
    const bad = await call("/api/items", { token: "not-the-token" });
    expect(bad.status).toBe(401);
  });

  it("adds, edits, checks, and deletes an item", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "  Oat milk  ", store: "costco", category: "refrigerated", quantityNote: "2 cartons", brand: "Oatly" },
    });
    expect(created.status).toBe(201);
    const item = created.json?.item as Json;
    expect(item.name).toBe("Oat milk");
    expect(item.checked).toBe(false);
    expect(item.staple).toBe(false);

    const patched = await call(`/api/items/${item.id}`, {
      method: "PATCH",
      token,
      body: { checked: true, quantityNote: "1 carton" },
    });
    expect(patched.status).toBe(200);
    expect((patched.json?.item as Json).checked).toBe(true);
    expect((patched.json?.item as Json).quantityNote).toBe("1 carton");

    const removed = await call(`/api/items/${item.id}`, { method: "DELETE", token });
    expect(removed.status).toBe(200);
    expect((await call(`/api/items/${item.id}`, { method: "DELETE", token })).status).toBe(404);
    expect((await call("/api/items", { token })).json).toEqual({ items: [] });
  });

  it("only allows aisles that belong to the store", async () => {
    const token = env.API_TOKEN;
    expect((await call("/api/items", { method: "POST", token, body: { name: "Bananas", store: "costco", category: "produce" } })).status).toBe(400);
    expect((await call("/api/items", { method: "POST", token, body: { name: "Soap", store: "amazon", category: "frozen" } })).status).toBe(400);
    expect((await call("/api/items", { method: "POST", token, body: { name: "", store: "local", category: "produce" } })).status).toBe(400);

    const local = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Bananas", store: "local", category: "produce" },
    });
    expect(local.status).toBe(201);

    const amazon = await call("/api/items", {
      method: "POST",
      token,
      body: {
        name: "Dish soap",
        store: "amazon",
        asin: "https://www.amazon.com/Example-Soap/dp/B0DISHSOAP/ref=sr",
        brand: "Seventh Generation",
      },
    });
    expect(amazon.status).toBe(201);
    expect((amazon.json?.item as Json).category).toBe("general");
    expect((amazon.json?.item as Json).asin).toBe("B0DISHSOAP");

    const id = (local.json?.item as Json).id;
    const moved = await call(`/api/items/${id}`, { method: "PATCH", token, body: { store: "amazon" } });
    expect(moved.status).toBe(400);
  });

  it("keeps staples and can add a bought one again", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Paper towels", store: "costco", category: "shelf", staple: true, brand: "Kirkland" },
    });
    const item = created.json?.item as Json;
    expect(item.staple).toBe(true);
    expect(item.stapleId).toBeTruthy();

    const staples = await call("/api/staples", { token });
    expect(staples.json?.staples).toHaveLength(1);

    const again = await call(`/api/staples/${item.stapleId}/add`, { method: "POST", token });
    expect(again.status).toBe(200);
    expect(again.json?.alreadyOnList).toBe(true);
    expect((await call("/api/items", { token })).json?.items).toHaveLength(1);

    await call(`/api/items/${item.id}`, { method: "PATCH", token, body: { checked: true } });
    const readded = await call(`/api/staples/${item.stapleId}/add`, { method: "POST", token });
    expect(readded.json?.alreadyOnList).toBe(false);
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(items.filter((entry) => entry.checked === false)).toHaveLength(1);
    expect(items.filter((entry) => entry.checked === true)).toHaveLength(1);

    const cleared = await call("/api/items/clear-checked", { method: "POST", token, body: { store: "costco" } });
    expect(cleared.json).toEqual({ removed: 1 });
    const left = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(left).toHaveLength(1);
    expect(left[0].checked).toBe(false);
    expect((await call("/api/staples", { token })).json?.staples).toHaveLength(1);

    await call(`/api/items/${left[0].id}`, { method: "DELETE", token });
    expect((await call("/api/staples", { token })).json?.staples).toHaveLength(1);
  });

  it("adds a staple on its own, and removing it leaves this week's item", async () => {
    const token = env.API_TOKEN;
    const staple = await call("/api/staples", {
      method: "POST",
      token,
      body: { name: "Coffee beans", store: "amazon", brand: "Lavazza", asin: "b0coffee01" },
    });
    expect(staple.status).toBe(201);
    const stapleId = (staple.json?.staple as Json).id as string;
    expect((staple.json?.staple as Json).asin).toBe("B0COFFEE01");
    expect((staple.json?.staple as Json).category).toBe("general");

    const added = await call(`/api/staples/${stapleId}/add`, { method: "POST", token });
    const item = added.json?.item as Json;
    expect(item.store).toBe("amazon");
    expect(item.staple).toBe(true);

    const other = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Bread", store: "local", category: "shelf", checked: true },
    });
    expect(other.status).toBe(201);

    const clearedLocal = await call("/api/items/clear-checked", { method: "POST", token, body: { store: "local" } });
    expect(clearedLocal.json).toEqual({ removed: 1 });
    const stillThere = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(stillThere.map((entry) => entry.name)).toEqual(["Coffee beans"]);

    expect((await call(`/api/staples/${stapleId}`, { method: "DELETE", token })).status).toBe(200);
    const after = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(after).toHaveLength(1);
    expect(after[0].staple).toBe(false);
    expect(after[0].stapleId).toBeNull();
    expect((await call("/api/staples", { token })).json).toEqual({ staples: [] });
    expect((await call(`/api/staples/${stapleId}`, { method: "DELETE", token })).status).toBe(404);
  });

  it("exports the whole list for a backup", async () => {
    const token = env.API_TOKEN;
    await call("/api/items", { method: "POST", token, body: { name: "Spinach", store: "local", category: "produce" } });
    await call("/api/staples", { method: "POST", token, body: { name: "Oat milk", store: "costco", category: "refrigerated" } });
    const dump = await call("/api/export", { token });
    expect(dump.status).toBe(200);
    expect(dump.json?.items).toHaveLength(1);
    expect(dump.json?.staples).toHaveLength(1);
    expect(typeof dump.json?.exportedAt).toBe("string");
  });

  it("can update a practice item whose id is not a long random one", async () => {
    const token = env.API_TOKEN;
    const now = "2026-01-02T12:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO items (id, name, quantity_note, store, category, checked, brand, asin, staple, staple_id, created_at, updated_at)
       VALUES (?, ?, NULL, 'costco', 'shelf', 0, NULL, NULL, 0, NULL, ?, ?)`,
    )
      .bind("item-olive-oil", "Olive oil", now, now)
      .run();

    const patched = await call("/api/items/item-olive-oil", { method: "PATCH", token, body: { checked: true } });
    expect(patched.status).toBe(200);
    expect((patched.json?.item as Json).checked).toBe(true);
  });

  it("serves the phone page", async () => {
    const response = await exports.default.fetch("https://grocery.test/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type") ?? "").toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Groceries");
    expect(html).toContain("/manifest.json");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });
});
