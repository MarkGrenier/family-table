# Family Table

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

New files are `migrations/0003_food.sql`, `migrations/0004_recipe_sections.sql`, `migrations/0005_mealime.sql`, `migrations/0006_item_deleted.sql`, `migrations/0007_plan_alternates.sql`, `migrations/0008_on_hand.sql`, `migrations/0009_share_keys.sql`, `migrations/0010_plan_also.sql`, `migrations/0011_groceries_deferred.sql`, `migrations/0012_store_tags.sql`, `migrations/0013_stores.sql`, and `migrations/0014_fresh.sql`. Older migration files stay as they are. The command below applies every one that is not on the live list yet. `0005_mealime.sql` adds grocery sections, cookware, cooked days, and feedback. `0006_item_deleted.sql` lets a grocery line be hidden and put back. `0007_plan_alternates.sql` adds an empty list of alternate recipes to each planned meal. `0008_on_hand.sql` adds an empty usually-on-hand list and remembers the amount each recipe contributed to a grocery line. `0009_share_keys.sql` marks every existing recipe as finished (`needs_review` starts off) and adds an empty table for share-sheet keys. `0010_plan_also.sql` adds an empty list of extra dinners on a day that already has one. `0011_groceries_deferred.sql` adds `groceries_deferred` to each planned meal, starting at 0, so meals already on the calendar are not shopped again. `0012_store_tags.sql` adds an empty store tag on each grocery line and an empty custom-store table. `0013_stores.sql` adds the store list and starts it with Local store, Costco, and Amazon. `0014_fresh.sql` adds `fresh` on each grocery line, starting at 0, and does not mark any existing line fresh. None of them change rows that are already there.

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

The icon is a white plate, fork, and knife on the app's green. A newly added icon is named Family Table. An icon you already added keeps the old picture until you delete it and add the app again. Do the same on the other phone.

Open the app on both phones. When one of you changes dinner, a recipe, or the groceries, the other phone updates within a few seconds, as long as the app is open.

## Using the app

Four tabs sit at the bottom: Today, Week, Recipes, and Groceries. The Groceries tab shows how many things are still to buy.

