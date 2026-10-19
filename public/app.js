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
  groceryDraft: "",
  doneOpen: false,
  offer: null,
  notice: "",
  error: "",
  loginError: "",
  showMeals: {},
};

const PLURAL = {
  cup: "cups",
  clove: "cloves",
  can: "cans",
  package: "packages",
  bunch: "bunches",
  slice: "slices",
  piece: "pieces",
  stalk: "stalks",
  head: "heads",
  bag: "bags",
  jar: "jars",
  box: "boxes",
};

const app = document.getElementById("app");
app.addEventListener("click", onClick);
app.addEventListener("submit", onSubmit);
app.addEventListener("input", onInput);
app.addEventListener("error", onAssetError, true);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.page?.kind === "cook") lockScreen();
});

boot();
setInterval(() => refresh(false), 5000);

async function boot() {
  const me = await fetch("/api/items");
  state.authed = me.status !== 401;
  if (state.authed) await refresh(true);
  state.loading = false;
  render();
}

async function refresh(force) {
  if (!state.authed) return;
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
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"));
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
    app.innerHTML = loginHtml();
    return;
  }
  if (state.loading) {
    app.innerHTML = `<main class="screen"><p class="muted">Loading…</p></main>`;
    return;
  }
  if (state.page?.kind === "cook") {
    app.innerHTML = cookHtml();
    return;
  }
  app.innerHTML = `<main class="screen">${bodyHtml()}</main>${tabsHtml()}${sheetHtml()}`;
}

function loginHtml() {
  return `<main class="login">
    <h1>Food</h1>
    <p>Dinners, the week, and the grocery list for Mark and Emma.</p>
    <form id="login-form" class="stack">
      <label class="field">Passcode
        <input id="passcode" type="password" autocomplete="current-password" required>
      </label>
      ${state.loginError ? `<p class="error" role="alert">${esc(state.loginError)}</p>` : ""}
      <button class="primary" type="submit">Open</button>
    </form>
  </main>`;
}

function bodyHtml() {
  if (state.page?.kind === "day") return dayHtml(state.page.date);
  if (state.page?.kind === "recipe") return recipeHtml(state.page.id);
  if (state.page?.kind === "new-recipe") return newRecipeHtml();
  if (state.tab === "week") return weekHtml();
  if (state.tab === "recipes") return recipesHtml();
  if (state.tab === "groceries") return groceriesHtml();
  return todayHtml();
}

function todayHtml() {
  const today = nyToday();
  const dinner = mealOn(today, "dinner");
  const others = ["breakfast", "lunch"].map((meal) => mealOn(today, meal)).filter(Boolean);
  const events = eventsOn(today);
  return `<p class="kicker">Today</p>
    <h1>${esc(longDate(today))}</h1>
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}
    ${dinner ? dinnerCard(dinner) : emptyDinner()}
    ${others.map(otherMeal).join("")}
    ${events.length ? `<h2 class="kicker">On the calendar</h2><ul class="events">${events.map(eventItem).join("")}</ul>` : ""}`;
}

function dinnerCard(entry) {
  if (entry.type === "recipe") {
    const recipe = recipeById(entry.recipeId);
    return `<section class="meal-block">
      <p class="kicker">Dinner</p>
      ${photoBlock(entry.imageUrl || recipe?.imageUrl, entry.recipeName || "Dinner")}
      <h2 class="hero-title">${esc(entry.recipeName || "Dinner")}</h2>
      ${recipe?.totalTime ? `<p class="small">${esc(recipe.totalTime)}</p>` : ""}
      <button class="primary" type="button" data-action="cook" data-id="${esc(entry.recipeId)}">Start cooking</button>
    </section>`;
  }
  const title = entry.type === "leftovers" ? "Leftovers" : entry.note || "Dinner";
  return `<section class="meal-block">
    <p class="kicker">Dinner</p>
    <h2 class="hero-title">${esc(title)}</h2>
  </section>`;
}

function emptyDinner() {
  return `<section class="meal-block">
    <p class="kicker">Dinner</p>
    <p>Nothing planned tonight.</p>
    <button class="primary" type="button" data-action="plan-dinner">Plan dinner</button>
  </section>`;
}

