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
    await env.DB.prepare("DELETE FROM recipe_feedback").run();
    await env.DB.prepare("DELETE FROM recipe_made").run();
    await env.DB.prepare("DELETE FROM grocery_sources").run();
    await env.DB.prepare("DELETE FROM plan_entries").run();
    await env.DB.prepare("DELETE FROM family_events").run();
    await env.DB.prepare("DELETE FROM recipes").run();
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
    await call("/api/plan", { method: "POST", token, body: { date: "2026-10-12", meal: "dinner", type: "recipe", recipeId: id } });
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(items.some((item) => item.name === "Water")).toBe(false);
    expect(items.some((item) => item.name === "Black pepper")).toBe(false);
    expect(items.some((item) => item.name === "Avocado")).toBe(false);
    expect(items.find((item) => item.name === "Lettuce")?.section).toBe("produce");
    expect(items.find((item) => item.name === "Chicken thighs")).toMatchObject({ quantityNote: "1 lb", section: "meat" });
    expect((items.find((item) => item.name === "Chicken thighs")?.recipes as Json[])[0].name).toBe("Salsa chicken");

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
    await call("/api/plan", { method: "POST", token, body: { date: "2026-11-02", meal: "dinner", type: "recipe", recipeId: id } });
    const items = ((await call("/api/items", { token })).json?.items ?? []) as Json[];
    expect(items.find((item) => item.name === "Rice")?.quantityNote).toBe("½ cup");
    expect(items.some((item) => item.name === "Shrimp")).toBe(true);
    expect(items.some((item) => item.name === "Avocado")).toBe(false);
    const leftover = await call("/api/plan", {
      method: "POST",
      token,
      body: { date: "2026-11-03", meal: "dinner", type: "leftovers", recipeId: id },
    });
    expect(leftover.status).toBe(200);
    expect((leftover.json?.entry as Json).recipeId).toBe(id);
    const linked = ((await call("/api/plan?from=2026-11-03&to=2026-11-03", { token })).json?.plan ?? []) as Json[];
    expect(linked[0]).toMatchObject({ type: "leftovers", recipeId: id, recipeName: "Shrimp tacos" });
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
    expect(js).toContain("Swap meal");
    expect(js).not.toContain("Change meal");
    expect(js).toContain("Edit recipe");
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
