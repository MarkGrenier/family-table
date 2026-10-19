# Family groceries

A shared shopping list for Mark and Emma.

There are three stores: Costco, the local store, and Amazon. Things you buy over and over can sit on a Staples list and be added again next time. When one phone changes the list, the other phone catches up in a few seconds.

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

5. Create the practice list (a few example items, only on this computer):

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

### 2. Create the database

This is the little database that stores the list.

```bash
npx wrangler d1 create grocery
```

Cloudflare prints a database id. It looks like `a1b2c3d4-1234-5678-9abc-def012345678`.

Open the file `wrangler.toml` in TextEdit (or any text editor). Find this line:

```toml
database_id = "00000000-0000-0000-0000-000000000000"
```

Replace the zeros with the id Cloudflare printed. Save the file. Leave every other line as it is.

### 3. Create the empty list

```bash
npx wrangler d1 migrations apply grocery --remote
```

If it asks you to continue, type `y` and press Enter.

The live list starts empty. The practice milk and bananas stay on your computer.

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
3. Type the passcode from step 4 and tap **Open the list**. The phone remembers it.
4. Tap the Share button (the square with an arrow pointing up).
5. Tap **Add to Home Screen**.
6. Tap **Add**.

An icon named Groceries appears on the home screen. Do the same on the other phone.

Open the list on both phones. When one of you adds or checks something, the other phone updates within a few seconds, as long as the list is open.

## Using the list

- The buttons at the top are Costco, Local, Amazon, and Staples.
- Type a name and tap **Add**. On Costco and Local, tap the aisle first: Produce, Shelf-stable, Refrigerated, or Frozen. Costco has no Produce aisle. Amazon is one list, with no aisles.
- **Add details** is for a quantity, a brand, an Amazon code, or marking it as a staple.
- Tap an item to mark it bought. Bought items drop to the bottom and turn grey. Tap again to put it back.
- **Edit** changes the name and the other details. **Delete this item** is inside that screen, so it is harder to tap by mistake.
- **Clear already got** takes the bought items off that store. It asks you first.
- A staple is something you buy often. Tick **Staple** when you save an item, or tap **Add a staple** on the Staples tab. **Add to this week** puts it on that store's list. If it is already there and not bought yet, the button says **On the list**. After you check it off, you can add it again.
- **Sign out on this phone** is at the bottom. It only signs out that phone.

## If something goes wrong

- "That passcode didn't work" — on the live site, use the passcode from step 4, not the practice passcode from this computer.
- The page will not load on your phone at `127.0.0.1` — that address only works on the computer that is running `npm start`. Phones use the `workers.dev` address.
- You changed the passcode — each phone needs to open the list and sign in again. Use **Sign out on this phone** first if it still shows the old list.
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
  "staple": true
}
```

`PATCH /api/items/ID`

Send only what changed. Example: `{ "checked": true }`.

`DELETE /api/items/ID`

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
  "brand": "Kirkland"
}
```

`POST /api/staples/ID/add`

Puts that staple on this week's list. If it is already there and not bought yet, it is not added twice. The reply includes `"alreadyOnList": true` or `false`.

`DELETE /api/staples/ID`

Removes the staple. Anything already on this week's list stays there.

### Backup

`GET /api/export`

Returns the whole list: `{ "exportedAt", "items", "staples" }`.

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