- **Today** is tonight's recipe: the photo, the dish name, the time, the servings, and the Cookware, Ingredients, and Instructions tabs. The steps stay inside Instructions. **Mark cooked** and **Start cooking** sit at the bottom. **Start cooking** walks through today's prep and cook steps, then kids' plates when that note exists. Night-before steps are not part of cooking. If tomorrow has night-before prep, a tag on the photo says **Prep for tomorrow · 1 step**. Tap it for a short list with a checkbox on each step. A leftovers night is a large photo of the dish, or a warm plate illustration when it has no photo, then an amber Leftovers tag, the dish name, and “Night off. Enjoy the leftovers.” A card at the bottom shows tomorrow’s dinner when one is planned, including a prep tag when that recipe has night-before steps. Tap it to open that recipe. If tomorrow is leftovers too, the card says Tomorrow: leftovers. If nothing is planned, the card stays hidden. The dots still open Swap meal. There are no ingredient tabs and no Start cooking. A recipe with no photo shows the plate icon, and the prep tag sits on that band when tomorrow needs it. If tonight is already marked cooked, Start cooking stays up, with Cooked beside it. Family events for today are listed under the recipe. If nothing is planned, you get a short note and a button to plan dinner. The dots on the photo open **Swap meal** and **Edit recipe**. Swap meal picks another saved recipe, or leftovers, for tonight. The grocery list drops the old meal's unchecked items and adds the new one's.
- **Week** is the next seven days, with today at the top. Earlier days are not listed. Each day shows its meals (dinner, and breakfast or lunch when those are planned) and that day's family events. A leftover night in the week list and the month day panel still says Dinner, with an amber Leftovers tag. Tapping a date selects that day on the Week list, or on the month calendar when it is further ahead. There is no separate day page. The dots on a meal open Remove and Edit recipe. Each meal shows its photo, or the plate icon when there is no photo. Tap a meal to open that recipe. The green + on an empty day opens the recipe picker. After you pick, you come back to Week or the month with that date selected and the dinner visible. Adding from a recipe stays on that recipe and shows Added to that date. The calendar icon in the header opens a simple month view for jumping further ahead. Today starts selected, and that day's meals and events sit under the grid. Tap another day to switch. Edit opens the planner. Choosing a recipe puts the things you need to buy on the grocery list when that dinner is this week or next week (Monday through Sunday). A later dinner waits until it enters that window. Salt, pepper, oil, water, and spices stay off the list. An optional ingredient is skipped unless you set `buy` to true. Taking that recipe off the day takes those unchecked items back off. Leftovers and notes don't add anything. Checking an item off offers Undo for a few seconds. In Show completed items, tap the filled circle to put it back.
- **Recipes** is the cookbook. **Favorites**, **Recent**, and **A-Z** sort the list. A recipe shows **Last made Oct 12** when it has been planned before. A recipe that still needs finishing shows **Needs a look**. Open one for the photo, a heart, **Cookware**, **Ingredients**, and **Instructions**. Tap the servings to scale the amounts. **Cooked?** records that you made it. **Start cooking** walks through the steps. The page a recipe came from is stored and is not shown. The dots on a recipe edit it: title, servings, time, photo, ingredients, and steps. Sending a new week does not remove recipes.
- **Groceries** is grouped by store, and inside each store by Produce, Shelf-stable, Refrigerated, and Frozen. That order is the same for every store. The same ingredient from two recipes becomes one line, including a plural and its singular (`Lemons` and `Lemon`). Amounts are shown when they are something you buy, such as pounds, cloves, or a bag. Teaspoons, tablespoons, and cups are left off. If the amounts do not add up, the line is just the name, with “for 2 recipes” when more than one dinner needs it. Jarred garlic and fresh garlic stay separate when their sections differ. Tap the circle to mark something bought. Tap a row to edit the name, amount, store, section, brand, and note. Swipe the row left and tap **Delete**. Undo puts that same line back for a few seconds. The green **+** hides while a row is swiped open, and the list can scroll the last row above it. **+** opens a short Add sheet. **Store** is a dropdown like **Section**: **No store**, each saved store, **Add store…**, and **Edit stores…**. **Add store…** asks for a name, saves it, and selects it. **Edit stores…** opens a small menu to rename or remove a store, including Costco, the local store, and Amazon. Removing a store asks first, and its items become No store. The sheet shows name, quantity, store, section, brand, a note, and a **Fresh** switch together. The switch is a row like the others. One **Add** button saves the item, and the keyboard Return key does the same. The section is guessed from the name until you change it. The aisle stays on the item and is not shown. A fresh line that came from a planned meal stays off the store groups until the day before that meal. On that day it sits at the top under **Buy today**. Before that, **Coming up** at the bottom of the screen shows how many are waiting, and a tap expands them. A fresh item with no meal date stays in its store group. Checking an item off still moves it to completed. The green dots share the list, show completed items, or mark them all complete. Tapping the dimmed area behind a sheet, the recipe picker, or Add closes it and does not save or remove anything.

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

`store` can be `costco`, `local`, `amazon`, or the store's name, such as `Costco` or `Target`. A new name is saved on the store list. `""` means no store. The reply includes `storeName` for the label Mark sees. `store` on a Costco, local, or Amazon item stays the old key when that key still fits the aisle.

`category` is `produce`, `shelf`, `refrigerated`, or `frozen` for every store. Amazon still accepts `general`, or no category, and that item is shelf-stable. `GET /api/stores` returns `{ "stores": [{ "id", "name" }] }`. `POST /api/stores` with `{ "name": "Target" }` adds one. `PATCH /api/stores/ID` with `{ "name": "Target Plaza" }` renames it. `DELETE /api/stores/ID` removes it and leaves its items with no store.

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

Send only what changed. Example: `{ "checked": true }`. `{ "deleted": true }` hides the line, and `{ "deleted": false }` puts that same line back. `GET /api/items` leaves hidden lines out. Leaving `barcode` out keeps the one already saved. Sending a barcode here does not, by itself, turn the item into a staple.

`DELETE /api/items/ID`

`DELETE /api/items?source=recipe` removes every grocery line that was added from a recipe or a planned meal. Lines typed by hand stay. The reply is `{ "deleted": 12 }`.

