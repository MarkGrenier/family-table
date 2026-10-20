const state = {
  authed: false,
  loading: true,
  tab: "today",
  page: null,
  sheet: null,
  recipes: [],
  plan: [],
  events: [],
  items: [],
  recipeQuery: "",
  recipeSort: "favorites",
  dayQuery: "",
  addQuery: "",
  notice: "",
  error: "",
  loginError: "",
  passcode: "",
  showMeals: {},
  checking: null,
  doneOpen: false,
  timer: null,
  timerHandle: null,
  stars: 0,
  comment: "",
};

const SECTIONS = [
  ["produce", "Produce"],
  ["meat", "Meat & Seafood"],
  ["dairy", "Dairy Cheese & Eggs"],
  ["bakery", "Bakery"],
  ["frozen", "Frozen"],
  ["pantry", "Pantry"],
  ["baking", "Baking & Spices"],
  ["oils", "Oils Sauces & Condiments"],
  ["snacks", "Snacks"],
  ["beverages", "Beverages"],
  ["household", "Household"],
  ["other", "Other"],
];

const app = document.getElementById("app");
app.addEventListener("focusin", (event) => {
  if (event.target.id === "passcode") event.target.removeAttribute("readonly");
});
app.addEventListener("click", onClick);
app.addEventListener("submit", onSubmit);
app.addEventListener("input", onInput);
app.addEventListener("pointerdown", onPointerDown);
app.addEventListener("pointerup", onPointerUp);
app.addEventListener("pointercancel", () => clearGesture());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.page?.kind === "cook") lockScreen();
});

let gesture = null;

boot();
setInterval(() => refresh(false), 5000);

async function boot() {
  render();
  const me = await fetch("/api/items");
  const typed = document.getElementById("passcode");
  if (typed) state.passcode = typed.value;
  state.authed = me.status !== 401;
  if (state.authed) await refresh(true);
  state.loading = false;
  render();
}

async function refresh(force) {
  if (!state.authed) return;
  if (state.checking && !force) return;
  try {
    const range = visibleRange();
    const [items, recipes, plan, events] = await Promise.all([
      api("/api/items"),
      api("/api/recipes"),
      api(`/api/plan?from=${range.from}&to=${range.to}`),
      api(`/api/events?from=${range.from}&to=${range.to}`),
    ]);
    state.items = items.items || [];
    state.recipes = recipes.recipes || [];
    state.plan = plan.plan || [];
    state.events = events.events || [];
    state.error = "";
    if (force || !isTyping()) render();
  } catch (error) {
    if (error.status === 401) {
      state.authed = false;
      render();
      return;
    }
    if (force) {
      state.error = "Couldn't refresh just now.";
      render();
    }
  }
}

function isTyping() {
  const el = document.activeElement;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function render() {
  if (!state.authed) {
    const input = document.getElementById("passcode");
    const error = document.getElementById("login-error");
    if (input && error) {
      error.hidden = !state.loginError;
      error.textContent = state.loginError || "";
      if (!input.value && state.passcode) input.value = state.passcode;
      return;
    }
    app.innerHTML = loginHtml();
    const fresh = document.getElementById("passcode");
    if (fresh && state.passcode) fresh.value = state.passcode;
    return;
  }
  if (state.loading) {
    app.innerHTML = `<main class="screen"><p class="muted">Loading…</p></main>`;
    return;
  }
  if (state.page?.kind === "cook") {
    app.innerHTML = cookHtml() + sheetHtml();
    return;
  }
  const bare = ["recipe", "feedback", "item", "add-item"].includes(state.page?.kind);
  app.innerHTML = `<main class="${bare ? "bare" : "screen"}">${bodyHtml()}</main>${bare ? "" : tabsHtml()}${sheetHtml()}`;
  const focus = document.getElementById("add-search");
  if (focus && state.page?.kind === "add-item") focus.focus();
}

function loginHtml() {
  return `<main class="login">
    <h1>Food</h1>
    <p class="lede">Dinners, the week, and the grocery list for Mark and Emma.</p>
    <form id="login-form">
      <div class="pass-box">
        <input id="passcode" name="passcode" type="password" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text" readonly aria-label="Passcode">
        <button type="button" data-action="toggle-passcode">Show</button>
      </div>
      <p id="login-error" class="error" role="alert" ${state.loginError ? "" : "hidden"}>${esc(state.loginError || "")}</p>
      <button class="primary" type="submit">Open</button>
    </form>
  </main>`;
}

function bodyHtml() {
  if (state.page?.kind === "day") return dayHtml(state.page.date);
  if (state.page?.kind === "recipe") return recipeHtml(state.page.id);
  if (state.page?.kind === "feedback") return feedbackHtml(state.page.id);
  if (state.page?.kind === "item") return itemHtml(state.page.id);
  if (state.page?.kind === "add-item") return addHtml();
  if (state.page?.kind === "new-recipe") return newRecipeHtml();
  if (state.tab === "week") return weekHtml();
  if (state.tab === "recipes") return recipesHtml();
  if (state.tab === "groceries") return groceriesHtml();
  return todayHtml();
}

function tabsHtml() {
  const count = state.items.filter((item) => !item.checked && item.id !== state.checking).length;
  return `<nav class="tabs">${tabBtn("today", "Today", sun())}${tabBtn("week", "Week", cal())}${tabBtn("recipes", "Recipes", book())}${tabBtn("groceries", "Groceries", cart(), count)}</nav>`;
}

function tabBtn(id, label, icon, count) {
  return `<button type="button" data-action="tab" data-tab="${id}" class="${state.tab === id ? "is-on" : ""}">${icon}${count ? `<span class="badge">${count}</span>` : ""}<span>${label}</span></button>`;
}

function todayHtml() {
  const today = nyToday();
  const dinner = mealOn(today, "dinner");
  const events = eventsOn(today);
  return `<p class="kicker">Today</p>
    <h1>${esc(longDate(today))}</h1>
    ${dinner ? dinnerCard(dinner) : `<p>Nothing planned tonight.</p><button class="primary" type="button" data-action="plan-dinner">Plan dinner</button>`}
    ${events.length ? `<h2 class="kicker">On the calendar</h2><ul>${events.map((event) => `<li>${esc(event.title)}</li>`).join("")}</ul>` : ""}`;
}

function dinnerCard(entry) {
  if (entry.type !== "recipe") return `<h2 class="title">${esc(entry.type === "leftovers" ? "Leftovers" : entry.note || "Dinner")}</h2>`;
  const recipe = recipeById(entry.recipeId);
  return `<p class="kicker">Dinner</p>
    ${photo(entry.imageUrl || recipe?.imageUrl)}
    <h2 class="title">${esc(entry.recipeName || "Dinner")}</h2>
    <button class="primary" type="button" data-action="cook" data-id="${esc(entry.recipeId)}">Start cooking</button>`;
}

function weekHtml() {
  const start = mondayOf(nyToday());
  return `<h1>Week</h1>${weekBlock("This week", start)}${weekBlock("Next week", addDays(start, 7))}`;
}

function weekBlock(title, monday) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  return `<h2 class="kicker">${esc(title)}</h2>${days.map(dayRow).join("")}`;
}

