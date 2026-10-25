import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { deriveShareKey, sha256Hex } from "../src/auth";

type Json = Record<string, unknown>;

function pngUint32(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

async function pngPixel(bytes: Uint8Array, x: number, y: number) {
  let offset = 8;
  let width = 0;
  let color = 2;
  const parts: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = pngUint32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = pngUint32(data, 0);
      color = data[9];
    }
    if (type === "IDAT") parts.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const packed = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    packed.set(part, cursor);
    cursor += part.length;
  }
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const row = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const paeth = (left: number, up: number, upLeft: number) => {
    const estimate = left + up - upLeft;
    const leftDelta = Math.abs(estimate - left);
    const upDelta = Math.abs(estimate - up);
    const upLeftDelta = Math.abs(estimate - upLeft);
    if (leftDelta <= upDelta && leftDelta <= upLeftDelta) return left;
    return upDelta <= upLeftDelta ? up : upLeft;
  };
  for (let line = 0; line <= y; line += 1) {
    const filter = raw[line * (stride + 1)];
    const start = line * (stride + 1) + 1;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? row[index - channels] : 0;
      const up = prev[index];
      const upLeft = index >= channels ? prev[index - channels] : 0;
      const value = raw[start + index];
      if (filter === 1) row[index] = (value + left) & 255;
      else if (filter === 2) row[index] = (value + up) & 255;
      else if (filter === 3) row[index] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[index] = (value + paeth(left, up, upLeft)) & 255;
      else row[index] = value;
    }
    prev.set(row);
  }
  const pixel = x * channels;
  return [row[pixel], row[pixel + 1], row[pixel + 2]];
}

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

async function shareText(token: string, body: string, contentType = "application/json") {
  const response = await exports.default.fetch(
    new Request("https://grocery.test/api/share", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body,
    }),
  );
  return {
    status: response.status,
    text: await response.text(),
    type: response.headers.get("Content-Type") ?? "",
  };
}

function easternDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function shiftDay(iso: string, count: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function mondayOfDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftDay(iso, weekday === 0 ? -6 : 1 - weekday);
}

/** Monday of this week through Sunday of next week. Matches src/food.ts groceryWindow. */
function shopWindow() {
  const from = mondayOfDay(easternDay());
  return { from, to: shiftDay(from, 13) };
}

async function signIn(): Promise<string> {
  const response = await call("/api/login", { method: "POST", body: { passcode: env.PASSCODE } });
  expect(response.status).toBe(200);
  expect(response.setCookie).toBeTruthy();
  return response.setCookie!.split(";")[0];
}