function otherMeal(entry) {
  return `<button class="meal-row" type="button" data-action="open-day" data-date="${esc(entry.date)}">
    <span class="day-main">
      <span class="day-date">${esc(mealLabel(entry.meal))}</span>
      <p class="day-plan">${esc(planTitle(entry))}</p>
    </span>
  </button>`;
}

function weekHtml() {
  const today = nyToday();
  const start = mondayOf(today);
  return `<h1>Week</h1>
    ${state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : ""}
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}
    ${weekBlock("This week", start)}
    ${weekBlock("Next week", addDays(start, 7))}`;
}

function weekBlock(title, monday) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  return `<div class="week-head"><h2>${esc(title)}</h2></div>
    ${days.map((date) => dayRow(date)).join("")}`;
}

function dayRow(date) {
  const today = date === nyToday();
  const plans = ["dinner", "breakfast", "lunch"].map((meal) => mealOn(date, meal)).filter(Boolean);
  const events = eventsOn(date);
  return `<button class="day-row${today ? " is-today" : ""}" type="button" data-action="open-day" data-date="${esc(date)}">
    <span class="day-main">
      <span class="day-date">${esc(today ? "Today" : shortDate(date))}</span>
      ${plans.map((entry) => `<p class="day-plan">${esc(plans.length > 1 ? `${mealLabel(entry.meal)} · ${planTitle(entry)}` : planTitle(entry))}</p>`).join("")}
      ${events.length ? `<ul class="events">${events.map(eventItem).join("")}</ul>` : ""}
    </span>
  </button>`;
}

function dayHtml(date) {
  const dinner = mealOn(date, "dinner");
  const extras = ["breakfast", "lunch"].filter((meal) => mealOn(date, meal) || state.showMeals[`${date}:${meal}`]);
  return `<button class="back" type="button" data-action="back">Week</button>
    <h1>${esc(longDate(date))}</h1>
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}
    ${mealEditor(date, "dinner", dinner)}
    ${extras.map((meal) => mealEditor(date, meal, mealOn(date, meal))).join("")}
    ${["breakfast", "lunch"].filter((meal) => !extras.includes(meal)).map((meal) => `<button class="quiet" type="button" data-action="show-meal" data-date="${esc(date)}" data-meal="${meal}">+ Add ${meal}</button>`).join("")}
    ${eventsOn(date).length ? `<h2 class="kicker">On the calendar</h2><ul class="events">${eventsOn(date).map(eventItem).join("")}</ul>` : ""}`;
}

function mealEditor(date, meal, entry) {
  const editing = (state.page?.meal || "dinner") === meal;
  return `<section class="meal-block">
    <p class="kicker">${esc(mealLabel(meal))}</p>
    ${entry ? `<p class="hero-title">${esc(planTitle(entry))}</p><button class="quiet" type="button" data-action="clear-meal" data-id="${esc(entry.id)}">Remove</button>` : ""}
    ${editing ? pickerHtml(date, meal) : `<button class="quiet" type="button" data-action="show-meal" data-date="${esc(date)}" data-meal="${meal}">Change</button>`}
  </section>`;
}

function pickerHtml(date, meal) {
  const query = state.dayQuery.trim().toLowerCase();
  const recipes = (query ? state.recipes.filter((recipe) => recipe.name.toLowerCase().includes(query)) : state.recipes).slice(0, 8);
  return `<label class="search">Search recipes
      <input class="day-search" type="search" value="${esc(state.dayQuery)}" placeholder="Chili, pasta…" autocomplete="off" data-date="${esc(date)}" data-meal="${meal}">
    </label>
    <div class="day-results"><ul class="results">${recipes.map((recipe) => `<li><button type="button" data-action="pick-recipe" data-id="${esc(recipe.id)}" data-date="${esc(date)}" data-meal="${meal}">${esc(recipe.name)}</button></li>`).join("") || `<li class="small">No matching recipes.</li>`}</ul></div>
    <button class="secondary" type="button" data-action="leftovers" data-date="${esc(date)}" data-meal="${meal}">Leftovers</button>
    <form data-form="day-note" class="add-row">
      <input name="note" type="text" maxlength="140" placeholder="Eating out" aria-label="Short note" data-date="${esc(date)}" data-meal="${meal}">
      <button class="secondary" type="submit">Save note</button>
    </form>`;
}