Each item may also include `section` (`produce`, `meat`, `dairy`, `bakery`, `frozen`, `pantry`, `baking`, `oils`, `snacks`, `beverages`, `household`, or `other`), `imageUrl`, `substitute`, `notes`, and `fresh`. `fresh` is `true` or `false`. Leave it out on a new item and it is saved as `false`. `GET /api/items` adds `recipes` on each line: `{ "id", "name", "imageUrl", "date" }` for the recipes that need it. It also adds `dueDate`, `dinnerDate`, and `recipeName`. `dueDate` is the day before the earliest planned meal on a fresh line, or `null` when the line is not fresh or has no meal date. `dinnerDate` is that meal. `recipeName` is that meal's recipe. Older fields `store` and `category` stay.

`GET /api/groceries?due=2026-10-25`

Returns unchecked fresh lines whose due date is that day or earlier.

```json
{
  "groceries": [
    {
      "name": "Salmon",
      "quantity": "1 lb",
      "store": "Local store",
      "dinnerDate": "2026-10-26",
      "recipeName": "Sheet-pan salmon"
    }
  ]
}
```

`quantity` is the amount note, or `null`. `store` is the store name on the list, or `null` when the line has no store. `dinnerDate` is the planned meal. `recipeName` is that meal's recipe. A fresh line with no meal date is left out. A bought line is left out. A missing or unreal due date is a 400. A Monday dinner is due the Sunday before it. A Sunday dinner is due the Saturday before it. Sending `due` as that Sunday includes the Monday dinner and leaves out a dinner whose due date is still later.

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
      "fresh": false,
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

`section` is one of `produce`, `meat`, `dairy`, `bakery`, `frozen`, `pantry`, `baking`, `oils`, `snacks`, `beverages`, `household`, `other`. `fresh` is optional. Send `true` for something to buy the day before the meal, such as salmon. Leave it out, or send `false`, and the ingredient is ordinary. Planning the recipe copies `fresh` onto the grocery line. Saving the recipe again with `fresh: true` sets that flag on a line already on the list. It does not clear a line you marked fresh yourself. A step's `ingredients` list is positions in the ingredient list, starting at 0, or the ingredient's name. `quantity` is still accepted as another name for `qty`.

`cookware` is an optional list of tools. Each recipe also comes back with `averageRating` and `lastComment` once someone has sent feedback.

`POST /api/recipes/ID/cooked` marks it cooked today. That updates `lastMade`, `timesMade`, and `cookedToday`. Tapping it again the same day does not count twice.

`POST /api/recipes/ID/feedback` with `{ "stars": 5, "comment": "The kids ate it." }` saves a rating. `GET /api/recipes/ID/feedback` reads them back. `stars` is 1 to 5.

`GET /api/recipes/ID`

`PATCH /api/recipes/ID` with only what changed. `{ "favorite": true }` stars it, and `{ "favorite": false }` clears the star. `{ "imageUrl": "https://..." }` sets the photo. `{ "imageUrl": null }` clears it. A path that starts with `/` is also allowed.

`DELETE /api/recipes/ID` removes the recipe. Days that used it become a note with the recipe's name.

`POST /api/recipes/import` with `{ "url": "https://..." }` fetches the page and reads the schema.org Recipe block (including one inside `@graph`). The photo saved in `imageUrl` is the recipe's JSON-LD `image` when that is an https picture (a relative picture is joined to the page address). Otherwise it is `og:image`, then `twitter:image`. The reply is the saved recipe, including `sourceUrl`. If the page has no recipe, the reply is `422` and nothing is saved. This route needs the helper password or a signed-in session. A share-sheet key is rejected.

`POST /api/share` is the iPhone Share sheet. It uses a share-only key, not the helper password and not the passcode. Sending the helper password gets plain text `That share key didn't work.` and saves nothing. The same line comes back for a wrong key. The body can be JSON `{ "url": "https://..." }` or `{ "URL": "https://..." }`, or the link as plain text. The reply is plain text, not JSON: `Added: Lemon pasta` when the page had a name, at least one ingredient, and at least one step, or `Saved for Chef to finish: Tuesday notes` when the page could not be read, had no recipe, or was only partly filled in. A partial save still keeps the link, the same main photo when the page has one, and, when the page opened, the `<title>`. `needsReview` is true on those. A photo that does not load in the app shows the plate icon. A link that is not a public `https` address is `400` and nothing is saved. Sharing a recipe does not add groceries. Groceries are added only when that recipe is planned.