describe("grocery API", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM recipe_feedback").run();
    await env.DB.prepare("DELETE FROM recipe_made").run();
    await env.DB.prepare("DELETE FROM grocery_sources").run();
    await env.DB.prepare("DELETE FROM plan_entries").run();
    await env.DB.prepare("DELETE FROM family_events").run();
    await env.DB.prepare("DELETE FROM recipes").run();
    await env.DB.prepare("DELETE FROM items").run();
    await env.DB.prepare("DELETE FROM staples").run();
    await env.DB.prepare("DELETE FROM on_hand").run();
    await env.DB.prepare("DELETE FROM share_keys").run();
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
    expect(items.setCookie ?? "").toContain("grocery_session=");
    expect(items.setCookie ?? "").toContain("Max-Age=34560000");

    const home = await exports.default.fetch(new Request("https://grocery.test/", { headers: { Cookie: cookie } }));
    const page = await home.text();
    expect(page).toContain('data-session="1"');
    expect(page).toContain('id="splash"');
    expect(page).toContain("splash-family");
    expect(page).not.toContain("login-brand");
    expect(page).not.toContain('src="/mark.svg"');
    expect(page).not.toContain("passcode");
    expect(home.headers.get("Set-Cookie") ?? "").toContain("Max-Age=34560000");

    const anon = await exports.default.fetch("https://grocery.test/");
    const anonHtml = await anon.text();
    expect(anonHtml).toContain('data-session="0"');
    expect(anonHtml).toContain('id="splash"');
    expect(anonHtml).toContain("splash-table");
    expect(anonHtml).not.toContain("login-brand");
    expect(anonHtml).not.toContain('src="/mark.svg"');
    expect(anonHtml).not.toContain("passcode");
    expect(anon.headers.get("Set-Cookie")).toBeNull();

    const stale = await exports.default.fetch(new Request("https://grocery.test/", { headers: { Cookie: "grocery_session=nope" } }));
    expect(await stale.text()).toContain('data-session="0"');
    expect(stale.headers.get("Set-Cookie")).toBeNull();

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

  it("remembers hidden groceries and staples for suggestions", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Mandarin orange cups", store: "costco", category: "shelf", section: "pantry", brand: "Dole", asin: "B0MANDARIN" },
    });
    expect(created.status).toBe(201);
    const item = created.json?.item as Json;
    expect((await call(`/api/items/${item.id}`, { method: "PATCH", token, body: { deleted: true } })).status).toBe(200);
    const staple = await call("/api/staples", {
      method: "POST",
      token,
      body: { name: "Jessica's sourdough bread", store: "costco", category: "shelf", brand: "Kirkland", asin: "B00SOURDOU" },
    });
    expect(staple.status).toBe(201);
    const stapleId = (staple.json?.staple as Json).id as string;
    const history = await call("/api/items/history", { token });
    expect(history.status).toBe(200);
    const rows = (history.json?.items ?? []) as Json[];
    const saved = rows.find((entry) => entry.name === "Mandarin orange cups");
    expect(saved?.deletedAt).toBeTruthy();
    expect(saved?.brand).toBe("Dole");
    expect(saved?.asin).toBe("B0MANDARIN");
    expect(saved?.storeTag).toBe("costco");
    expect(saved?.section).toBe("pantry");
    const staples = (history.json?.staples ?? []) as Json[];
    expect(staples.some((entry) => entry.name === "Jessica's sourdough bread" && entry.brand === "Kirkland")).toBe(true);
    const listed = (history.json && ((await call("/api/items", { token })).json?.items ?? [])) as Json[];
    expect(listed.some((entry) => entry.name === "Mandarin orange cups")).toBe(false);
    expect((await call(`/api/items/${item.id}`, { method: "DELETE", token })).status).toBe(200);
    expect((await call(`/api/staples/${stapleId}`, { method: "DELETE", token })).status).toBe(200);
  });

  it("hides a grocery item and puts the same one back", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Lemons", store: "local", category: "produce", section: "produce" },
    });
    expect(created.status).toBe(201);
    const item = created.json?.item as Json;

    const hidden = await call(`/api/items/${item.id}`, { method: "PATCH", token, body: { deleted: true } });
    expect(hidden.status).toBe(200);
    const listed = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(listed.some((entry) => entry.id === item.id)).toBe(false);

    const bad = await call(`/api/items/${item.id}`, { method: "PATCH", token, body: { deleted: "yes" } });
    expect(bad.status).toBe(400);

    const restored = await call(`/api/items/${item.id}`, { method: "PATCH", token, body: { deleted: false } });
    expect(restored.status).toBe(200);
    expect((restored.json?.item as Json).id).toBe(item.id);
    expect((restored.json?.item as Json).name).toBe("Lemons");
    const back = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(back.some((entry) => entry.id === item.id && entry.name === "Lemons")).toBe(true);

    const staple = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Paper towels", store: "costco", category: "shelf", staple: true },
    });
    const line = staple.json?.item as Json;
    await call(`/api/items/${line.id}`, { method: "PATCH", token, body: { deleted: true } });
    const again = await call(`/api/staples/${line.stapleId}/add`, { method: "POST", token });
    expect(again.status).toBe(200);
    expect(again.json?.alreadyOnList).toBe(false);
    expect((again.json?.item as Json).id).not.toBe(line.id);
  });

  it("lets every store use produce, shelf, refrigerated, and frozen", async () => {
    const token = env.API_TOKEN;
    const costcoProduce = await call("/api/items", { method: "POST", token, body: { name: "Bananas", store: "costco", category: "produce" } });
    expect(costcoProduce.status).toBe(201);
    expect((costcoProduce.json?.item as Json).storeName).toBe("Costco");
    expect((costcoProduce.json?.item as Json).category).toBe("produce");
    const amazonFrozen = await call("/api/items", { method: "POST", token, body: { name: "Soap", store: "amazon", category: "frozen" } });
    expect(amazonFrozen.status).toBe(201);
    expect((amazonFrozen.json?.item as Json).storeName).toBe("Amazon");
    expect((amazonFrozen.json?.item as Json).category).toBe("frozen");
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
    expect(moved.status).toBe(200);
    expect((moved.json?.item as Json).storeName).toBe("Amazon");
    expect((moved.json?.item as Json).category).toBe("produce");
  });

  it("renames and removes a store without losing the item", async () => {
    const token = env.API_TOKEN;
    const listed = await call("/api/stores", { token });
    expect(((listed.json?.stores as Json[]) || []).map((store) => store.name)).toEqual(["Local store", "Costco", "Amazon"]);

    const created = await call("/api/stores", { method: "POST", token, body: { name: " Target " } });
    expect(created.status).toBe(201);
    const id = (created.json?.store as Json).id as string;
    const again = await call("/api/stores", { method: "POST", token, body: { name: "target" } });
    expect(again.status).toBe(200);
    expect((again.json?.store as Json).id).toBe(id);
    expect((await call("/api/stores", { method: "POST", token, body: { name: " " } })).status).toBe(400);

    const item = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Paper plates", store: "Target", category: "shelf" },
    });
    expect(item.status).toBe(201);
    expect((item.json?.item as Json).storeName).toBe("Target");

    const renamed = await call(`/api/stores/${id}`, { method: "PATCH", token, body: { name: "Target Plaza" } });
    expect((renamed.json?.store as Json).name).toBe("Target Plaza");
    const named = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(named.find((entry) => entry.name === "Paper plates")?.storeName).toBe("Target Plaza");

    expect((await call(`/api/stores/${id}`, { method: "DELETE", token })).status).toBe(200);
    const cleared = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(cleared.find((entry) => entry.name === "Paper plates")?.storeName).toBeNull();

    const costco = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Oat milk", store: "costco", category: "refrigerated" },
    });
    expect((costco.json?.item as Json).store).toBe("costco");
    expect((costco.json?.item as Json).storeName).toBe("Costco");
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
    expect(dump.json?.recipes).toEqual([]);
    expect(dump.json?.plan).toEqual([]);
    expect(dump.json?.events).toEqual([]);
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

  it("still adds an item when no barcode is sent", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Rice", store: "costco", category: "shelf" },
    });
    expect(created.status).toBe(201);
    const item = created.json?.item as Json;
    expect(item.barcode).toBeNull();
    expect(item.staple).toBe(false);

    const patched = await call(`/api/items/${item.id}`, { method: "PATCH", token, body: { checked: true } });
    expect((patched.json?.item as Json).barcode).toBeNull();
    expect((patched.json?.item as Json).checked).toBe(true);
  });

  it("remembers a barcode on the item and one staple", async () => {
    const token = env.API_TOKEN;
    const code = "012345678905";
    const created = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Oat milk", store: "costco", category: "refrigerated", brand: "Oatly", barcode: code },
    });
    expect(created.status).toBe(201);
    const item = created.json?.item as Json;
    expect(item.barcode).toBe(code);
    expect(item.staple).toBe(true);
    expect(item.brand).toBe("Oatly");

    const staples = ((await call("/api/staples", { token })).json?.staples ?? []) as Json[];
    expect(staples).toHaveLength(1);
    expect(staples[0].barcode).toBe(code);

    const again = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Oat milk", store: "costco", category: "refrigerated", brand: "Oatly", barcode: code },
    });
    expect(again.status).toBe(201);
    expect((again.json?.item as Json).id).toBe(item.id);
    expect(((await call("/api/items", { token })).json?.items as Json[])).toHaveLength(1);
    expect(((await call("/api/staples", { token })).json?.staples as Json[])).toHaveLength(1);

    const known = await call(`/api/barcode/${code}`, { token });
    expect(known.status).toBe(200);
    expect(known.json?.known).toBe(true);
    expect(known.json?.alreadyOnList).toBe(true);
    expect(known.json?.stapleId).toBe(item.stapleId);
    expect(known.json?.name).toBe("Oat milk");

    await call(`/api/items/${item.id}`, { method: "PATCH", token, body: { checked: true } });
    const afterCheck = await call(`/api/barcode/${code}`, { token });
    expect(afterCheck.json?.alreadyOnList).toBe(false);

    const readded = await call(`/api/staples/${item.stapleId}/add`, { method: "POST", token });
    expect(readded.json?.alreadyOnList).toBe(false);
    expect((readded.json?.item as Json).barcode).toBe(code);
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(items.filter((entry) => entry.checked === false)).toHaveLength(1);
    expect(((await call("/api/staples", { token })).json?.staples as Json[])).toHaveLength(1);

    const alias = await call("/api/barcode/0012345678905", { token });
    expect(alias.json?.known).toBe(true);
    expect(alias.json?.name).toBe("Oat milk");
  });

  it("keeps a barcode when only the bought box changes, and does not make it a staple by itself", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Crackers", store: "local", category: "shelf" },
    });
    const id = (created.json?.item as Json).id;
    const withCode = await call(`/api/items/${id}`, { method: "PATCH", token, body: { barcode: "555555" } });
    expect((withCode.json?.item as Json).barcode).toBe("555555");
    expect((withCode.json?.item as Json).staple).toBe(false);
    const checked = await call(`/api/items/${id}`, { method: "PATCH", token, body: { checked: true } });
    expect((checked.json?.item as Json).barcode).toBe("555555");
    expect((checked.json?.item as Json).staple).toBe(false);
  });

  it("rejects a bad barcode and hides lookup until sign-in", async () => {
    const token = env.API_TOKEN;
    expect((await call("/api/barcode/12345678")).status).toBe(401);
    expect(
      (await call("/api/items", { method: "POST", token, body: { name: "Nope", store: "costco", category: "shelf", barcode: "12345" } }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("/api/items", {
          method: "POST",
          token,
          body: { name: "Nope", store: "costco", category: "shelf", barcode: "123456789012345" },
        })
      ).status,
    ).toBe(400);
    const blank = await call("/api/staples", {
      method: "POST",
      token,
      body: { name: "Coffee", store: "amazon" },
    });
    expect((blank.json?.staple as Json).barcode).toBeNull();
    const saved = await call("/api/staples", {
      method: "POST",
      token,
      body: { name: "Coffee", store: "amazon", barcode: "000111222333" },
    });
    expect((saved.json?.staple as Json).barcode).toBe("000111222333");
  });

  it("suggests a name for a new barcode and stays quiet when the lookup misses", async () => {
    const token = env.API_TOKEN;
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("openfoodfacts.org")) {
        return new Response(
          JSON.stringify({ status: 1, product: { product_name: "Oat drink", brands: "Oatly, Other" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const found = await call("/api/barcode/3017620422003", { token });
      expect(found.status).toBe(200);
      expect(found.json?.known).toBe(false);
      expect(found.json?.suggestion).toEqual({ name: "Oat drink", brand: "Oatly" });
    } finally {
      globalThis.fetch = original;
    }

    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 0 }), { status: 200 })) as typeof fetch;
    try {
      const missed = await call("/api/barcode/000000000000", { token });
      expect(missed.json?.known).toBe(false);
      expect(missed.json?.suggestion).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("saves a recipe, plans it, and shops its ingredients once", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Weeknight chili",
        servings: 4,
        totalTime: "45 min",
        sourceUrl: "https://recipes.example/chili",
        ingredients: ["1 lb ground beef", "1 onion", "2 cloves garlic"],
        steps: ["Brown the beef.", "Simmer until thick."],
      },
    });
    expect(created.status).toBe(201);
    const recipe = created.json?.recipe as Json;
    expect(recipe.name).toBe("Weeknight chili");
    expect(recipe.sourceUrl).toBe("https://recipes.example/chili");
    const id = recipe.id as string;

    const doubled = await call(`/api/recipes/${id}/groceries`, { method: "POST", token, body: { servings: 8 } });
    expect(doubled.status).toBe(200);
    expect(doubled.json).toMatchObject({ added: 3, updated: 0 });
    const again = await call(`/api/recipes/${id}/groceries`, { method: "POST", token, body: { servings: 8 } });
    expect(again.json).toMatchObject({ added: 0, skipped: 3 });

    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const beef = items.find((item) => item.name === "Ground beef");
    expect(beef?.quantityNote).toBe("2 lb");
    expect(beef?.store).toBe("local");
    expect(beef?.section).toBe("meat");
    expect(items.find((item) => item.name === "Onion")?.quantityNote).toBe("2");
    expect(items.find((item) => item.name === "Garlic")?.quantityNote).toBe("4 cloves");

    const favorite = await call(`/api/recipes/${id}`, { method: "PATCH", token, body: { favorite: true } });
    expect((favorite.json?.recipe as Json).favorite).toBe(true);

    const monday = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-10-19", meal: "dinner", type: "recipe", recipeId: id },
    });
    const thursday = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-10-22", meal: "dinner", type: "recipe", recipeId: id },
    });
    expect(monday.status).toBe(200);
    expect(thursday.status).toBe(200);
    await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-10-20", meal: "dinner", type: "leftovers" },
    });
    await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-10-21", meal: "lunch", type: "note", note: "Eating out" },
    });

    await call("/api/items/clear-checked", { method: "POST", token, body: { store: "local" } });
    for (const item of items) {
      await call(`/api/items/${item.id}`, { method: "DELETE", token });
    }

    const shopped = await call("/api/plan/groceries", {
      method: "POST",
      token,
      body: { from: "2026-10-19", to: "2026-10-25" },
    });
    expect(shopped.json).toMatchObject({ added: 3 });
    const weekItems = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(weekItems.find((item) => item.name === "Ground beef")?.quantityNote).toBe("2 lb");

    const repeat = await call("/api/plan/groceries", {
      method: "POST",
      token,
      body: { from: "2026-10-19", to: "2026-10-25" },
    });
    expect(repeat.json).toMatchObject({ added: 0, skipped: 6 });
    const still = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(still.find((item) => item.name === "Ground beef")?.quantityNote).toBe("2 lb");

    const removed = await call(`/api/recipes/${id}`, { method: "DELETE", token });
    expect(removed.status).toBe(200);
    const plan = ((await call("/api/plan?from=2026-10-19&to=2026-10-25", { token })).json?.plan ?? []) as Json[];
    const notes = plan.filter((entry) => entry.type === "note").map((entry) => entry.note);
    expect(notes).toContain("Weeknight chili");
    expect(plan.some((entry) => entry.type === "leftovers")).toBe(true);
  });

  it("imports a recipe page and replaces calendar events for a range", async () => {
    const token = env.API_TOKEN;
    const html = `<!doctype html><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Recipe",
          name: "Lemon pasta",
          image: "https://images.example/pasta.jpg",
          recipeYield: "4 servings",
          totalTime: "PT25M",
          recipeIngredient: ["1/2 lb spaghetti", "1 lemon"],
          recipeInstructions: [{ "@type": "HowToStep", text: "Boil the pasta." }, { "@type": "HowToStep", text: "Toss with lemon." }],
        },
      ],
    })}</script>`;
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://recipes.example/pasta")) {
        return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const imported = await call("/api/recipes/import", {
        method: "POST",
        token,
        body: { url: "https://recipes.example/pasta" },
      });
      expect(imported.status).toBe(201);
      const recipe = imported.json?.recipe as Json;
      expect(recipe.name).toBe("Lemon pasta");
      expect(recipe.imageUrl).toBe("https://images.example/pasta.jpg");
      expect(recipe.totalTime).toBe("25 min");
      expect(recipe.servings).toBe(4);
      expect(recipe.steps).toEqual(["Boil the pasta.", "Toss with lemon."]);
      expect((recipe.ingredients as Json[])[0]).toMatchObject({ name: "spaghetti", quantity: 0.5, unit: "lb" });
    } finally {
      globalThis.fetch = original;
    }

    const ogHtml = `<!doctype html><meta property="og:image" content="https://images.example/shrimp.jpg"><script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Garlic shrimp",
      recipeIngredient: ["1 lb shrimp"],
      recipeInstructions: ["Cook the shrimp."],
    })}</script>`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://recipes.example/shrimp")) {
        return new Response(ogHtml, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return original(input, init);
    }) as typeof fetch;
    try {
      const fromOg = await call("/api/recipes/import", {
        method: "POST",
        token,
        body: { url: "https://recipes.example/shrimp" },
      });
      expect(fromOg.status).toBe(201);
      const shrimp = fromOg.json?.recipe as Json;
      expect(shrimp.imageUrl).toBe("https://images.example/shrimp.jpg");
      const photo = await call(`/api/recipes/${shrimp.id}`, {
        method: "PATCH",
        token,
        body: { imageUrl: "https://images.example/shrimp-2.jpg" },
      });
      expect(photo.status).toBe(200);
      expect((photo.json?.recipe as Json).imageUrl).toBe("https://images.example/shrimp-2.jpg");
    } finally {
      globalThis.fetch = original;
    }

    const missed = await call("/api/recipes/import", { method: "POST", token, body: { url: "http://recipes.example/nope" } });
    expect(missed.status).toBe(400);

    await call("/api/events", {
      method: "POST",
      token,
      body: { date: "2026-10-18", time: "9:00", title: "Keep me" },
    });
    const replaced = await call("/api/events?from=2026-10-19&to=2026-10-25", {
      method: "PUT",
      token,
      body: {
        events: [
          { date: "2026-10-19", time: "15:30", title: "Soccer" },
          { date: "2026-10-21", time: "afternoon", title: "No school" },
        ],
      },
    });
    expect(replaced.status).toBe(200);
    const events = ((await call("/api/events?from=2026-10-01&to=2026-10-31", { token })).json?.events ?? []) as Json[];
    expect(events.map((event) => event.title)).toEqual(["Keep me", "Soccer", "No school"]);
  });

  it("does not add one planned meal twice when the week is added later", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Soup", servings: 2, ingredients: ["1 onion"], steps: ["Simmer."] },
    });
    const id = (created.json?.recipe as Json).id;
    const planned = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-10-19", meal: "dinner", type: "recipe", recipeId: id },
    });
    const planId = (planned.json?.entry as Json).id;
    await call("/api/plan/groceries", { method: "POST", token, body: { from: "2026-10-19", to: "2026-10-19", planId } });
    await call("/api/plan/groceries", { method: "POST", token, body: { from: "2026-10-19", to: "2026-10-25" } });
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(items.find((item) => item.name === "Onion")?.quantityNote).toBe("1");
  });

  it("adds groceries when a recipe is planned and takes them back when it changes", async () => {
    const token = env.API_TOKEN;
    const chili = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Chili", ingredients: ["1 onion", "1 lb beef"], steps: ["Simmer."] },
    });
    const pasta = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Pasta", ingredients: ["1 onion", "1/2 lb spaghetti"], steps: ["Boil."] },
    });
    const chiliId = (chili.json?.recipe as Json).id as string;
    const pastaId = (pasta.json?.recipe as Json).id as string;

    await call("/api/items", { method: "POST", token, body: { name: "Milk", store: "local", category: "refrigerated" } });
    const planned = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-10-19", meal: "dinner", type: "recipe", recipeId: chiliId },
    });
    expect(planned.status).toBe(200);
    const afterPlan = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(afterPlan.find((item) => item.name === "Onion")?.quantityNote).toBe("1");
    expect(afterPlan.find((item) => item.name === "Beef")?.quantityNote).toBe("1 lb");
    expect(afterPlan.find((item) => item.name === "Milk")?.quantityNote ?? null).toBeNull();

    await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-10-20", meal: "dinner", type: "recipe", recipeId: pastaId },
    });
    const shared = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(shared.find((item) => item.name === "Onion")?.quantityNote).toBe("2");

    const leftovers = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-10-21", meal: "dinner", type: "leftovers" },
    });
    expect(leftovers.status).toBe(200);
    expect(((await call("/api/items", { token })).json?.items as Json[]).filter((item) => item.name === "Onion")).toHaveLength(1);

    const beef = shared.find((item) => item.name === "Beef");
    await call(`/api/items/${beef?.id}`, { method: "PATCH", token, body: { checked: true } });
    await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-10-19", meal: "dinner", type: "note", note: "Eating out" },
    });
    const afterSwap = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(afterSwap.find((item) => item.name === "Beef")?.checked).toBe(true);
    expect(afterSwap.find((item) => item.name === "Onion")?.quantityNote).toBe("1");
    expect(afterSwap.some((item) => item.name === "Milk")).toBe(true);

    const pastaPlan = ((await call("/api/plan?from=2026-10-20&to=2026-10-20", { token })).json?.plan ?? []) as Json[];
    await call(`/api/plan/${pastaPlan[0].id}`, { method: "DELETE", token });
    const cleared = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(cleared.some((item) => item.name === "Onion")).toBe(false);
    expect(cleared.some((item) => item.name === "Spaghetti")).toBe(false);
    expect(cleared.some((item) => item.name === "Milk")).toBe(true);
    expect(cleared.find((item) => item.name === "Beef")?.checked).toBe(true);
  });

  it("replaces a week of recipes for a helper and reads it back", async () => {
    const token = env.API_TOKEN;
    const first = await call("/api/week", {
      method: "PUT",
      token,
      body: {
        weekStart: "2026-10-19",
        days: [
          {
            date: "2026-10-19",
            meal: "dinner",
            type: "recipe",
            recipe: {
              externalId: "home-chef-chicken-chili",
              name: "Chicken chili",
              coversNights: 2,
              servings: 4,
              nightBefore: ["Thaw the chicken in the fridge."],
              ingredients: ["1 lb chicken thighs", "1 onion"],
              prepSteps: ["Chop the onion."],
              cookSteps: [
                { text: "Brown the chicken.", minutes: 8 },
                { text: "Simmer.", minutes: 25 },
              ],
              kidsPlates: "Plain rice and fruit.",
              reheating: "Simmer 5 minutes.",
              sourceUrl: "https://example.com/chicken-chili",
            },
          },
          { date: "2026-10-20", meal: "dinner", type: "leftovers", note: "Chicken chili" },
          { date: "2026-10-22", meal: "dinner", type: "note", note: "Eating out" },
        ],
      },
    });
    expect(first.status).toBe(200);
    const firstDays = (first.json?.days ?? []) as Json[];
    expect(firstDays).toHaveLength(3);
    expect(firstDays[1].type).toBe("leftovers");
    expect((firstDays[1].recipe as Json).name).toBe("Chicken chili");
    const savedRecipe = firstDays[0].recipe as Json;
    expect(savedRecipe.externalId).toBe("home-chef-chicken-chili");
    expect(savedRecipe.coversNights).toBe(2);
    expect(savedRecipe.nightBefore).toEqual(["Thaw the chicken in the fridge."]);
    expect(savedRecipe.prepSteps).toEqual(["Chop the onion."]);
    expect(savedRecipe.cookSteps).toEqual([
      { text: "Brown the chicken.", minutes: 8, ingredients: [] },
      { text: "Simmer.", minutes: 25, ingredients: [] },
    ]);
    expect(savedRecipe.kidsPlates).toBe("Plain rice and fruit.");
    const shopped = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(shopped.find((item) => item.name === "Chicken thighs")?.quantityNote).toBe("1 lb");
    expect(shopped.find((item) => item.name === "Onion")?.quantityNote).toBe("1");

    const second = await call("/api/week", {
      method: "PUT",
      token,
      body: {
        weekStart: "2026-10-19",
        days: [
          {
            date: "2026-10-21",
            meal: "dinner",
            type: "recipe",
            recipe: {
              externalId: "home-chef-chicken-chili",
              name: "Weeknight chili",
              coversNights: 2,
              ingredients: ["2 lb chicken thighs"],
              cookSteps: [{ text: "Simmer the chili.", minutes: 30 }],
            },
          },
        ],
      },
    });
    expect(second.status).toBe(200);
    const recipes = ((await call("/api/recipes", { token })).json?.recipes ?? []) as Json[];
    expect(recipes.filter((recipe) => recipe.externalId === "home-chef-chicken-chili")).toHaveLength(1);
    expect(recipes.find((recipe) => recipe.externalId === "home-chef-chicken-chili")?.name).toBe("Weeknight chili");

    const read = await call("/api/week?start=2026-10-19", { token });
    expect(read.status).toBe(200);
    expect(read.json?.weekStart).toBe("2026-10-19");
    const days = (read.json?.days ?? []) as Json[];
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-10-21");
    expect((days[0].recipe as Json).cookSteps).toEqual([{ text: "Simmer the chili.", minutes: 30, ingredients: [] }]);
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(items.some((item) => item.name === "Onion")).toBe(false);
    expect(items.find((item) => item.name === "Chicken thighs")?.quantityNote).toBe("2 lb");
    expect((await call("/api/week", { method: "PUT", token, body: { weekStart: "2026-10-20", days: [] } })).status).toBe(400);
  });

  it("keeps the cookbook when a week is replaced and reports when a recipe was made", async () => {
    const token = env.API_TOKEN;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const shift = (iso: string, days: number) => {
      const [year, month, day] = iso.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const older = shift(today, -14);
    const recent = shift(today, -3);
    const future = shift(today, 10);

    const created = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Keep me soup", ingredients: ["1 onion"], steps: ["Simmer."] },
    });
    const id = (created.json?.recipe as Json).id as string;
    await call("/api/plan", { method: "POST", token, body: { date: older, meal: "dinner", type: "recipe", recipeId: id } });
    await call("/api/plan", { method: "POST", token, body: { date: recent, meal: "dinner", type: "recipe", recipeId: id } });
    await call("/api/plan", { method: "POST", token, body: { date: recent, meal: "lunch", type: "recipe", recipeId: id } });
    await call("/api/plan", { method: "POST", token, body: { date: future, meal: "dinner", type: "recipe", recipeId: id } });
    await call("/api/plan", { method: "POST", token, body: { date: shift(today, -1), meal: "dinner", type: "leftovers", note: "Soup" } });

    const starred = await call(`/api/recipes/${id}`, { method: "PATCH", token, body: { favorite: true } });
    expect((starred.json?.recipe as Json).favorite).toBe(true);
    expect((starred.json?.recipe as Json).lastMade).toBe(recent);
    expect((starred.json?.recipe as Json).timesMade).toBe(3);

    const favorites = await call("/api/recipes?favorite=true&q=soup", { token });
    const listed = (favorites.json?.recipes ?? []) as Json[];
    expect(listed).toHaveLength(1);
    expect(listed[0].lastMade).toBe(recent);
    expect(listed[0].timesMade).toBe(3);

    const replaced = await call("/api/week", {
      method: "PUT",
      token,
      body: {
        weekStart: "2026-10-26",
        days: [
          {
            date: "2026-10-26",
            meal: "dinner",
            type: "recipe",
            recipe: { externalId: "keep-me-soup", name: "Brand new pasta", ingredients: ["1/2 lb spaghetti"], steps: ["Boil."] },
          },
        ],
      },
    });
    expect(replaced.status).toBe(200);
    const names = (((await call("/api/recipes", { token })).json?.recipes ?? []) as Json[]).map((recipe) => recipe.name);
    expect(names).toContain("Keep me soup");
    expect(names).toContain("Brand new pasta");
    const week = ((await call("/api/week?start=2026-10-26", { token })).json?.days ?? []) as Json[];
    expect(week).toHaveLength(1);
    expect((week[0].recipe as Json).name).toBe("Brand new pasta");
  });

  it("parses shopping lines, skips pantry basics, and keeps feedback", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Salsa chicken",
        servings: 2,
        totalTime: "35 minutes",
        cookware: ["chef's knife", "citrus juicer"],
        ingredients: [
          "–2 tsp water to thin",
          "1/box (~5 oz) lettuce",
          "/box (~5 oz) lettuce",
          "2 cloves garlic",
          "2 tsp olive oil, 10 cloves garlic",
          "1/2 tsp black pepper",
          { text: "1 lb chicken thighs", name: "chicken thighs", qty: 1, unit: "lb", section: "meat", buy: true },
          { text: "1 avocado", name: "avocado", qty: 1, section: "produce", optional: true },
        ],
        cookSteps: [{ text: "Wash the lettuce.", minutes: 2, ingredients: [1] }],
      },
    });
    expect(created.status).toBe(201);
    const recipe = created.json?.recipe as Json;
    const lines = recipe.ingredients as Json[];
    const water = lines.find((line) => line.name === "water");
    expect(water?.qty).toBe(2);
    expect(water?.unit).toBe("tsp");
    expect(water?.buy).toBe(false);
    const lettuce = lines.filter((line) => line.name === "lettuce");
    expect(lettuce.length).toBeGreaterThanOrEqual(2);
    expect(lettuce[0]).toMatchObject({ qty: 1, unit: "box", section: "produce" });
    expect(String(lettuce[0].note)).toContain("5 oz");
    const garlic = lines.filter((line) => line.name === "garlic");
    expect(garlic.some((line) => line.qty === 2 && line.unit === "clove")).toBe(true);
    expect(garlic.some((line) => line.qty === 10 && line.unit === "clove")).toBe(true);
    expect(garlic.some((line) => line.unit === "tsp" && line.qty === 20)).toBe(false);
    expect(lines.find((line) => line.name === "black pepper")?.buy).toBe(false);
    expect(lines.find((line) => line.name === "avocado")?.optional).toBe(true);
    expect(recipe.cookware).toEqual(["chef's knife", "citrus juicer"]);
    expect((recipe.cookSteps as Json[])[0].ingredients).toEqual([1]);

    const id = recipe.id as string;
    await call("/api/plan", { method: "POST", token, body: { date: shopWindow().from, meal: "dinner", type: "recipe", recipeId: id } });
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(items.some((item) => item.name === "Water")).toBe(false);
    expect(items.some((item) => item.name === "Black pepper")).toBe(false);
    expect(items.some((item) => item.name === "Avocado")).toBe(false);
    expect(items.find((item) => item.name === "Lettuce")?.section).toBe("produce");
    expect(items.find((item) => item.name === "Chicken thighs")).toMatchObject({ quantityNote: "1 lb", section: "meat" });
    expect((items.find((item) => item.name === "Chicken thighs")?.recipes as Json[])[0]).toMatchObject({
      name: "Salsa chicken",
      date: shopWindow().from,
    });

    const cooked = await call(`/api/recipes/${id}/cooked`, { method: "POST", token, body: {} });
    expect(cooked.status).toBe(200);
    expect((cooked.json?.recipe as Json).cookedToday).toBe(true);
    const again = await call(`/api/recipes/${id}/cooked`, { method: "POST", token, body: {} });
    expect((again.json?.recipe as Json).timesMade).toBe((cooked.json?.recipe as Json).timesMade);

    const sent = await call(`/api/recipes/${id}/feedback`, {
      method: "POST",
      token,
      body: { stars: 5, comment: "The kids ate it." },
    });
    expect(sent.status).toBe(201);
    expect((sent.json?.recipe as Json).averageRating).toBe(5);
    expect((sent.json?.recipe as Json).lastComment).toBe("The kids ate it.");
    const feedback = await call(`/api/recipes/${id}/feedback`, { token });
    expect((feedback.json?.feedback as Json[])[0]).toMatchObject({ stars: 5, comment: "The kids ate it." });

    const cleared = await call("/api/items?source=recipe", { method: "DELETE", token });
    expect(cleared.status).toBe(200);
    expect(Number(cleared.json?.deleted)).toBeGreaterThan(0);
    const left = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(left.some((item) => item.name === "Chicken thighs")).toBe(false);
  });

  it("keeps an explicit buy on an optional ingredient and accepts timer ranges", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Shrimp tacos",
        servings: 4,
        ingredients: [
          { text: "1 lb shrimp", name: "shrimp", qty: 1, unit: "lb", section: "meat", buy: true },
          { text: "1/2 cup rice", name: "rice", qty: 0.5, unit: "cup", section: "pantry", optional: true, buy: true },
          { text: "1 avocado", name: "avocado", qty: 1, section: "produce", optional: true },
        ],
        nightBefore: ["Thaw the shrimp"],
        prepSteps: ["Chop the cabbage"],
        cookSteps: [
          { text: "Sear the shrimp.", minutes: "4-5", ingredients: [0] },
          { text: "Rest.", seconds: 30, ingredients: [] },
        ],
        kidsPlates: "Plain tortillas.",
        reheating: "Warm gently.",
      },
    });
    expect(created.status).toBe(201);
    const recipe = created.json?.recipe as Json;
    const lines = recipe.ingredients as Json[];
    expect(lines.find((line) => line.name === "rice")).toMatchObject({ optional: true, buy: true, qty: 0.5 });
    expect(lines.find((line) => line.name === "avocado")).toMatchObject({ optional: true, buy: false });
    expect(recipe.cookSteps).toEqual([
      { text: "Sear the shrimp.", minutes: "4-5", ingredients: [0] },
      { text: "Rest.", minutes: null, seconds: 30, ingredients: [] },
    ]);
    const id = recipe.id as string;
    const shrimpDay = shiftDay(shopWindow().from, 4);
    await call("/api/plan", { method: "POST", token, body: { date: shrimpDay, meal: "dinner", type: "recipe", recipeId: id } });
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(items.find((item) => item.name === "Rice")?.quantityNote ?? null).toBe("½ cup");
    expect(items.some((item) => item.name === "Shrimp")).toBe(true);
    expect(items.some((item) => item.name === "Avocado")).toBe(false);
    const leftover = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: shiftDay(shrimpDay, 1), meal: "dinner", type: "leftovers", recipeId: id },
    });
    expect(leftover.status).toBe(200);
    expect((leftover.json?.entry as Json).recipeId).toBe(id);
    const leftoverDay = shiftDay(shrimpDay, 1);
    const linked = ((await call(`/api/plan?from=${leftoverDay}&to=${leftoverDay}`, { token })).json?.plan ?? []) as Json[];
    expect(linked[0]).toMatchObject({ type: "leftovers", recipeId: id, recipeName: "Shrimp tacos" });
  });

  it("keeps structured ingredients and step links when one field changes", async () => {
    const token = env.API_TOKEN;
    const beef = {
      text: "1 lb fresh ground beef 93/7",
      name: "Ground beef 93/7",
      quantity: 1,
      qty: 1,
      unit: "lb",
      section: "meat",
      buy: true,
      optional: false,
      note: null,
    };
    const onion = {
      text: "1 onion",
      name: "onion",
      quantity: 1,
      qty: 1,
      unit: null,
      section: "produce",
      buy: true,
      optional: false,
      note: null,
    };
    const created = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Beef tacos",
        servings: 4,
        ingredients: [beef, onion],
        steps: ["Brown the beef."],
        prepSteps: ["Thaw the beef."],
        cookSteps: [{ text: "Brown the beef.", minutes: 8, ingredients: [0] }],
      },
    });
    expect(created.status).toBe(201);
    const recipe = created.json?.recipe as Json;
    expect((recipe.ingredients as Json[])[0].name).toBe("Ground beef 93/7");
    expect(String((recipe.ingredients as Json[])[0].text)).toContain("fresh");
    const id = recipe.id as string;

    const renamed = await call(`/api/recipes/${id}`, { method: "PATCH", token, body: { name: "Weeknight tacos" } });
    expect(renamed.status).toBe(200);
    const kept = renamed.json?.recipe as Json;
    expect(kept.name).toBe("Weeknight tacos");
    expect(kept.ingredients).toEqual(recipe.ingredients);
    expect(kept.cookSteps).toEqual([{ text: "Brown the beef.", minutes: 8, ingredients: [0] }]);
    expect(kept.prepSteps).toEqual(["Thaw the beef."]);

    const edited = await call(`/api/recipes/${id}`, {
      method: "PATCH",
      token,
      body: {
        ingredients: [{ ...(recipe.ingredients as Json[])[0], name: "Ground beef 90/10" }, (recipe.ingredients as Json[])[1]],
      },
    });
    const lines = (edited.json?.recipe as Json).ingredients as Json[];
    expect(lines[0].name).toBe("Ground beef 90/10");
    expect(lines[0].text).toBe("1 lb fresh ground beef 93/7");
    expect(lines[0].unit).toBe("lb");
    expect(lines[1]).toEqual((recipe.ingredients as Json[])[1]);
    expect((edited.json?.recipe as Json).cookSteps).toEqual(recipe.cookSteps);
  });

  it("keeps a leftovers note when that meal is saved again", async () => {
    const token = env.API_TOKEN;
    const chili = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Chicken chili", ingredients: ["1 onion"], steps: ["Simmer."] },
    });
    const pasta = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Lemon pasta", ingredients: ["1 lemon"], steps: ["Boil."] },
    });
    const chiliId = (chili.json?.recipe as Json).id;
    const pastaId = (pasta.json?.recipe as Json).id;
    await call("/api/plan", { method: "POST", token, body: { date: "2026-12-01", meal: "dinner", type: "recipe", recipeId: chiliId } });
    await call("/api/plan", { method: "POST", token, body: { date: "2026-12-02", meal: "dinner", type: "recipe", recipeId: pastaId } });
    const first = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-12-03", meal: "dinner", type: "leftovers", recipeId: chiliId, note: "Chicken chili" },
    });
    expect((first.json?.entry as Json).note).toBe("Chicken chili");
    const again = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-12-03", meal: "dinner", type: "leftovers", recipeId: pastaId },
    });
    expect(again.status).toBe(200);
    expect((again.json?.entry as Json).note).toBe("Chicken chili");
    expect((again.json?.entry as Json).recipeId).toBe(pastaId);
    const renamed = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-12-03", meal: "dinner", type: "leftovers", recipeId: chiliId, note: "Spicy chili" },
    });
    expect((renamed.json?.entry as Json).note).toBe("Spicy chili");
  });

  it("stores up to three alternates without adding their groceries", async () => {
    const token = env.API_TOKEN;
    const main = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Chosen chili", externalId: "chosen-chili", ingredients: ["1 lb ground beef"], steps: ["Simmer."] },
    });
    const salmon = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Sheet salmon", externalId: "sheet-salmon", ingredients: ["1 lb salmon"], steps: ["Roast."] },
    });
    const pasta = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Lemon noodles", externalId: "lemon-noodles", ingredients: ["1/2 lb spaghetti"], steps: ["Boil."] },
    });
    const extra = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Extra soup", ingredients: ["1 onion"], steps: ["Simmer."] },
    });
    const mainId = (main.json?.recipe as Json).id as string;
    const salmonId = (salmon.json?.recipe as Json).id as string;
    const pastaId = (pasta.json?.recipe as Json).id as string;
    const chosenDay = shiftDay(shopWindow().from, 2);
    const planned = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: chosenDay, meal: "dinner", type: "recipe", recipeId: mainId, alternates: ["sheet-salmon", pastaId] },
    });
    expect(planned.status).toBe(200);
    const entry = planned.json?.entry as Json;
    expect(entry.alternates).toEqual([salmonId, pastaId]);
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(items.map((item) => item.name)).toEqual(["Ground beef"]);

    const kept = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: chosenDay, meal: "dinner", type: "recipe", recipeId: mainId },
    });
    expect((kept.json?.entry as Json).alternates).toEqual([salmonId, pastaId]);

    const patched = await call(`/api/plan/${entry.id}`, {
      method: "PATCH",
      token,
      body: { alternates: [salmonId, "lemon-noodles", mainId] },
    });
    expect(patched.status).toBe(200);
    expect((patched.json?.entry as Json).recipeId).toBe(mainId);
    expect((patched.json?.entry as Json).alternates).toEqual([salmonId, pastaId]);
    expect(((await call("/api/items", { token })).json?.items as Json[]).map((item) => item.name)).toEqual(["Ground beef"]);

    const swapped = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: chosenDay, meal: "dinner", type: "recipe", recipeId: salmonId, alternates: [mainId, pastaId] },
    });
    expect((swapped.json?.entry as Json).alternates).toEqual([mainId, pastaId]);
    const after = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(after.map((item) => item.name)).toEqual(["Salmon"]);
    expect(after.some((item) => item.name === "Ground beef" || item.name === "Spaghetti")).toBe(false);

    expect((await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-12-09", meal: "dinner", type: "recipe", recipeId: mainId, alternates: [salmonId, pastaId, (extra.json?.recipe as Json).id, "nope"] },
    })).status).toBe(400);
    expect((await call(`/api/plan/${entry.id}`, { method: "PATCH", token, body: { alternates: ["missing-recipe"] } })).status).toBe(400);

    const week = await call("/api/week", {
      method: "PUT",
      token,
      body: {
        weekStart: "2026-12-07",
        days: [{ date: "2026-12-08", meal: "dinner", type: "recipe", recipeId: mainId, alternates: ["sheet-salmon"] }],
      },
    });
    expect(week.status).toBe(200);
    const day = ((week.json?.days ?? []) as Json[])[0];
    expect(day.alternates).toEqual([salmonId]);
    expect(day.recipeId).toBe(mainId);
  });

  it("merges plurals, sums amounts, and keeps different sections apart", async () => {
    const token = env.API_TOKEN;
    const first = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Lemon chicken",
        ingredients: [
          "2 lemons",
          "2 English cucumbers",
          "8 1/2 tsp garlic",
          "1 bag carrots",
          { text: "4 cube butter", name: "butter", qty: 4, unit: "cube", section: "dairy", buy: true },
        ],
        steps: ["Cook."],
      },
    });
    const second = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Lemon salad",
        ingredients: ["1 lemon", "1 English cucumber", "1 tsp garlic", "1 1/2 cups carrots"],
        steps: ["Toss."],
      },
    });
    const jarred = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Jarred garlic pasta",
        ingredients: [{ text: "1 jar garlic", name: "garlic", qty: 1, unit: "jar", section: "pantry", buy: true }],
        steps: ["Warm."],
      },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const ids = [first, second, jarred].map((response) => (response.json?.recipe as Json).id as string);
    const dates = [0, 1, 2].map((offset) => shiftDay(shopWindow().from, offset));
    for (let index = 0; index < ids.length; index += 1) {
      const planned = await call("/api/plan", {
        method: "POST",
        token,
        body: { date: dates[index], meal: "dinner", type: "recipe", recipeId: ids[index] },
      });
      expect(planned.status).toBe(200);
    }

    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const lemons = items.filter((item) => /lemon/i.test(String(item.name)));
    const cucumbers = items.filter((item) => /cucumber/i.test(String(item.name)));
    expect(lemons).toHaveLength(1);
    expect(lemons[0].quantityNote).toBe("3");
    expect(cucumbers).toHaveLength(1);
    expect(cucumbers[0].quantityNote).toBe("3");

    const garlics = items.filter((item) => item.name === "Garlic");
    expect(garlics).toHaveLength(2);
    expect(garlics.find((item) => item.section === "produce")?.quantityNote).toBe("9 ½ tsp");
    expect(garlics.find((item) => item.section === "pantry")?.quantityNote).toBe("1 jar");
    expect(String(garlics.find((item) => item.section === "pantry")?.quantityNote ?? "")).not.toMatch(/\b(tsp|tbsp|cups?)\b/i);
    const carrots = items.find((item) => item.name === "Carrots");
    expect(carrots?.quantityNote).toBe("1 bag + 1 ½ cups");
    const butter = items.find((item) => item.name === "Butter");
    expect(butter?.quantityNote).toBe("4 cubes");
    expect(butter?.section).toBe("dairy");
  });

  it("skips usually-on-hand names and rebuilds planned groceries without dropping typed items", async () => {
    const token = env.API_TOKEN;
    expect((await call("/api/on-hand")).status).toBe(401);
    expect((await call("/api/groceries/rebuild", { method: "POST", body: {} })).status).toBe(401);

    const empty = await call("/api/on-hand", { token });
    expect(empty.json).toEqual({ items: [] });
    const created = await call("/api/on-hand", { method: "POST", token, body: { name: "Lemons" } });
    expect(created.status).toBe(201);
    const again = await call("/api/on-hand", { method: "POST", token, body: { name: "Lemon" } });
    expect(again.status).toBe(200);
    expect((again.json?.item as Json).id).toBe((created.json?.item as Json).id);
    expect((await call("/api/on-hand", { method: "POST", token, body: { name: "  " } })).status).toBe(400);

    const typed = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Lemons", store: "local", category: "produce", section: "produce" },
    });
    expect(typed.status).toBe(201);
    const lemonRecipe = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Lemon water", ingredients: ["1 lemon"], steps: ["Stir."] },
    });
    const lemonId = (lemonRecipe.json?.recipe as Json).id as string;
    await call("/api/plan", {
      method: "POST",
      token,
      body: { date: shiftDay(shopWindow().from, 3), meal: "dinner", type: "recipe", recipeId: lemonId },
    });
    const skipped = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const lemons = skipped.filter((item) => /lemon/i.test(String(item.name)));
    expect(lemons).toHaveLength(1);
    expect(lemons[0].quantityNote ?? null).toBeNull();

    await call(`/api/items/${lemons[0].id}`, { method: "DELETE", token });
    await call(`/api/on-hand/${(created.json?.item as Json).id}`, { method: "DELETE", token });
    expect((await call("/api/on-hand", { token })).json).toEqual({ items: [] });
    const shopped = await call("/api/plan/groceries", {
      method: "POST",
      token,
      body: { from: shiftDay(shopWindow().from, 3), to: shiftDay(shopWindow().from, 3) },
    });
    expect(shopped.json).toMatchObject({ added: 1 });
    const bought = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(bought.find((item) => item.name === "Lemon")?.quantityNote).toBe("1");

    const rice = await call("/api/on-hand", { method: "POST", token, body: { name: "Rice" } });
    const removed = await call("/api/on-hand", { method: "DELETE", token, body: { name: "rice" } });
    expect(removed.status).toBe(200);
    expect((await call(`/api/on-hand/${(rice.json?.item as Json).id}`, { method: "DELETE", token })).status).toBe(404);

    const soap = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Dish soap", store: "local", category: "shelf" },
    });
    const dinner = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Onion beef", ingredients: ["1 onion", "1 lb beef"], steps: ["Simmer."] },
    });
    const dinnerId = (dinner.json?.recipe as Json).id as string;
    await call("/api/plan", {
      method: "POST",
      token,
      body: { date: shiftDay(shopWindow().from, 4), meal: "dinner", type: "recipe", recipeId: dinnerId },
    });
    const before = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const beef = before.find((item) => item.name === "Beef");
    const onion = before.find((item) => item.name === "Onion");
    await call(`/api/items/${beef?.id}`, { method: "PATCH", token, body: { checked: true } });
    await call(`/api/items/${onion?.id}`, { method: "PATCH", token, body: { quantityNote: "8 ½ tsp" } });
    const rebuilt = await call("/api/groceries/rebuild", { method: "POST", token, body: {} });
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.json).toMatchObject({ removed: 2, added: 2, skipped: 1 });
    const after = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(after.filter((item) => item.name === "Dish soap")).toHaveLength(1);
    expect(after.filter((item) => item.name === "Onion")).toHaveLength(1);
    expect(after.find((item) => item.name === "Onion")?.quantityNote).toBe("1");
    expect(after.filter((item) => item.name === "Beef")).toHaveLength(1);
    expect(after.find((item) => item.name === "Beef")?.checked).toBe(true);
    expect(after.some((item) => item.name === "Lemon")).toBe(true);
    expect((soap.json?.item as Json).name).toBe("Dish soap");

    const manual = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Garlic", quantityNote: "2 cartons", store: "local", category: "produce", section: "produce" },
    });
    const pounds = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Garlic roast",
        ingredients: [{ text: "1 lb garlic", name: "garlic", qty: 1, unit: "lb", section: "produce", buy: true }],
        steps: ["Roast."],
      },
    });
    const roastId = (pounds.json?.recipe as Json).id as string;
    const roast = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: shiftDay(shopWindow().from, 5), meal: "dinner", type: "recipe", recipeId: roastId },
    });
    const merged = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const garlic = merged.find((item) => item.id === (manual.json?.item as Json).id);
    expect(garlic?.quantityNote).toBe("1 lb");
    await call(`/api/plan/${(roast.json?.entry as Json).id}`, { method: "DELETE", token });
    const restored = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(restored.find((item) => item.id === (manual.json?.item as Json).id)?.quantityNote).toBe("2 cartons");
  });

  it("rebuilds many planned days at once and keeps a repeated ingredient on one line", async () => {
    const token = env.API_TOKEN;
    const created = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Cornstarch chicken",
        ingredients: ["1 tbsp cornstarch", "2 tbsp cornstarch", "1 lb chicken thighs"],
        steps: ["Toss."],
      },
    });
    const id = (created.json?.recipe as Json).id as string;
    expect((created.json?.recipe as Json).ingredients).toHaveLength(3);
    const starchStart = shopWindow().from;
    for (let day = 0; day < 10; day += 1) {
      const date = shiftDay(starchStart, day);
      const planned = await call("/api/plan", {
        method: "POST",
        token,
        body: { date, meal: "dinner", type: "recipe", recipeId: id },
      });
      expect(planned.status).toBe(200);
    }
    expect((await call("/api/items", { method: "POST", token, body: { name: "Dish soap", store: "local", category: "shelf" } })).status).toBe(201);
    const rebuilt = await call("/api/groceries/rebuild", { method: "POST", token, body: {} });
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.json).toMatchObject({ removed: 2, added: 2, skipped: 0 });
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const starch = items.filter((item) => /cornstarch/i.test(String(item.name)));
    expect(starch).toHaveLength(1);
    expect(starch[0]?.quantityNote).toBe("30 tbsp");
    expect(items.filter((item) => /chicken thigh/i.test(String(item.name)))).toHaveLength(1);
    expect(items.filter((item) => item.name === "Dish soap")).toHaveLength(1);
    const plan = ((await call(`/api/plan?from=${starchStart}&to=${starchStart}`, { token })).json?.plan ?? []) as Json[];
    expect((await call(`/api/plan/${plan[0]?.id}`, { method: "DELETE", token })).status).toBe(200);
    const still = await call(`/api/recipes/${id}`, { token });
    expect(still.status).toBe(200);
    expect((still.json?.recipe as Json).name).toBe("Cornstarch chicken");
    expect(((still.json?.recipe as Json).ingredients as unknown[]) ?? []).toHaveLength(3);
  });

  it("rebuild clears a for-N amount and puts the summed total back", async () => {
    const token = env.API_TOKEN;
    const jarred = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Jarred garlic", quantityNote: "for 2 recipes", store: "local", category: "shelf", section: "pantry" },
    });
    const paprika = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Paprika", quantityNote: "for 3", store: "local", category: "shelf", section: "pantry" },
    });
    const milk = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Oat milk", quantityNote: "2 cartons", store: "local", category: "refrigerated" },
    });
    expect(jarred.status).toBe(201);
    expect(paprika.status).toBe(201);
    expect(milk.status).toBe(201);
    const cleared = await call("/api/groceries/rebuild", { method: "POST", token, body: {} });
    expect(cleared.status).toBe(200);
    expect(cleared.json).toMatchObject({ added: 0, updated: 2, removed: 0 });
    const idle = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(idle.find((item) => item.id === (jarred.json?.item as Json).id)?.quantityNote ?? null).toBeNull();
    expect(idle.find((item) => item.id === (paprika.json?.item as Json).id)?.quantityNote ?? null).toBeNull();
    expect(idle.find((item) => item.id === (milk.json?.item as Json).id)?.quantityNote).toBe("2 cartons");

    const first = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Cup one", ingredients: ["1 cup rice"], steps: ["Boil."] },
    });
    const second = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Cup two", ingredients: ["1 cup rice"], steps: ["Simmer."] },
    });
    const ids = [first, second].map((response) => (response.json?.recipe as Json).id as string);
    const dates = [6, 7].map((offset) => shiftDay(shopWindow().from, offset));
    for (let index = 0; index < ids.length; index += 1) {
      const planned = await call("/api/plan", {
        method: "POST",
        token,
        body: { date: dates[index], meal: "lunch", type: "recipe", recipeId: ids[index] },
      });
      expect(planned.status).toBe(200);
    }
    const before = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const rice = before.find((item) => item.name === "Rice");
    expect(rice?.quantityNote).toBe("2 cups");
    expect((await call(`/api/items/${rice?.id}`, { method: "PATCH", token, body: { quantityNote: "for 2 recipes" } })).status).toBe(200);
    const rebuilt = await call("/api/groceries/rebuild", { method: "POST", token, body: {} });
    expect(rebuilt.status).toBe(200);
    const after = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(after.find((item) => item.name === "Rice")?.quantityNote).toBe("2 cups");
    expect(after.find((item) => item.id === (milk.json?.item as Json).id)?.quantityNote).toBe("2 cartons");
  });

  it("keeps the main photo from the recipe, then the page card", async () => {
    const token = env.API_TOKEN;
    const pages: Record<string, string> = {
      "https://recipes.example/layered": `<!doctype html>
        <meta property="og:image" content="https://images.example/og.jpg">
        <meta name="twitter:image" content="https://images.example/tw.jpg">
        <script type="application/ld+json">${JSON.stringify({
          "@graph": [
            { "@type": "Recipe", name: "First cake", recipeIngredient: ["1 egg"], recipeInstructions: ["Bake."], image: "http://images.example/skip.jpg" },
            { "@type": "Recipe", name: "Second cake", image: { "@type": "ImageObject", contentUrl: "https://images.example/from-recipe.jpg" } },
          ],
        })}</script>`,
      "https://recipes.example/relative": `<!doctype html><script type="application/ld+json">${JSON.stringify({
        "@type": "Recipe",
        name: "Relative cake",
        image: "images/cake.jpg",
        recipeIngredient: ["1 egg"],
        recipeInstructions: ["Bake."],
      })}</script>`,
      "https://recipes.example/card": `<!doctype html>
        <meta property="og:image" content="http://images.example/og-http.jpg">
        <meta property="og:image" content="https://images.example/og-https.jpg">
        <meta name="twitter:image" content="https://images.example/tw-only.jpg">
        <script type="application/ld+json">${JSON.stringify({
          "@type": "Recipe",
          name: "Card cake",
          recipeIngredient: ["1 egg"],
          recipeInstructions: ["Bake."],
        })}</script>`,
      "https://recipes.example/bird": `<!doctype html>
        <meta name="twitter:image:src" content="https://images.example/bird.jpg?w=1&amp;h=2">
        <script type="application/ld+json">${JSON.stringify({
          "@type": "Recipe",
          name: "Bird cake",
          recipeIngredient: ["1 egg"],
          recipeInstructions: ["Bake."],
        })}</script>`,
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input);
      const body = pages[href];
      if (body) return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
      return original(input, init);
    }) as typeof fetch;
    try {
      const layered = await call("/api/recipes/import", { method: "POST", token, body: { url: "https://recipes.example/layered" } });
      expect(layered.status).toBe(201);
      expect((layered.json?.recipe as Json).name).toBe("First cake");
      expect((layered.json?.recipe as Json).imageUrl).toBe("https://images.example/from-recipe.jpg");

      const relative = await call("/api/recipes/import", { method: "POST", token, body: { url: "https://recipes.example/relative" } });
      expect((relative.json?.recipe as Json).imageUrl).toBe("https://recipes.example/images/cake.jpg");

      const card = await call("/api/recipes/import", { method: "POST", token, body: { url: "https://recipes.example/card" } });
      expect((card.json?.recipe as Json).imageUrl).toBe("https://images.example/og-https.jpg");

      const bird = await call("/api/recipes/import", { method: "POST", token, body: { url: "https://recipes.example/bird" } });
      expect((bird.json?.recipe as Json).imageUrl).toBe("https://images.example/bird.jpg?w=1&h=2");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("imports from a share key without shopping or opening the rest of the list", async () => {
    const token = env.API_TOKEN;
    const markKey = await deriveShareKey(env.PASSCODE, "Mark");
    const emmaKey = await deriveShareKey(env.PASSCODE, "Emma");
    expect(markKey).toMatch(/^ft_mark_[a-f0-9]{32}$/);
    expect(emmaKey).toMatch(/^ft_emma_[a-f0-9]{32}$/);
    expect(markKey).not.toBe(emmaKey);
    expect((await call("/api/share-setup", { token })).status).toBe(404);
    expect((await call("/api/share-setup", { token: markKey })).status).toBe(401);
    expect((await call("/api/items", { token: markKey })).status).toBe(401);
    expect((await call("/api/recipes", { token: markKey })).status).toBe(401);
    expect((await call("/api/recipes/import", { method: "POST", token: markKey, body: { url: "https://recipes.example/pasta" } })).status).toBe(401);
    expect((await call("/api/plan", { method: "POST", token: markKey, body: { date: "2026-12-16", meal: "dinner", type: "note", note: "nope" } })).status).toBe(401);

    const blocked = await shareText(token, JSON.stringify({ url: "https://recipes.example/chili" }));
    expect(blocked.status).toBe(401);
    expect(blocked.type).toContain("text/plain");
    expect(blocked.text).toBe("That share key didn't work.");
    expect((await call("/api/recipes", { token })).json).toEqual({ recipes: [] });

    const full = `<!doctype html><title>Ignored</title>
      <meta property="og:image" content="https://images.example/og-pasta.jpg">
      <meta name="twitter:image" content="https://images.example/tw-pasta.jpg">
      <script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Lemon pasta",
      image: "/images/pasta.jpg",
      recipeYield: "4 servings",
      recipeIngredient: ["1 lemon", "1/2 lb spaghetti"],
      recipeInstructions: ["Boil the pasta."],
    })}</script>`;
    const partial = `<!doctype html><title>Half a soup</title>
      <meta name="twitter:image" content="https://images.example/tw-soup.jpg">
      <meta property="og:image" content="https://images.example/og-soup.jpg">
      <script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Half a soup",
    })}</script>`;
    const notes = `<!doctype html><title>Tuesday notes</title><meta name="twitter:image" content="https://images.example/tw-notes.jpg"><p>Not a recipe.</p>`;
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input);
      if (href.startsWith("https://recipes.example/pasta")) return new Response(full, { status: 200, headers: { "Content-Type": "text/html" } });
      if (href.startsWith("https://recipes.example/half")) return new Response(partial, { status: 200, headers: { "Content-Type": "text/html" } });
      if (href.startsWith("https://recipes.example/notes")) return new Response(notes, { status: 200, headers: { "Content-Type": "text/html" } });
      if (href.startsWith("https://recipes.example/down")) return new Response("nope", { status: 500 });
      return original(input, init);
    }) as typeof fetch;
    try {
      const added = await shareText(markKey, JSON.stringify({ URL: "https://recipes.example/pasta" }));
      expect(added.status).toBe(200);
      expect(added.type).toContain("text/plain");
      expect(added.text).toBe("Added: Lemon pasta");
      const stored = await env.DB.prepare(`SELECT key_hash FROM share_keys WHERE person = ?`).bind("Mark").first<{ key_hash: string }>();
      expect(stored?.key_hash).toBe(await sha256Hex(markKey));
      expect(stored?.key_hash).not.toBe(markKey);
      const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM share_keys`).first<{ n: number }>();
      expect(Number(rows?.n)).toBe(2);
      const half = await shareText(emmaKey, "https://recipes.example/half extra words", "text/plain");
      expect(half.status).toBe(200);
      expect(half.type).toContain("text/plain");
      expect(half.text).toBe("Saved for Chef to finish: Half a soup");
      const stub = await shareText(markKey, JSON.stringify({ url: "https://recipes.example/notes" }));
      expect(stub.status).toBe(200);
      expect(stub.text).toBe("Saved for Chef to finish: Tuesday notes");
      const missed = await shareText(markKey, JSON.stringify({ url: "https://recipes.example/down" }));
      expect(missed.text).toBe("Saved for Chef to finish: Recipe");
      const bad = await shareText(markKey, JSON.stringify({ url: "http://recipes.example/pasta" }));
      expect(bad.status).toBe(400);
      expect(bad.text).toBe("Paste a full https link.");
    } finally {
      globalThis.fetch = original;
    }

    const recipes = ((await call("/api/recipes", { token })).json?.recipes ?? []) as Json[];
    const pasta = recipes.find((recipe) => recipe.name === "Lemon pasta");
    expect(pasta?.needsReview).toBe(false);
    expect(pasta?.sourceUrl).toBe("https://recipes.example/pasta");
    expect(pasta?.imageUrl).toBe("https://recipes.example/images/pasta.jpg");
    expect(((await call("/api/items", { token })).json?.items as Json[])).toEqual([]);
    const review = ((await call("/api/recipes?needsReview=true", { token })).json?.recipes ?? []) as Json[];
    expect(review.map((recipe) => recipe.name).sort()).toEqual(["Half a soup", "Recipe", "Tuesday notes"]);
    expect(review.every((recipe) => recipe.needsReview === true)).toBe(true);
    expect(String(review.find((recipe) => recipe.name === "Tuesday notes")?.sourceUrl)).toBe("https://recipes.example/notes");
    expect(review.find((recipe) => recipe.name === "Half a soup")?.imageUrl).toBe("https://images.example/og-soup.jpg");
    expect(review.find((recipe) => recipe.name === "Tuesday notes")?.imageUrl).toBe("https://images.example/tw-notes.jpg");
    expect(review.find((recipe) => recipe.name === "Recipe")?.imageUrl).toBeNull();
    const starred = await call(`/api/recipes/${review.find((recipe) => recipe.name === "Tuesday notes")?.id}`, {
      method: "PATCH",
      token,
      body: { favorite: true },
    });
    expect((starred.json?.recipe as Json).needsReview).toBe(true);

    const finished = await call(`/api/recipes/${review.find((recipe) => recipe.name === "Half a soup")?.id}`, {
      method: "PATCH",
      token,
      body: { ingredients: ["1 onion"], steps: ["Simmer."] },
    });
    expect((finished.json?.recipe as Json).needsReview).toBe(false);
    const still = ((await call("/api/recipes?needsReview=true", { token })).json?.recipes ?? []) as Json[];
    expect(still.map((recipe) => recipe.name).sort()).toEqual(["Recipe", "Tuesday notes"]);

    const planned = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: shiftDay(shopWindow().from, 6), meal: "dinner", type: "recipe", recipeId: pasta?.id },
    });
    expect(planned.status).toBe(200);
    const shopped = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(shopped.map((item) => item.name).sort()).toEqual(["Lemon", "Spaghetti"]);
  });

  it("keeps a second dinner beside the first and drops it on replace", async () => {
    const token = env.API_TOKEN;
    const barley = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Zzalso barley bowl", servings: 2, ingredients: ["1 cup zzalso barley"], steps: ["Simmer."] },
    });
    const pear = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Zzalso pear salad", servings: 2, ingredients: ["2 zzalso pears"], steps: ["Toss."] },
    });
    const lentil = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Zzalso lentil stew", servings: 2, ingredients: ["1 cup zzalso lentils"], steps: ["Stew."] },
    });
    const barleyId = (barley.json?.recipe as Json).id as string;
    const pearId = (pear.json?.recipe as Json).id as string;
    const lentilId = (lentil.json?.recipe as Json).id as string;
    const alsoDay = shiftDay(shopWindow().from, 8);
    const first = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: alsoDay, meal: "dinner", type: "recipe", recipeId: barleyId },
    });
    expect(first.status).toBe(200);
    const planId = (first.json?.entry as Json).id as string;
    const second = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: alsoDay, meal: "dinner", type: "recipe", recipeId: pearId, keep: true },
    });
    expect(second.status).toBe(200);
    expect((second.json?.entry as Json).recipeId).toBe(barleyId);
    expect((second.json?.entry as Json).also).toEqual([pearId]);
    const names = async () => ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect((await names()).map((item) => item.name).sort()).toEqual(["Zzalso barley", "Zzalso pears"]);
    const window = shopWindow();
    const rebuilt = await call("/api/groceries/rebuild", { method: "POST", token, body: { from: window.from, to: window.to } });
    expect(rebuilt.status).toBe(200);
    expect((await names()).map((item) => item.name).sort()).toEqual(["Zzalso barley", "Zzalso pears"]);
    expect((await call(`/api/plan/${planId}/also/${pearId}`, { method: "DELETE", token })).status).toBe(200);
    const afterDrop = ((await call(`/api/plan?from=${alsoDay}&to=${alsoDay}`, { token })).json?.plan ?? []) as Json[];
    expect(afterDrop).toHaveLength(1);
    expect(afterDrop[0]?.also).toEqual([]);
    expect((await names()).map((item) => item.name)).toEqual(["Zzalso barley"]);
    const again = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: alsoDay, meal: "dinner", type: "recipe", recipeId: pearId, keep: true },
    });
    expect((again.json?.entry as Json).also).toEqual([pearId]);
    const replaced = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: alsoDay, meal: "dinner", type: "recipe", recipeId: lentilId },
    });
    expect(replaced.status).toBe(200);
    expect((replaced.json?.entry as Json).recipeId).toBe(lentilId);
    expect((replaced.json?.entry as Json).also).toEqual([]);
    expect((await names()).map((item) => item.name)).toEqual(["Zzalso lentils"]);
  });

  it("shops a deferred meal once when it reaches today, and leaves cleared meals alone", async () => {
    const token = env.API_TOKEN;
    const span = shopWindow();
    const today = easternDay();
    const outside = shiftDay(span.to, 10);
    const created = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Window rice bowl", ingredients: ["1 lb window rice"], steps: ["Simmer."] },
    });
    const id = (created.json?.recipe as Json).id as string;
    const manual = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Window paper", store: "local", category: "shelf" },
    });
    const paperId = (manual.json?.item as Json).id as string;
    await call(`/api/items/${paperId}`, { method: "PATCH", token, body: { checked: true } });
    const names = async () => ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const deferred = async (planId: string) => {
      const row = await env.DB.prepare(`SELECT groceries_deferred AS deferred FROM plan_entries WHERE id = ?`)
        .bind(planId)
        .first<{ deferred: number }>();
      return Number(row?.deferred);
    };

    const far = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: outside, meal: "dinner", type: "recipe", recipeId: id },
    });
    expect(far.status).toBe(200);
    const farId = (far.json?.entry as Json).id as string;
    expect(await deferred(farId)).toBe(1);
    expect((await names()).some((item) => item.name === "Window rice")).toBe(false);
    const blocked = await call("/api/plan/groceries", { method: "POST", token, body: { from: outside, to: outside } });
    expect(blocked.json).toMatchObject({ added: 0, updated: 0 });
    const beforeDelete = await names();
    expect((await call(`/api/plan/${farId}`, { method: "DELETE", token })).status).toBe(200);
    const afterDelete = await names();
    expect(afterDelete.map((item) => [item.id, item.quantityNote, item.checked])).toEqual(
      beforeDelete.map((item) => [item.id, item.quantityNote, item.checked]),
    );

    await call("/api/plan", {
      method: "POST",
      token,
      body: { date: outside, meal: "dinner", type: "recipe", recipeId: id },
    });
    const parked = ((await call(`/api/plan?from=${outside}&to=${outside}`, { token })).json?.plan ?? []) as Json[];
    expect(parked).toHaveLength(1);
    const parkedId = parked[0].id as string;
    expect(await deferred(parkedId)).toBe(1);

    const yesterday = shiftDay(today, -1);
    await env.DB.prepare(`UPDATE plan_entries SET plan_date = ? WHERE id = ?`).bind(yesterday, parkedId).run();
    expect((await names()).some((item) => item.name === "Window rice")).toBe(false);
    expect(await deferred(parkedId)).toBe(1);

    await env.DB.prepare(`UPDATE plan_entries SET plan_date = ? WHERE id = ?`).bind(today, parkedId).run();
    const arrived = await names();
    expect(arrived.find((item) => item.name === "Window rice")?.quantityNote).toBe("1 lb");
    expect(arrived.find((item) => item.id === paperId)?.checked).toBe(true);
    expect(await deferred(parkedId)).toBe(0);
    const again = await names();
    expect(again.find((item) => item.name === "Window rice")?.quantityNote).toBe("1 lb");
    const sources = await env.DB.prepare(`SELECT COUNT(*) AS n FROM grocery_sources WHERE instr(source_key, ?) = 1`)
      .bind(`plan:${parkedId}:`)
      .first<{ n: number }>();
    expect(Number(sources?.n)).toBe(1);

    await env.DB.prepare(`DELETE FROM grocery_sources WHERE instr(source_key, ?) = 1`).bind(`plan:${parkedId}:`).run();
    await env.DB.prepare(`DELETE FROM items WHERE name = ?`).bind("Window rice").run();
    expect((await names()).some((item) => item.name === "Window rice")).toBe(false);
    expect((await names()).some((item) => item.name === "Window rice")).toBe(false);
    expect(await deferred(parkedId)).toBe(0);

    const later = shiftDay(today, 1);
    const second = later <= span.to ? { date: later, meal: "dinner" } : { date: today, meal: "lunch" };
    const near = await call("/api/plan", {
      method: "POST",
      token,
      body: { ...second, type: "recipe", recipeId: id },
    });
    expect(near.status).toBe(200);
    const nearId = (near.json?.entry as Json).id as string;
    expect(await deferred(nearId)).toBe(0);
    expect((await names()).find((item) => item.name === "Window rice")?.quantityNote).toBe("1 lb");
    expect((await names()).find((item) => item.name === "Window rice")?.quantityNote).toBe("1 lb");

    const stillFar = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: outside, meal: "dinner", type: "recipe", recipeId: id },
    });
    expect(stillFar.status).toBe(200);
    expect(await deferred((stillFar.json?.entry as Json).id as string)).toBe(1);
    const outsideRebuild = await call("/api/groceries/rebuild", {
      method: "POST",
      token,
      body: { from: outside, to: outside },
    });
    expect(outsideRebuild.json).toMatchObject({ added: 0, removed: 0 });
    expect((await names()).find((item) => item.name === "Window rice")?.quantityNote).toBe("1 lb");
  });

  it("takes groceries back when a meal moves from the window to a later date", async () => {
    const token = env.API_TOKEN;
    const span = shopWindow();
    const today = easternDay();
    const outside = shiftDay(span.to, 8);
    const other = shiftDay(today, 1) <= span.to ? shiftDay(today, 1) : today;
    const otherMeal = other === today ? "lunch" : "dinner";
    const created = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Move bowl",
        ingredients: ["1 lb move rice", "1 lemon", "1 carton oat milk", "1 sponge"],
        steps: ["Stir."],
      },
    });
    const id = (created.json?.recipe as Json).id as string;
    const side = await call("/api/recipes", {
      method: "POST",
      token,
      body: { name: "Move rice side", ingredients: ["1 lb move rice"], steps: ["Simmer."] },
    });
    const sideId = (side.json?.recipe as Json).id as string;
    const hand = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Oat milk", store: "local", category: "shelf", section: "pantry", quantityNote: "2 cartons" },
    });
    expect(hand.status).toBe(201);
    const names = async () => ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const deferred = async (planId: string) => {
      const row = await env.DB.prepare(`SELECT groceries_deferred AS deferred, plan_date FROM plan_entries WHERE id = ?`)
        .bind(planId)
        .first<{ deferred: number; plan_date: string }>();
      return { deferred: Number(row?.deferred), date: row?.plan_date ?? "" };
    };

    const stayed = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: other, meal: otherMeal, type: "recipe", recipeId: sideId },
    });
    expect(stayed.status).toBe(200);
    const moving = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: today, meal: "dinner", type: "recipe", recipeId: id },
    });
    expect(moving.status).toBe(200);
    const planId = (moving.json?.entry as Json).id as string;
    expect((await deferred(planId)).deferred).toBe(0);
    const shopped = await names();
    expect(shopped.find((item) => item.name === "Move rice")?.quantityNote).toBe("2 lb");
    expect(shopped.some((item) => item.name === "Lemon")).toBe(true);
    const sponge = shopped.find((item) => item.name === "Sponge");
    expect(sponge).toBeTruthy();
    expect((await call(`/api/items/${sponge?.id}`, { method: "PATCH", token, body: { checked: true } })).status).toBe(200);

    const moved = await call("/api/plan", {
      method: "POST",
      token,
      body: { id: planId, date: outside, meal: "dinner", type: "recipe", recipeId: id },
    });
    expect(moved.status).toBe(200);
    expect((moved.json?.entry as Json).id).toBe(planId);
    expect((moved.json?.entry as Json).date).toBe(outside);
    expect(await deferred(planId)).toEqual({ deferred: 1, date: outside });
    const leftBehind = ((await call(`/api/plan?from=${today}&to=${today}`, { token })).json?.plan ?? []) as Json[];
    expect(leftBehind.some((entry) => entry.meal === "dinner")).toBe(false);

    const after = await names();
    expect(after.find((item) => item.name === "Move rice")?.quantityNote).toBe("1 lb");
    expect(after.some((item) => item.name === "Lemon")).toBe(false);
    expect(after.find((item) => item.name === "Oat milk")?.quantityNote).toBe("2 cartons");
    expect(after.find((item) => item.name === "Sponge")).toMatchObject({ checked: true });
    const again = await names();
    expect(again.find((item) => item.name === "Move rice")?.quantityNote).toBe("1 lb");
    expect(again.filter((item) => item.name === "Sponge")).toHaveLength(1);

    await env.DB.prepare(`UPDATE plan_entries SET plan_date = ? WHERE id = ?`).bind(today, planId).run();
    const returned = await names();
    expect(returned.find((item) => item.name === "Move rice")?.quantityNote).toBe("2 lb");
    expect(returned.some((item) => item.name === "Lemon")).toBe(true);
    expect((await deferred(planId)).deferred).toBe(0);
    const returnedAgain = await names();
    expect(returnedAgain.find((item) => item.name === "Move rice")?.quantityNote).toBe("2 lb");
    expect(returnedAgain.filter((item) => item.name === "Lemon")).toHaveLength(1);
  });

  it("times fresh groceries the day before the meal, across a week boundary", async () => {
    const token = env.API_TOKEN;
    const window = shopWindow();
    const monday = shiftDay(window.from, 7);
    const sunday = shiftDay(window.from, 13);
    const salmonDue = shiftDay(monday, -1);
    const shrimpDue = shiftDay(sunday, -1);

    const salmonRecipe = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Sheet-pan salmon",
        servings: 4,
        ingredients: [
          { text: "1 lb salmon", name: "salmon", qty: 1, unit: "lb", section: "meat", buy: true, fresh: true },
          { text: "1 onion", name: "onion", qty: 1, section: "produce", buy: true, fresh: false },
        ],
        steps: ["Roast the salmon."],
      },
    });
    expect(salmonRecipe.status).toBe(201);
    const salmonId = (salmonRecipe.json?.recipe as Json).id as string;
    const savedLines = (salmonRecipe.json?.recipe as Json).ingredients as Json[];
    expect(savedLines.find((line) => line.name === "salmon")).toMatchObject({ fresh: true });
    expect(savedLines.find((line) => line.name === "onion")).toMatchObject({ fresh: false });

    const shrimpRecipe = await call("/api/recipes", {
      method: "POST",
      token,
      body: {
        name: "Garlic shrimp",
        servings: 4,
        ingredients: [{ text: "1 lb shrimp", name: "shrimp", qty: 1, unit: "lb", section: "meat", buy: true, fresh: true }],
        steps: ["Saute the shrimp."],
      },
    });
    const shrimpId = (shrimpRecipe.json?.recipe as Json).id as string;

    expect(
      (await call("/api/plan", { method: "POST", token, body: { date: monday, meal: "dinner", type: "recipe", recipeId: salmonId } })).status,
    ).toBe(200);
    expect(
      (await call("/api/plan", { method: "POST", token, body: { date: sunday, meal: "dinner", type: "recipe", recipeId: shrimpId } })).status,
    ).toBe(200);

    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    const salmon = items.find((item) => item.name === "Salmon");
    const onion = items.find((item) => item.name === "Onion");
    const shrimp = items.find((item) => item.name === "Shrimp");
    expect(salmon).toMatchObject({
      fresh: true,
      dueDate: salmonDue,
      dinnerDate: monday,
      recipeName: "Sheet-pan salmon",
      storeName: "Local store",
      quantityNote: "1 lb",
    });
    expect(onion).toMatchObject({ fresh: false, dueDate: null, dinnerDate: null });
    expect(shrimp).toMatchObject({ fresh: true, dueDate: shrimpDue, dinnerDate: sunday, recipeName: "Garlic shrimp" });

    const names = async (due: string) => {
      const response = await call(`/api/groceries?due=${due}`, { token });
      expect(response.status).toBe(200);
      return ((response.json?.groceries ?? []) as Json[]).map((item) => item.name);
    };
    expect(await names(shiftDay(salmonDue, -1))).toEqual([]);
    expect(await names(salmonDue)).toEqual(["Salmon"]);
    const both = await call(`/api/groceries?due=${shrimpDue}`, { token });
    expect(both.json?.groceries).toEqual([
      { name: "Salmon", quantity: "1 lb", store: "Local store", dinnerDate: monday, recipeName: "Sheet-pan salmon" },
      { name: "Shrimp", quantity: "1 lb", store: "Local store", dinnerDate: sunday, recipeName: "Garlic shrimp" },
    ]);

    const basil = await call("/api/items", {
      method: "POST",
      token,
      body: { name: "Basil", store: "local", category: "produce", section: "produce", fresh: true },
    });
    expect((basil.json?.item as Json).fresh).toBe(true);
    expect(await names(shrimpDue)).toEqual(["Salmon", "Shrimp"]);

    const quiet = await call(`/api/items/${salmon?.id}`, { method: "PATCH", token, body: { fresh: false } });
    expect((quiet.json?.item as Json).fresh).toBe(false);
    expect(await names(shrimpDue)).toEqual(["Shrimp"]);

    const again = await call(`/api/items/${salmon?.id}`, { method: "PATCH", token, body: { fresh: true } });
    expect((again.json?.item as Json).fresh).toBe(true);
    expect(await names(salmonDue)).toEqual(["Salmon"]);

    await call(`/api/items/${salmon?.id}`, { method: "PATCH", token, body: { checked: true } });
    expect(await names(shrimpDue)).toEqual(["Shrimp"]);

    expect((await call("/api/groceries?due=2026-13-40", { token })).status).toBe(400);
    expect((await call("/api/groceries", { token })).status).toBe(400);
    expect((await call(`/api/groceries?due=${salmonDue}`)).status).toBe(401);

    const marked = await call(`/api/recipes/${salmonId}`, {
      method: "PATCH",
      token,
      body: {
        ingredients: [
          { text: "1 lb salmon", name: "salmon", qty: 1, unit: "lb", section: "meat", buy: true, fresh: true },
          { text: "1 onion", name: "onion", qty: 1, section: "produce", buy: true, fresh: true },
        ],
      },
    });
    expect(marked.status).toBe(200);
    const after = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(after.find((item) => item.name === "Onion")).toMatchObject({ fresh: true, dueDate: salmonDue, dinnerDate: monday });
  });

  it("serves the phone page", async () => {
    const response = await exports.default.fetch("https://grocery.test/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type") ?? "").toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Family Table");
    expect(html).toContain("/manifest.json");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("serves the plate home-screen icons and the recipe menu", async () => {
    const script = await exports.default.fetch("https://grocery.test/app.js");
    expect(script.status).toBe(200);
    const js = await script.text();
    expect(js).toContain('sortButton("recent", "Recent")');
    expect(js).not.toContain("Recently made");
    expect(js).not.toContain("Swap meal");
    expect(js).not.toContain("Change meal");
    expect(js).not.toContain("change-meal");
    expect(js).not.toContain("showRecipes");
    expect(js).not.toContain("function pickerHtml");
    expect(js).toContain('data-action="add-meal"');
    expect(js).toContain("Add to ");
    expect(js).toContain('kind: "pick"');
    expect(js).not.toContain("recipe-menu");
    expect(js).not.toContain(">Edit recipe</button>");
    const todayScreen = js.slice(js.indexOf("function todayHtml"), js.indexOf("function leftoversNight"));
    expect(todayScreen).toContain("nyToday()");
    expect(todayScreen).toContain('<div class="today-head"><h1>Today</h1></div>');
    expect(todayScreen).not.toContain("monthPick");
    expect(todayScreen).not.toContain("remove-meal");
    expect(todayScreen).not.toContain('aria-label="Remove"');
    const kept = js.slice(js.indexOf("function mergeDated"), js.indexOf("function visibleRange"));
    expect(kept).toContain("entry.date < range.from");
    expect(kept).toContain("entry.date > range.to");
    const todayRange = js.slice(js.indexOf("function visibleRange"), js.indexOf("function formatUtc"));
    expect(todayRange).toContain('state.tab === "today"');
    expect(js).toContain("Remove from ${esc(state.sheet.when)}?");
    expect(js).not.toContain("Remove ${esc(state.sheet.name)} from ${esc(state.sheet.when)}?");
    expect(js).toContain("choice-stack");
    expect(js).toContain("choice-btn");
    const removeFn = js.slice(js.indexOf("async function removeMeal"), js.indexOf("function planRestoreBody"));
    expect(removeFn.indexOf("showUndo")).toBeLessThan(removeFn.indexOf('method: "DELETE"'));
    expect(removeFn).not.toContain("3000");
    expect(removeFn).not.toContain("5000");
    expect(js).toContain("const UNDO_MS = 2000");
    expect(js).toContain("const UNDO_FADE_MS = 400");
    const undoFn = js.slice(js.indexOf("function showUndo"), js.indexOf("async function deleteGrocery"));
    expect(undoFn).toContain("clearUndoTimers()");
    expect(undoFn).toContain("UNDO_MS - UNDO_FADE_MS");
    expect(undoFn).toContain("}, UNDO_MS)");
    expect(undoFn).not.toContain("5000");
    expect(undoFn).not.toContain("3000");
    const planFn = js.slice(js.indexOf("async function planRecipe"), js.indexOf("function confirmRemove"));
    expect(planFn.indexOf("finishAdd(date)")).toBeLessThan(planFn.indexOf('method: "POST"'));
    expect(planFn).not.toContain('kind: "day"');
    expect(js).toContain("pendingDeletes");
    expect(js).toContain('data-action="confirm-remove"');
    expect(js).toContain('kind: "remove-choice"');
    expect(js).not.toContain("function recipeMenuRows");
    expect(js).not.toContain("recipe-row-menu");
    const panel = js.slice(js.indexOf("function monthPanel"), js.indexOf("function monthTitle"));
    expect(panel).not.toContain(">Edit</button>");
    expect(panel).toContain('class="week-date"');
    expect(panel).toContain("shortDate(date)");
    expect(panel).not.toContain("longDate");
    expect(panel).toContain("dayBody(date, false)");
    const dayBody = js.slice(js.indexOf("function dayBody"), js.indexOf("function dinnerGap"));
    expect(dayBody).toContain("addDinnerButton(date)");
    expect(dayBody).toContain(">Nothing planned</p>");
    const selectDay = js.slice(js.indexOf('if (action === "select-day")'), js.indexOf('if (action === "add-meal")'));
    expect(selectDay).not.toContain("openAddMeal");
    expect(selectDay).toContain("if (!date) return;");
    expect(selectDay).not.toContain("nyToday()");
    const openDay = js.slice(js.indexOf('action === "open-day"'), js.indexOf('action === "cal-shift"'));
    expect(openDay).not.toContain("openAddMeal");
    expect(js).toContain('aria-label="Add dinner"');
    expect(js).toContain("mealOn(date, \"dinner\")");
    const rows = js.slice(js.indexOf("function recipeRows"), js.indexOf("function recipeHtml"));
    expect(rows).toContain('aria-label="Add to date"');
    expect(rows).not.toContain("row-edit");
    expect(rows).not.toContain('data-action="edit-recipe"');
    expect(rows).not.toContain(">Edit</button>");
    expect(rows).not.toContain('aria-label="Remove"');
    expect(rows).not.toContain('aria-label="More"');
    const detailHero = js.slice(js.indexOf("function hero"), js.indexOf("function panelBtn"));
    expect(detailHero).not.toContain("add-to-date");
    expect(detailHero).not.toContain("add-float");
    expect(detailHero).toContain('class="float right edit-float"');
    expect(detailHero).toContain(">Edit</button>");
    expect(detailHero).toContain("showEdit");
    expect(detailHero).not.toContain('aria-label="More"');
    expect(detailHero).not.toContain('aria-label="Remove"');
    const recipePage = js.slice(js.indexOf("function recipeView"), js.indexOf("function cookDock"));
    expect(recipePage).toContain('hero(recipe, !embedded, tag, mode === "page")');
    expect(recipePage).not.toContain('mode === "today"');
    expect(recipePage).toContain('class="outline-btn add-date"');
    expect(recipePage).toContain(">Add to date</button>");
    expect(js).toContain("Edit recipe");
    expect(js).not.toContain("Delete item");
    expect(js).not.toContain("Used in");
    expect(js).toContain('data-form="add-item"');
    expect(js).toContain(">Add</button>");
    expect(js).not.toContain("add-done");
    expect(js).toContain("guessSection");
    expect(js).toContain("grocery-screen");
    expect(js).toContain("is-away");
    expect(js).toContain("function openEdit");
    const groceryDown = js.slice(js.indexOf('const row = event.target.closest(".g-row")'), js.indexOf("function onPointerMove"));
    expect(groceryDown).not.toContain("setTimeout");
    const pointerUp = js.slice(js.indexOf("function onPointerUp"), js.indexOf("function onPointerCancel"));
    expect(pointerUp).toContain("openEdit(id)");
    expect(pointerUp).toContain("deleteGrocery(id)");
    expect(pointerUp).not.toContain("openItem(id)");
    const addForm = js.slice(js.indexOf("function addHtml"), js.indexOf("function newRecipeHtml"));
    expect(addForm.match(/type="submit"/g)).toHaveLength(1);
    expect(addForm).toContain('data-action="submit-add"');
    expect(addForm).not.toContain("<form");
    expect(addForm).not.toContain('type="hidden"');
    expect(addForm).toContain('name="quantityNote"');
    expect(addForm).toContain("storeFieldHtml");
    expect(addForm).toContain("sectionFieldHtml");
    expect(addForm).not.toContain("More details");
    expect(addForm).not.toContain("more-details");
    expect(addForm).not.toContain('name="category"');
    expect(addForm).not.toContain(">Aisle");
    expect(addForm).toContain('class="sheet add-sheet"');
    expect(addForm).not.toContain("choiceHtml(STORES");
    expect(js).toContain("Add store…");
    expect(js).toContain("Edit stores…");
    expect(js).toContain('data-action="edit-store"');
    expect(js).not.toContain("Manage stores");
    expect(js).toContain("Shelf-stable");
    expect(js).toContain('data-action="confirm-remove-store"');
    expect(js).toContain("will have no store.");
    const backdrop = js.slice(js.indexOf('contains("sheet")'), js.indexOf('closest("[data-action]")'));
    expect(backdrop).toContain("dismissSheet()");
    expect(backdrop).toContain("closePick()");
    expect(backdrop).not.toContain("confirm-remove");
    expect(backdrop).not.toContain("submitAdd");
    expect(backdrop).not.toContain("plan-replace");
    expect(backdrop).not.toContain("saveItem");
    const dismiss = js.slice(js.indexOf("function dismissSheet"), js.indexOf("async function onClick"));
    expect(dismiss).toContain("plan-choice");
    expect(dismiss).not.toContain("confirm-remove");
    expect(dismiss).not.toContain("saveItem");
    expect(js).toContain("storeTag");
    expect(addForm).not.toContain('name="brand"');
    expect(addForm).not.toContain(">Brand");
    expect(addForm.indexOf("sectionFieldHtml")).toBeLessThan(addForm.indexOf("storeFieldHtml"));
    expect(addForm.indexOf("freshRowHtml(draft.fresh)")).toBeLessThan(addForm.indexOf('name="notes"'));
    expect(addForm).toContain('name="notes"');
    expect(addForm).toContain("freshRowHtml(draft.fresh)");
    const freshRow = js.slice(js.indexOf("function freshRowHtml"), js.indexOf("function aisleFor"));
    expect(freshRow).toContain(">Fresh</span>");
    expect(freshRow).toContain('name="fresh"');
    expect(freshRow).toContain("fresh-field");
    expect(freshRow).not.toContain("field-label");
    expect(freshRow).toContain("fresh-row");
    expect(addForm).not.toContain("<select");
    expect(addForm).not.toContain("checkbox");
    expect(addForm).toContain("suggestHtml(filteredSuggestions())");
    const suggestions = js.slice(js.indexOf("function filteredSuggestions"), js.indexOf("function suggestHtml"));
    expect(suggestions).toContain("if (!query) return []");
    expect(suggestions).toContain(".slice(0, 5)");
    expect(suggestions).toContain("onList");
    const pull = js.slice(js.indexOf("function beginSheetPull"), js.indexOf("function moveSheetPull"));
    expect(pull).toContain('closest?.("input, textarea, select, [contenteditable=\'true\']")');
    expect(pull).toContain("pick-sheet");
    expect(pull).toContain(".add-sheet");
    expect(pull).toContain("edit-sheet");
    expect(pull).toContain('card.dataset.form === "item-edit"');
    expect(pull).toContain("scroller.scrollTop > 0");
    expect(pull).not.toContain(".sheet-grab, .sheet-head");
    expect(js).toContain("function markSheetOpen");
    expect(js).toContain('classList.add("sheet-open")');
    expect(js).toContain("function onSheetLockMove");
    expect(addForm).not.toContain("checkIcon");
    expect(addForm).not.toContain("Optional");
    expect(addForm).toContain("sectionTouched");
    const editItem = js.slice(js.indexOf('state.sheet?.kind === "edit-item"'), js.indexOf('state.sheet?.kind === "pick-date"'));
    expect(editItem).not.toContain("usedInHtml");
    expect(editItem).not.toContain("Used in");
    expect(editItem).toContain('name="section"');
    expect(editItem.indexOf('name="section"')).toBeLessThan(editItem.indexOf("storeFieldHtml"));
    expect(editItem).not.toContain('name="brand"');
    expect(editItem).not.toContain(">Brand");
    expect(editItem).not.toContain("sheet-delete");
    expect(editItem).not.toContain('name="category"');
    expect(editItem).not.toContain("More details");
    expect(editItem.indexOf("freshRowHtml")).toBeLessThan(editItem.indexOf('name="notes"'));
    expect(editItem).toContain("freshRowHtml");
    const saveItem = js.slice(js.indexOf("async function saveItem"), js.indexOf("async function fetchRecipe"));
    expect(saveItem).not.toContain("brand");
    const groceryRow = js.slice(js.indexOf("function groceryRow"), js.indexOf("function itemHtml"));
    expect(groceryRow).not.toContain("brand");
    expect(js).toContain('data-action="delete-item"');
    expect(js).toContain('name="ing-name"');
    expect(js).toContain("raised && cooked");
    expect(js).toContain("Cooked</button>");
    expect(js).toContain('class="outline-btn cook-back"');
    expect(js).toContain(">Back</button>");
    expect(js).toContain('data-delta="-1"');
    expect(js).toContain('index === 0 ? " disabled" : ""');
    const cook = js.slice(js.indexOf("function cookHtml"), js.indexOf("function groceriesHtml"));
    const actions = cook.slice(cook.indexOf('class="cook-actions"'), cook.indexOf('class="dashes"'));
    expect(cook.indexOf("cook-ings")).toBeLessThan(cook.indexOf("cook-actions"));
    expect(actions.indexOf("cook-back")).toBeGreaterThan(-1);
    expect(actions.indexOf("cook-back")).toBeLessThan(actions.indexOf('data-delta="1"'));
    expect(actions).not.toContain("cook-list");
    const moveCook = js.slice(js.indexOf("function moveCook"), js.indexOf("function closeCook"));
    expect(moveCook).toContain("if (next >= steps.length) return closeCook();");
    expect(moveCook).toContain("if (next < 0) return;");
    expect(js).not.toContain("Mark cooked");
    expect(js).not.toContain("Marked cooked");
    expect(js).not.toContain("Mark as cooked");
    expect(js).toContain("recipeThumb(recipe)");
    expect(js).toContain("Pick ${esc(mealName)} for ");
    expect(js).toContain("Added to ");
    expect(js).toContain("focusCalendarDate");
    expect(js).not.toContain('kind: "day"');
    expect(js).toContain('class="lo-pill"');
    const night = js.slice(js.indexOf("function leftoversNight"), js.indexOf("function foodPhoto"));
    expect(night.indexOf('class="lo-pill"')).toBeGreaterThan(-1);
    expect(night.indexOf('class="lo-pill"')).toBeLessThan(night.indexOf("<h1>"));
    expect(night).toContain('class="night-card');
    expect(night).toContain("hero hero-tint hero-");
    expect(night).toContain("foodPhoto(recipe, entry)");
    expect(night).toContain("bowlIcon()");
    expect(night).toContain('class="hero-logo"');
    expect(night).toContain(">Change</button>");
    expect(night).not.toContain('class="night-gap"');
    expect(js).toContain("nightCard(dinner, recipe, { change: false })");
    expect(js).toContain("nightCard(dinner, null, { change: false })");
    expect(night).not.toContain("<h1>Today</h1>");
    expect(night).not.toContain("remove-meal");
    expect(night).not.toContain(">Remove</button>");
    expect(night).toContain("options.edit");
    expect(night).toContain('class="float right edit-float"');
    expect(night).toContain(">Edit</button>");
    expect(js).toContain('data-action="remove-meal"');
    expect(js).toContain(">Remove</button>");
    expect(js).toContain('kind: "plan"');
    expect(js).toContain("scrollToTop");
    expect(js).toContain("ing-detail");
    expect(js).toContain("mealLabel(entry.meal)");
    expect(js).toContain("Night off. Enjoy the leftovers.");
    expect(js).toContain("fallback-photo");
    expect(js).toContain("onPhotoError");
    expect(js).not.toContain("onerror=");
    expect(js).not.toContain("Share button");
    expect(js).not.toContain("share-setup");
    expect(js).not.toContain("copy-share-key");
    expect(js).not.toContain("recipes-menu");
    expect(js).toContain("Needs a look");
    expect(js).not.toContain("sourceUrl");
    expect(js).toContain('class="hero-logo"');
    expect(js).toContain("markImg(112)");
    expect(js).not.toContain("function utensilsIcon");
    expect(js).toContain("function bowlIcon");
    expect(js).not.toContain("/photos/leftovers-hero.jpg");
    expect(js).toContain("Tomorrow: leftovers");
    const calendarCopy = js.slice(js.indexOf("function weekListHtml"), js.indexOf("function groceriesHtml"));
    expect(calendarCopy).not.toContain("Coming up");
    expect(calendarCopy).not.toContain("coming-up");
    const groceries = js.slice(js.indexOf("const LIST_AISLES"), js.indexOf("function groceryRow"));
    expect(groceries).not.toContain("Shelf-stable");
    expect(groceries).not.toContain('class="section-head">Fresh');
    expect(groceries).not.toContain('class="aisle-head">Fresh');
    expect(groceries).not.toContain('class="section-head">Buy today');
    expect(groceries).toContain("store-head\">${esc(block.label)}</h2>${aisles}");
    expect(groceries).toContain('["shelf", ""]');
    expect(groceries).toContain('["produce", "Produce"]');
    expect(groceries).toContain('["refrigerated", "Refrigerated"]');
    expect(groceries).toContain('["frozen", "Frozen"]');
    expect(groceries.indexOf('["shelf", ""]')).toBeLessThan(groceries.indexOf('["produce", "Produce"]'));
    expect(groceries.indexOf('["produce", "Produce"]')).toBeLessThan(groceries.indexOf('["refrigerated", "Refrigerated"]'));
    expect(groceries.indexOf('["refrigerated", "Refrigerated"]')).toBeLessThan(groceries.indexOf('["frozen", "Frozen"]'));
    expect(groceries).toContain("item.fresh ? buyHint(item)");
    expect(groceries).not.toContain("freshWaiting");
    expect(groceries).not.toContain("Coming up");
    expect(groceries).not.toContain('data-action="toggle-coming"');
    expect(js).toContain("function freshWaiting");
    expect(js).toContain('class="buy-hint"');
    const buyHint = js.slice(js.indexOf("function buyHint"), js.indexOf("function itemHtml"));
    expect(buyHint).toContain('return "Buy today"');
    expect(buyHint).toContain("Buy ${formatUtc(item.dueDate, { weekday: \"long\" })}");
    expect(buyHint).toContain("item.dueDate <= nyToday()");
    expect(js).toContain("month-screen");
    const toggleItem = js.slice(js.indexOf("async function toggleItem"), js.indexOf("async function undoCheck"));
    expect(toggleItem).not.toContain("wait(");
    expect(toggleItem).not.toContain("is-leaving");
    expect(toggleItem.indexOf("showUndo")).toBeLessThan(toggleItem.indexOf("settleCheck(id, true)"));
    expect(js).toContain('class="dot');
    expect(js).not.toContain("day-dish");
    expect(js).not.toContain("day-num");
    expect(js).toContain('aria-label="Search recipes"');
    const recipesPage = js.slice(js.indexOf("function recipesHtml"), js.indexOf("function sortButton"));
    expect(recipesPage).toContain('placeholder="Search recipes"');
    expect(recipesPage).not.toContain(">Search<");
    expect(recipesPage).not.toContain(">Search\n");
    const hero = await exports.default.fetch("https://grocery.test/photos/leftovers-hero.jpg");
    expect(hero.status).toBe(200);
    expect(hero.headers.get("Content-Type") ?? "").toContain("image/");
    expect(js).not.toContain("Reheating");
    expect(js).toContain('data-action="cancel-pick"');
    const pick = js.slice(js.indexOf("function pickHtml"), js.indexOf("function recipesHtml"));
    expect(pick).toContain('class="pick-list"');
    expect(pick).not.toContain("plan-kinds");
    expect(pick).not.toContain("mark-out");
    expect(pick).not.toContain("mark-leftovers");
    expect(js).toContain("function prepLine");
    expect(js).toContain("Prep for tomorrow:");
    const tomorrow = js.slice(js.indexOf("function tomorrowCard"), js.indexOf("function leftoversRow"));
    expect(tomorrow).not.toContain("prep-mini");
    expect(tomorrow).not.toContain("Prep for tomorrow");
    expect(js).toContain('kind: "sheet"');
    expect(js).toContain("Pick ${esc(mealName)} for ");
    expect(js).toContain("Added to ");
    expect(js).toContain("focusCalendarDate");
    expect(js).not.toContain('kind: "day"');
    expect(js).toContain("dataset.session");
    expect(js).toContain("login-brand");
    expect(js).toContain("markImg(88)");
    expect(js).not.toContain('class="splash"');
    expect(js).not.toContain("splashHtml");
    expect(js).toContain("const SPLASH_MS = 1500");
    expect(js).toContain("Add to date");
    expect(js).toContain('data-action="add-to-date"');
    expect(js).toContain('kind: "pick-date"');
    expect(js).toContain('"pick-date-day"');
    expect(js).toContain("already has ${esc(state.sheet.name)}.");
    expect(js).not.toContain("Replace it?");
    expect(js).not.toContain("Replace it or add both?");
    expect(js).not.toContain("Add both");
    expect(js).not.toContain("plan-keep");
    expect(js).toContain(">Replace</button>");
    expect(js).toContain(">Cancel</button>");
    const css = await (await exports.default.fetch("https://grocery.test/styles.css")).text();
    expect(css).toContain(".recipe-name");
    expect(css).toContain("line-clamp: 2");
    expect(css).toContain("border-radius: 50%");
    expect(css).toContain("opacity 300ms");
    expect(css).toContain(".month-panel-head.is-today .week-date");
    const shell = await (await exports.default.fetch("https://grocery.test/sw.js")).text();
    expect(js).toContain('root.classList.toggle("kb-open", kb > 80)');
    expect(css).toContain(".kb-open .add-sheet .sheet-card");
    expect(js).toContain("function screenBehindPick");
    expect(js).toContain("function parkTodayHero");
    expect(js).toContain("function restoreTodayHero");
    expect(shell).toContain("grocery-shell-v98");
    expect(shell).toContain("/styles.css?v=86");
    expect(shell).toContain("/app.js?v=93");
    const weekTab = js.slice(js.indexOf('if (action === "tab")'), js.indexOf('if (action === "back")'));
    expect(weekTab).toContain('state.calMode = "week";');
    expect(weekTab).toContain("state.weekAnchor = null;");
    expect(js).toContain("const EDGE_PX = 30");
    expect(js).toContain("const BACK_SNAP_MS = 200");
    expect(js).toContain("swipe-under");
    expect(js).toContain("can-swipe-back");
    expect(js).toContain('kind: "back"');
    expect(js).toContain('[data-action="back"], [data-action="close-sheet"], [data-action="close-cook"], [data-action="close-feedback"], [data-action="cancel-pick"], [data-action="plan-cancel"]');
    const edgeDown = js.slice(js.indexOf("function onPointerDown"), js.indexOf('const row = event.target.closest(".g-row")'));
    expect(edgeDown.indexOf("beginEdgeBack(event)")).toBeGreaterThan(-1);
    expect(edgeDown).not.toContain("beginPeriod(");
    expect(edgeDown).not.toContain('pointerType === "touch"');
    expect(edgeDown).toContain("EDGE_PX");
    expect(edgeDown).not.toContain("m-swipe");
    expect(edgeDown).not.toContain('kind: "cal"');
    expect(js).not.toContain("function beginPeriod");
    expect(js).not.toContain("function movePeriod");
    expect(js).not.toContain('kind: "period"');
    expect(js).not.toContain("onSwipeDebugMove");
    expect(js).not.toContain('document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false })');
    expect(js).not.toContain('app.addEventListener("touchmove"');
    expect(js).not.toContain('class="period-snap"');
    expect(js).not.toContain("commitPeriodSnap");
    expect(js).toContain("Version ${APP_VERSION}");
    expect(js).toContain("hero hero-tint hero-");
    expect(js).toContain(">Change</button>");
    expect(js).toContain('data-action="open-about"');
    expect(js).not.toContain('data-action="toggle-swipe-debug"');
    expect(css).toContain(".today-head h1");
    expect(css).toContain(".today-head {\n  flex: none;\n  margin-bottom: 0.8rem;\n}");
    expect(css).toContain(".search { display: block; margin: 0.8rem 0; }");
    const todayCss = css.slice(css.indexOf(".today-screen {"), css.indexOf(".today-screen.no-dock"));
    expect(todayCss).not.toContain("padding-left: 0");
    expect(css).toContain(".today-screen .tomorrow {\n  width: 100%;\n  margin-left: 0;\n  margin-right: 0;\n}");
    expect(css).toContain(".today-screen .hero {\n  border-radius: 12px;\n  overflow: hidden;\n}");
    expect(css).toContain(".can-swipe-back { touch-action: pan-y; overscroll-behavior-x: none; }");
    expect(css).toContain(".swipe-under {");
    expect(css).toContain(".is-swipe-back { transition: none; }");
    expect(js).toContain("const CHECK_HOLD_MS = 600");
    expect(js).toContain("is-checking-out");
    expect(js).toContain("desiredChecked");
    expect(js).not.toContain("checkGeneration");
    expect(js).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(css).toContain(".g-check.is-on { background: var(--green); border-color: var(--green); }");
    expect(css).toContain(".g-swipe.is-checking-out");
    expect(css).toContain("grid-template-rows: 0fr");
    expect(css).toContain(".g-swipe.is-checking-out { transition: none; transform: none; }");
    expect(css).toContain(".section-head.store-head { color: var(--ink); font-weight: 750; }");
    expect(css).toContain(".aisle-head { margin: 0.45rem 0 0.1rem; color: #8a8a90; font-size: 0.72rem; font-weight: 600;");
    expect(css).toContain(".buy-hint {\n  display: inline-block;\n  margin-top: 0.22rem;\n  padding: 0.12rem 0.48rem;\n  border-radius: 999px;\n  background: var(--green-soft);");
    const buyHintCss = css.slice(css.indexOf(".buy-hint {"), css.indexOf(".g-name .buy-hint"));
    expect(buyHintCss).toContain("font-weight: 400;");
    expect(buyHintCss).not.toContain("font-weight: 750");
    const today = js.slice(js.indexOf("function todayHtml"), js.indexOf("function todayShowsPhotoPrep"));
    expect(today).toContain('if (dinner?.type === "note") return `${todayHead()}${prep}${nightCard(dinner, null, { change: false })}');
    expect(today).not.toContain(">Edit</button>");
    expect(today).not.toContain(">Change</button>");
    expect(today.indexOf("prepLine()")).toBeLessThan(today.indexOf('dinner?.type === "note"'));
    const ahead = js.slice(js.indexOf("function recipePrepAhead"), js.indexOf("function duePrepSteps"));
    expect(ahead).toContain("recipe.nightBefore");
    expect(ahead).toContain("recipe.prepSteps");
    expect(ahead).toContain("seen.has(line)");
    const due = js.slice(js.indexOf("function duePrepSteps"), js.indexOf("function prepPhotoTag"));
    expect(due).toContain("recipePrepAhead(recipe)");
    const cookMode = js.slice(js.indexOf("function cookSequence"), js.indexOf("function resolveIngredient"));
    expect(cookMode).toContain("recipe.prepSteps");
    expect(cookMode).not.toContain("recipe.nightBefore");
    expect(css).toContain(".fresh-row {");
    expect(css).toContain(".buy-hint {");
    expect(css).not.toContain(".coming-line");
    expect(css).toContain(".store-option {");
    expect(css).toContain(".store-pick { flex: 1; min-height: 40px; padding: 0.3rem 0.75rem; text-align: left; font-weight: 400; }");
    expect(js).toContain('class="section-head store-head"');
    expect(js).toContain('class="section-head">Completed');
    const monthGrid = js.slice(js.indexOf("function monthGrid"), js.indexOf("function monthCell"));
    expect(monthGrid).toContain('["S", "M", "T", "W", "T", "F", "S"]');
    expect(monthGrid).toContain("sundayOf(first)");
    expect(monthGrid).not.toContain("mondayOf");
    const weekList = js.slice(js.indexOf("function weekListHtml"), js.indexOf("function monthHtml"));
    expect(weekList).toContain("addDays(start, 6)");
    expect(weekList).toContain('aria-label="Previous week"');
    expect(weekList).toContain('aria-label="Next week"');
    expect(weekList).toContain('class="week-period"');
    expect(weekList).not.toContain("sundayOf");
    const weekShift = js.slice(js.indexOf("function weekStart"), js.indexOf("function shiftWeek"));
    expect(weekShift).toContain("state.weekAnchor >= today");
    const shiftWeek = js.slice(js.indexOf("function shiftWeek"), js.indexOf("function daysBetween"));
    expect(shiftWeek).toContain("delta * 7");
    expect(shiftWeek).toContain("next >= today ? null : next");
    const monthShift = js.slice(js.indexOf("function canShiftMonth"), js.indexOf("function weekStart"));
    expect(monthShift).toContain("return true");
    expect(monthShift).not.toContain("previousLast");
    const dateShift = js.slice(js.indexOf("function canShiftDateMonth"), js.indexOf("function dateSheetHtml"));
    expect(dateShift).toContain("previousLast >= nyToday()");
    const monthCell = js.slice(js.indexOf("function monthCell"), js.indexOf("function mealsOn"));
    expect(monthCell).toContain('action === "select-day"');
    expect(monthCell).toContain("canOpenPast || !past");
    const mealMenu = js.slice(js.indexOf("function removeMealButton"), js.indexOf("function mealRow"));
    expect(mealMenu).toContain("entry.date < nyToday()");
    expect(mealMenu).toContain('aria-label="Remove"');
    expect(mealMenu).toContain('data-action="remove-meal"');
    expect(mealMenu).toContain("minus()");
    expect(mealMenu).toContain('class="remove-badge"');
    expect(mealMenu).toContain('class="remove-dot"');
    expect(mealMenu).not.toContain("add-plus");
    const addDinner = js.slice(js.indexOf("function addDinnerButton"), js.indexOf("function removeMealButton"));
    expect(addDinner).toContain('class="add-badge"');
    expect(addDinner).toContain('class="add-dot"');
    expect(addDinner).toContain("plus()");
    expect(addDinner).not.toContain("add-plus");
    expect(js).not.toContain('class="m-swipe');
    expect(js).not.toContain('class="m-delete"');
    expect(js).not.toContain('kind: "meal"');
    expect(js).not.toContain("mealSwipeId");
    expect(js).toContain('class="month-period"');
    expect(js).toContain('class="week-period"');
    expect(js).toContain("shiftCalendar(delta)");
    expect(js).toContain("shiftWeek(delta)");
    expect(shiftWeek).toContain("start >= today");
    expect(js).not.toContain('kind: "cal"');
    expect(js).not.toContain("paintPeriod");
    expect(css).toContain(".remove-dot {");
    expect(css).toContain(".add-dot {");
    expect(css).toContain("background: var(--green);");
    expect(css).not.toContain(".m-swipe");
    expect(css).not.toContain("scroll-snap-type");
    expect(js).not.toContain("function pinPeriodPanes");
    expect(css).not.toContain(".period-pane");
    expect(css).toContain(".hero-logo {");
    expect(css).not.toContain(".week-period { touch-action: pan-y; }");
    expect(css).not.toContain("touch-action: none");
    expect(css).toContain("html.sheet-open");
    expect(css).toContain("html.sheet-open body");
    expect(css).toContain("overscroll-behavior: none");
    expect(css).toContain("html.sheet-open .screen");
    expect(css).toContain("touch-action: pan-y");
    expect(css).toContain("touch-action: pan-x");
    expect(css).toContain(".sheet-backdrop");
    expect(css).not.toContain("html.is-sheet-pulling");
    expect(js).toContain("function keepOneAddField");
    expect(js).toContain('querySelectorAll("input, textarea, select")');
    expect(css).toContain(".hero-out {");
    expect(css).toContain(".about-version {");
    expect(css).toContain(".month-screen .month-period {");
    expect(css).toContain(".toast.is-fading");
    expect(css).toContain("opacity 400ms linear");
    expect(js).toContain('getElementById("splash")');
    expect(js).not.toContain("Loading…");
    const html = await (await exports.default.fetch("https://grocery.test/")).text();
    expect(html).toContain("apple-touch-startup-image");
    expect(html).toContain("/splash/apple-splash-1170-2532.png");
    const startup = await exports.default.fetch("https://grocery.test/splash/apple-splash-1170-2532.png");
    expect(startup.status).toBe(200);
    expect(startup.headers.get("Content-Type") ?? "").toContain("image/png");
    const startupBytes = new Uint8Array(await startup.arrayBuffer());
    expect(startupBytes[0]).toBe(0x89);
    const startupWidth = (startupBytes[16] << 24) | (startupBytes[17] << 16) | (startupBytes[18] << 8) | startupBytes[19];
    const startupHeight = (startupBytes[20] << 24) | (startupBytes[21] << 16) | (startupBytes[22] << 8) | startupBytes[23];
    expect(startupWidth).toBe(1170);
    expect(startupHeight).toBe(2532);
    const corner = await pngPixel(startupBytes, 8, 8);
    expect(Math.abs(corner[0] - 247)).toBeLessThan(20);
    expect(Math.abs(corner[1] - 247)).toBeLessThan(20);
    expect(Math.abs(corner[2] - 245)).toBeLessThan(20);
    const plate = await pngPixel(startupBytes, 397, 1152);
    expect(plate).toEqual([93, 187, 36]);
    expect(js).not.toContain("meal-letter");
    expect(js).not.toContain("style=");
    expect(js).not.toContain("Open source");
    expect(js).not.toContain("Nothing else");
    const icons: Array<[string, number]> = [
      ["/icons/apple-touch-icon.png", 180],
      ["/icons/icon-192.png", 192],
      ["/icons/icon-512.png", 512],
      ["/icons/icon-maskable.png", 512],
      ["/icons/favicon-32.png", 32],
    ];
    for (const [path, size] of icons) {
      const icon = await exports.default.fetch(`https://grocery.test${path}`);
      expect(icon.status).toBe(200);
      expect(icon.headers.get("Content-Type") ?? "").toContain("image/png");
      const bytes = new Uint8Array(await icon.arrayBuffer());
      expect(bytes[0]).toBe(0x89);
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      expect(width).toBe(size);
      expect(height).toBe(size);
      if (path.endsWith("apple-touch-icon.png")) expect(bytes[25]).toBe(2);
    }
  });
});