function dayRow(date) {
  const today = date === nyToday();
  const plans = ["dinner", "breakfast", "lunch"].map((meal) => mealOn(date, meal)).filter(Boolean);
  return `<button class="day-row${today ? " is-today" : ""}" type="button" data-action="open-day" data-date="${esc(date)}">
    <span><span class="day-date">${esc(today ? "Today" : shortDate(date))}</span>
    ${plans.map((entry) => `<p class="day-plan">${esc(planTitle(entry))}</p>`).join("") || `<p class="day-plan muted">Nothing planned</p>`}</span>
  </button>`;
}

function dayHtml(date) {
  const dinner = mealOn(date, "dinner");
  return `<button class="text-green" type="button" data-action="back">Week</button>
    <h1>${esc(longDate(date))}</h1>
    <section><p class="kicker">Dinner</p>
      ${dinner ? `<p class="title" style="font-size:1.4rem">${esc(planTitle(dinner))}</p><button class="text-green" type="button" data-action="clear-meal" data-id="${esc(dinner.id)}">Remove</button>` : ""}
      ${pickerHtml(date, "dinner")}
    </section>`;
}

function pickerHtml(date, meal) {
  const query = state.dayQuery.trim().toLowerCase();
  const recipes = (query ? state.recipes.filter((recipe) => recipe.name.toLowerCase().includes(query)) : state.recipes).slice(0, 8);
  return `<label class="search">Search recipes
      <input class="field-box day-search" type="search" value="${esc(state.dayQuery)}" placeholder="Chili, pasta…" data-date="${esc(date)}" data-meal="${meal}">
    </label>
    ${recipes.map((recipe) => `<button class="link-row" type="button" data-action="pick-recipe" data-id="${esc(recipe.id)}" data-date="${esc(date)}" data-meal="${meal}">${esc(recipe.name)}</button>`).join("")}
    <button class="gray-btn" type="button" data-action="leftovers" data-date="${esc(date)}" data-meal="${meal}">Leftovers</button>
    <form data-form="day-note" class="stack" style="margin-top:0.8rem">
      <input class="field-box" name="note" maxlength="140" placeholder="Eating out" aria-label="Short note" data-date="${esc(date)}" data-meal="${meal}">
      <button class="gray-btn" type="submit">Save note</button>
    </form>`;
}

function recipesHtml() {
  return `<h1>Recipes</h1>
    <label class="search">Search
      <input id="recipe-search" class="field-box" type="search" value="${esc(state.recipeQuery)}" placeholder="Search recipes" autocomplete="off">
    </label>
    <div class="sort" role="group" aria-label="Sort recipes">
      ${sortButton("favorites", "Favorites")}${sortButton("recent", "Recently made")}${sortButton("az", "A-Z")}
    </div>
    <div id="recipe-list">${recipeList(visibleRecipes())}</div>`;
}

function sortButton(sort, label) {
  const on = state.recipeSort === sort;
  return `<button type="button" data-action="recipe-sort" data-sort="${sort}" aria-pressed="${on ? "true" : "false"}">${label}</button>`;
}

function visibleRecipes() {
  const query = state.recipeQuery.trim().toLowerCase();
  const recipes = query ? state.recipes.filter((recipe) => recipe.name.toLowerCase().includes(query)) : state.recipes.slice();
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (state.recipeSort === "az") return recipes.sort(byName);
  if (state.recipeSort === "recent") {
    return recipes.sort((a, b) => {
      if (a.lastMade && b.lastMade && a.lastMade !== b.lastMade) return a.lastMade < b.lastMade ? 1 : -1;
      if (a.lastMade && !b.lastMade) return -1;
      if (!a.lastMade && b.lastMade) return 1;
      return byName(a, b);
    });
  }
  return recipes.sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || byName(a, b));
}

function recipeList(recipes) {
  if (!recipes.length) return `<p class="empty">${state.recipeQuery ? "Nothing matches that." : "No recipes yet."}</p>`;
  return recipes.map((recipe) => `<div class="recipe-row">
      <button type="button" data-action="open-recipe" data-id="${esc(recipe.id)}" class="recipe-open">
        ${recipe.imageUrl ? `<img class="thumb" src="${esc(safeSrc(recipe.imageUrl))}" alt="">` : `<span class="thumb"></span>`}
        <span class="recipe-copy"><span>${esc(recipe.name)}</span>${lastMadeText(recipe) ? `<span class="small">${esc(lastMadeText(recipe))}</span>` : ""}</span>
      </button>
      <button class="heart${recipe.favorite ? " is-on" : ""}" type="button" data-action="favorite" data-id="${esc(recipe.id)}" aria-label="${recipe.favorite ? "Unfavorite" : "Favorite"}">${heart(recipe.favorite)}</button>
    </div>`).join("");
}

