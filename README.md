# Family Table

Dinners, recipes, and one grocery list for Mark and Emma.

The live app is the Cloudflare Worker `family-grocery` at https://family-grocery.grenier-family.workers.dev. Recipes, the week plan, and the grocery list are in the D1 database `grocery`. `wrangler.toml` names that database. The phone shell cache is `grocery-shell-v106`.

## Run it on this computer

```bash
npm install
```

Create a `.dev.vars` file in this folder. It is gitignored. Put a practice `PASSCODE` and `API_TOKEN` in it. Those values stay on this computer and are not the live secrets.

```bash
npm run setup
npm start
```

Open http://127.0.0.1:47219

## Deploy

Sign in once:

```bash
npx wrangler login
```

`wrangler.toml` already points at the live database. Do not commit API tokens, `.dev.vars`, `.env`, share keys, or database backups. The live worker already has `PASSCODE` and `API_TOKEN`. Change them with `npx wrangler secret put`, not by writing them into the repo.

### Deploy routine

1. Back up D1 before uploading:

   ```bash
   npx wrangler d1 export grocery --remote --output backups/grocery-before-vNNN.sql
   ```

   `backups/` is gitignored. That file is the family list.

2. Bump the shell cache in `public/sw.js` from `grocery-shell-vNNN` to the next number. Bump the `styles.css?v=` and `app.js?v=` query strings in `public/sw.js` and `public/index.html` so phones load the new files.

3. Deploy:

   ```bash
   npx wrangler deploy
   ```

   Skip migrations unless the schema changed. Do not send secret values with the deploy.

4. Check the counts. They should match the numbers from before the deploy:

   ```bash
   npx wrangler d1 execute grocery --remote --command "SELECT (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL) AS kept, (SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND checked = 0) AS active, (SELECT COUNT(*) FROM items) AS all_rows, (SELECT COUNT(*) FROM recipes) AS recipes, (SELECT COUNT(*) FROM plan_entries) AS plan, (SELECT COUNT(*) FROM stores) AS stores;"
   ```

   Fetch `https://family-grocery.grenier-family.workers.dev/sw.js` with a browser user agent and confirm the cache name is the one you just bumped.
