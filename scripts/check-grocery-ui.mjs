import { chromium, webkit, devices } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const shots = "/opt/cursor/artifacts";

function seedItems() {
  const items = [
    {
      id: "milk",
      name: "Milk",
      quantityNote: "1 gallon",
      store: "local",
      storeTag: "local",
      section: "dairy",
      category: "refrigerated",
      checked: false,
      updatedAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: "eggs",
      name: "Eggs",
      quantityNote: "2 dozen",
      store: "local",
      storeTag: "local",
      section: "dairy",
      category: "refrigerated",
      checked: true,
      fresh: true,
      buyDate: "2026-10-23",
      dueDate: "2020-01-01",
      updatedAt: "2026-10-19T12:00:00.000Z",
    },
    {
      id: "basil",
      name: "Basil",
      quantityNote: "1 bunch",
      store: "local",
      storeTag: "local",
      section: "produce",
      category: "produce",
      checked: false,
      fresh: true,
      dueDate: "2020-01-01",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "coffee",
      name: "Coffee",
      quantityNote: "1 bag",
      store: "amazon",
      storeTag: "amazon",
      section: "beverages",
      category: "shelf",
      checked: false,
      updatedAt: "2026-10-18T12:00:00.000Z",
    },
    {
      id: "millet",
      name: "Millet",
      quantityNote: "1 bag",
      store: "local",
      storeTag: "local",
      section: "pantry",
      category: "shelf",
      checked: true,
      updatedAt: "2026-10-17T12:00:00.000Z",
    },
  ];
  for (let i = 1; i <= 24; i++) {
    const n = String(i).padStart(2, "0");
    items.push({
      id: `pack-${n}`,
      name: `Pack ${n}`,
      quantityNote: null,
      store: "local",
      storeTag: "local",
      section: "pantry",
      category: "shelf",
      checked: false,
      updatedAt: `2026-01-${n > "24" ? "01" : n}T00:00:00.000Z`,
    });
  }
  return items;
}

async function installApi(page, bag) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname.startsWith("/api/")) {
      if (bag.fail) return route.abort("internetdisconnected");
      if (req.method() !== "GET") {
        const raw = req.postData();
        const body = raw ? req.postDataJSON() : null;
        bag.writes.push({ path: u.pathname, method: req.method(), body, headers: req.headers() });
        if (req.method() === "POST" && u.pathname === "/api/items") {
          await new Promise((r) => setTimeout(r, 160));
          const key = req.headers()["idempotency-key"];
          if (bag.saved.has(key)) return route.fulfill({ json: { item: bag.saved.get(key) } });
          const item = {
            id: String(body.name).toLowerCase(),
            ...body,
            storeTag: body.store,
            checked: false,
            updatedAt: new Date().toISOString(),
          };
          bag.items.push(item);
          bag.saved.set(key, item);
          if (bag.loseNextAdd) {
            bag.loseNextAdd = false;
            return route.abort("connectionreset");
          }
          return route.fulfill({ json: { item } });
        }
        if (u.pathname.startsWith("/api/stores")) {
          if (req.method() === "POST") {
            const store = { id: String(body.name).toLowerCase().replace(/\s+/g, "-"), name: body.name };
            bag.stores.push(store);
            return route.fulfill({ json: { store }, status: 201 });
          }
          if (req.method() === "DELETE") {
            const id = decodeURIComponent(u.pathname.split("/").pop());
            bag.stores = bag.stores.filter((store) => store.id !== id);
            return route.fulfill({ json: {} });
          }
        }
        const id = decodeURIComponent(u.pathname.split("/").pop());
        const old = bag.items.find((entry) => entry.id === id);
        if (old && body) Object.assign(old, body, { updatedAt: new Date().toISOString() });
        return route.fulfill({ json: { item: old } });
      }
      const data =
        u.pathname === "/api/items"
          ? { items: bag.items.filter((entry) => !entry.deleted) }
          : u.pathname === "/api/items/history"
            ? { items: bag.items, staples: [] }
            : u.pathname === "/api/stores"
              ? { stores: bag.stores }
              : {};
      return route.fulfill({ json: data });
    }
    const path = root + "public" + (u.pathname === "/" ? "/index.html" : u.pathname);
    if (!fs.existsSync(path)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      body: fs.readFileSync(path),
      contentType: path.endsWith(".js")
        ? "application/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".html")
            ? "text/html"
            : "image/svg+xml",
    });
  });
}