function recipeHtml(id) {
  const recipe = recipeById(id);
  if (!recipe) return `<div class="pad"><button class="text-green" type="button" data-action="back">Recipes</button><p>That recipe isn't here anymore.</p></div>`;
  const servings = state.page.servings || recipe.servings || 4;
  const factor = servings / (recipe.servings || 1);
  const panel = state.page.panel || "ingredients";
  const cooked = Boolean(recipe.cookedToday);
  return `${hero(recipe)}
    <div class="pad">
      <div class="title-row"><h1>${esc(recipe.name)}</h1>
        <button class="heart${recipe.favorite ? " is-on" : ""}" type="button" data-action="favorite" data-id="${esc(recipe.id)}" aria-label="Favorite">${heart(recipe.favorite)}</button>
      </div>
      <p class="meta">${recipe.totalTime ? `${esc(recipe.totalTime)} • ` : ""}<button type="button" data-action="servings-toggle">${servings} ${servings === 1 ? "serving" : "servings"} ▾</button></p>
      ${state.page.servingsOpen ? `<div class="seg"><button type="button" data-action="servings" data-delta="-1">−</button><button type="button" class="is-on">${servings}</button><button type="button" data-action="servings" data-delta="1">+</button></div>` : ""}
      ${lastMadeText(recipe) ? `<p class="small">${esc(lastMadeText(recipe))}</p>` : ""}
      <div class="seg" role="tablist">
        ${panelBtn("cookware", "Cookware", panel)}${panelBtn("ingredients", "Ingredients", panel)}${panelBtn("instructions", "Instructions", panel)}
      </div>
      ${panel === "cookware" ? cookwareHtml(recipe) : ""}
      ${panel === "ingredients" ? ingredientsHtml(recipe, factor) : ""}
      ${panel === "instructions" ? instructionsHtml(recipe, factor) : ""}
    </div>
    <div class="dock">
      ${cooked ? `<div class="cooked-pill">✓ Cooked</div><button class="gray-btn" type="button" data-action="feedback" data-id="${esc(recipe.id)}">Give Feedback</button>` : `<button class="gray-btn" type="button" data-action="mark-cooked" data-id="${esc(recipe.id)}">Cooked?</button><button class="green-btn" type="button" data-action="cook" data-id="${esc(recipe.id)}">Start cooking</button>`}
    </div>`;
}

function hero(recipe) {
  return `<div class="hero">${recipe.imageUrl ? `<img src="${esc(safeSrc(recipe.imageUrl))}" alt="">` : ""}
      <button class="float left" type="button" data-action="back" aria-label="Back">${chevLeft()}</button>
      <button class="float right" type="button" data-action="recipe-menu" aria-label="More">${dots()}</button>
    </div>`;
}

function panelBtn(id, label, panel) {
  return `<button type="button" role="tab" data-action="panel" data-panel="${id}" class="${panel === id ? "is-on" : ""}">${label}</button>`;
}

function cookwareHtml(recipe) {
  const items = recipe.cookware || [];
  if (!items.length) return `<p class="empty">No cookware for this one.</p>`;
  return items.map((item) => `<div class="ing-row"><span>${esc(item)}</span></div>`).join("");
}

function ingredientsHtml(recipe, factor) {
  const items = recipe.ingredients || [];
  if (!items.length) return `<p class="empty">No ingredients yet.</p>`;
  return items.map((item) => `<div class="ing-row"><span>${esc(item.name)}</span><span class="qty">${esc(amountOf(item, factor))}${item.optional ? " optional" : ""}</span></div>`).join("");
}

function instructionsHtml(recipe, factor) {
  const steps = instructionSteps(recipe);
  if (!steps.length) return `<p class="empty">No instructions yet.</p>`;
  return steps.map((step, index) => `<div class="step-block"><p><span class="step-no">${index + 1}</span> ${esc(step.text)}</p>
      ${stepBits(recipe, step, factor)}</div>`).join("") + notesHtml(recipe);
}

