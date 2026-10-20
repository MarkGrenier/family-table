# Add to Family Table from the iPhone Share sheet

This is the shortcut Mark and Emma use in Safari. You build it once on the iPhone, in the Shortcuts app. After that, a recipe page can be sent into Family Table from the Share button (the square with the arrow).

A signed shortcut file is not included. This project was built on a computer that cannot sign Apple shortcuts, and an unsigned file will not install. Follow the steps below instead. It takes a few minutes.

## Before you start

The keys live on the computer that runs Family Table. They are not shown in the app.

On that computer, in the project folder, run:

```bash
npm run share-keys
```

That prints Mark's key and Emma's key, and saves the same text in `share-keys.txt` in the project folder. Mark's key starts with `ft_mark_`. Emma's key starts with `ft_emma_`. Each key only adds a recipe.

The shortcut address is your live website plus `/api/share`. Use that website. An address that starts with `http://127` only works on the computer at home.

Copy the address and your own key into Notes on the iPhone so you can paste them into Shortcuts.

## Build the shortcut

Open the **Shortcuts** app.

### 1. New shortcut

Tap the **+** button. Name the shortcut **Add to Family Table**.

### 2. Show it in the Share sheet

Tap the **i** button (the shortcut's info).

Turn on **Show in Share Sheet**.

Under the types of things it accepts, leave **URLs** and **Safari web pages** on. You can turn the other types off.

Tap **Done**.

### 3. Get the link

Tap **Add Action** (or the search field).

Search for **Get URLs from Shortcut Input**.

Tap that action so it sits under the shortcut name.

This takes the page you shared and keeps only the link.

### 4. Send the link to Family Table

Tap **+** again, or search below the first action.

Search for **Get Contents of URL**.

Tap it so it sits under Get URLs from Shortcut Input.

Set it up like this:

- **URL** (the address of the request): paste the address you copied. It ends in `/api/share`.
- Tap **Show More**, or the arrow, until you see Method, Headers, and Request Body.
- **Method**: **POST**.
- **Headers**: add one header.
  - Name: `Authorization`
  - Value: type `Bearer`, then a space, then paste your key. It should look like `Bearer ft_mark_` or `Bearer ft_emma_` followed by a long string of letters and numbers. The word Bearer, the space, and the key are all required.
- **Request Body**: **JSON**.
- Add one field.
  - Key: `url` (all lowercase).
  - Value: tap the value, then tap **URLs** (the result of Get URLs from Shortcut Input). Do not type a recipe page in here. The shortcut fills that in each time you share.

### 5. Show the answer

Search for **Show Notification**.

Put it under Get Contents of URL.

- Leave the title as Family Table, or type **Family Table**.
- **Body**: tap it and choose **Contents of URL** (the reply from the previous action).

That reply is one short line. Shortcuts shows it as the notification.

- **Added: Lemon pasta** means the recipe came in whole.
- **Saved for Chef to finish: Tuesday soup** means the page was saved, and Chef still needs to add the missing pieces. In the app that recipe says **Needs a look**.

### 6. Try it

Open a recipe in Safari.

Tap the Share button.

Tap **Add to Family Table**.

You should see one of those two lines. Open Family Table, tap Recipes, and the dish is there.

Nothing is added to Groceries yet. Groceries are added only when that recipe is planned on a day.

The page address is kept with the recipe so it can be fetched again. It is not shown in the app.

## If the notification says the key didn't work

The line is: **That share key didn't work.**

Check the Authorization value. It starts with `Bearer `, with a space, then the key from `share-keys.txt` for the person whose phone this is. Run `npm run share-keys` again if you need a fresh copy.

## If you change phones

Build the same shortcut again. Copy the address and that person's key from `share-keys.txt`.