async function openGroceries(page) {
  await page.goto("http://localhost/");
  await page.waitForTimeout(1700);
  await page.locator('[data-action="tab"][data-tab="groceries"]').click();
  await page.locator("#add-item").waitFor();
}

async function addByEnter(page, text) {
  const input = page.locator("#add-item");
  await input.fill(text);
  await input.press("Enter");
  await page.waitForTimeout(280);
}

async function firstName(page) {
  return (await page.locator("#grocery-list .g-name").first().innerText()).split("\n")[0].trim();
}

async function idleBar(page) {
  return page.evaluate(() => {
    const h1 = document.querySelector(".title-row h1").getBoundingClientRect();
    const bar = document.querySelector(".add-bar").getBoundingClientRect();
    const input = document.querySelector("#add-item").getBoundingClientRect();
    const list = document.querySelector("#grocery-list").getBoundingClientRect();
    return {
      gap: Math.round(bar.top - h1.bottom),
      barHeight: Math.round(bar.height),
      inputHeight: Math.round(input.height),
      listGap: Math.round(list.top - bar.bottom),
      detailsHidden: document.querySelector("#add-details").hidden,
      chips: document.querySelectorAll("#suggest-row .chip").length,
      pills: document.querySelectorAll("#store-picks .pill").length,
    };
  });
}