function recipesHtml() {
  return `<h1>Recipes</h1>
    <label class="search">Search
      <input id="recipe-search" type="search" value="${esc(state.recipeQuery)}" placeholder="Search recipes" autocomplete="off">
    </label>
    <div class="sort" role="group" aria-label="Sort recipes">
      ${sortButton("favorites", "Favorites")}
      ${sortButton("recent", "Recently made")}
      ${sortButton("az", "A-Z")}
    </div>
    <button class="secondary" type="button" data-action="add-recipe">Add a recipe</button>
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
  if (!recipes.length) {
    return `<p class="empty">${state.recipeQuery ? "Nothing matches that." : "No recipes yet. Add one from a link, or type it in."}</p>`;
  }
  return recipes.map((recipe) => `<div class="recipe-row">
      <button type="button" data-action="open-recipe" data-id="${esc(recipe.id)}" class="recipe-open">
        ${recipe.imageUrl ? `<img class="thumb" src="${esc(safeSrc(recipe.imageUrl))}" alt="">` : `<span class="thumb placeholder"></span>`}
        <span class="recipe-copy">
          <span>${esc(recipe.name)}</span>
          ${lastMadeText(recipe) ? `<span class="small">${esc(lastMadeText(recipe))}</span>` : ""}
        </span>
      </button>
      <button class="star${recipe.favorite ? " is-on" : ""}" type="button" data-action="favorite" data-id="${esc(recipe.id)}" aria-label="${recipe.favorite ? "Unfavorite" : "Favorite"}" aria-pressed="${recipe.favorite ? "true" : "false"}">★</button>
    </div>`).join("");
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

function recipeHtml(id) {
  const recipe = recipeById(id);
  if (!recipe) return `<button class="back" type="button" data-action="back">Recipes</button><p>That recipe isn't here anymore.</p>`;
  const servings = state.page.servings || recipe.servings;
  const factor = servings / (recipe.servings || 1);
  const host = hostOf(recipe.sourceUrl);
  return `<button class="back" type="button" data-action="back">Recipes</button>
    ${photoBlock(recipe.imageUrl, recipe.name)}
    <h1>${esc(recipe.name)}</h1>
    <p class="small">${[recipe.totalTime, host ? `From ${host}` : ""].filter(Boolean).map(esc).join(" · ") || ""}</p>
    ${lastMadeText(recipe) ? `<p class="small">${esc(lastMadeText(recipe))}</p>` : ""}
    ${recipe.sourceUrl ? `<p><a href="${esc(safeSrc(recipe.sourceUrl))}" target="_blank" rel="noopener noreferrer">Source</a></p>` : ""}
    <div class="stepper" aria-label="Servings">
      <button type="button" data-action="servings" data-delta="-1" aria-label="Fewer servings">−</button>
      <strong>${servings}</strong>
      <button type="button" data-action="servings" data-delta="1" aria-label="More servings">+</button>
    </div>
    ${recipe.coversNights ? `<p class="small">Covers ${recipe.coversNights} ${recipe.coversNights === 1 ? "night" : "nights"}</p>` : ""}
    ${stepList("Night before", recipe.nightBefore)}
    <h2 class="kicker">Ingredients</h2>
    <ul class="ingredients">${recipe.ingredients.map((ingredient) => `<li>${esc(scaledLine(ingredient, factor))}</li>`).join("") || `<li class="small">No ingredients yet.</li>`}</ul>
    <button class="primary" type="button" data-action="add-recipe-groceries" data-id="${esc(recipe.id)}" data-servings="${servings}">Add ingredients to groceries</button>
    ${state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : ""}
    ${stepList("Prep", recipe.prepSteps)}
    ${cookStepList(recipe.cookSteps)}
    ${!(recipe.prepSteps || []).length && !(recipe.cookSteps || []).length ? `${stepList("Steps", recipe.steps)}` : ""}
    ${noteBlock("Kids' plates", recipe.kidsPlates)}
    ${noteBlock("Reheating", recipe.reheating)}
    ${cookSequence(recipe).length ? `<button class="secondary" type="button" data-action="cook" data-id="${esc(recipe.id)}">Cook</button>` : ""}`;
}