Mark and Emma each have a share key. Only the hash is stored. The app does not show the keys. On the computer that has the passcode, `npm run share-keys` prints both keys and writes `share-keys.txt` in the project folder. That file stays off the website. The shortcut steps are in `docs/share-shortcut.md`. A signed `.shortcut` file is not in this project; this environment cannot sign one.

`GET /api/recipes?needsReview=true` lists the recipes Chef still needs to finish. Leaving the query off returns the whole cookbook, same as before. `PATCH` with ingredients and steps clears `needsReview` once the recipe has a name, at least one ingredient, and a step. Starring it does not.

`POST /api/recipes/ID/groceries` with optional `{ "servings": 8 }` adds that recipe's ingredients. Amounts scale from the recipe's own servings when you send a different number. The same recipe is not added twice.

### The week

Dates are `YYYY-MM-DD`. Meals are `breakfast`, `lunch`, or `dinner`. A day has one entry per meal.

`GET /api/plan?from=2026-10-19&to=2026-10-25`

`POST /api/plan` saves or replaces that day and meal. Weeks run Monday through Sunday. A `recipe` meal adds its ingredients to groceries only when the date is in the grocery window: the Monday of the current week through the Sunday of the next week, in Eastern time. A meal further out is saved with `groceries_deferred` set, and does not change the list. Send the existing meal `id` with a new date to move it. Moving or replacing a meal from inside the window onto a date past it takes that meal's groceries back (a checked line stays checked, a line you typed stays, an unchecked line with nothing else on it comes off) and leaves it deferred, so it is shopped once when the date comes into the window. The next time the list is fetched (`GET /api/items`, which the app does on load), a deferred meal whose date is today through the end of that window is shopped once and the flag is cleared. Fetching again does not add it twice. A meal already in the window stays as it is, including one whose groceries were cleared after shopping. Past dates are never shopped by that check. Replacing an in-window meal with a different recipe, leftovers, or a note takes back the unchecked items that were added only for that meal. Bought items stay. Leftovers and notes add nothing. Removing a meal outside the window does not change the list.

```json
{ "date": "2026-10-19", "meal": "dinner", "type": "recipe", "recipeId": "RECIPE_ID" }
```

`type` may also be `leftovers`, or `note` with a `note` string.

`alternates` is up to 3 other recipes for that same meal. Each entry is a `recipeId` or an `externalId`. The saved list is recipe ids, and `GET /api/plan` returns it on the meal as `alternates`. Leave the field out and the ones already saved stay. Send `[]` to clear them. The chosen recipe is not kept in its own alternate list. Alternates do not add groceries. Only the chosen recipe does.

`PATCH /api/plan/ID` with `{ "alternates": ["RECIPE_ID", "external-id"] }` changes that list and nothing else. The meal and its groceries stay as they are.

`DELETE /api/plan/ID` removes that meal. When it was a recipe inside the grocery window, the unchecked groceries that belonged only to it come off the list. A meal outside the window leaves the list alone. Bought items stay either way.

`POST /api/plan/groceries` with `{ "from": "2026-10-19", "to": "2026-10-25" }` adds ingredients for recipes planned in that range and inside the grocery window. Dates outside the window are skipped. The phones already do this when a recipe is planned. This endpoint is for a helper that wants to run it again. Two dinners of the same recipe count twice. Running it again does not add them a second time. Send `"planId"` as well when you only want one planned meal. Matching names are combined, including singular and plural. Each ingredient keeps the section it was given, so pantry garlic does not merge into produce garlic. Amounts are added only for units you can buy (pounds and ounces, cloves, cans, bags, and the like). Ounces and pounds convert. Teaspoons, tablespoons, and cups are never written on the list. When the units do not add up, the line is the item name, and the amount says `for 2 recipes` when more than one recipe contributed. A name on the usually-on-hand list is skipped. The grey note still lists the recipe.