test("grocery add bar, edit page, undo, store filter and long list", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const bag = {
      items: seedItems(),
      stores: [{ id: "amazon", name: "Amazon" }, { id: "local", name: "Market" }],
      writes: [],
      saved: new Map(),
      fail: false,
      loseNextAdd: false,
    };
    await installApi(page, bag);
    await openGroceries(page);

    assert.match(await page.locator("#grocery-list").innerText(), /Buy today/);
    assert.equal(await page.locator(".fab, .add-sheet, #add-form, #add-search").count(), 0);
    assert.equal(await page.locator("#add-item").getAttribute("placeholder"), "Add an item");
    assert.equal(await page.locator("#add-item").getAttribute("autocomplete"), "off");
    assert.equal(await page.locator("#add-item").getAttribute("autocorrect"), "on");
    assert.equal(await page.locator("#add-item").getAttribute("enterkeyhint"), "done");
    assert.equal(await page.locator("#add-item").getAttribute("aria-label"), "Add grocery item");
    assert.equal(await page.locator("#add-item").getAttribute("name"), "item");
    assert.equal(await page.locator("#add-qty").getAttribute("autocomplete"), "off");
    assert.equal(await page.locator(".section-pills .pill").count(), 0);
    const idle = await idleBar(page);
    assert.ok(idle.gap >= 12 && idle.gap <= 16, JSON.stringify(idle));
    assert.ok(idle.inputHeight >= 32 && idle.inputHeight <= 40, JSON.stringify(idle));
    assert.ok(idle.barHeight <= 44, JSON.stringify(idle));
    assert.ok(idle.listGap > 0 && idle.listGap <= 16, JSON.stringify(idle));
    assert.equal(idle.detailsHidden, true);
    assert.equal(idle.chips, 0);
    assert.equal(idle.pills, 0);

    const writesBeforeChip = bag.writes.length;
    await page.locator("#add-item").fill("egg");
    await page.locator('[data-action="use-suggest"][data-name="Eggs"]').click();
    assert.equal(await page.locator("#add-item").inputValue(), "Eggs");
    assert.equal(bag.writes.length, writesBeforeChip);
    assert.equal(await page.locator("#suggest-row .chip").count(), 0);
    await page.locator("#add-item").fill("");
    assert.equal(await page.locator("#suggest-row .chip").count(), 0);
    await page.locator("#add-item").fill("mil");
    assert.equal(await page.locator("#suggest-row .chip").innerText(), "Millet");
    assert.equal(await page.locator("#store-picks .pill").count(), 0);
    await page.locator('[data-action="toggle-add-details"]').click();
    assert.equal(await page.locator("#add-details").isVisible(), true);
    await page.locator("h1").first().click();
    await page.waitForFunction(() => document.querySelectorAll("#suggest-row .chip").length === 0 && document.querySelector("#add-details").hidden);

    await addByEnter(page, "Milk");
    assert.equal(await page.locator("#add-error").innerText(), "Already on your list");
    assert.equal(await page.locator("#add-item").inputValue(), "Milk");
    assert.equal(bag.writes.filter((entry) => entry.path === "/api/items").length, 0);

    await addByEnter(page, "oats 2");
    assert.equal(await page.locator("#add-item").inputValue(), "");
    assert.equal(await page.locator("#add-item").evaluate((node) => node === document.activeElement), true);
    assert.equal(await firstName(page), "oats");
    assert.equal(bag.items.find((entry) => entry.id === "oats").quantityNote, "2");
    assert.match(await page.locator("#add-toast").innerText(), /Added oats\s+·\s+Undo/);
    const placed = await page.locator('#grocery-list .g-swipe[data-id="oats"]').evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: window.innerHeight, scroll: window.scrollY };
    });
    assert.ok(placed.top >= 0 && placed.bottom <= placed.height, JSON.stringify(placed));
    assert.ok(placed.scroll < 5);

    for (const name of ["Bread", "Butter", "Jam"]) await addByEnter(page, name);
    assert.equal(await page.locator("#add-item").inputValue(), "");
    assert.equal(await page.locator("#add-item").evaluate((node) => node === document.activeElement), true);
    assert.equal(await firstName(page), "Jam");
    assert.match(await page.locator("#add-toast").innerText(), /Added Jam\s+·\s+Undo/);
    assert.equal(await page.locator("h1").first().innerText(), "Groceries");

    await page.locator("#add-item").press("Escape");
    assert.equal(await page.locator("#quick-add").count(), 1);
    assert.equal(await page.locator("h1").first().innerText(), "Groceries");

    const postsBefore = bag.writes.filter((entry) => entry.path === "/api/items").length;
    await page.locator("#add-item").fill("Bananas");
    await page.locator('[data-action="submit-add"]').click();
    await page.evaluate(() => submitAdd());
    await page.waitForTimeout(400);
    const bananaPosts = bag.writes.filter((entry) => entry.path === "/api/items" && entry.body.name === "Bananas");
    assert.equal(bananaPosts.length, 1);
    assert.equal(bag.writes.filter((entry) => entry.path === "/api/items").length, postsBefore + 1);
    assert.ok(bananaPosts[0].headers["idempotency-key"]);

    bag.loseNextAdd = true;
    await page.locator("#add-item").fill("Apples 4");
    await page.locator("#add-item").press("Enter");
    await page.waitForTimeout(400);
    assert.equal(await page.locator("#add-item").inputValue(), "Apples 4");
    assert.equal(await page.locator("#add-error").isVisible(), true);
    await page.locator('[data-action="submit-add"]').click();
    await page.waitForTimeout(400);
    const applePosts = bag.writes.filter((entry) => entry.body?.name === "Apples");
    assert.equal(applePosts.length, 2);
    assert.equal(applePosts[0].headers["idempotency-key"], applePosts[1].headers["idempotency-key"]);
    assert.equal(applePosts[0].body.quantityNote, "4");
    assert.equal(bag.items.filter((entry) => entry.name === "Apples").length, 1);
    assert.equal(await page.locator("#add-item").inputValue(), "");

    await addByEnter(page, "Eggs");
    const eggSave = bag.writes.find((entry) => entry.path === "/api/items/eggs" && entry.body.checked === false);
    assert.ok(eggSave);
    assert.equal(eggSave.body.quantityNote, "2 dozen");
    assert.notEqual(eggSave.body.buyDate, "2026-10-23");
    assert.equal(await page.locator("#add-item").evaluate((node) => node === document.activeElement), true);
    assert.match(await page.locator("#add-toast").innerText(), /Added Eggs\s+·\s+Undo/);
    await page.locator("#add-toast button").click();
    await page.waitForTimeout(300);
    assert.equal(bag.items.find((entry) => entry.id === "eggs").checked, true);

    await page.locator("#add-item").fill("Zucchini");
    await page.locator('[data-action="toggle-add-details"]').click();
    assert.equal(await page.locator("#add-details").isVisible(), true);
    assert.equal(await page.locator("#add-item").evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.locator("#add-section option").count(), 13);
    await page.locator("#add-qty").fill("3");
    await page.locator("#add-section").selectOption("produce");
    const pillBox = await page.locator("#detail-stores .pill").first().boundingBox();
    assert.ok(pillBox.height >= 28 && pillBox.height <= 32, JSON.stringify(pillBox));
    await page.locator('#detail-stores [data-action="pick-add-store"][data-store="local"]').click();
    assert.equal(await page.locator('#detail-stores [data-store="local"]').getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#add-item").evaluate((node) => node === document.activeElement), true);
    await page.locator("#add-item").press("Enter");
    await page.waitForTimeout(280);
    assert.equal(await firstName(page), "Zucchini");
    const zucchini = bag.writes.find((entry) => entry.body?.name === "Zucchini");
    assert.equal(zucchini.body.quantityNote, "3");
    assert.equal(zucchini.body.section, "produce");
    assert.equal(zucchini.body.store, "local");
    assert.equal(await page.locator("#add-details").isHidden(), true);
    assert.equal(await page.locator("#suggest-row .chip").count(), 0);
    assert.equal(await page.locator("#store-picks .pill").count(), 0);
    const visible = await page.locator('#grocery-list .g-swipe[data-id="zucchini"]').evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: window.innerHeight };
    });
    assert.ok(visible.top >= 0 && visible.bottom <= visible.height, JSON.stringify(visible));
    assert.ok((await page.locator("#grocery-list").innerText()).includes("Coffee"));

    await page.setViewportSize({ width: 390, height: 500 });
    await addByEnter(page, "Yogurt");
    const keyboard = await page.evaluate(() => {
      const bar = document.querySelector(".add-bar").getBoundingClientRect();
      const row = document.querySelector('#grocery-list .g-swipe[data-id="yogurt"]').getBoundingClientRect();
      return { barTop: bar.top, barBottom: bar.bottom, rowTop: row.top, rowBottom: row.bottom, height: window.innerHeight, focused: document.activeElement?.id };
    });
    assert.equal(keyboard.focused, "add-item");
    assert.ok(keyboard.barTop >= 0 && keyboard.barBottom <= keyboard.height, JSON.stringify(keyboard));
    assert.ok(keyboard.rowTop >= 0 && keyboard.rowBottom <= keyboard.height, JSON.stringify(keyboard));
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator('.g-row[data-id="milk"] .g-name').click();
    await page.locator("#item-edit").waitFor();
    assert.equal(await page.locator(".edit-screen").count(), 1);
    assert.equal(await page.locator(".sheet").count(), 0);
    assert.equal(await page.locator(".section-pills .pill").count(), 12);
    assert.equal(await page.locator('[data-action="toggle-fresh"]').count(), 1);
    assert.equal(await page.locator('[data-action="edit-stores"]').count(), 1);
    await page.locator('[name="quantityNote"]').fill("3 gallons");
    await page.locator('[form="item-edit"]').click();
    await page.locator("#add-item").waitFor();
    assert.equal(bag.items.find((entry) => entry.id === "milk").quantityNote, "3 gallons");

    await page.locator('.g-row[data-id="jam"]').scrollIntoViewIfNeeded();
    const jam = await page.locator('.g-row[data-id="jam"]').boundingBox();
    await page.mouse.move(jam.x + jam.width - 24, jam.y + jam.height / 2);
    await page.mouse.down();
    await page.mouse.move(jam.x + 8, jam.y + jam.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    assert.match(await page.locator(".toast").innerText(), /Jam deleted/);
    await page.locator('.toast button[data-action="undo-check"]').click();
    await page.waitForTimeout(300);
    assert.equal(bag.items.find((entry) => entry.id === "jam").deleted, false);
    assert.ok((await page.locator("#grocery-list").innerText()).includes("Jam"));

    await page.locator('.g-check[data-id="milk"]').click();
    await page.waitForTimeout(200);
    assert.equal(bag.items.find((entry) => entry.id === "milk").checked, true);
    await page.locator('.toast button[data-action="undo-check"]').click();
    await page.waitForTimeout(250);
    assert.equal(bag.items.find((entry) => entry.id === "milk").checked, false);
    await page.locator('[data-action="grocery-menu"]').click();
    await page.locator('[data-action="toggle-done"]').click();
    assert.match(await page.locator("#grocery-list").innerText(), /Eggs/);
    await page.locator('[data-action="grocery-menu"]').click();
    await page.locator('[data-action="toggle-done"]').click();
    await page.locator('[data-action="grocery-menu"]').click();
    await page.locator('[data-action="manage-stores"]').click();
    await page.locator('[data-action="edit-store"][data-id="amazon"]').click();
    await page.locator('[data-action="ask-remove-store"][data-id="amazon"]').click();
    assert.match(await page.locator(".store-confirm").innerText(), /will have no store/);
    await page.locator('[data-action="cancel-remove-store"]').click();
    await page.locator('[data-action="add-store-row"]').click();
    await page.locator('[name="newStore"]').fill("Corner");
    await page.locator('[data-action="save-store"]').click();
    await page.waitForTimeout(200);
    assert.ok(bag.stores.some((store) => store.name === "Corner"));
    await page.locator('[data-action="edit-store"][data-id="amazon"]').click();
    await page.locator('[data-action="ask-remove-store"][data-id="amazon"]').click();
    await page.locator('[data-action="confirm-remove-store"][data-id="amazon"]').click();
    await page.waitForTimeout(200);
    assert.equal(bag.stores.some((store) => store.id === "amazon"), false);
    assert.equal(bag.items.find((entry) => entry.id === "coffee").deleted, undefined);
    await page.locator('[data-action="close-sheet"]').click();
    await page.locator('[data-action="grocery-menu"]').click();
    await page.locator('[data-action="mark-all"]').click();
    await page.waitForFunction(() => !document.querySelector("#grocery-list .g-row:not(.is-done)"));
    assert.match(await page.locator("#grocery-list").innerText(), /The list is clear/);
    await page.locator('[data-action="grocery-menu"]').click();
    await page.locator('[data-action="toggle-done"]').click();
    await page.locator('.g-check[data-id="milk"]').click();
    await page.waitForTimeout(200);
    assert.equal(bag.items.find((entry) => entry.id === "milk").checked, false);
    await page.locator('[data-action="tab"][data-tab="today"]').click();
    assert.match(await page.locator("main").innerText(), /Today/);
    await page.locator('[data-action="tab"][data-tab="groceries"]').click();
    await page.locator("#add-item").waitFor();

    bag.fail = true;
    await page.reload();
    await page.waitForTimeout(1900);
    assert.equal(await page.locator("#splash").count(), 0);
    assert.match(await page.locator("main").innerText(), /Offline/);
    assert.match(await page.locator("main").innerText(), /Milk/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("iPhone 13 WebKit screenshots of the slim add bar", { timeout: 90000 }, async () => {
  fs.mkdirSync(shots, { recursive: true });
  const browser = await webkit.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const bag = {
      items: seedItems(),
      stores: [{ id: "amazon", name: "Amazon" }, { id: "local", name: "Market" }],
      writes: [],
      saved: new Map(),
      fail: false,
      loseNextAdd: false,
    };
    await installApi(page, bag);
    await openGroceries(page);
    const idle = await idleBar(page);
    assert.ok(idle.gap >= 12 && idle.gap <= 16, JSON.stringify(idle));
    assert.ok(idle.inputHeight >= 32 && idle.inputHeight <= 40, JSON.stringify(idle));
    assert.ok(idle.barHeight <= 44, JSON.stringify(idle));
    assert.ok(idle.listGap > 0 && idle.listGap <= 16, JSON.stringify(idle));
    assert.equal(idle.detailsHidden, true);
    assert.equal(idle.chips, 0);
    assert.equal(idle.pills, 0);
    await page.screenshot({ path: `${shots}/idle-list.png` });

    await page.locator("#add-item").fill("mil");
    await page.locator("#suggest-row .chip").waitFor();
    assert.equal(await page.locator("#suggest-row .chip").innerText(), "Millet");
    assert.equal(await page.locator("#store-picks .pill").count(), 0);
    assert.equal(await page.locator("#add-details").isHidden(), true);
    await page.screenshot({ path: `${shots}/typing-mil.png` });

    await page.locator('[data-action="toggle-add-details"]').click();
    assert.equal(await page.locator("#add-details").isVisible(), true);
    assert.equal(await page.locator("#add-item").evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.locator("#add-qty").isVisible(), true);
    assert.equal(await page.locator("#add-section option").count(), 13);
    assert.ok(await page.locator("#detail-stores .pill").count() >= 2);
    const pillBox = await page.locator("#detail-stores .pill").first().boundingBox();
    assert.ok(pillBox.height >= 28 && pillBox.height <= 32, JSON.stringify(pillBox));
    await page.screenshot({ path: `${shots}/details-expanded.png` });

    await page.locator("#add-item").fill("");
    await page.locator("h1").first().click();
    await page.waitForFunction(() => document.querySelector("#add-details").hidden && document.querySelectorAll("#suggest-row .chip").length === 0);
    for (const name of ["Bread", "Butter", "Jam"]) await addByEnter(page, name);
    assert.equal(await page.locator("#add-item").evaluate((node) => node === document.activeElement), true);
    assert.equal(await firstName(page), "Jam");
    assert.match(await page.locator("#add-toast").innerText(), /Added Jam\s+·\s+Undo/);
    assert.equal(await page.locator("#add-details").isHidden(), true);
    assert.equal(await page.locator("#suggest-row .chip").count(), 0);
    const seen = await page.locator('#grocery-list .g-swipe[data-id="jam"]').evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight;
    });
    assert.equal(seen, true);
    await page.locator("h1").first().click();
    await page.screenshot({ path: `${shots}/list-after-adding.png` });

    await page.locator('.g-row[data-id="milk"] .g-name').click();
    await page.locator("#item-edit").waitFor();
    assert.equal(await page.locator(".section-pills .pill").count(), 12);
    await page.locator('[data-action="back"]').click();
    await page.locator("#add-item").waitFor();
    await page.waitForTimeout(2300);
    await page.locator('.g-row[data-id="jam"]').waitFor();
    await page.locator('.g-row[data-id="jam"]').scrollIntoViewIfNeeded();
    const jam = await page.locator('.g-row[data-id="jam"]').boundingBox();
    await page.mouse.move(jam.x + jam.width - 20, jam.y + jam.height / 2);
    await page.mouse.down();
    await page.mouse.move(jam.x + 6, jam.y + jam.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    assert.match(await page.locator(".toast").innerText(), /Jam deleted/);
    await page.locator('.toast button[data-action="undo-check"]').click();
    await page.waitForTimeout(300);
    assert.equal(bag.items.find((entry) => entry.id === "jam").deleted, false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