function newRecipeHtml() {
  const draft = state.page.draft || {};
  return `<button class="back" type="button" data-action="back">Recipes</button>
    <h1>Add a recipe</h1>
    <form data-form="fetch-recipe" class="stack">
      <label class="field">Paste a link
        <input name="url" type="url" inputmode="url" placeholder="https://" value="${esc(draft.url || "")}">
      </label>
      <button class="primary" type="submit">Fetch recipe</button>
    </form>
    ${state.page.error ? `<p class="error" role="alert">${esc(state.page.error)}</p>` : ""}
    <h2>Or type it in</h2>
    <form data-form="recipe-form" class="stack">
      <label class="field">Name
        <input name="name" required maxlength="120" value="${esc(draft.name || "")}">
      </label>
      <label class="field">Ingredients, one per line
        <textarea name="ingredients">${esc(draft.ingredients || "")}</textarea>
      </label>
      <label class="field">Steps, one per line
        <textarea name="steps">${esc(draft.steps || "")}</textarea>
      </label>
      <label class="field">Source link
        <input name="sourceUrl" type="url" value="${esc(draft.sourceUrl || draft.url || "")}">
      </label>
      <button class="primary" type="submit">Save recipe</button>
    </form>`;
}

function cookHtml() {
  const recipe = recipeById(state.page.id);
  const steps = cookSequence(recipe);
  const index = Math.min(state.page.step || 0, Math.max(0, steps.length - 1));
  const step = steps[index];
  if (!recipe || !step) {
    return `<main class="cook"><button class="back" type="button" data-action="close-cook">Close</button><p>There aren't any steps yet.</p></main>`;
  }
  return `<main class="cook">
    <button class="back" type="button" data-action="close-cook">Close</button>
    <p class="kicker">${esc(step.phase)} · Step ${index + 1} of ${steps.length}</p>
    <p class="cook-step">${esc(step.text)}</p>
    ${timerHtml(step, index)}
    <div class="cook-nav">
      <button class="secondary" type="button" data-action="cook-step" data-delta="-1" ${index === 0 ? "disabled" : ""}>Back</button>
      <button class="primary" type="button" data-action="cook-step" data-delta="1">${index === steps.length - 1 ? "Done" : "Next"}</button>
    </div>
  </main>`;
}

function stepList(title, lines) {
  const items = (lines || []).filter(Boolean);
  if (!items.length) return "";
  return `<h2 class="kicker">${esc(title)}</h2><ol class="steps">${items.map((line) => `<li>${esc(line)}</li>`).join("")}</ol>`;
}

function cookStepList(steps) {
  const items = steps || [];
  if (!items.length) return "";
  return `<h2 class="kicker">Cook</h2><ol class="steps">${items.map((step) => `<li>${esc(step.text)}${step.minutes ? ` <span class="small">${step.minutes} min</span>` : ""}</li>`).join("")}</ol>`;
}

function noteBlock(title, text) {
  if (!text) return "";
  return `<p class="note-block"><span class="kicker">${esc(title)}</span> ${esc(text)}</p>`;
}

function cookSequence(recipe) {
  if (!recipe) return [];
  const prep = (recipe.prepSteps || []).filter(Boolean).map((text) => ({ phase: "Prep", text, minutes: null }));
  const cook = (recipe.cookSteps || []).filter((step) => step && step.text).map((step) => ({ phase: "Cook", text: step.text, minutes: step.minutes || null }));
  if (prep.length || cook.length) return [...prep, ...cook];
  return (recipe.steps || []).filter(Boolean).map((text) => ({ phase: "Cook", text, minutes: null }));
}