function stepBits(recipe, step, factor) {
  const lines = (step.ingredients || []).map((ref) => resolveIngredient(recipe, ref, factor)).filter(Boolean);
  if (!lines.length) return "";
  return `<ul class="step-ings">${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;
}

function notesHtml(recipe) {
  return `${recipe.kidsPlates ? `<p class="note-block"><span class="kicker">Kids' plates</span><br>${esc(recipe.kidsPlates)}</p>` : ""}
    ${recipe.reheating ? `<p class="note-block"><span class="kicker">Reheating</span><br>${esc(recipe.reheating)}</p>` : ""}`;
}

function feedbackHtml(id) {
  const recipe = recipeById(id);
  return `<div class="topbar"><button class="back" type="button" data-action="close-feedback" aria-label="Close">✕</button><h1>Feedback</h1><span></span></div>
    <div class="pad feedback">
      <p class="ask">How was this recipe?</p>
      <div class="stars">${[1, 2, 3, 4, 5].map((star) => `<button type="button" data-action="star" data-star="${star}" class="${star <= state.stars ? "is-on" : ""}" aria-label="${star} stars">★</button>`).join("")}</div>
      <label class="field-label" style="text-align:left">Comments for the chef?
        <textarea class="box" id="feedback-comment" maxlength="1000">${esc(state.comment)}</textarea>
      </label>
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
      <button class="green-btn" type="button" data-action="send-feedback" data-id="${esc(recipe?.id || id)}">Send</button>
    </div>`;
}

function cookHtml() {
  const recipe = recipeById(state.page.id);
  const steps = cookSequence(recipe);
  const index = Math.min(state.page.step || 0, Math.max(0, steps.length - 1));
  const step = steps[index];
  const factor = (state.page.servings || recipe?.servings || 1) / (recipe?.servings || 1);
  if (!recipe || !step) return `<main class="cook"><button class="cook-x" type="button" data-action="close-cook">✕</button><p>There aren't any steps yet.</p></main>`;
  const lines = (step.ingredients || []).map((ref) => resolveIngredient(recipe, ref, factor)).filter(Boolean);
  return `<main class="cook">
      <button class="cook-x" type="button" data-action="close-cook" aria-label="Close">✕</button>
      <p class="step-num">${index + 1}</p>
      <p class="cook-step">${esc(step.text)}</p>
      ${lines.length ? `<ul>${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}
      ${timerHtml(step, index)}
      <div class="cook-dock">
        <div class="cook-actions">
          <button class="list-btn" type="button" data-action="cook-list" aria-label="All steps">${listIcon()}</button>
          <button class="green-btn" type="button" data-action="cook-step" data-delta="1">${index === steps.length - 1 ? "Done" : "Next"}</button>
        </div>
        <div class="dashes">${steps.map((_, i) => `<i class="${i <= index ? "is-on" : ""}"></i>`).join("")}</div>
      </div>
    </main>`;
}

function groceriesHtml() {
  const open = state.items.filter((item) => !item.checked || item.id === state.checking);
  const groups = SECTIONS.map(([id, label]) => ({ id, label, items: open.filter((item) => (item.section || "other") === id) })).filter((group) => group.items.length);
  const loose = open.filter((item) => !SECTIONS.some(([id]) => id === (item.section || "other")));
  if (loose.length) groups.push({ id: "other", label: "Other", items: loose });
  const done = state.items.filter((item) => item.checked && item.id !== state.checking);
  return `<div class="title-row"><h1>Groceries</h1><button type="button" data-action="grocery-menu" aria-label="List options" style="color:var(--green)">${dots()}</button></div>
    ${groups.map((group) => `<h2 class="section-head">${esc(group.label)}</h2>${group.items.map(groceryRow).join("")}`).join("") || `<p class="empty">The list is clear.</p>`}
    ${state.doneOpen && done.length ? `<h2 class="section-head">Completed</h2>${done.map(groceryRow).join("")}` : ""}
    <button class="fab" type="button" data-action="add-item" aria-label="Add">+</button>`;
}

function groceryRow(item) {
  const checking = state.checking === item.id;
  const done = item.checked || checking;
  return `<div class="g-row${done ? " is-done" : ""}" data-id="${esc(item.id)}">
      <button class="check${done ? " is-on" : ""} g-check" type="button" data-action="toggle-item" data-id="${esc(item.id)}" aria-label="${done ? "Put back" : "Mark bought"} ${esc(item.name)}">${done ? checkIcon() : ""}</button>
      <span class="g-name">${esc(item.name)}</span>
      <span class="qty">${esc(qtyOf(item))}</span>
    </div>`;
}

function itemHtml(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return `<div class="pad"><button class="text-green" type="button" data-action="back">Groceries</button><p>That item isn't on the list.</p></div>`;
  const recipes = item.recipes || [];
  return `<div class="topbar"><button class="back" type="button" data-action="back">‹ Groceries</button><span></span>
      <button class="text-btn" type="button" data-action="edit-item" data-id="${esc(item.id)}">Edit</button></div>
    <div class="pad"><h1>${esc(`${qtyOf(item) ? `${qtyOf(item)} ` : ""}${item.name}`)}</h1>
      <p class="subhead">${esc(sectionLabel(item.section))}</p></div>
    ${item.imageUrl ? `<img class="photo-edge" src="${esc(safeSrc(item.imageUrl))}" alt="">` : ""}
    <div class="pad">
      ${item.substitute ? `<h2>Need a substitute?</h2><p>${esc(item.substitute)}</p>` : ""}
      ${item.notes ? `<h2>Notes</h2><p>${esc(item.notes)}</p>` : ""}
      ${recipes.length ? `<h2>You'll use this in...</h2>${recipes.map((recipe) => `<button class="link-row" type="button" data-action="open-recipe" data-id="${esc(recipe.id)}">${recipe.imageUrl ? `<img class="round-thumb" src="${esc(safeSrc(recipe.imageUrl))}" alt="">` : `<span class="round-thumb"></span>`}<span style="flex:1;text-align:left">${esc(recipe.name)}</span><span class="chev">›</span></button>`).join("")}` : ""}
    </div>`;
}

function filteredSuggestions() {
  const query = state.addQuery.trim().toLowerCase();
  return frequentNames().filter((name) => !query || name.toLowerCase().includes(query)).slice(0, 12);
}

function suggestHtml(names) {
  return names.map((name) => `<button class="suggest" type="button" data-action="quick-add" data-name="${esc(name)}">+ ${esc(name)}</button>`).join("");
}

function addHtml() {
  const names = filteredSuggestions();
  return `<div class="topbar"><button class="back" type="button" data-action="back" aria-label="Close">✕</button><h1>Add</h1>
      <button class="text-btn" type="button" data-action="add-done">Done</button></div>
    <div class="pad">
      <input id="add-search" class="search-box" type="search" placeholder="Add something..." value="${esc(state.addQuery)}" autocomplete="off" enterkeyhint="done">
      <div id="suggest-list">${suggestHtml(names)}</div>
    </div>`;
}

function newRecipeHtml() {
  return `<div class="pad"><button class="text-green" type="button" data-action="back">Recipes</button><h1>Add a recipe</h1>
    <form data-form="fetch-recipe" class="stack"><input class="field-box" name="url" type="url" placeholder="Paste a link"><button class="green-btn" type="submit">Fetch recipe</button></form>
    ${state.page.error ? `<p class="error">${esc(state.page.error)}</p>` : ""}</div>`;
}

function sheetHtml() {
  if (state.sheet?.kind === "grocery-menu") {
    return `<div class="sheet"><div class="sheet-card" role="dialog">
        <div class="sheet-head"><span></span><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
        <button class="menu-row" type="button" data-action="toggle-done">${boxIcon()} ${state.doneOpen ? "Hide completed items" : "Show completed items"}</button>
        <button class="menu-row" type="button" data-action="mark-all">${checkOutline()} Mark all complete</button>
        <button class="menu-row" type="button" data-action="share-list">${shareIcon()} Share</button>
      </div></div>`;
  }
  if (state.sheet?.kind === "edit-item") {
    const item = state.items.find((entry) => entry.id === state.sheet.id);
    if (!item) return "";
    return `<div class="sheet"><form class="sheet-card" data-form="item-edit" role="dialog">
        <div class="sheet-head"><button class="text-green" type="button" data-action="close-sheet">Cancel</button><button class="text-green" type="submit">Done</button></div>
        <label class="field-label">Name<input class="field-box" name="name" required maxlength="80" value="${esc(item.name)}"></label>
        <label class="field-label">Quantity<input class="field-box" name="quantityNote" maxlength="140" value="${esc(qtyOf(item))}"></label>
        <label class="field-label">Section<span class="select-wrap"><select class="box" name="section">${SECTIONS.map(([id, label]) => `<option value="${id}" ${(item.section || "other") === id ? "selected" : ""}>${label}</option>`).join("")}</select></span></label>
      </form></div>`;
  }
  if (state.sheet?.kind === "recipe-menu") {
    const recipe = recipeById(state.page?.id);
    return `<div class="sheet"><div class="sheet-card" role="dialog">
        <div class="sheet-head"><span></span><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
        ${recipe?.sourceUrl ? `<a class="menu-row" href="${esc(safeSrc(recipe.sourceUrl))}" target="_blank" rel="noopener noreferrer">Open source</a>` : `<p class="muted">Nothing else on this recipe.</p>`}
      </div></div>`;
  }
  if (state.sheet?.kind === "cook-list") {
    const steps = cookSequence(recipeById(state.page?.id));
    return `<div class="sheet"><div class="sheet-card" role="dialog">
        <div class="sheet-head"><strong>Steps</strong><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
        ${steps.map((step, index) => `<button class="menu-row" type="button" data-action="jump-step" data-step="${index}">${index + 1}. ${esc(step.text)}</button>`).join("")}
      </div></div>`;
  }
  return "";
}

function onPointerDown(event) {
  const row = event.target.closest(".g-row");
  if (!row || event.target.closest(".g-check")) return;
  clearGesture();
  gesture = { id: row.dataset.id, x: event.clientX, y: event.clientY, long: false };
  gesture.timer = setTimeout(() => {
    if (!gesture) return;
    gesture.long = true;
    state.sheet = { kind: "edit-item", id: gesture.id };
    render();
  }, 520);
}

function onPointerUp(event) {
  if (!gesture) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  const id = gesture.id;
  const long = gesture.long;
  clearGesture();
  if (long) return;
  if (dx > 48 && Math.abs(dx) > Math.abs(dy)) {
    openItem(id);
    return;
  }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) openItem(id);
}

function clearGesture() {
  if (gesture?.timer) clearTimeout(gesture.timer);
  gesture = null;
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "toggle-passcode") {
    const input = document.getElementById("passcode");
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "Show" : "Hide";
    input.focus();
    return;
  }
  if (action === "tab") {
    state.tab = button.dataset.tab;
    state.page = null;
    state.sheet = null;
    render();
    return;
  }
  if (action === "back") {
    const kind = state.page?.kind;
    state.sheet = null;
    if (kind === "recipe" && state.recipeBack) {
      state.tab = state.recipeBack.tab;
      state.page = state.recipeBack.page;
    } else if (kind === "item" || kind === "add-item") {
      state.page = null;
      state.tab = "groceries";
    } else if (kind === "day") {
      state.page = null;
      state.tab = "week";
    } else {
      state.page = null;
      if (kind === "recipe" || kind === "new-recipe") state.tab = "recipes";
    }
    render();
    return;
  }
  if (action === "plan-dinner" || action === "open-day") {
    state.tab = "week";
    state.page = { kind: "day", date: button.dataset.date || nyToday() };
    state.dayQuery = "";
    render();
    return;
  }
  if (action === "pick-recipe") return planRecipe(button.dataset.date, button.dataset.meal, button.dataset.id);
  if (action === "leftovers") return savePlanEntry({ date: button.dataset.date, meal: button.dataset.meal, type: "leftovers" });
  if (action === "clear-meal") return removePlan(button.dataset.id);
  if (action === "open-recipe") {
    const recipe = recipeById(button.dataset.id);
    state.recipeBack = state.page?.kind === "item" ? { tab: "groceries", page: state.page } : { tab: "recipes", page: null };
    state.tab = state.recipeBack.tab === "groceries" ? "groceries" : "recipes";
    state.page = { kind: "recipe", id: button.dataset.id, servings: recipe?.servings || 4, panel: "ingredients" };
    state.sheet = null;
    state.stars = 0;
    state.comment = "";
    render();
    return;
  }
  if (action === "recipe-sort") {
    state.recipeSort = button.dataset.sort;
    render();
    return;
  }
  if (action === "favorite") return toggleFavorite(button.dataset.id);
  if (action === "panel") {
    state.page.panel = button.dataset.panel;
    render();
    return;
  }
  if (action === "servings-toggle") {
    state.page.servingsOpen = !state.page.servingsOpen;
    render();
    return;
  }
  if (action === "servings") {
    const recipe = recipeById(state.page?.id);
    state.page.servings = Math.min(99, Math.max(1, (state.page.servings || recipe.servings) + Number(button.dataset.delta)));
    render();
    return;
  }
  if (action === "recipe-menu") {
    state.sheet = { kind: "recipe-menu" };
    render();
    return;
  }
  if (action === "cook") return openCook(button.dataset.id);
  if (action === "cook-step") return moveCook(Number(button.dataset.delta));
  if (action === "close-cook") return closeCook();
  if (action === "cook-list") {
    state.sheet = { kind: "cook-list" };
    render();
    return;
  }
  if (action === "jump-step") {
    state.page.step = Number(button.dataset.step);
    state.sheet = null;
    stopTimer(false);
    render();
    return;
  }
  if (action === "timer-start") return startTimer(Number(button.dataset.minutes));
  if (action === "timer-cancel") return stopTimer(true);
  if (action === "mark-cooked") return markCooked(button.dataset.id);
  if (action === "feedback") {
    state.page = { kind: "feedback", id: button.dataset.id };
    state.error = "";
    render();
    return;
  }
  if (action === "close-feedback") {
    state.page = { kind: "recipe", id: state.page.id, servings: recipeById(state.page.id)?.servings, panel: "ingredients" };
    render();
    return;
  }
  if (action === "star") {
    state.stars = Number(button.dataset.star);
    const comment = document.getElementById("feedback-comment");
    if (comment) state.comment = comment.value;
    render();
    return;
  }
  if (action === "send-feedback") return sendFeedback(button.dataset.id);
  if (action === "toggle-item") return toggleItem(button.dataset.id);
  if (action === "grocery-menu") {
    state.sheet = { kind: "grocery-menu" };
    render();
    return;
  }
  if (action === "close-sheet") {
    state.sheet = null;
    render();
    return;
  }
  if (action === "toggle-done") {
    state.doneOpen = !state.doneOpen;
    state.sheet = null;
    render();
    return;
  }
  if (action === "mark-all") return markAll();
  if (action === "share-list") return shareList();
  if (action === "add-item") {
    state.page = { kind: "add-item" };
    state.addQuery = "";
    state.tab = "groceries";
    render();
    return;
  }
  if (action === "add-done") {
    if (state.addQuery.trim()) await addGrocery(state.addQuery.trim());
    state.page = null;
    state.tab = "groceries";
    render();
    return;
  }
  if (action === "quick-add") return addGrocery(button.dataset.name);
  if (action === "edit-item") {
    state.sheet = { kind: "edit-item", id: button.dataset.id };
    render();
  }
}

async function onSubmit(event) {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  if (form.id === "login-form") {
    const input = document.getElementById("passcode");
    state.passcode = (input && input.value) || state.passcode || "";
    return signIn(state.passcode);
  }
  if (form.dataset.form === "item-edit") return saveItem(new FormData(form));
  if (form.dataset.form === "day-note") {
    const input = form.querySelector("input");
    return savePlanEntry({ date: input.dataset.date, meal: input.dataset.meal, type: "note", note: new FormData(form).get("note") });
  }
  if (form.dataset.form === "fetch-recipe") return fetchRecipe(new FormData(form).get("url"));
}

function onInput(event) {
  if (event.target.id === "passcode") {
    state.passcode = event.target.value;
    return;
  }
  if (event.target.id === "recipe-search") {
    state.recipeQuery = event.target.value;
    const list = document.getElementById("recipe-list");
    if (list) list.innerHTML = recipeList(visibleRecipes());
    return;
  }
  if (event.target.id === "add-search") {
    state.addQuery = event.target.value;
    const list = document.getElementById("suggest-list");
    if (list) list.innerHTML = suggestHtml(filteredSuggestions());
    return;
  }
  if (event.target.id === "feedback-comment") state.comment = event.target.value;
  if (event.target.classList?.contains("day-search")) {
    state.dayQuery = event.target.value;
    render();
    const field = document.querySelector(".day-search");
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }
}

async function signIn(passcode) {
  const value = String(passcode || "").trim();
  if (!value) {
    state.loginError = "Wrong passcode";
    render();
    return;
  }
  state.loginError = "";
  try {
    await api("/api/login", { method: "POST", body: { passcode: value } });
    state.authed = true;
    state.loading = true;
    state.passcode = "";
    render();
    await refresh(true);
    state.loading = false;
    render();
  } catch {
    state.loginError = "Wrong passcode";
    render();
  }
}

async function savePlanEntry(body) {
  try {
    await api("/api/plan", { method: "POST", body });
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function planRecipe(date, meal, recipeId) {
  await savePlanEntry({ date, meal, type: "recipe", recipeId });
}

async function removePlan(id) {
  await api(`/api/plan/${id}`, { method: "DELETE" });
  await refresh(true);
}

async function toggleFavorite(id) {
  const recipe = recipeById(id);
  if (!recipe) return;
  recipe.favorite = !recipe.favorite;
  render();
  try {
    const data = await api(`/api/recipes/${id}`, { method: "PATCH", body: { favorite: recipe.favorite } });
    const index = state.recipes.findIndex((entry) => entry.id === id);
    if (index >= 0) state.recipes[index] = data.recipe;
    render();
  } catch (error) {
    state.error = error.message;
    await refresh(true);
  }
}

function openCook(id) {
  const recipe = recipeById(id);
  if (!cookSequence(recipe).length) return;
  stopTimer(false);
  state.cookReturn = { page: state.page ? { ...state.page } : null };
  state.page = { kind: "cook", id, step: 0, servings: state.page?.servings || recipe.servings };
  lockScreen();
  render();
}

function moveCook(delta) {
  const steps = cookSequence(recipeById(state.page.id));
  const next = (state.page.step || 0) + delta;
  if (next >= steps.length || next < 0) return closeCook();
  stopTimer(false);
  state.page.step = next;
  render();
}

function closeCook() {
  const back = state.cookReturn;
  stopTimer(false);
  unlockScreen();
  state.page = back?.page || null;
  state.sheet = null;
  render();
}

async function markCooked(id) {
  try {
    const data = await api(`/api/recipes/${id}/cooked`, { method: "POST", body: {} });
    replaceRecipe(data.recipe);
    render();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function sendFeedback(id) {
  const commentBox = document.getElementById("feedback-comment");
  if (commentBox) state.comment = commentBox.value;
  if (!state.stars) {
    state.error = "Tap a star first.";
    render();
    return;
  }
  try {
    const data = await api(`/api/recipes/${id}/feedback`, { method: "POST", body: { stars: state.stars, comment: state.comment } });
    replaceRecipe(data.recipe);
    state.page = { kind: "recipe", id, servings: data.recipe.servings, panel: "ingredients" };
    state.error = "";
    render();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function toggleItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (!item.checked) {
    state.checking = id;
    render();
    await wait(700);
    const row = document.querySelector(`.g-row[data-id="${cssEscape(id)}"]`);
    row?.classList.add("is-leaving");
    await wait(220);
  }
  try {
    await api(`/api/items/${id}`, { method: "PATCH", body: { checked: !item.checked } });
    state.checking = null;
    await refresh(true);
  } catch (error) {
    state.checking = null;
    state.error = error.message;
    render();
  }
}

async function markAll() {
  const open = state.items.filter((item) => !item.checked);
  state.sheet = null;
  for (const item of open) {
    await api(`/api/items/${item.id}`, { method: "PATCH", body: { checked: true } });
  }
  await refresh(true);
}

async function shareList() {
  const lines = state.items.filter((item) => !item.checked).map((item) => `${item.name}${qtyOf(item) ? ` — ${qtyOf(item)}` : ""}`);
  const text = lines.length ? `Groceries\n${lines.join("\n")}` : "The grocery list is clear.";
  state.sheet = null;
  render();
  try {
    if (navigator.share) await navigator.share({ title: "Groceries", text });
    else if (navigator.clipboard) await navigator.clipboard.writeText(text);
  } catch {
    /* The share sheet was dismissed. */
  }
}

async function addGrocery(name) {
  const clean = String(name || "").trim();
  if (!clean) return;
  state.addQuery = "";
  try {
    await api("/api/items", { method: "POST", body: { name: clean, store: "local", category: "shelf", section: "other" } });
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function saveItem(form) {
  const id = state.sheet?.id;
  if (!id) return;
  const section = String(form.get("section") || "other");
  const category = section === "produce" ? "produce" : section === "frozen" ? "frozen" : section === "meat" || section === "dairy" ? "refrigerated" : "shelf";
  try {
    await api(`/api/items/${id}`, {
      method: "PATCH",
      body: { name: String(form.get("name") || ""), quantityNote: String(form.get("quantityNote") || "") || null, section, category, store: "local" },
    });
    state.sheet = null;
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function fetchRecipe(url) {
  try {
    const data = await api("/api/recipes/import", { method: "POST", body: { url } });
    state.recipes.unshift(data.recipe);
    state.page = { kind: "recipe", id: data.recipe.id, servings: data.recipe.servings, panel: "ingredients" };
    render();
  } catch (error) {
    state.page.error = error.message;
    render();
  }
}

function openItem(id) {
  state.page = { kind: "item", id };
  state.tab = "groceries";
  render();
}

function replaceRecipe(recipe) {
  const index = state.recipes.findIndex((entry) => entry.id === recipe.id);
  if (index >= 0) state.recipes[index] = recipe;
  else state.recipes.unshift(recipe);
}

function recipeById(id) {
  return state.recipes.find((recipe) => recipe.id === id);
}

function instructionSteps(recipe) {
  if (!recipe) return [];
  const night = (recipe.nightBefore || []).map((text) => ({ text, ingredients: [] }));
  const prep = (recipe.prepSteps || []).map((text) => ({ text, ingredients: [] }));
  const cook = (recipe.cookSteps || []).filter((step) => step && step.text);
  if (night.length || prep.length || cook.length) return [...night, ...prep, ...cook];
  return (recipe.steps || []).filter(Boolean).map((text) => ({ text, ingredients: [] }));
}

function cookSequence(recipe) {
  if (!recipe) return [];
  const prep = (recipe.prepSteps || []).filter(Boolean).map((text) => ({ text, minutes: null, ingredients: [] }));
  const cook = (recipe.cookSteps || []).filter((step) => step && step.text).map((step) => ({ text: step.text, minutes: step.minutes || null, ingredients: step.ingredients || [] }));
  if (prep.length || cook.length) return [...prep, ...cook];
  return (recipe.steps || []).filter(Boolean).map((text) => ({ text, minutes: null, ingredients: [] }));
}

function resolveIngredient(recipe, ref, factor) {
  const item = typeof ref === "number" ? recipe.ingredients?.[ref] : (recipe.ingredients || []).find((entry) => entry.name?.toLowerCase() === String(ref).toLowerCase() || entry.text === ref);
  if (!item) return typeof ref === "string" ? ref : "";
  return scaledLine(item, factor);
}

function amountOf(item, factor) {
  const qty = item.qty ?? item.quantity;
  if (qty == null) return "";
  return `${formatQty(qty * factor)}${item.unit ? ` ${unitWord(item.unit, qty * factor)}` : ""}`.trim();
}

function scaledLine(item, factor) {
  const amount = amountOf(item, factor);
  return `${amount ? `${amount} ` : ""}${item.name || item.text || ""}`.trim();
}

function qtyOf(item) {
  const note = item.quantityNote || "";
  const split = note.split(" · ")[0];
  return split.trim();
}

function sectionLabel(id) {
  return SECTIONS.find(([key]) => key === (id || "other"))?.[1] || "Other";
}

function frequentNames() {
  const counts = new Map();
  for (const item of state.items) {
    const key = item.name.trim();
    counts.set(key, (counts.get(key) || 0) + (item.checked ? 2 : 1));
  }
  const open = new Set(state.items.filter((item) => !item.checked).map((item) => item.name.toLowerCase()));
  return [...counts.entries()].filter(([name]) => !open.has(name.toLowerCase())).sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

function lastMadeText(recipe) {
  if (!recipe?.lastMade) return "";
  return `Last made ${madeDate(recipe.lastMade)}`;
}

function madeDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = `${months[month - 1]} ${day}`;
  return String(year) === nyToday().slice(0, 4) ? label : `${label}, ${year}`;
}

function formatQty(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round(value * 1000) / 1000;
  const whole = Math.floor(rounded + 1e-8);
  const fraction = rounded - whole;
  const fractions = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 8], [3, 8]];
  if (fraction < 0.02) return String(whole);
  for (const [numerator, denominator] of fractions) {
    if (Math.abs(fraction - numerator / denominator) < 0.03) return whole ? `${whole} ${numerator}/${denominator}` : `${numerator}/${denominator}`;
  }
  return String(Math.round(rounded * 100) / 100);
}

function unitWord(unit, qty) {
  const plural = { clove: "cloves", cup: "cups", can: "cans", bunch: "bunches", box: "boxes", slice: "slices", piece: "pieces" };
  return qty > 1 && plural[unit] ? plural[unit] : unit;
}

function mealOn(date, meal) {
  return state.plan.find((entry) => entry.date === date && entry.meal === meal);
}
function eventsOn(date) {
  return state.events.filter((event) => event.date === date);
}
function planTitle(entry) {
  if (entry.type === "leftovers") return entry.note ? `Leftovers · ${entry.note}` : "Leftovers";
  if (entry.type === "note") return entry.note || "Note";
  return entry.recipeName || "Recipe";
}
function nyToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(iso, count) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function mondayOf(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}
function visibleRange() {
  const start = mondayOf(nyToday());
  return { from: addDays(start, -14), to: addDays(start, 13) };
}
function formatUtc(iso, options) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(new Date(Date.UTC(year, month - 1, day)));
}
function longDate(iso) {
  return formatUtc(iso, { weekday: "long", month: "long", day: "numeric" });
}
function shortDate(iso) {
  return formatUtc(iso, { weekday: "short", day: "numeric" });
}
function photo(url) {
  return url ? `<img src="${esc(safeSrc(url))}" alt="" style="width:100%;border-radius:16px;max-height:220px;object-fit:cover">` : "";
}
function timerHtml(step, index) {
  if (!step.minutes) return "";
  const timer = state.timer;
  if (timer && timer.step === index && timer.done) return `<p class="timer">Time's up</p>`;
  if (timer && timer.step === index) return `<p class="timer">${formatClock(timer.remaining)}</p><button class="gray-btn" type="button" data-action="timer-cancel">Cancel timer</button>`;
  return `<button class="gray-btn" type="button" data-action="timer-start" data-minutes="${step.minutes}">Start ${step.minutes} min timer</button>`;
}
function formatClock(totalSeconds) {
  const seconds = Math.max(0, totalSeconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function startTimer(minutes) {
  stopTimer(false);
  const step = state.page?.step || 0;
  state.timer = { step, remaining: minutes * 60, endsAt: Date.now() + minutes * 60 * 1000, done: false };
  state.timerHandle = setInterval(() => {
    if (!state.timer) return;
    state.timer.remaining = Math.max(0, Math.round((state.timer.endsAt - Date.now()) / 1000));
    if (state.timer.remaining <= 0) {
      state.timer.done = true;
      clearInterval(state.timerHandle);
      render();
      return;
    }
    const node = document.querySelector(".timer");
    if (node) node.textContent = formatClock(state.timer.remaining);
  }, 250);
  render();
}
function stopTimer(shouldRender) {
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = null;
  state.timer = null;
  if (shouldRender) render();
}
async function lockScreen() {
  try { await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
}
function unlockScreen() {}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function cssEscape(value) { return window.CSS?.escape ? CSS.escape(value) : value.replace(/"/g, ""); }
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function safeSrc(value) {
  const text = String(value || "");
  if (text.startsWith("/") || text.startsWith("https://")) return text;
  return "";
}
function heart(on) {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"/></svg>`;
}
function chevLeft() { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#222" stroke-width="2.4"><path d="M15 5 8 12l7 7"/></svg>`; }
function dots() { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>`; }
function checkIcon() { return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>`; }
function listIcon() { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#444" stroke-width="2"><path d="M8 7h11M8 12h11M8 17h11M4 7h.01M4 12h.01M4 17h.01"/></svg>`; }
function sun() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg>`; }
function cal() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>`; }
function book() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z"/><path d="M5 4v16"/></svg>`; }
function cart() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h2l2 11h10l2-7H8"/><circle cx="9" cy="19" r="1.2"/><circle cx="17" cy="19" r="1.2"/></svg>`; }
function boxIcon() { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#444" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`; }
function checkOutline() { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#444" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/></svg>`; }
function shareIcon() { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#444" stroke-width="1.8"><circle cx="6" cy="12" r="2"/><circle cx="17" cy="7" r="2"/><circle cx="17" cy="17" r="2"/><path d="m8 11 7-3M8 13l7 3"/></svg>`; }