`POST /api/groceries/rebuild` with `{}` rebuilds grocery lines for planned recipes inside the grocery window (this Monday through the Sunday of next week). Meals outside that window are left as they are. Send `{ "from": "2026-10-19", "to": "2026-10-25" }` to limit the dates further. Both dates are required if you send either one. It detaches unchecked lines that those meals added, deletes a line only when nothing else is still attached, then adds the meals again with the rules above. Checked lines stay, including ones already bought. Items you typed yourself stay on the list and are not duplicated. The reply is `{ "added", "updated", "skipped", "removed" }`.

Meals already planned after the window can still be sitting on the grocery list from before this rule. On 21 Oct 2026 the window ends 1 Nov 2026, so that includes 13 Nov Chili-Lime Chicken Breast Burrito Bowls and 27 Nov Beef Taco Potato Skillet. `npm run cleanup-future` reads a sqlite copy and prints the before/after diff. The copy stays as it is. `--sql` writes a file you can run on the live database after migration 0011 is applied. Every plan row stays. Those meals are marked deferred, so each one is shopped once when its date enters the window. Checked lines stay checked. A line you added by hand stays. An unchecked line that only those meals contributed comes off the list.

```bash
npx wrangler d1 migrations apply grocery --remote
npx wrangler d1 export grocery --remote --output live.sql
sqlite3 live.sqlite < live.sql
npm run cleanup-future -- --db live.sqlite
npm run cleanup-future -- --db live.sqlite --sql cleanup-future-groceries.sql
npx wrangler d1 execute grocery --remote --file=cleanup-future-groceries.sql
```

### Usually on hand

`GET /api/on-hand` returns `{ "items": [{ "id", "name" }] }`. The list starts empty. Nothing is pre-filled.

`POST /api/on-hand` with `{ "name": "Lemons" }` saves a name. The same name, or its singular or plural, is stored once. A repeat reply is the existing row. An empty name is `400`. Recipes skip that ingredient when they add groceries. Typing the item on the list yourself still adds it.

`DELETE /api/on-hand/ID` removes that row. `DELETE /api/on-hand` with `{ "id": "ID" }` or `{ "name": "Lemons" }` does the same. A missing row is `404`.

### Weekly menu

`PUT /api/week` replaces Monday through Sunday, starting on `weekStart` (that date has to be a Monday). It also saves the recipes in the list. Recipes already in the cookbook stay there. Replacing the week does not delete them. A recipe with `externalId` updates the recipe that already has that id. Otherwise the name is used. `recipeId` uses a recipe that is already saved, without changing it.

`GET /api/week?start=2026-10-19` reads that week back in the same shape. Each recipe day includes the full recipe. A day may also send `alternates`, the same list of up to 3 recipe ids or external ids. They come back as recipe ids and do not add groceries.

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

`coversNights` is how many nights the recipe feeds, including a leftovers night. A leftovers day can send `recipeId` for the original recipe. If it doesn't, a note that matches the recipe name, or the previous dinner that still covers that night, is used. `nightBefore`, `prepSteps`, and `cookSteps` show on the recipe page in that order, inside Instructions. Cook mode walks today's prep and cook steps, then kids' plates when that note exists. Night-before steps stay out of cook mode. On Today they show up as a tag on the photo, **Prep for tomorrow · 1 step**, when tomorrow's recipe has them. Leftovers use the source recipe's photo. A recipe with no photo shows a plate icon on a green band instead, and the tag sits on that band. The Ingredients button in cook mode lists every ingredient at the current serving size. The screen stays awake while you cook.

A cook step timer is `minutes` as a number (`8`), a range (`"4-5"`), or `seconds` (`30`). The words "4-5 min" or "30 sec" inside the step also start a timer. `kidsPlates` and `reheating` are short notes. The app keeps `reheating` on the recipe and does not show it. Leave a section out when it doesn't apply.

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

`POST /api/login` with `{ "passcode": "..." }` sets a cookie that lasts about 400 days. Each later request from that signed-in phone renews it for another 400 days. When the cookie is still valid, the home page is the app shell, not the passcode form. The passcode form is sent only when there is no session, or the session is no longer valid.

`POST /api/logout` clears that cookie on the phone that called it.

A request with no cookie and no bearer token gets `401`.

An Amazon code can be the 10-character ASIN, or a product link such as `https://www.amazon.com/dp/B0DISHSOAP`. The list stores the 10-character code.

## Check that it still works

Optional. You do not need this to use the list.

```bash
npm test
```