function timerHtml(step, index) {
  if (!step.minutes) return "";
  const timer = state.timer;
  if (timer && timer.step === index && timer.done) return `<p class="timer" role="status">Time's up</p>`;
  if (timer && timer.step === index) {
    return `<p class="timer" role="timer">${formatClock(timer.remaining)}</p>
      <button class="secondary" type="button" data-action="timer-cancel">Cancel timer</button>`;
  }
  return `<button class="secondary" type="button" data-action="timer-start" data-minutes="${step.minutes}">Start ${step.minutes} min timer</button>`;
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function groceriesHtml() {
  const open = state.items.filter((item) => !item.checked);
  const done = state.items.filter((item) => item.checked);
  return `<h1>Groceries</h1>
    <div class="checklist">
    ${state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : ""}
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}
    <form data-form="grocery-add" class="add-row">
      <input id="grocery-name" name="name" type="text" maxlength="80" placeholder="Add something" value="${esc(state.groceryDraft)}" aria-label="Add something" autocomplete="off">
      <button class="secondary" type="submit">Add</button>
    </form>
    ${open.length ? open.map(itemRow).join("") : `<p class="empty">The list is clear.</p>`}
    ${done.length ? `<div class="done-head">
      <button type="button" data-action="toggle-done">${state.doneOpen ? "Hide" : "Done"} ${done.length}</button>
      <button class="quiet" type="button" data-action="ask-clear">Clear</button>
    </div>
    ${state.doneOpen ? `<div class="done-list">${done.map(itemRow).join("")}</div>` : ""}` : ""}
    </div>`;
}

function itemRow(item) {
  return `<div class="item-row">
    <button class="check${item.checked ? " is-on" : ""}" type="button" data-action="toggle-item" data-id="${esc(item.id)}" aria-pressed="${item.checked ? "true" : "false"}" aria-label="${item.checked ? "Put back" : "Mark bought"} ${esc(item.name)}">${item.checked ? checkIcon() : ""}</button>
    <button class="item-main" type="button" data-action="open-item" data-id="${esc(item.id)}">
      <p class="item-name">${esc(item.name)}</p>
      ${item.quantityNote ? `<p class="small">${esc(item.quantityNote)}</p>` : ""}
    </button>
  </div>`;
}

function sheetHtml() {
  if (state.sheet?.kind === "clear") {
    return `<div class="sheet"><div class="sheet-card" role="dialog" aria-modal="true">
      <h2>Clear bought items?</h2>
      <div class="stack">
        <button class="primary" type="button" data-action="confirm-clear">Clear</button>
        <button class="secondary" type="button" data-action="close-sheet">Cancel</button>
      </div>
    </div></div>`;
  }
  if (state.sheet?.kind !== "item") return "";
  const item = state.items.find((entry) => entry.id === state.sheet.id);
  if (!item) return "";
  return `<div class="sheet"><form class="sheet-card" data-form="item-edit" role="dialog" aria-modal="true">
      <h2>Edit</h2>
      <label class="field">Name
        <input name="name" required maxlength="80" value="${esc(item.name)}">
      </label>
      <label class="field">Note
        <input name="quantityNote" maxlength="140" value="${esc(item.quantityNote || "")}">
      </label>
      ${state.sheet.error ? `<p class="error" role="alert">${esc(state.sheet.error)}</p>` : ""}
      ${state.sheet.confirm ? `<p>Delete this item?</p><button class="danger" type="button" data-action="confirm-delete" data-id="${esc(item.id)}">Delete</button>` : `<button class="danger" type="button" data-action="ask-delete">Delete</button>`}
      <div class="stack">
        <button class="primary" type="submit">Save</button>
        <button class="secondary" type="button" data-action="close-sheet">Cancel</button>
      </div>
    </form></div>`;
}

function tabsHtml() {
  const tabs = [
    ["today", "Today", sunIcon()],
    ["week", "Week", calendarIcon()],
    ["recipes", "Recipes", bookIcon()],
    ["groceries", "Groceries", bagIcon()],
  ];
  const active = state.page?.kind === "day" ? "week" : state.page?.kind === "recipe" || state.page?.kind === "new-recipe" ? "recipes" : state.tab;
  return `<nav class="tabs">${tabs.map(([id, label, icon]) => `<button class="tab${active === id ? " is-on" : ""}" type="button" data-action="tab" data-tab="${id}">${icon}${label}</button>`).join("")}</nav>`;
}

function photoBlock(url, name) {
  if (!url) return `<div class="photo is-missing" role="img" aria-label="${esc(name)}"></div>`;
  return `<div class="photo"><img src="${esc(safeSrc(url))}" alt="${esc(name)}"></div>`;
}

function eventItem(event) {
  const time = prettyTime(event.time);
  return `<li>${esc(time ? `${time} ${event.title}` : event.title)}</li>`;
}

async function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "tab") {
    state.tab = button.dataset.tab;
    state.page = null;
    state.offer = null;
    state.notice = "";
    state.error = "";
    render();
    return;
  }
  if (action === "back") {
    state.page = null;
    state.offer = null;
    state.notice = "";
    render();
    return;
  }
  if (action === "plan-dinner") {
    state.tab = "week";
    state.page = { kind: "day", date: nyToday(), meal: "dinner" };
    render();
    return;
  }
  if (action === "open-day") {
    state.tab = "week";
    state.page = { kind: "day", date: button.dataset.date, meal: "dinner" };
    state.dayQuery = "";
    state.offer = null;
    render();
    return;
  }
  if (action === "show-meal") {
    state.showMeals[`${button.dataset.date}:${button.dataset.meal}`] = true;
    state.page = { ...state.page, meal: button.dataset.meal };
    render();
    return;
  }
  if (action === "pick-recipe") return planRecipe(button.dataset.date, button.dataset.meal, button.dataset.id);
  if (action === "leftovers") return savePlanEntry({ date: button.dataset.date, meal: button.dataset.meal, type: "leftovers" });
  if (action === "clear-meal") return removePlan(button.dataset.id);
  if (action === "open-recipe") {
    const recipe = recipeById(button.dataset.id);
    state.tab = "recipes";
    state.page = { kind: "recipe", id: button.dataset.id, servings: recipe?.servings || 4 };
    state.notice = "";
    render();
    return;
  }
  if (action === "add-recipe") {
    state.tab = "recipes";
    state.page = { kind: "new-recipe", draft: {}, error: "" };
    render();
    return;
  }
  if (action === "favorite") return toggleFavorite(button.dataset.id);
  if (action === "recipe-sort") {
    state.recipeSort = button.dataset.sort;
    render();
    return;
  }
  if (action === "servings") {
    const recipe = recipeById(state.page?.id);
    const next = Math.min(99, Math.max(1, (state.page.servings || recipe.servings) + Number(button.dataset.delta)));
    state.page.servings = next;
    render();
    return;
  }
  if (action === "cook") return openCook(button.dataset.id);
  if (action === "cook-step") return moveCook(Number(button.dataset.delta));
  if (action === "close-cook" || action === "cook-back") return closeCook();
  if (action === "timer-start") return startTimer(Number(button.dataset.minutes));
  if (action === "timer-cancel") return stopTimer(true);
  if (action === "add-recipe-groceries") return addRecipeGroceries(button.dataset.id, button.dataset.servings);
  if (action === "toggle-item") return toggleItem(button.dataset.id);
  if (action === "open-item") {
    state.sheet = { kind: "item", id: button.dataset.id };
    render();
    return;
  }
  if (action === "close-sheet") {
    state.sheet = null;
    render();
    return;
  }
  if (action === "ask-delete") {
    state.sheet = { ...state.sheet, confirm: true };
    render();
    return;
  }
  if (action === "confirm-delete") return deleteItem(button.dataset.id);
  if (action === "toggle-done") {
    state.doneOpen = !state.doneOpen;
    render();
    return;
  }
  if (action === "ask-clear") {
    state.sheet = { kind: "clear" };
    render();
    return;
  }
  if (action === "confirm-clear") return clearDone();
}

