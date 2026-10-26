import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
test(
  "grocery entry, saving, undo, focus and offline startup",
  { timeout: 60000 },
  async () => {
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const writes = [];
      let fail = false;
      let loseNextAddResponse = false;
      const savedRequests = new Map();
      let items = [
        {
          id: "milk",
          name: "Milk",
          quantityNote: "1 gallon",
          store: "local",
          storeTag: "local",
          section: "dairy",
          category: "refrigerated",
          checked: false,
          updatedAt: "2026-10-26",
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
          updatedAt: "2026-10-25",
        },
      ];
      await page.route("**/*", async (route) => {
        const req = route.request(),
          u = new URL(req.url());
        if (u.pathname.startsWith("/api/")) {
          if (fail) return route.abort("internetdisconnected");
          if (req.method() !== "GET") {
            const body = req.postDataJSON();
            writes.push({ path: u.pathname, body, headers: req.headers() });
            await new Promise((r) => setTimeout(r, 160));
            if (req.method() === "POST" && u.pathname === "/api/items") {
              const key = req.headers()["idempotency-key"];
              if (savedRequests.has(key)) {
                return route.fulfill({
                  json: { item: savedRequests.get(key) },
                });
              }
              const item = {
                id: body.name.toLowerCase(),
                ...body,
                storeTag: body.store,
                checked: false,
                updatedAt: new Date().toISOString(),
              };
              items.push(item);
              savedRequests.set(key, item);
              if (loseNextAddResponse) {
                loseNextAddResponse = false;
                return route.abort("connectionreset");
              }
              return route.fulfill({ json: { item } });
            }
            const id = u.pathname.split("/").pop();
            const old = items.find((x) => x.id === id);
            Object.assign(old, body);
            return route.fulfill({ json: { item: old } });
          }
          let data =
            u.pathname === "/api/items"
              ? { items: items.filter((x) => !x.deleted) }
              : u.pathname === "/api/items/history"
                ? { items, staples: [] }
                : u.pathname === "/api/stores"
                  ? {
                      stores: [
                        { id: "local", name: "Market" },
                        { id: "amazon", name: "Amazon" },
                      ],
                    }
                  : {};
          return route.fulfill({ json: data });
        }
        const path =
          root + "public" + (u.pathname === "/" ? "/index.html" : u.pathname);
        if (!fs.existsSync(path))
          return route.fulfill({ status: 404, body: "" });
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
      await page.goto("http://localhost/");
      await page.waitForTimeout(1700);
      await page.locator('[data-action="tab"][data-tab="groceries"]').click();
      await page.locator('[data-action="add-item"]').click();
      assert.equal(await page.locator("#add-more-details").isVisible(), false);
      assert.match(
        await page.locator("#suggest-list").innerText(),
        /Buy again/,
      );
      // Explicit store/section choices win over remembered suggestion values.
      await page
        .locator('[data-action="pick-store"][data-store="amazon"]')
        .click();
      await page.locator('[data-action="toggle-add-details"]').click();
      await page
        .locator('[data-action="pick-section"][data-section="pantry"]')
        .click();
      await page
        .locator('[data-action="use-suggest"][data-name="Eggs"]')
        .click();
      assert.equal(
        await page
          .locator('[data-action="pick-store"][data-store="amazon"]')
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await page
          .locator('[data-action="pick-section"][data-section="pantry"]')
          .getAttribute("aria-pressed"),
        "true",
      );
      await page.locator("#add-search").press("Escape");
      await page.locator('[data-action="add-item"]').click();
      await page.locator("#add-search").fill("Milk");
      assert.match(await page.locator("#add-fields").innerText(), /1 gallon/);
      assert.equal(
        await page.locator('[data-action="submit-add"]').isDisabled(),
        true,
      );
      await page.locator('[data-action="edit-listed-item"]').click();
      await page
        .locator('.edit-item-sheet [name="quantityNote"]')
        .fill("3 gallons");
      await page.locator('.edit-item-sheet [type="submit"]').click();
      await page.waitForTimeout(400);
      assert.equal(items[0].quantityNote, "3 gallons");
      console.log("PASS existing item edit");
      await page.locator('[data-action="add-item"]').click();
      await page.locator("#add-search").fill("Eggs");
      assert.equal(
        await page.locator('[name="quantityNote"]').inputValue(),
        "2 dozen",
      );
      await page.locator('[data-action="toggle-add-details"]').click();
      assert.equal(
        await page
          .locator('[data-action="toggle-fresh"]')
          .getAttribute("aria-pressed"),
        "true",
      );
      await page.locator('[name="quantityNote"]').fill("");
      await page.locator('[name="quantityNote"]').press("Enter");
      await page.waitForTimeout(300);
      const save = writes.find((x) => x.path === "/api/items/eggs");
      assert.equal(save.body.quantityNote, null);
      assert.notEqual(save.body.buyDate, "2026-10-23");
      assert.equal(await page.locator("#add-form").count(), 1);
      assert.equal(await page.locator("#add-search").inputValue(), "");
      assert.equal(
        await page
          .locator("#add-search")
          .evaluate((x) => x === document.activeElement),
        true,
      );
      console.log(
        "PASS completed quantity, fresh date, consecutive entry and focus",
      );
      await page.locator('[data-action="undo-add"]').click();
      await page.waitForTimeout(250);
      assert.equal(items.find((x) => x.id === "eggs").checked, true);
      console.log("PASS undo revival");
      await page.locator("#add-search").fill("Bananas");
      await page.locator('[data-action="submit-add"]').click();
      await page.evaluate(() => submitAdd());
      await page.waitForTimeout(300);
      assert.equal(writes.filter((x) => x.path === "/api/items").length, 1);
      assert.ok(
        writes.find((x) => x.path === "/api/items").headers["idempotency-key"],
      );
      console.log("PASS saving lock and idempotency key");

      // The server may save an item even if its response never reaches the phone.
      loseNextAddResponse = true;
      await page.locator("#add-search").fill("Apples");
      await page.locator('[name="quantityNote"]').fill("4");
      await page.locator('[name="quantityNote"]').press("Enter");
      await page.waitForTimeout(300);
      assert.equal(await page.locator("#add-search").inputValue(), "Apples");
      assert.equal(
        await page.locator('[name="quantityNote"]').inputValue(),
        "4",
      );
      assert.equal(await page.locator("#add-error").isVisible(), true);
      await page.locator('[data-action="submit-add"]').click();
      await page.waitForTimeout(300);
      const appleRequests = writes.filter(
        (entry) => entry.body.name === "Apples",
      );
      assert.equal(appleRequests.length, 2);
      assert.equal(
        appleRequests[0].headers["idempotency-key"],
        appleRequests[1].headers["idempotency-key"],
      );
      assert.equal(items.filter((item) => item.name === "Apples").length, 1);
      console.log(
        "PASS lost-response retry preserves the draft without duplicating the item",
      );
      await page.locator("#add-search").fill("Peanut butter");
      assert.match(await page.locator(".add-summary").innerText(), /Pantry/);
      await page.setViewportSize({ width: 390, height: 470 });
      await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vvh")) <= 470);
      const dock = await page
        .locator('[data-action="submit-add"]')
        .boundingBox();
      assert.ok(dock.y >= 0 && dock.y + dock.height <= 470);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#add-search").press("Escape");
      assert.equal(await page.locator("#add-form").count(), 0);
      assert.equal(
        await page
          .locator('[data-action="add-item"]')
          .evaluate((x) => x === document.activeElement),
        true,
      );
      fail = true;
      await page.reload();
      await page.waitForTimeout(1900);
      assert.equal(await page.locator("#splash").count(), 0);
      assert.match(await page.locator("main").innerText(), /Offline/);
      assert.match(await page.locator("main").innerText(), /Milk/);
      console.log("PASS offline reload shows saved list");
      assert.deepEqual(errors, []);
      console.log("PASS no browser errors");
    } finally {
      await browser.close();
    }
  },
);
