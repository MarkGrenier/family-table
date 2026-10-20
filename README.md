# Family food

Dinners, recipes, and one grocery list for Mark and Emma.

The home screen is tonight. The week shows what is planned. Recipes can come from a link or be typed in. Groceries is one plain checklist. When one phone changes something, the other phone catches up in a few seconds.

You can try the whole list on this computer before you put it on the internet. A Cloudflare account is only needed for the internet part.

## Try it on this computer

You do not need a Cloudflare account for this.

1. Install Node.js if it is not already installed. Go to [https://nodejs.org](https://nodejs.org) and install the version marked **LTS** (20 or newer).
2. Open the Terminal app.
3. Go into this project folder. For example:

   ```bash
   cd ~/family-grocery
   ```

4. Install the pieces the list needs:

   ```bash
   npm install
   ```

5. Create the practice list (a few example recipes and groceries, only on this computer):

   ```bash
   npm run setup
   ```

6. Start the list:

   ```bash
   npm start
   ```

7. Open [http://127.0.0.1:47219](http://127.0.0.1:47219) in the browser on that same computer.

   The practice passcode is in .dev.vars on your computer.

8. To stop the list, click the terminal window and press Control+C.

`127.0.0.1` means "this computer." A phone cannot open that address. Use the computer for this practice round. The iPhone steps are below, after the list is on the internet.

The practice passcode is only for this computer. Do not use it once the list is published. Anyone who can read this page would know it.

The example milk, bananas, and the rest live in `seed.sql`. They are not copied to the live list.

To change the practice passcode, open the file `.dev.vars`, change the `PASSCODE=` line, save, and start the list again.

## Put it on the internet

Do this once, after you have a free Cloudflare account. Sign up at [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).

Stay in the project folder in Terminal. `npm install` from the section above needs to have been run already.

### 1. Sign in

```bash
npx wrangler login
```

A browser window opens. Sign in to Cloudflare and approve the question it asks. Come back to Terminal when it says you are logged in.

### 2. The database

`wrangler.toml` already has the live database id. Leave that line as it is.

### 3. Add the new tables on the live list

The phones already have the grocery list. This step adds recipes, the week plan, and family events. It does not erase anything already on the list.

New files are `migrations/0003_food.sql`, `migrations/0004_recipe_sections.sql`, and `migrations/0005_mealime.sql`. Older migration files stay as they are. The command below applies every one that is not on the live list yet. `0005_mealime.sql` adds grocery sections, cookware, cooked days, and feedback. It does not change rows that are already there.

```bash
npx wrangler d1 migrations apply grocery --remote
```

If it asks you to continue, type `y` and press Enter.

Then publish the new pages:

```bash
npx wrangler deploy
```

The practice milk and bananas stay on your computer. They are not copied to the live list.

### 4. Choose the passcode

```bash
npx wrangler secret put PASSCODE
```

Type the passcode you and Emma will share, then press Enter. The letters will not show as you type. That is normal.

Pick something you can both remember. Do not reuse the practice passcode unless you are happy for it to be written in this file.

### 5. Choose a password for a helper program

Phones do not use this. You only need it if a computer helper will change the list for you. You can skip this step.

```bash
npx wrangler secret put API_TOKEN
```

Type a long made-up password and press Enter. Write it down somewhere private. It will not be shown again.

### 6. Publish the site

```bash
npx wrangler deploy
```

Terminal prints a web address ending in `workers.dev`. That is your list. Leave that address somewhere you can find it.

### 7. Put it on an iPhone

Do this in Safari. The Chrome app on an iPhone will not add it to the home screen the same way.

1. Open Safari.
2. Go to the `workers.dev` address from the last step.
3. Type the passcode from step 4 and tap **Open**. The phone remembers it.
4. Tap the Share button (the square with an arrow pointing up).
5. Tap **Add to Home Screen**.
6. Tap **Add**.

The icon is still the little cart. A newly added icon is named Food. An icon you already added can keep its old name. Do the same on the other phone.

Open the app on both phones. When one of you changes dinner, a recipe, or the groceries, the other phone updates within a few seconds, as long as the app is open.

## Using the app

Four tabs sit at the bottom: Today, Week, Recipes, and Groceries. The Groceries tab shows how many things are still to buy.

- **Today** is tonight's recipe: the photo, the dish name, the time, the servings, and the Cookware, Ingredients, and Instructions tabs. The steps stay inside Instructions. **Mark cooked** and **Start cooking** sit at the bottom. **Start cooking** walks through today's prep and cook steps, then kids' plates and reheating when those notes exist. Night-before steps are not part of cooking. If tomorrow has night-before prep, one line says **Prep for tomorrow: 1 step**. Tap it for a short list with a checkbox on each step. That line is the usual placement. To compare the other three, add `?prepStyle=header`, `?prepStyle=photo`, or `?prepStyle=bottom` to the address. Header is a strip across the top, photo is a tag on the picture, and bottom sits in the bar with Start cooking. Leftovers open that recipe with a Leftovers label. Reheating stays in Instructions. Family events for today are listed under the recipe. If nothing is planned, you get a short note and a button to plan dinner.
- **Week** is the next seven days, with today at the top. Earlier days are not listed. Each day shows its meals (dinner, and breakfast or lunch when those are planned) and that day's family events. A leftover night links back to the recipe it came from. Tap a day to pick a recipe, leftovers, or a short note such as eating out. The calendar icon in the header opens a simple month view for jumping further ahead. Today starts selected, and that day's meals and events sit under the grid. Tap another day to switch. Edit opens the planner. Choosing a recipe puts the things you need to buy on the grocery list. Salt, pepper, oil, water, and spices stay off the list. An optional ingredient is skipped unless you set `buy` to true. Taking that recipe off the day takes those unchecked items back off. Leftovers and notes don't add anything. Checking an item off offers Undo for a few seconds. In Show completed items, tap the filled circle to put it back.
- **Recipes** is the cookbook. **Favorites**, **Recently made**, and **A-Z** sort the list. A recipe shows **Last made Oct 12** when it has been planned before. Open one for the photo, a heart, **Cookware**, **Ingredients**, and **Instructions**. Tap the servings to scale the amounts. **Cooked?** records that you made it. **Start cooking** walks through the steps. Sending a new week does not remove recipes.
- **Groceries** is grouped by food type, not by store. Tap the circle to mark something bought. Tap the row, or swipe it right, for details. Hold the row to edit the name, amount, and section. The green **+** adds something. The green dots share the list, show completed items, or mark them all complete.

## If something goes wrong

- "Wrong passcode" — on the live site, use the passcode from step 4, not the practice passcode from this computer.
- The page will not load on your phone at `127.0.0.1` — that address only works on the computer that is running `npm start`. Phones use the `workers.dev` address.
- You changed the passcode — each phone needs to open the app and sign in again.
- `npm start` says the port is already in use — the list is probably already running in another terminal window. Close that one, or just open [http://127.0.0.1:47219](http://127.0.0.1:47219).

## For a helper program

You can skip this section. It is for a computer helper, not for the phones.

The phone signs in with the passcode. A helper sends a different password, the API token from step 5, on every request:

```
Authorization: Bearer YOUR_TOKEN
```

Send and receive JSON. Addresses below are added to your site, for example `https://family-grocery.yourname.workers.dev/api/items`.

`store` is one of `costco`, `local`, `amazon`.

`category` depends on the store:

- Costco: `shelf`, `refrigerated`, `frozen`
- Local store: `produce`, `shelf`, `refrigerated`, `frozen`
- Amazon: `general` (or leave it out)

### Items

`GET /api/items`

Returns `{ "items": [ ... ] }`.

`POST /api/items`

```json
{
  "name": "Oat milk",
  "quantityNote": "2 cartons",
  "store": "costco",
  "category": "refrigerated",
  "brand": "Oatly",
  "asin": "",
  "barcode": "012345678905",
  "staple": true
}
```

`barcode` is optional. Leave it out, or send `""`, and the item is saved with `"barcode": null`. A new item that includes a barcode is also remembered as a staple, so the next scan can add it in one step. Old requests that never send `barcode` still work.

`PATCH /api/items/ID`

Send only what changed. Example: `{ "checked": true }`. Leaving `barcode` out keeps the one already saved. Sending a barcode here does not, by itself, turn the item into a staple.

`DELETE /api/items/ID`

`DELETE /api/items?source=recipe` removes every grocery line that was added from a recipe or a planned meal. Lines typed by hand stay. The reply is `{ "deleted": 12 }`.

Each item may also include `section` (`produce`, `meat`, `dairy`, `bakery`, `frozen`, `pantry`, `baking`, `oils`, `snacks`, `beverages`, `household`, or `other`), `imageUrl`, `substitute`, and `notes`. `GET /api/items` adds `recipes` on each line: `{ "id", "name", "imageUrl" }` for the recipes that need it. Older fields `store` and `category` stay.

`POST /api/items/clear-checked`

```json
{ "store": "costco" }
```

Removes bought items for that store only. Staples stay.

### Staples

`GET /api/staples`

`POST /api/staples`

```json
{
  "name": "Paper towels",
  "store": "costco",
  "category": "shelf",
  "brand": "Kirkland",
  "barcode": ""
}
```

`barcode` is optional here too. Omit it and the staple is saved with `"barcode": null`.

`POST /api/staples/ID/add`

Puts that staple on this week's list. If it is already there and not bought yet, it is not added twice. The reply includes `"alreadyOnList": true` or `false`.

`DELETE /api/staples/ID`

Removes the staple. Anything already on this week's list stays there.

### Barcodes

`GET /api/barcode/012345678905`

Needs the same sign-in as the rest of the list.

If that barcode was saved before, the reply looks like:

```json
{
  "barcode": "012345678905",
  "known": true,
  "name": "Oat milk",
  "store": "costco",
  "category": "refrigerated",
  "brand": "Oatly",
  "asin": null,
  "stapleId": "…",
  "alreadyOnList": true
}
```

`alreadyOnList` is true when an unchecked copy is already on the list. A 12-digit code and the same code with a leading 0 are treated as the same barcode.

If it is new, the reply is `{ "barcode", "known": false, "suggestion" }`. `suggestion` is `{ "name", "brand" }` when a free product lookup finds it, or `null` when it does not. No key is required for that lookup.

### Recipes

`GET /api/recipes`

`GET /api/recipes?q=chili` finds recipes by name.

`GET /api/recipes?favorite=true` returns only favorites. You can use both, as in `GET /api/recipes?q=chili&favorite=true`.

Each recipe includes `favorite`, `lastMade`, and `timesMade`. `lastMade` is the most recent date it was cooked or planned, up through today in Eastern time, or `null` if that has not happened. A date still in the future does not count. `timesMade` counts those planned meals, plus a day you marked it cooked when it was not already planned. Leftovers do not count, and cooking it on a day it was already planned does not count twice.

`POST /api/recipes`

A recipe's ingredients can be plain lines, or objects. Old lines still work. Water, salt, pepper, oil, and common spices are marked `buy: false` so planning the recipe does not put them on the grocery list. `optional` and `buy` are separate. An optional ingredient is left off the list unless you send `buy: true` for it, which is how a backup the kids will actually eat still gets bought. Amounts use fractions like ½ and ¼.

```json
{
  "name": "Cilantro-lime chicken",
  "servings": 2,
  "totalTime": "35 minutes",
  "cookware": ["chef's knife", "citrus juicer"],
  "ingredients": [
    {
      "text": "1 lb chicken thighs, boneless skinless",
      "name": "chicken thighs",
      "qty": 1,
      "unit": "lb",
      "section": "meat",
      "buy": true,
      "optional": false,
      "note": "boneless skinless"
    },
    {
      "text": "1/2 small bunch cilantro",
      "name": "cilantro",
      "qty": 0.5,
      "unit": "bunch",
      "section": "produce",
      "buy": true,
      "optional": false,
      "note": "small"
    },
    "–2 tsp water to thin",
    "1/2 tsp black pepper"
  ],
  "prepSteps": ["Chop the cilantro."],
  "cookSteps": [
    {
      "text": "Pat the chicken dry and put it in a bowl.",
      "minutes": null,
      "ingredients": [0]
    },
    {
      "text": "Simmer until the chicken is cooked through.",
      "minutes": 12,
      "ingredients": []
    }
  ],
  "kidsPlates": "Plain rice and fruit.",
  "reheating": "Warm gently with a splash of water.",
  "sourceUrl": "https://example.com/chicken",
  "favorite": false
}
```

`section` is one of `produce`, `meat`, `dairy`, `bakery`, `frozen`, `pantry`, `baking`, `oils`, `snacks`, `beverages`, `household`, `other`. A step's `ingredients` list is positions in the ingredient list, starting at 0, or the ingredient's name. `quantity` is still accepted as another name for `qty`.

`cookware` is an optional list of tools. Each recipe also comes back with `averageRating` and `lastComment` once someone has sent feedback.

`POST /api/recipes/ID/cooked` marks it cooked today. That updates `lastMade`, `timesMade`, and `cookedToday`. Tapping it again the same day does not count twice.

`POST /api/recipes/ID/feedback` with `{ "stars": 5, "comment": "The kids ate it." }` saves a rating. `GET /api/recipes/ID/feedback` reads them back. `stars` is 1 to 5.

`GET /api/recipes/ID`

`PATCH /api/recipes/ID` with only what changed. `{ "favorite": true }` stars it, and `{ "favorite": false }` clears the star.

`DELETE /api/recipes/ID` removes the recipe. Days that used it become a note with the recipe's name.

`POST /api/recipes/import` with `{ "url": "https://..." }` fetches the page and reads the schema.org Recipe block (including one inside `@graph`). The reply is the saved recipe, including `sourceUrl`. If the page has no recipe, the reply is `422` and nothing is saved.

`POST /api/recipes/ID/groceries` with optional `{ "servings": 8 }` adds that recipe's ingredients. Amounts scale from the recipe's own servings when you send a different number. The same recipe is not added twice.

### The week

Dates are `YYYY-MM-DD`. Meals are `breakfast`, `lunch`, or `dinner`. A day has one entry per meal.

`GET /api/plan?from=2026-10-19&to=2026-10-25`

`POST /api/plan` saves or replaces that day and meal. A `recipe` meal adds its ingredients to groceries. Replacing it with a different recipe, leftovers, or a note takes back the unchecked items that were added only for that meal. Bought items stay. Leftovers and notes add nothing.

```json
{ "date": "2026-10-19", "meal": "dinner", "type": "recipe", "recipeId": "RECIPE_ID" }
```

`type` may also be `leftovers`, or `note` with a `note` string.

`DELETE /api/plan/ID` removes that meal and, when it was a recipe, the unchecked groceries that belonged only to it.

`POST /api/plan/groceries` with `{ "from": "2026-10-19", "to": "2026-10-25" }` adds ingredients for recipes planned in that range. The phones already do this when a recipe is planned. This endpoint is for a helper that wants to run it again. Two dinners of the same recipe count twice. Running it again does not add them a second time. Send `"planId"` as well when you only want one planned meal. Matching names are combined, and the grey note lists the recipe.

### Weekly menu

`PUT /api/week` replaces Monday through Sunday, starting on `weekStart` (that date has to be a Monday). It also saves the recipes in the list. Recipes already in the cookbook stay there. Replacing the week does not delete them. A recipe with `externalId` updates the recipe that already has that id. Otherwise the name is used. `recipeId` uses a recipe that is already saved, without changing it.

`GET /api/week?start=2026-10-19` reads that week back in the same shape. Each recipe day includes the full recipe.

Planning and removing meals here follows the same grocery rules as `POST /api/plan`.

```json
{
  "weekStart": "2026-10-19",
  "days": [
    {
      "date": "2026-10-19",
      "meal": "dinner",
      "type": "recipe",
      "recipe": {
        "externalId": "home-chef-chicken-chili",
        "name": "Chicken chili",
        "coversNights": 2,
        "servings": 4,
        "nightBefore": ["Thaw the chicken in the fridge."],
        "ingredients": ["1 1/2 lb chicken thighs", "1 onion", "2 cloves garlic"],
        "prepSteps": ["Chop the onion and garlic."],
        "cookSteps": [
          { "text": "Brown the chicken in a pot.", "minutes": 8 },
          { "text": "Simmer until thick.", "minutes": 25 }
        ],
        "kidsPlates": "Plain rice, beans, and fruit.",
        "reheating": "Add a splash of water and simmer for 5 minutes.",
        "sourceUrl": "https://example.com/chicken-chili"
      }
    },
    {
      "date": "2026-10-20",
      "meal": "dinner",
      "type": "leftovers",
      "note": "Chicken chili"
    },
    {
      "date": "2026-10-21",
      "meal": "dinner",
      "type": "note",
      "note": "Eating at Grandma's"
    },
    {
      "date": "2026-10-22",
      "meal": "dinner",
      "type": "recipe",
      "recipeId": "EXISTING_RECIPE_ID"
    }
  ]
}
```

`coversNights` is how many nights the recipe feeds, including a leftovers night. A leftovers day can send `recipeId` for the original recipe. If it doesn't, a note that matches the recipe name, or the previous dinner that still covers that night, is used. `nightBefore`, `prepSteps`, and `cookSteps` show on the recipe page in that order, inside Instructions. Cook mode walks today's prep and cook steps, then kids' plates and reheating when those notes exist. Night-before steps stay out of cook mode. On Today they show up as one line, **Prep for tomorrow**, when tomorrow's recipe has them. The Ingredients button in cook mode lists every ingredient at the current serving size. The screen stays awake while you cook.

A cook step timer is `minutes` as a number (`8`), a range (`"4-5"`), or `seconds` (`30`). The words "4-5 min" or "30 sec" inside the step also start a timer. `kidsPlates` and `reheating` are short notes. Leave a section out when it doesn't apply.

`GET /api/week` is unchanged: one Monday-to-Sunday menu. The week list and the month view on the phone load `/api/plan` and `/api/events` for the days on screen.

The same fields can be sent on `POST /api/recipes` and `PATCH /api/recipes/ID`. Older recipes that only have `steps` still cook from those steps.

### Family events

`GET /api/events?from=2026-10-19&to=2026-10-25`

`POST /api/events`

```json
{ "date": "2026-10-19", "time": "15:30", "title": "Soccer" }
```

`time` may be `HH:MM` or a short bit of text such as `afternoon`, or left out.

`PUT /api/events?from=2026-10-19&to=2026-10-25` replaces every event in that range and leaves days outside it alone.

```json
{ "events": [ { "date": "2026-10-19", "time": "15:30", "title": "Soccer" } ] }
```

`DELETE /api/events/ID`

### Backup

`GET /api/export`

Returns everything: `{ "exportedAt", "items", "staples", "recipes", "plan", "events" }`.

### The website sign-in

Phones use these. A helper does not need them.

`POST /api/login` with `{ "passcode": "..." }` sets a cookie that lasts about 400 days.

`POST /api/logout` clears that cookie on the phone that called it.

A request with no cookie and no bearer token gets `401`.

An Amazon code can be the 10-character ASIN, or a product link such as `https://www.amazon.com/dp/B0DISHSOAP`. The list stores the 10-character code.

## Check that it still works

Optional. You do not need this to use the list.

```bash
npm test
```