async function onSubmit(event) {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  if (form.id === "login-form") return signIn(new FormData(form).get("passcode"));
  const kind = form.dataset.form;
  if (kind === "grocery-add") {
    state.groceryDraft = "";
    return addGrocery(new FormData(form).get("name"));
  }
  if (kind === "day-note") {
    const input = form.querySelector("input");
    return savePlanEntry({ date: input.dataset.date, meal: input.dataset.meal, type: "note", note: new FormData(form).get("note") });
  }
  if (kind === "item-edit") return saveItem(new FormData(form));
  if (kind === "fetch-recipe") return fetchRecipe(new FormData(form).get("url"));
  if (kind === "recipe-form") return saveRecipe(new FormData(form));
}

function onInput(event) {
  if (event.target.id === "recipe-search") {
    state.recipeQuery = event.target.value;
    const list = document.getElementById("recipe-list");
    if (list) list.innerHTML = recipeList(visibleRecipes());
  }
  if (event.target.classList?.contains("day-search")) {
    state.dayQuery = event.target.value;
    const holder = event.target.closest("section")?.querySelector(".day-results");
    if (!holder || state.page?.kind !== "day") return;
    const query = state.dayQuery.trim().toLowerCase();
    const recipes = (query ? state.recipes.filter((recipe) => recipe.name.toLowerCase().includes(query)) : state.recipes).slice(0, 8);
    const meal = event.target.dataset.meal;
    const date = event.target.dataset.date;
    holder.innerHTML = `<ul class="results">${recipes.map((recipe) => `<li><button type="button" data-action="pick-recipe" data-id="${esc(recipe.id)}" data-date="${esc(date)}" data-meal="${meal}">${esc(recipe.name)}</button></li>`).join("") || `<li class="small">No matching recipes.</li>`}</ul>`;
  }
  if (event.target.id === "grocery-name") state.groceryDraft = event.target.value;
}

function onAssetError(event) {
  if (event.target?.tagName === "IMG" && event.target.parentElement?.classList.contains("photo")) {
    event.target.parentElement.classList.add("is-missing");
    event.target.remove();
  }
}

async function signIn(passcode) {
  state.loginError = "";
  try {
    await api("/api/login", { method: "POST", body: { passcode } });
    state.authed = true;
    state.loading = true;
    render();
    await refresh(true);
    state.loading = false;
    render();
  } catch (error) {
    state.loginError = error.message || "That passcode didn't work.";
    render();
  }
}

async function savePlanEntry(body) {
  try {
    await api("/api/plan", { method: "POST", body });
    state.error = "";
    state.offer = null;
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function planRecipe(date, meal, recipeId) {
  try {
    await api("/api/plan", { method: "POST", body: { date, meal, type: "recipe", recipeId } });
    state.dayQuery = "";
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function removePlan(id) {
  try {
    await api(`/api/plan/${id}`, { method: "DELETE" });
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function toggleFavorite(id) {
  const recipe = recipeById(id);
  if (!recipe) return;
  try {
    await api(`/api/recipes/${id}`, { method: "PATCH", body: { favorite: !recipe.favorite } });
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

function openCook(id) {
  const recipe = recipeById(id);
  if (!cookSequence(recipe).length) return;
  stopTimer(false);
  state.cookReturn = { tab: state.tab, page: state.page ? { ...state.page } : null };
  state.page = { kind: "cook", id, step: 0 };
  lockScreen();
  render();
}

function moveCook(delta) {
  const recipe = recipeById(state.page.id);
  const last = cookSequence(recipe).length - 1;
  const next = (state.page.step || 0) + delta;
  if (next > last || next < 0) return closeCook();
  stopTimer(false);
  state.page.step = next;
  render();
}

function closeCook() {
  const back = state.cookReturn;
  stopTimer(false);
  unlockScreen();
  state.cookReturn = null;
  if (back?.page?.kind === "recipe" || back?.page?.kind === "day") {
    state.tab = back.tab;
    state.page = back.page;
  } else {
    state.tab = back?.tab || "today";
    state.page = null;
  }
  render();
}

async function addRecipeGroceries(id, servings) {
  try {
    const body = servings ? { servings: Number(servings) } : {};
    await api(`/api/recipes/${id}/groceries`, { method: "POST", body });
    state.offer = null;
    state.notice = "Added to groceries.";
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

function startTimer(minutes) {
  stopTimer(false);
  const step = state.page?.step || 0;
  state.timer = { step, remaining: minutes * 60, endsAt: Date.now() + minutes * 60 * 1000, done: false };
  state.timerHandle = setInterval(() => {
    if (!state.timer) return;
    const remaining = Math.max(0, Math.round((state.timer.endsAt - Date.now()) / 1000));
    state.timer.remaining = remaining;
    if (remaining <= 0) {
      state.timer.done = true;
      clearInterval(state.timerHandle);
      state.timerHandle = null;
      render();
      return;
    }
    const node = document.querySelector(".timer");
    if (node) node.textContent = formatClock(remaining);
  }, 250);
  render();
}

function stopTimer(shouldRender) {
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = null;
  state.timer = null;
  if (shouldRender) render();
}

async function addGrocery(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return;
  try {
    await api("/api/items", { method: "POST", body: { name: trimmed, store: "local", category: "shelf" } });
    state.groceryDraft = "";
    state.notice = "";
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function toggleItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  try {
    await api(`/api/items/${id}`, { method: "PATCH", body: { checked: !item.checked } });
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function saveItem(form) {
  try {
    await api(`/api/items/${state.sheet.id}`, {
      method: "PATCH",
      body: { name: String(form.get("name") || ""), quantityNote: String(form.get("quantityNote") || "") },
    });
    state.sheet = null;
    await refresh(true);
  } catch (error) {
    state.sheet = { ...state.sheet, error: error.message };
    render();
  }
}

async function deleteItem(id) {
  try {
    await api(`/api/items/${id}`, { method: "DELETE" });
    state.sheet = null;
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    state.sheet = null;
    render();
  }
}

async function clearDone() {
  try {
    for (const store of ["local", "costco", "amazon"]) {
      await api("/api/items/clear-checked", { method: "POST", body: { store } });
    }
    state.sheet = null;
    state.doneOpen = false;
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    state.sheet = null;
    render();
  }
}

async function fetchRecipe(url) {
  state.page = { ...state.page, error: "", draft: { ...(state.page.draft || {}), url: String(url || "") } };
  render();
  try {
    const data = await api("/api/recipes/import", { method: "POST", body: { url } });
    state.page = { kind: "recipe", id: data.recipe.id, servings: data.recipe.servings };
    await refresh(true);
  } catch (error) {
    state.page = {
      kind: "new-recipe",
      error: error.message || "Couldn't find a recipe on that page. You can type it in instead.",
      draft: { url: String(url || ""), sourceUrl: String(url || "") },
    };
    render();
  }
}

async function saveRecipe(form) {
  const ingredients = String(form.get("ingredients") || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const steps = String(form.get("steps") || "").split("\n").map((line) => line.trim()).filter(Boolean);
  try {
    const data = await api("/api/recipes", {
      method: "POST",
      body: {
        name: String(form.get("name") || ""),
        ingredients,
        steps,
        sourceUrl: String(form.get("sourceUrl") || ""),
      },
    });
    state.page = { kind: "recipe", id: data.recipe.id, servings: data.recipe.servings };
    await refresh(true);
  } catch (error) {
    state.page = { ...state.page, error: error.message, draft: Object.fromEntries(form.entries()) };
    render();
  }
}

let wakeLock = null;
async function lockScreen() {
  try {
    if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}
function unlockScreen() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

function recipeById(id) {
  return state.recipes.find((recipe) => recipe.id === id) || null;
}
function mealOn(date, meal) {
  return state.plan.find((entry) => entry.date === date && entry.meal === meal) || null;
}
function eventsOn(date) {
  return state.events.filter((event) => event.date === date);
}
function planTitle(entry) {
  if (entry.type === "leftovers") return "Leftovers";
  if (entry.type === "note") return entry.note || "Note";
  return entry.recipeName || "Recipe";
}
function mealLabel(meal) {
  return meal.charAt(0).toUpperCase() + meal.slice(1);
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
  return { from: start, to: addDays(start, 13) };
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
function prettyTime(value) {
  if (!value) return "";
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  let hour = Number(match[1]);
  const suffix = hour >= 12 ? "pm" : "am";
  hour = hour % 12 || 12;
  return match[2] === "00" ? `${hour} ${suffix}` : `${hour}:${match[2]} ${suffix}`;
}
function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; }
}
function safeSrc(url) {
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch { return ""; }
}
function scaledLine(ingredient, factor) {
  if (ingredient.quantity == null || !factor) return ingredient.text || ingredient.name;
  const quantity = ingredient.quantity * factor;
  const unit = ingredient.unit ? (quantity > 1 && PLURAL[ingredient.unit] ? PLURAL[ingredient.unit] : ingredient.unit) : "";
  return `${formatQuantity(quantity)}${unit ? ` ${unit}` : ""} ${ingredient.name}`.trim();
}
function formatQuantity(value) {
  const rounded = Math.round(value * 1000) / 1000;
  const whole = Math.floor(rounded + 1e-8);
  const fraction = rounded - whole;
  if (fraction < 0.02) return String(whole);
  const choices = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 8], [3, 8], [5, 8], [7, 8]];
  let best = null;
  for (const [numerator, denominator] of choices) {
    const diff = Math.abs(fraction - numerator / denominator);
    if (diff < 0.03 && (!best || diff < best.diff)) best = { text: `${numerator}/${denominator}`, diff };
  }
  if (best) return whole ? `${whole} ${best.text}` : best.text;
  return String(Math.round(rounded * 100) / 100);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function sunIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></svg>`;
}
function calendarIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>`;
}
function bookIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v11.5H8A3 3 0 0 0 5 17V4.5z"/><path d="M5 17a3 3 0 0 1 3-3h10"/></svg>`;
}
function bagIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/></svg>`;
}
function checkIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>`;
}
