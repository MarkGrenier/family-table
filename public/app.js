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
  calMode: "week",
  calStart: null,
  monthPick: null,
  prepDone: {},
  undo: null,
  swipeId: null,
  todayPanel: "ingredients",
  todayServings: null,
  todayServingsOpen: false,
  todayId: null,
  mealQuery: "",
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
app.addEventListener("click", onClick);
app.addEventListener("error", onPhotoError, true);
app.addEventListener("submit", onSubmit);
app.addEventListener("input", onInput);
app.addEventListener("pointerdown", onPointerDown);
app.addEventListener("pointermove", onPointerMove);
app.addEventListener("pointerup", onPointerUp);
app.addEventListener("pointercancel", onPointerCancel);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.page?.kind === "cook") lockScreen();
});

let gesture = null;
let wakeLock = null;
let undoTimer = null;
let checkGeneration = 0;
let swallowClick = false;
let viewKeySeen = "";

function swallowNextClick() {
  swallowClick = true;
  setTimeout(() => {
    swallowClick = false;
  }, 0);
}

boot();
setInterval(() => refresh(false), 5000);

async function boot() {
  if (!app.querySelector(".splash")) app.innerHTML = splashHtml();
  if (app.dataset.session === "0") state.authed = false;
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
    if ((force || !isTyping()) && !gesture?.dragging) render();
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

function viewKey() {
  if (!state.authed) return "login";
  if (state.loading) return "loading";
  const page = state.page;
  if (!page) {
    if (state.tab !== "today") return `tab:${state.tab}`;
    const dinner = mealOn(nyToday(), "dinner");
    return `tab:today:${dinner?.id || ""}:${dinner?.type || ""}:${dinner?.recipeId || ""}`;
  }
  if (page.kind === "cook") return `cook:${page.id}:${page.step || 0}`;
  if (page.kind === "recipe") return `recipe:${page.id}:${page.planDate || ""}:${page.planMeal || ""}`;
  if (page.kind === "day") return `day:${page.date}`;
  if (page.kind === "feedback") return `feedback:${page.id}`;
  if (page.kind === "item") return `item:${page.id}`;
  return page.kind;
}

function scrollToTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function render() {
  const key = viewKey();
  const moved = key !== viewKeySeen;
  if (moved && key.startsWith("tab:today")) state.todayPanel = "ingredients";
  viewKeySeen = key;
  const finish = () => {
    if (moved) scrollToTop();
  };
  if (!state.authed) {
    const input = document.getElementById("passcode");
    const error = document.getElementById("login-error");
    if (input && error) {
      error.hidden = !state.loginError;
      error.textContent = state.loginError || "";
      if (!input.value && state.passcode) input.value = state.passcode;
      finish();
      return;
    }
    app.innerHTML = loginHtml();
    const fresh = document.getElementById("passcode");
    if (fresh && state.passcode) fresh.value = state.passcode;
    finish();
    return;
  }
  if (state.loading) {
    app.innerHTML = splashHtml();
    finish();
    return;
  }
  if (state.page?.kind === "cook") {
    app.innerHTML = cookHtml() + sheetHtml();
    finish();
    return;
  }
  const bare = ["recipe", "feedback", "item", "add-item"].includes(state.page?.kind);
  const dinnerTonight = state.tab === "today" && !state.page ? mealOn(nyToday(), "dinner") : null;
  const dayDinner = state.page?.kind === "day" ? mealOn(state.page.date, "dinner") : null;
  const todayCook = dinnerTonight?.type === "recipe" && Boolean(recipeForEntry(dinnerTonight));
  const leftoversNightOn = dinnerTonight?.type === "leftovers" || dayDinner?.type === "leftovers";
  const monthOn = state.tab === "calendar" && state.calMode === "month" && !state.page;
  const mainClass = bare ? "bare" : todayCook ? "screen today-screen" : leftoversNightOn ? "screen today-screen no-dock night-screen" : monthOn ? "screen month-screen" : "screen";
  app.innerHTML = `<main class="${mainClass}">${bodyHtml()}</main>${bare ? "" : tabsHtml()}${sheetHtml()}${toastHtml()}`;
  const focus = document.getElementById("add-search");
  if (focus && state.page?.kind === "add-item") focus.focus();
  finish();
}

function splashHtml() {
  return `<main class="splash">${markImg(72)}</main>`;
}

function loginHtml() {
  return `<main class="login">
    <div class="login-brand">${markImg(88)}<h1>Family Table</h1></div>
    <form id="login-form">
      <div class="pass-box">
        <input id="passcode" name="passcode" type="password" autocomplete="current-password" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text" placeholder="Enter family passcode" aria-label="Passcode">
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
  if (state.tab === "calendar") return calendarHtml();
  if (state.tab === "recipes") return recipesHtml();
  if (state.tab === "groceries") return groceriesHtml();
  return todayHtml();
}

function tabsHtml() {
  const count = state.items.filter((item) => !item.checked && item.id !== state.checking).length;
  return `<nav class="tabs">${tabBtn("today", "Today", sun())}${tabBtn("calendar", "Week", cal())}${tabBtn("recipes", "Recipes", book())}${tabBtn("groceries", "Groceries", cart(), count)}</nav>`;
}

function tabBtn(id, label, icon, count) {
  return `<button type="button" data-action="tab" data-tab="${id}" class="${state.tab === id ? "is-on" : ""}">${icon}${count ? `<span class="badge">${count}</span>` : ""}<span>${label}</span></button>`;
}

function todayHtml() {
  const today = nyToday();
  const dinner = mealOn(today, "dinner");
  const recipe = recipeForEntry(dinner);
  const events = eventsOn(today);
  if (dinner?.type === "leftovers") return leftoversNight(dinner, recipe);
  if (recipe && dinner) {
    if (state.todayId !== recipe.id) {
      state.todayId = recipe.id;
      state.todayServings = recipe.servings || 4;
      state.todayPanel = "ingredients";
      state.todayServingsOpen = false;
    }
  }
  return `${recipe && dinner ? recipeView(recipe, "today") : emptyTonight()}
    ${eventsHtml(events)}
    ${recipe ? cookDock(recipe, true) : ""}`;
}

function leftoversNight(entry, recipe, options = {}) {
  const photo = foodPhoto(recipe, entry);
  const back = options.back ? `<button class="float left" type="button" data-action="back" aria-label="Back">${chevLeft()}</button>` : "";
  const remove = options.remove ? `<button class="text-green night-remove" type="button" data-action="clear-meal" data-id="${esc(entry.id)}">Remove</button>` : "";
  return `<article class="leftover-night">
      <div class="hero night-hero">
        <img class="fallback-photo" src="${esc(photo || "/photos/leftovers-hero.jpg")}" alt="">
        ${back}
        <button class="float right" type="button" data-action="recipe-menu" data-date="${esc(entry.date)}" data-meal="${esc(entry.meal)}" aria-label="More">${dots()}</button>
      </div>
      <div class="pad">
        ${options.back ? `<p class="kicker meal-kicker">${esc(mealLabel(entry.meal))}</p>` : ""}
        <span class="lo-pill">Leftovers</span>
        <h1>${esc(dishName(entry, recipe))}</h1>
        <p class="night-line">Night off. Enjoy the leftovers.</p>
        ${remove}
      </div>
      <div class="night-gap"></div>
      ${tomorrowCard(entry.date)}
    </article>`;
}

function foodPhoto(recipe, entry) {
  const image = String(recipe?.imageUrl || entry?.imageUrl || "");
  if (!image || image === "/plate.svg" || image === "/mark.svg" || image.endsWith("/plate.svg")) return "";
  return safeSrc(image);
}

function tomorrowCard(date) {
  const entry = mealOn(addDays(date, 1), "dinner");
  if (!entry) return "";
  const recipe = recipeForEntry(entry);
  if (entry.type === "leftovers") {
    const name = recipe?.name || entry.recipeName || entry.note || "";
    return `<button class="tomorrow" type="button" data-action="open-day" data-date="${esc(entry.date)}">
        ${recipe ? recipeThumb(recipe) : `<span class="thumb-tile" aria-hidden="true">${plateIcon()}</span>`}
        <span class="tomorrow-copy"><strong>Tomorrow: leftovers</strong>${name ? `<span class="tomorrow-dish">${esc(name)}</span>` : ""}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>`;
  }
  if (entry.type === "note") {
    return `<button class="tomorrow" type="button" data-action="open-day" data-date="${esc(entry.date)}">
        <span class="tomorrow-copy"><span class="kicker">Tomorrow</span><strong>${esc(entry.note || "A note")}</strong></span>
        <span class="chev" aria-hidden="true">›</span>
      </button>`;
  }
  if (!recipe) return "";
  const steps = (recipe.nightBefore || []).filter(Boolean);
  const prep = steps.length ? `<span class="prep-mini">Prep for tomorrow · ${steps.length} ${steps.length === 1 ? "step" : "steps"}</span>` : "";
  return `<button class="tomorrow" type="button" data-action="open-recipe" data-id="${esc(recipe.id)}" data-date="${esc(entry.date)}" data-meal="${esc(entry.meal)}">
      ${recipeThumb(recipe)}
      <span class="tomorrow-copy"><span class="kicker">Tomorrow</span><strong>${esc(dishName(entry, recipe))}</strong>${prep}</span>
      <span class="chev" aria-hidden="true">›</span>
    </button>`;
}

function leftoversRow(entry, recipe) {
  const thumb = recipe ? recipeThumb(recipe) : `<span class="thumb-tile" aria-hidden="true">${plateIcon()}</span>`;
  return `<div class="leftover-row">${thumb}
      <button class="copy" type="button" data-action="open-day" data-date="${esc(entry.date)}">
        <strong>${esc(dishName(entry, recipe))}</strong>
        <span class="leftover-meta"><span class="meal-kind">${esc(mealLabel(entry.meal))}</span><span class="lo-pill">Leftovers</span></span>
      </button>
      <button class="icon-btn" type="button" data-action="recipe-menu" data-date="${esc(entry.date)}" data-meal="${esc(entry.meal)}" aria-label="More">${dots()}</button>
    </div>`;
}

function dishName(entry, recipe) {
  return recipe?.name || entry?.recipeName || entry?.note || "Dinner";
}

function emptyTonight() {
  return `<div class="empty-night">
      ${emptyPlate()}
      <h1>Nothing planned tonight.</h1>
      <p class="muted">Pick a recipe when you know what's for dinner.</p>
      <button class="primary" type="button" data-action="plan-dinner">Plan dinner</button>
    </div>`;
}

function emptyPlate() {
  return `<svg class="empty-art" viewBox="0 0 280 180" aria-hidden="true">
      <rect width="280" height="180" rx="24" fill="#f3f1ea"/>
      <ellipse cx="140" cy="96" rx="78" ry="46" fill="#fff"/>
      <ellipse cx="118" cy="92" rx="28" ry="18" fill="#8fbf55"/>
      <ellipse cx="162" cy="90" rx="34" ry="20" fill="#e7c27a"/>
      <circle cx="104" cy="78" r="6" fill="#d4533c"/>
      <circle cx="126" cy="72" r="5" fill="#e07a3d"/>
    </svg>`;
}

function duePrepSteps() {
  const tomorrow = addDays(nyToday(), 1);
  const steps = [];
  for (const meal of ["breakfast", "lunch", "dinner"]) {
    const entry = mealOn(tomorrow, meal);
    const recipe = recipeForEntry(entry);
    if (!recipe) continue;
    (recipe.nightBefore || []).filter(Boolean).forEach((text, index) => {
      steps.push({ text: String(text), meal, key: `${tomorrow}:${meal}:${recipe.id}:${index}` });
    });
  }
  return steps;
}

function prepPhotoTag() {
  const count = duePrepSteps().length;
  if (!count) return "";
  const label = `Prep for tomorrow · ${count} ${count === 1 ? "step" : "steps"}`;
  return `<button class="prep-tag" type="button" data-action="open-prep">${esc(label)}</button>`;
}

function prepSheet() {
  const steps = duePrepSteps();
  return `<div class="sheet"><div class="sheet-card" role="dialog" aria-label="Prep for tomorrow">
      <div class="sheet-head"><strong>Prep for tomorrow</strong><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
      ${steps.map((step) => {
        const on = Boolean(state.prepDone[step.key]);
        const meal = step.meal === "dinner" ? "" : `${mealLabel(step.meal)}: `;
        return `<button class="prep-row" type="button" data-action="toggle-prep" data-key="${esc(step.key)}" aria-pressed="${on ? "true" : "false"}">
          <span class="check${on ? " is-on" : ""}">${on ? checkIcon() : ""}</span>
          <span>${esc(meal + step.text)}</span>
        </button>`;
      }).join("") || `<p class="muted">Nothing to prep.</p>`}
    </div></div>`;
}

function eventsHtml(events) {
  if (!events.length) return "";
  return `<section class="today-events"><h2 class="kicker">Family</h2><ul>${events.map((event) => `<li>${event.time ? `<span class="muted">${esc(event.time)}</span> ` : ""}${esc(event.title)}</li>`).join("")}</ul></section>`;
}

function calendarHtml() {
  return state.calMode === "month" ? monthHtml() : weekListHtml();
}

function weekListHtml() {
  const today = nyToday();
  const end = addDays(today, 6);
  const title = `${shortMonth(today)} ${Number(today.slice(8))} – ${shortMonth(end)} ${Number(end.slice(8))}`;
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  return `<div class="week-head">
      <h1>${esc(title)}</h1>
      <button class="icon-btn" type="button" data-action="cal-mode" aria-label="Open month">${cal()}</button>
    </div>
    <div class="week-list">${days.map(weekDay).join("")}</div>`;
}

function monthHtml() {
  const anchor = state.calStart || `${nyToday().slice(0, 7)}-01`;
  const prev = canShiftMonth(-1);
  return `<div class="month-bar">
      <button type="button" data-action="cal-shift" data-delta="-1" aria-label="Previous month" ${prev ? "" : "disabled"}>${chevLeft()}</button>
      <h1>${esc(monthTitle(anchor))}</h1>
      <button type="button" data-action="cal-shift" data-delta="1" aria-label="Next month">${chevRight()}</button>
      <button class="icon-btn is-on" type="button" data-action="cal-mode" aria-label="Back to this week">${cal()}</button>
    </div>
    <div class="cal-board">${monthGrid(anchor, monthSelection(anchor))}</div>
    ${monthPanel(monthSelection(anchor))}`;
}

function monthSelection(anchor) {
  const month = String(anchor || "").slice(0, 7);
  const today = nyToday();
  if (state.monthPick && state.monthPick.slice(0, 7) === month && state.monthPick >= today) return state.monthPick;
  if (today.slice(0, 7) === month) return today;
  const first = `${month}-01`;
  return first >= today ? first : today;
}

function monthPanel(date) {
  const meals = mealsOn(date);
  const events = eventsOn(date);
  const heading = date === nyToday() ? `Today · ${longDate(date)}` : longDate(date);
  return `<section class="month-panel">
      <div class="month-panel-head"><h2>${esc(heading)}</h2>
        <button class="text-green" type="button" data-action="open-day" data-date="${esc(date)}">Edit</button>
      </div>
      ${meals.length ? meals.map(mealRow).join("") : `<p class="muted">Nothing planned</p>`}
      ${events.map((event) => `<p class="event-line">${event.time ? `<time>${esc(event.time)}</time>` : ""}${esc(event.title)}</p>`).join("")}
    </section>`;
}

function monthTitle(iso) {
  return formatUtc(iso, { month: "long", year: "numeric" });
}

function shortMonth(iso) {
  return formatUtc(iso, { month: "short" });
}

function weekDay(date) {
  const today = date === nyToday();
  const meals = mealsOn(date);
  const events = eventsOn(date);
  const label = today ? `Today · ${shortDate(date)}` : shortDate(date);
  return `<section class="week-day${today ? " is-today" : ""}">
      <button class="week-date" type="button" data-action="open-day" data-date="${esc(date)}">${esc(label)}</button>
      ${meals.length ? meals.map(mealRow).join("") : `<button class="week-empty" type="button" data-action="open-day" data-date="${esc(date)}">Nothing planned</button>`}
      ${events.map((event) => `<p class="event-line">${event.time ? `<time>${esc(event.time)}</time>` : ""}${esc(event.title)}</p>`).join("")}
    </section>`;
}

function mealMenu(entry) {
  return `<button class="icon-btn" type="button" data-action="recipe-menu" data-date="${esc(entry.date)}" data-meal="${esc(entry.meal)}" aria-label="More">${dots()}</button>`;
}

function mealRow(entry) {
  const recipe = recipeForEntry(entry);
  if (entry.type === "leftovers") return leftoversRow(entry, recipe);
  const title = planTitle(entry);
  const meal = mealLabel(entry.meal);
  if (!recipe) {
    return `<div class="meal-row meal-line"><button class="meal-open" type="button" data-action="open-day" data-date="${esc(entry.date)}"><span class="meal-copy"><strong>${esc(title)}</strong><span>${esc(meal)}</span></span></button>${mealMenu(entry)}</div>`;
  }
  return `<div class="meal-row meal-line"><button class="meal-open" type="button" data-action="open-recipe" data-id="${esc(recipe.id)}" data-date="${esc(entry.date)}" data-meal="${esc(entry.meal)}">${recipeThumb(recipe)}<span class="meal-copy"><strong>${esc(title)}</strong><span>${esc(meal)}</span></span></button>${mealMenu(entry)}</div>`;
}

function mealLabel(meal) {
  if (meal === "breakfast") return "Breakfast";
  if (meal === "lunch") return "Lunch";
  return "Dinner";
}

function monthGrid(iso, selected) {
  const [year, month] = iso.split("-").map(Number);
  const first = `${iso.slice(0, 7)}-01`;
  const start = mondayOf(first);
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(start, index);
    if (index >= 35 && Number(date.slice(5, 7)) !== month) break;
    cells.push(date);
  }
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return `<div class="month-names">${names.map((name) => `<span>${name}</span>`).join("")}</div>
    <div class="month-grid">${cells.map((date) => monthCell(date, Number(date.slice(5, 7)) === month, selected)).join("")}</div>`;
}

function monthCell(date, inMonth, selected) {
  const today = date === nyToday();
  const past = date < nyToday();
  const dinner = inMonth ? mealOn(date, "dinner") : null;
  const label = dinner ? dishName(dinner, recipeForEntry(dinner)) : "";
  const open = inMonth && !past;
  const picked = open && date === selected;
  const mark = label ? `<span class="day-dish">${esc(label)}</span>` : "";
  return `<div class="month-cell${inMonth ? "" : " is-out"}${today ? " is-today" : ""}${past ? " is-past" : ""}${picked ? " is-picked" : ""}">
      <button type="button" ${open ? `data-action="select-day" data-date="${esc(date)}" aria-pressed="${picked ? "true" : "false"}"` : "disabled"}><span class="day-num">${Number(date.slice(8))}</span>${mark}</button>
    </div>`;
}


function mealsOn(date) {
  return ["breakfast", "lunch", "dinner"].map((meal) => mealOn(date, meal)).filter(Boolean);
}

function dayHtml(date) {
  const dinner = mealOn(date, "dinner");
  const recipe = recipeForEntry(dinner);
  if (dinner?.type === "leftovers") return leftoversNight(dinner, recipe, { back: true, remove: true });
  const planned = !dinner
    ? ""
    : `<p class="title day-title">${recipe ? `<button type="button" class="text-link" data-action="open-recipe" data-id="${esc(recipe.id)}" data-date="${esc(date)}" data-meal="dinner">${esc(planTitle(dinner))}</button>` : esc(planTitle(dinner))}</p><button class="text-green" type="button" data-action="clear-meal" data-id="${esc(dinner.id)}">Remove</button>`;
  return `<button class="text-green" type="button" data-action="back">Week</button>
    <h1>${esc(longDate(date))}</h1>
    <section><p class="kicker">Dinner</p>
      ${planned}
      ${pickerHtml(date, "dinner", dinner?.type !== "leftovers")}
    </section>`;
}

function pickerHtml(date, meal, showRecipes = true) {
  const query = state.dayQuery.trim().toLowerCase();
  const recipes = (query ? state.recipes.filter((recipe) => recipe.name.toLowerCase().includes(query)) : state.recipes).slice(0, 8);
  const finder = showRecipes ? `<label class="search">Search recipes
      <input class="field-box day-search" type="search" value="${esc(state.dayQuery)}" placeholder="Chili, pasta…" data-date="${esc(date)}" data-meal="${meal}">
    </label>
    ${recipes.map((recipe) => `<button class="link-row" type="button" data-action="pick-recipe" data-id="${esc(recipe.id)}" data-date="${esc(date)}" data-meal="${meal}">${esc(recipe.name)}</button>`).join("")}` : "";
  return `${finder}
    <button class="gray-btn" type="button" data-action="leftovers" data-date="${esc(date)}" data-meal="${meal}">Leftovers</button>
    <form data-form="day-note" class="stack day-note">
      <input class="field-box" name="note" maxlength="140" placeholder="Eating out" aria-label="Short note" data-date="${esc(date)}" data-meal="${meal}">
      <button class="gray-btn" type="submit">Save note</button>
    </form>`;
}

function recipesHtml() {
  return `<div class="recipes-head"><h1>Recipes</h1></div>
    <label class="search">
      <input id="recipe-search" class="field-box" type="search" value="${esc(state.recipeQuery)}" placeholder="Search recipes" aria-label="Search recipes" autocomplete="off">
    </label>
    <div class="sort" role="group" aria-label="Sort recipes">
      ${sortButton("favorites", "Favorites")}${sortButton("recent", "Recent")}${sortButton("az", "A-Z")}
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
        ${recipeThumb(recipe)}
        <span class="recipe-copy"><span>${esc(recipe.name)}</span>${recipe.needsReview ? `<span class="review-pill">Needs a look</span>` : ""}${lastMadeText(recipe) ? `<span class="small">${esc(lastMadeText(recipe))}</span>` : ""}</span>
      </button>
      <button class="heart${recipe.favorite ? " is-on" : ""}" type="button" data-action="favorite" data-id="${esc(recipe.id)}" aria-label="${recipe.favorite ? "Unfavorite" : "Favorite"}">${heart(recipe.favorite)}</button>
    </div>`).join("");
}

function recipeHtml(id) {
  const recipe = recipeById(id);
  if (!recipe) return `<div class="pad"><button class="text-green" type="button" data-action="back">Recipes</button><p>That recipe isn't here anymore.</p></div>`;
  const entry = state.page?.planDate ? mealOn(state.page.planDate, state.page.planMeal) : null;
  if (entry?.type === "leftovers") return leftoversNight(entry, recipeForEntry(entry) || recipe, { back: true });
  return `${recipeView(recipe, "page")}${cookDock(recipe, false)}`;
}

function recipeView(recipe, mode) {
  const embedded = mode !== "page";
  const servings = embedded ? state.todayServings || recipe.servings || 4 : state.page.servings || recipe.servings || 4;
  const factor = servings / (recipe.servings || 1);
  const panel = embedded ? state.todayPanel || "ingredients" : state.page.panel || "ingredients";
  const open = embedded ? state.todayServingsOpen : state.page.servingsOpen;
  const tag = embedded ? prepPhotoTag() : "";
  return `${hero(recipe, !embedded, tag)}
    <div class="pad">
      ${mode === "leftovers" ? `<span class="lo-pill">Leftovers</span>` : ""}
      <div class="title-row"><h1>${esc(recipe.name)}</h1>
        <button class="heart${recipe.favorite ? " is-on" : ""}" type="button" data-action="favorite" data-id="${esc(recipe.id)}" aria-label="Favorite">${heart(recipe.favorite)}</button>
      </div>
      <p class="meta">${recipe.totalTime ? `${esc(unicodeFractions(recipe.totalTime))} • ` : ""}<button type="button" data-action="servings-toggle">${servings} ${servings === 1 ? "serving" : "servings"} ▾</button></p>
      ${open ? `<div class="seg"><button type="button" data-action="servings" data-delta="-1">−</button><button type="button" class="is-on">${servings}</button><button type="button" data-action="servings" data-delta="1">+</button></div>` : ""}
      ${mode === "page" && lastMadeText(recipe) ? `<p class="small">${esc(lastMadeText(recipe))}</p>` : ""}
      <div class="seg" role="tablist">
        ${panelBtn("cookware", "Cookware", panel)}${panelBtn("ingredients", "Ingredients", panel)}${panelBtn("instructions", "Instructions", panel)}
      </div>
      ${panel === "cookware" ? cookwareHtml(recipe) : ""}
      ${panel === "ingredients" ? ingredientsHtml(recipe, factor) : ""}
      ${panel === "instructions" ? instructionsHtml(recipe, factor) : ""}
    </div>`;
}

function cookDock(recipe, raised) {
  const cooked = Boolean(recipe.cookedToday);
  const start = `<button class="green-btn" type="button" data-action="cook" data-id="${esc(recipe.id)}">Start cooking</button>`;
  if (raised && cooked) {
    return `<div class="dock dock-raised">${start}<div class="cooked-pill">✓ Cooked</div></div>`;
  }
  return `<div class="dock${raised ? " dock-raised" : ""}">
      ${cooked ? `<div class="cooked-pill">✓ Cooked</div><button class="gray-btn" type="button" data-action="feedback" data-id="${esc(recipe.id)}">Give Feedback</button>` : `<button class="outline-btn" type="button" data-action="mark-cooked" data-id="${esc(recipe.id)}">${checkOutline()} Mark cooked</button>${start}`}
    </div>`;
}

function hero(recipe, showBack, prepTag = "") {
  const menu = `<button class="float right" type="button" data-action="recipe-menu" aria-label="More">${dots()}</button>`;
  const back = showBack ? `<button class="float left" type="button" data-action="back" aria-label="Back">${chevLeft()}</button>` : "";
  if (!recipe.imageUrl) {
    return `<div class="hero hero-empty">${back}<span class="hero-mark" aria-hidden="true">${plateIcon()}</span>${prepTag}${menu}</div>`;
  }
  return `<div class="hero"><img class="fallback-photo" src="${esc(safeSrc(recipe.imageUrl))}" alt="">
      ${back}
      ${prepTag}
      ${menu}
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
  const counts = new Map();
  for (const item of items) {
    const key = ingredientNameKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return items.map((item) => ingredientRow(item, factor, (counts.get(ingredientNameKey(item)) || 0) > 1)).join("");
}

function ingredientNameKey(item) {
  return String(item?.name || item?.text || "").trim().toLowerCase();
}

function ingredientRow(item, factor, repeated) {
  const amount = amountOf(item, factor);
  const name = item.name || item.text || "Ingredient";
  const text = String(item.text || "").trim();
  const scaled = scaledLine(item, factor);
  const sameAsName = text.toLowerCase() === String(name).trim().toLowerCase();
  const sameAsScaled = text.toLowerCase() === scaled.toLowerCase();
  const detail = repeated && text && !sameAsName && !sameAsScaled ? unicodeFractions(text) : "";
  const label = repeated && !amount && text ? unicodeFractions(text) : name;
  const qty = repeated && !amount && text ? "" : amount;
  return `<div class="ing-row"><span>${esc(label)}${detail ? `<span class="ing-detail">${esc(detail)}</span>` : ""}</span><span class="qty">${esc(qty)}${item.optional ? " optional" : ""}</span></div>`;
}

function instructionsHtml(recipe, factor) {
  const steps = instructionSteps(recipe);
  if (!steps.length) return `<p class="empty">No instructions yet.</p>`;
  return steps.map((step, index) => `<div class="step-block">${step.label ? `<p class="kicker">${esc(step.label)}</p>` : ""}<p><span class="step-no">${index + 1}</span> ${esc(step.text)}</p>
      ${stepBits(recipe, step, factor)}</div>`).join("") + notesHtml(recipe);
}

function stepBits(recipe, step, factor) {
  const lines = (step.ingredients || []).map((ref) => resolveIngredient(recipe, ref, factor)).filter(Boolean);
  if (!lines.length) return "";
  return `<ul class="step-ings">${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;
}

function notesHtml(recipe) {
  return recipe.kidsPlates ? `<p class="note-block"><span class="kicker">Kids' plates</span><br>${esc(recipe.kidsPlates)}</p>` : "";
}

function feedbackHtml(id) {
  const recipe = recipeById(id);
  return `<div class="topbar"><button class="back" type="button" data-action="close-feedback" aria-label="Close">✕</button><h1>Feedback</h1><span></span></div>
    <div class="pad feedback">
      <p class="ask">How was this recipe?</p>
      <div class="stars">${[1, 2, 3, 4, 5].map((star) => `<button type="button" data-action="star" data-star="${star}" class="${star <= state.stars ? "is-on" : ""}" aria-label="${star} stars">★</button>`).join("")}</div>
      <label class="field-label field-left">Comments for the chef?
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
  if (!recipe || !step) return `<main class="cook"><button class="cook-x" type="button" data-action="close-cook" aria-label="Close">✕</button><p>There aren't any steps yet.</p></main>`;
  const lines = (step.ingredients || []).map((ref) => resolveIngredient(recipe, ref, factor)).filter(Boolean);
  return `<main class="cook">
      <button class="cook-x" type="button" data-action="close-cook" aria-label="Close">✕</button>
      ${step.label ? `<p class="kicker cook-label">${esc(step.label)}</p>` : ""}
      <p class="step-num">${index + 1}</p>
      <p class="cook-step">${esc(step.text)}</p>
      ${lines.length ? `<ul>${lines.map((line) => `<li>${esc(unicodeFractions(line))}</li>`).join("")}</ul>` : ""}
      ${timerHtml(step, index)}
      <div class="cook-dock">
        <div class="cook-actions">
          <button class="list-btn" type="button" data-action="cook-list" aria-label="Ingredients">${listIcon()}<span>Ingredients</span></button>
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
  return `<div class="title-row"><h1>Groceries</h1><button class="icon-green" type="button" data-action="grocery-menu" aria-label="List options">${dots()}</button></div>
    ${groups.map((group) => `<h2 class="section-head">${esc(group.label)}</h2>${group.items.map(groceryRow).join("")}`).join("") || `<p class="empty">The list is clear.</p>`}
    ${state.doneOpen && done.length ? `<h2 class="section-head">Completed</h2>${done.map(groceryRow).join("")}` : ""}
    <button class="fab" type="button" data-action="add-item" aria-label="Add">+</button>`;
}

function groceryRow(item) {
  const checking = state.checking === item.id;
  const done = item.checked || checking;
  const open = state.swipeId === item.id;
  return `<div class="g-swipe${open ? " is-open" : ""}" data-id="${esc(item.id)}">
      <button class="g-delete" type="button" data-action="delete-item" data-id="${esc(item.id)}">Delete</button>
      <div class="g-row${done ? " is-done" : ""}" data-id="${esc(item.id)}">
        <button class="check${done ? " is-on" : ""} g-check" type="button" data-action="toggle-item" data-id="${esc(item.id)}" aria-label="${done ? "Put back" : "Mark bought"} ${esc(item.name)}">${done ? checkIcon() : ""}</button>
        <span class="g-name">${esc(item.name)}</span>
        <span class="qty">${esc(qtyOf(item))}</span>
      </div>
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
    ${item.imageUrl ? `<img class="photo-edge fallback-photo" src="${esc(safeSrc(item.imageUrl))}" alt="">` : ""}
    <div class="pad">
      ${item.substitute ? `<h2>Need a substitute?</h2><p>${esc(item.substitute)}</p>` : ""}
      ${item.notes ? `<h2>Notes</h2><p>${esc(item.notes)}</p>` : ""}
      ${recipes.length ? `<h2>You'll use this in...</h2>${recipes.map((recipe) => `<button class="link-row" type="button" data-action="open-recipe" data-id="${esc(recipe.id)}">${recipe.imageUrl ? `<img class="round-thumb fallback-photo" src="${esc(safeSrc(recipe.imageUrl))}" alt="">` : ""}<span class="link-name">${esc(recipe.name)}</span><span class="chev">›</span></button>`).join("")}` : ""}
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

function mealContext() {
  const sheet = state.sheet;
  if (sheet?.date && sheet?.meal && (sheet.kind === "recipe-menu" || sheet.kind === "change-meal" || sheet.kind === "edit-recipe")) {
    return { date: sheet.date, meal: sheet.meal };
  }
  if (state.page?.kind === "recipe" && state.page.planDate && state.page.planMeal) {
    return { date: state.page.planDate, meal: state.page.planMeal };
  }
  if (state.page?.kind === "day") return { date: state.page.date, meal: "dinner" };
  if (!state.page && state.tab === "today") {
    const dinner = mealOn(nyToday(), "dinner");
    if (dinner) return { date: dinner.date, meal: dinner.meal };
  }
  return null;
}

function activeRecipe() {
  if (state.page?.kind === "recipe") return recipeById(state.page.id) || null;
  const context = mealContext();
  if (context) {
    const planned = recipeForEntry(mealOn(context.date, context.meal));
    if (planned) return recipeById(planned.id) || planned;
  }
  if (!state.page && state.tab === "today") {
    const recipe = tonightRecipe();
    if (!recipe) return null;
    return recipeById(recipe.id) || recipe;
  }
  return null;
}

function changeMealHtml() {
  const query = state.mealQuery.trim().toLowerCase();
  const matches = (recipe) => !query || recipe.name.toLowerCase().includes(query);
  const recipes = state.recipes.filter(matches).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const picks = chefPicks().filter(matches);
  return `<div class="sheet"><div class="sheet-card" role="dialog" aria-label="Swap meal">
      <div class="sheet-head"><button class="text-green" type="button" data-action="close-sheet">Cancel</button><strong>Swap meal</strong><span></span></div>
      ${state.sheet.error ? `<p class="error">${esc(state.sheet.error)}</p>` : ""}
      <label class="search">Search
        <input id="meal-search" class="field-box" type="search" value="${esc(state.mealQuery)}" placeholder="Search recipes" autocomplete="off">
      </label>
      ${picks.length ? `<p class="pick-label">Chef's picks</p><div class="pick-list">${picks.map((recipe) => pickRow(recipe, "pick-alternate")).join("")}</div>` : ""}
      <button class="menu-row" type="button" data-action="pick-leftovers">Leftovers</button>
      <div class="pick-list">${recipes.length ? recipes.map((recipe) => pickRow(recipe, "pick-change")).join("") : `<p class="muted">Nothing matches that.</p>`}</div>
    </div></div>`;
}

function pickRow(recipe, action) {
  return `<button class="pick-row" type="button" data-action="${action}" data-id="${esc(recipe.id)}">${recipeThumb(recipe)}<span>${esc(recipe.name)}</span></button>`;
}

function chefPicks() {
  const context = mealContext();
  if (!context) return [];
  const entry = mealOn(context.date, context.meal);
  const currentId = entry?.recipeId || null;
  return (entry?.alternates || []).map((id) => recipeById(id)).filter((recipe) => recipe && recipe.id !== currentId);
}

function editRecipeHtml() {
  const recipe = recipeById(state.sheet?.id) || activeRecipe();
  if (!recipe) return "";
  const draft = state.sheet.draft;
  const name = draft ? draft.name : recipe.name || "";
  const servings = draft ? draft.servings : recipe.servings || 4;
  const totalTime = draft ? draft.totalTime : recipe.totalTime || "";
  const imageUrl = draft ? draft.imageUrl : recipe.imageUrl || "";
  const ingredients = draft?.ingredients || recipe.ingredients || [];
  const steps = draft ? draft.steps : editableSteps(recipe);
  return `<div class="sheet"><form class="sheet-card edit-sheet" data-form="edit-recipe" role="dialog" aria-label="Edit recipe">
      <div class="sheet-head"><button class="text-green" type="button" data-action="close-sheet">Cancel</button><strong>Edit recipe</strong><button class="text-green" type="submit">Save</button></div>
      ${state.sheet.error ? `<p class="error">${esc(state.sheet.error)}</p>` : ""}
      <label class="field-label">Title<input class="field-box" name="name" required maxlength="120" value="${esc(name)}"></label>
      <label class="field-label">Servings<input class="field-box" name="servings" type="number" inputmode="numeric" min="1" max="99" required value="${esc(servings)}"></label>
      <label class="field-label">Total time<input class="field-box" name="totalTime" maxlength="40" value="${esc(totalTime)}" placeholder="35 min"></label>
      <label class="field-label">Photo URL<input class="field-box" name="imageUrl" maxlength="500" value="${esc(imageUrl)}" placeholder="https://"></label>
      <p class="field-label">Ingredients</p>
      ${ingredients.map((item, index) => ingredientEditRow(item, index)).join("")}
      <button class="text-green" type="button" data-action="add-ingredient">Add ingredient</button>
      <label class="field-label">Steps<textarea class="box" name="steps">${esc(steps)}</textarea></label>
      <p class="small">One step per line. Timers and ingredient links stay with each step.</p>
    </form></div>`;
}

function ingredientEditRow(item, index) {
  const qty = item.qty ?? item.quantity;
  const qtyText = qty == null ? "" : formatQty(qty) || String(qty);
  return `<div class="ing-edit" data-index="${index}">
      <input class="field-box" name="ing-qty" value="${esc(qtyText)}" aria-label="Quantity" inputmode="decimal" maxlength="12">
      <input class="field-box" name="ing-unit" value="${esc(item.unit || "")}" aria-label="Unit" maxlength="20">
      <input class="field-box" name="ing-name" value="${esc(item.name || "")}" aria-label="Ingredient" maxlength="80">
      <button class="text-btn" type="button" data-action="remove-ingredient" aria-label="Remove ${esc(item.name || "ingredient")}">✕</button>
      <input class="field-box ing-note" name="ing-note" value="${esc(item.note || "")}" aria-label="Note" maxlength="140" placeholder="Note">
    </div>`;
}

function editableSteps(recipe) {
  const cook = (recipe.cookSteps || []).map((step) => (typeof step === "string" ? step : step?.text)).filter(Boolean);
  const lines = cook.length ? cook : (recipe.steps || []).filter(Boolean);
  return lines.join("\n");
}

async function changeMeal(extra) {
  const context = mealContext();
  if (!context) return;
  const nextId = extra.recipeId || null;
  const body = { date: context.date, meal: context.meal, type: extra.type };
  if (nextId) body.recipeId = nextId;
  if (extra.note) body.note = extra.note;
  if (Array.isArray(extra.alternates)) body.alternates = extra.alternates;
  try {
    await api("/api/plan", { method: "POST", body });
    if (state.page?.kind === "recipe") {
      if (nextId && recipeById(nextId)) {
        const recipe = recipeById(nextId);
        state.page = { kind: "recipe", id: nextId, servings: recipe.servings || 4, panel: "ingredients", planDate: context.date, planMeal: context.meal };
      } else if (!nextId) {
        state.tab = context.date === nyToday() ? "today" : "calendar";
        state.page = null;
      }
    }
    state.sheet = null;
    state.mealQuery = "";
    await refresh(true);
  } catch (error) {
    state.sheet = { kind: "change-meal", error: error.message };
    render();
  }
}

function ingredientBase() {
  const recipe = recipeById(state.sheet?.id);
  return state.sheet?.draft?.ingredients || recipe?.ingredients || [];
}

function parseEditQty(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const glyphs = { "½": 1 / 2, "¼": 1 / 4, "¾": 3 / 4, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 1 / 8, "⅜": 3 / 8 };
  const mixedGlyph = /^(\d+)\s*([½¼¾⅓⅔⅛⅜])$/.exec(text);
  if (mixedGlyph) return Number(mixedGlyph[1]) + glyphs[mixedGlyph[2]];
  if (glyphs[text] != null) return glyphs[text];
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(text);
  if (mixed && Number(mixed[3])) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  if (fraction && Number(fraction[2])) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function qtySame(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(Number(left) - Number(right)) < 0.001;
}

function buildIngredient(row) {
  const index = row.dataset.index;
  const original = index === "new" ? null : ingredientBase()[Number(index)];
  const name = row.querySelector("[name=ing-name]").value.trim().replace(/\s+/g, " ");
  const unit = row.querySelector("[name=ing-unit]").value.trim() || null;
  const note = row.querySelector("[name=ing-note]").value.trim() || null;
  const qty = parseEditQty(row.querySelector("[name=ing-qty]").value);
  if (!name) return null;
  if (
    original &&
    original.name === name &&
    qtySame(original.qty ?? original.quantity, qty) &&
    (original.unit || null) === unit &&
    (original.note || null) === note
  ) {
    return original;
  }
  const next = { ...(original || { buy: true, optional: false }), name, qty, quantity: qty, unit, note };
  if (!original) {
    const amount = qty == null ? "" : `${formatQty(qty) || qty}${unit ? ` ${unit}` : ""}`;
    next.text = `${amount ? `${amount} ` : ""}${name}${note ? ` (${note})` : ""}`.trim();
  }
  return next;
}

function blankIngredient(sourceIndex = null) {
  return { name: "", qty: null, quantity: null, unit: null, note: null, text: "", buy: true, optional: false, section: "other", sourceIndex };
}

function readIngredientDraft(form) {
  return [...form.querySelectorAll(".ing-edit")].map((row) => {
    const position = row.dataset.index === "new" ? null : Number(row.dataset.index);
    const baseItem = position == null ? null : ingredientBase()[position];
    const sourceIndex = baseItem && Number.isInteger(baseItem.sourceIndex) ? baseItem.sourceIndex : position;
    return { ...(buildIngredient(row) || blankIngredient(sourceIndex)), sourceIndex };
  });
}

function publishIngredient(item) {
  const { sourceIndex, ...rest } = item;
  return rest;
}

function recipeHeader(form) {
  return {
    name: String(form.name?.value || ""),
    servings: String(form.servings?.value || ""),
    totalTime: String(form.totalTime?.value || ""),
    imageUrl: String(form.imageUrl?.value || ""),
  };
}

function rememberRecipeDraft(form, ingredients) {
  state.sheet.draft = { ...recipeHeader(form), ingredients, steps: String(form.steps?.value || "") };
}

function stepLines(text) {
  return String(text || "").split(/\n/).map((line) => line.trim()).filter(Boolean);
}

function cookStepText(step) {
  return typeof step === "string" ? step : step?.text || "";
}

async function saveRecipeEdit(form) {
  const id = state.sheet?.id;
  const recipe = recipeById(id);
  if (!id || !recipe) return;
  const header = recipeHeader(form);
  const name = header.name;
  const servingsRaw = header.servings;
  const totalTime = header.totalTime;
  const imageUrl = header.imageUrl;
  const stepText = String(form.steps?.value || "");
  const base = ingredientBase();
  const rows = [...form.querySelectorAll(".ing-edit")];
  const ingredients = [];
  const indexMap = new Map();
  let ingredientsChanged = rows.length !== (recipe.ingredients || []).length;
  rows.forEach((row) => {
    const position = row.dataset.index === "new" ? null : Number(row.dataset.index);
    const baseItem = position == null ? null : base[position];
    const originalIndex = baseItem && Number.isInteger(baseItem.sourceIndex) ? baseItem.sourceIndex : position;
    const built = buildIngredient(row);
    if (!built) {
      ingredientsChanged = true;
      return;
    }
    if (originalIndex == null || built !== baseItem) ingredientsChanged = true;
    if (originalIndex != null) indexMap.set(originalIndex, ingredients.length);
    ingredients.push(publishIngredient(built));
  });
  if ((recipe.ingredients || []).some((_, index) => !indexMap.has(index))) ingredientsChanged = true;
  const droppedIngredient = (recipe.ingredients || []).some((_, index) => !indexMap.has(index));
  const lines = stepLines(stepText);
  const existingCook = recipe.cookSteps || [];
  const previousLines = existingCook.length ? existingCook.map(cookStepText) : (recipe.steps || []).filter(Boolean);
  const stepsChanged = lines.length !== previousLines.length || lines.some((line, index) => line !== previousLines[index]);
  const body = {};
  if (name !== (recipe.name || "")) body.name = name;
  const servings = Number(servingsRaw);
  if (servings !== recipe.servings) body.servings = servings;
  const nextTime = totalTime.trim() ? totalTime : null;
  if (nextTime !== (recipe.totalTime || null)) body.totalTime = nextTime;
  const nextImage = imageUrl.trim() ? imageUrl.trim() : null;
  if (nextImage !== (recipe.imageUrl || null)) body.imageUrl = nextImage;
  if (ingredientsChanged) body.ingredients = ingredients;
  if (stepsChanged || droppedIngredient) {
    if (existingCook.length) {
      const remapped = existingCook.map((step, index) => {
        const source = step && typeof step === "object" ? { ...step } : { text: cookStepText(step), minutes: null, ingredients: [] };
        if (droppedIngredient) {
          source.ingredients = (source.ingredients || []).flatMap((ref) => {
            if (typeof ref !== "number") return [ref];
            return indexMap.has(ref) ? [indexMap.get(ref)] : [];
          });
        }
        if (stepsChanged) source.text = lines[index] || "";
        return source;
      }).filter((step) => step.text);
      lines.slice(existingCook.length).forEach((text) => remapped.push({ text, minutes: null, ingredients: [] }));
      body.cookSteps = remapped;
    } else if (stepsChanged) {
      body.steps = lines;
      body.cookSteps = lines.map((text) => ({ text, minutes: null, ingredients: [] }));
    }
  }
  const draft = { ...header, ingredients: readIngredientDraft(form), steps: stepText };
  if (!Object.keys(body).length) {
    state.sheet = null;
    render();
    return;
  }
  try {
    const data = await api(`/api/recipes/${id}`, { method: "PATCH", body });
    replaceRecipe(data.recipe);
    if (state.page?.kind === "recipe" && state.page.id === id) state.page.servings = data.recipe.servings;
    if (state.todayId === id) state.todayServings = data.recipe.servings;
    state.sheet = null;
    render();
  } catch (error) {
    state.sheet = { kind: "edit-recipe", id, error: error.message, draft };
    render();
  }
}

function sheetHtml() {
  if (state.sheet?.kind === "prep") return prepSheet();
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
        <button class="sheet-delete" type="button" data-action="delete-item" data-id="${esc(item.id)}">Delete item</button>
      </form></div>`;
  }
  if (state.sheet?.kind === "recipe-menu") {
    const context = mealContext();
    const planned = context ? mealOn(context.date, context.meal) : null;
    const recipe = activeRecipe();
    return `<div class="sheet"><div class="sheet-card" role="dialog" aria-label="Recipe">
        <div class="sheet-head"><span></span><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
        ${planned ? `<button class="menu-row" type="button" data-action="change-meal">Swap meal</button>` : ""}
        ${planned ? `<button class="menu-row" type="button" data-action="remove-meal" data-id="${esc(planned.id)}">Remove</button>` : ""}
        ${recipe ? `<button class="menu-row" type="button" data-action="edit-recipe">Edit recipe</button>` : ""}
      </div></div>`;
  }
  if (state.sheet?.kind === "change-meal") return changeMealHtml();
  if (state.sheet?.kind === "edit-recipe") return editRecipeHtml();
  if (state.sheet?.kind === "cook-list") {
    const recipe = recipeById(state.page?.id);
    const factor = (state.page?.servings || recipe?.servings || 1) / (recipe?.servings || 1);
    const steps = cookSequence(recipe);
    const lines = (recipe?.ingredients || []).map((item) => scaledLine(item, factor)).filter(Boolean);
    return `<div class="sheet"><div class="sheet-card" role="dialog">
        <div class="sheet-head"><strong>Ingredients</strong><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
        ${lines.map((line) => `<p class="menu-row">${esc(unicodeFractions(line))}</p>`).join("") || `<p class="muted">No ingredients yet.</p>`}
        <div class="sheet-head"><strong>Steps</strong></div>
        ${steps.map((step, index) => `<button class="menu-row" type="button" data-action="jump-step" data-step="${index}">${index + 1}. ${esc(step.text)}</button>`).join("")}
      </div></div>`;
  }
  return "";
}

function onPointerDown(event) {
  const board = event.target.closest(".cal-board");
  if (board) {
    gesture = { kind: "cal", x: event.clientX, y: event.clientY };
    return;
  }
  const row = event.target.closest(".g-row");
  if (!row || event.target.closest(".g-check") || event.target.closest(".g-delete")) return;
  clearGesture();
  gesture = { id: row.dataset.id, x: event.clientX, y: event.clientY, long: false, dragging: false, pointerId: event.pointerId };
  gesture.timer = setTimeout(() => {
    if (!gesture || gesture.dragging) return;
    gesture.long = true;
    state.swipeId = null;
    state.sheet = { kind: "edit-item", id: gesture.id };
    render();
  }, 520);
}

function onPointerMove(event) {
  if (!gesture || gesture.kind === "cal" || gesture.pointerId !== event.pointerId) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (!gesture.dragging) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (Math.abs(dy) > Math.abs(dx)) {
      if (gesture.timer) clearTimeout(gesture.timer);
      gesture.timer = null;
      gesture.scroll = true;
      return;
    }
    gesture.dragging = true;
    if (gesture.timer) clearTimeout(gesture.timer);
    gesture.timer = null;
    event.target.closest(".g-row")?.setPointerCapture?.(event.pointerId);
  }
  if (gesture.scroll) return;
  const base = state.swipeId === gesture.id ? -96 : 0;
  const next = Math.max(-120, Math.min(0, base + dx));
  const row = document.querySelector(`.g-swipe[data-id="${cssEscape(gesture.id)}"] .g-row`);
  if (row) {
    row.style.transition = "none";
    row.style.transform = `translateX(${next}px)`;
  }
  gesture.offset = next;
}

function onPointerUp(event) {
  if (!gesture) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (gesture.kind === "cal") {
    clearGesture();
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) {
      swallowNextClick();
      shiftCalendar(dx < 0 ? 1 : -1);
    }
    return;
  }
  const id = gesture.id;
  const long = gesture.long;
  const dragging = gesture.dragging;
  const offset = gesture.offset;
  const scrolled = gesture.scroll;
  clearGesture();
  if (long || scrolled) return;
  if (dragging) {
    swallowNextClick();
    state.swipeId = (offset ?? 0) < -48 ? id : null;
    render();
    return;
  }
  if (state.swipeId === id) {
    state.swipeId = null;
    swallowNextClick();
    render();
    return;
  }
  if (dx > 48 && Math.abs(dx) > Math.abs(dy)) {
    openItem(id);
    return;
  }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) openItem(id);
}

function onPointerCancel() {
  if (!gesture) return;
  if (gesture.dragging) {
    const id = gesture.id;
    const offset = gesture.offset ?? 0;
    clearGesture();
    state.swipeId = offset < -48 ? id : null;
    render();
    return;
  }
  clearGesture();
}

function clearGesture() {
  if (gesture?.timer) clearTimeout(gesture.timer);
  gesture = null;
}

async function onClick(event) {
  if (swallowClick) {
    swallowClick = false;
    return;
  }
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
    if (state.tab === "today") state.todayPanel = "ingredients";
    state.page = null;
    state.sheet = null;
    state.swipeId = null;
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
      state.tab = "calendar";
    } else {
      state.page = null;
      if (kind === "recipe" || kind === "new-recipe") state.tab = "recipes";
    }
    render();
    return;
  }
  if (action === "plan-dinner" || action === "open-day") {
    const date = button.dataset.date || nyToday();
    if (date < nyToday()) return;
    state.tab = "calendar";
    state.page = { kind: "day", date };
    state.dayQuery = "";
    state.sheet = null;
    render();
    return;
  }
  if (action === "cal-shift") return shiftCalendar(Number(button.dataset.delta));
  if (action === "cal-mode") {
    state.calMode = state.calMode === "month" ? "week" : "month";
    if (state.calMode === "month") {
      state.calStart = `${nyToday().slice(0, 7)}-01`;
      state.monthPick = null;
    }
    state.page = null;
    render();
    refresh(true);
    return;
  }
  if (action === "select-day") {
    const date = button.dataset.date;
    if (!date || date < nyToday()) return;
    state.monthPick = date;
    render();
    return;
  }
  if (action === "open-prep") {
    state.sheet = { kind: "prep" };
    render();
    return;
  }
  if (action === "toggle-prep") {
    const key = button.dataset.key;
    state.prepDone = { ...state.prepDone, [key]: !state.prepDone[key] };
    render();
    return;
  }
  if (action === "undo-check") return undoCheck();
  if (action === "pick-recipe") return planRecipe(button.dataset.date, button.dataset.meal, button.dataset.id);
  if (action === "leftovers") return savePlanEntry(leftoversPlan(button.dataset.date, button.dataset.meal));
  if (action === "clear-meal" || action === "remove-meal") return removeMeal(button.dataset.id);
  if (action === "open-recipe") {
    const recipe = recipeById(button.dataset.id);
    const fromToday = !state.page && state.tab === "today";
    state.recipeBack = state.page?.kind === "item"
      ? { tab: "groceries", page: state.page }
      : state.tab === "calendar"
        ? { tab: "calendar", page: state.page?.kind === "day" ? state.page : null }
        : fromToday
          ? { tab: "today", page: null }
          : { tab: "recipes", page: null };
    state.tab = state.recipeBack.tab === "groceries" ? "groceries" : state.recipeBack.tab === "today" ? "today" : "recipes";
    state.page = {
      kind: "recipe",
      id: button.dataset.id,
      servings: recipe?.servings || 4,
      panel: "ingredients",
      planDate: button.dataset.date || null,
      planMeal: button.dataset.meal || null,
    };
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
    if (state.page?.kind === "recipe") state.page.panel = button.dataset.panel;
    else state.todayPanel = button.dataset.panel;
    render();
    return;
  }
  if (action === "servings-toggle") {
    if (state.page?.kind === "recipe") state.page.servingsOpen = !state.page.servingsOpen;
    else state.todayServingsOpen = !state.todayServingsOpen;
    render();
    return;
  }
  if (action === "servings") {
    const delta = Number(button.dataset.delta);
    if (state.page?.kind === "recipe") {
      const recipe = recipeById(state.page.id);
      state.page.servings = Math.min(99, Math.max(1, (state.page.servings || recipe.servings) + delta));
    } else {
      const recipe = tonightRecipe();
      state.todayServings = Math.min(99, Math.max(1, (state.todayServings || recipe?.servings || 4) + delta));
    }
    render();
    return;
  }
  if (action === "recipe-menu") {
    state.sheet = { kind: "recipe-menu", date: button.dataset.date || null, meal: button.dataset.meal || null };
    render();
    return;
  }
  if (action === "change-meal") {
    state.mealQuery = "";
    state.sheet = { kind: "change-meal", error: "", date: state.sheet?.date || null, meal: state.sheet?.meal || null };
    render();
    return;
  }
  if (action === "edit-recipe") {
    const recipe = activeRecipe();
    if (!recipe) return;
    state.sheet = { kind: "edit-recipe", id: recipe.id, error: "", date: state.sheet?.date || null, meal: state.sheet?.meal || null };
    render();
    return;
  }
  if (action === "add-ingredient" || action === "remove-ingredient") {
    const form = button.closest("form");
    if (!form || state.sheet?.kind !== "edit-recipe") return;
    const ingredients = readIngredientDraft(form);
    if (action === "remove-ingredient") {
      const index = Number(button.closest(".ing-edit")?.dataset.index);
      ingredients.splice(index, 1);
    } else {
      ingredients.push(blankIngredient(null));
    }
    rememberRecipeDraft(form, ingredients);
    render();
    if (action === "add-ingredient") document.querySelector(".ing-edit:last-of-type [name=ing-name]")?.focus();
    return;
  }
  if (action === "pick-change") return changeMeal({ type: "recipe", recipeId: button.dataset.id });
  if (action === "pick-alternate") {
    const context = mealContext();
    if (!context) return;
    const nextId = button.dataset.id;
    return changeMeal({ type: "recipe", recipeId: nextId, alternates: swappedAlternates(mealOn(context.date, context.meal), nextId) });
  }
  if (action === "pick-leftovers") {
    const context = mealContext();
    if (!context) return;
    const plan = leftoversPlan(context.date, context.meal);
    return changeMeal({ type: "leftovers", recipeId: plan.recipeId, note: plan.note });
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
  if (action === "timer-start") return startTimer(Number(button.dataset.seconds));
  if (action === "timer-cancel") return stopTimer(true);
  if (action === "mark-cooked") return markCooked(button.dataset.id);
  if (action === "feedback") {
    state.feedbackFrom = state.page?.kind === "recipe" ? "recipe" : "today";
    state.page = {
      kind: "feedback",
      id: button.dataset.id,
      planDate: state.page?.planDate || null,
      planMeal: state.page?.planMeal || null,
      servings: state.page?.kind === "recipe" ? state.page.servings : state.todayServings,
    };
    state.error = "";
    render();
    return;
  }
  if (action === "close-feedback") {
    state.page = state.feedbackFrom === "recipe"
      ? { kind: "recipe", id: state.page.id, servings: state.page.servings || recipeById(state.page.id)?.servings, panel: "ingredients", planDate: state.page.planDate || null, planMeal: state.page.planMeal || null }
      : null;
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
    state.swipeId = null;
    state.sheet = { kind: "edit-item", id: button.dataset.id };
    render();
  }
  if (action === "delete-item") return deleteGrocery(button.dataset.id);
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
  if (form.dataset.form === "edit-recipe") return saveRecipeEdit(form);
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
  if (event.target.id === "meal-search") {
    state.mealQuery = event.target.value;
    render();
    const field = document.getElementById("meal-search");
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
    return;
  }
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

async function removeMeal(id) {
  const entry = state.plan.find((item) => item.id === id);
  const snapshot = entry
    ? {
        date: entry.date,
        meal: entry.meal,
        type: entry.type,
        recipeId: entry.recipeId || null,
        note: entry.note || null,
        alternates: entry.alternates || [],
      }
    : null;
  const name = entry ? planTitle(entry) : "Meal";
  state.sheet = null;
  try {
    await api(`/api/plan/${id}`, { method: "DELETE" });
    if (snapshot) showUndo({ id, name, kind: "plan", snapshot });
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

function planRestoreBody(snapshot) {
  const body = {
    date: snapshot.date,
    meal: snapshot.meal,
    type: snapshot.type,
    alternates: snapshot.alternates || [],
  };
  if (snapshot.recipeId) body.recipeId = snapshot.recipeId;
  if (snapshot.note) body.note = snapshot.note;
  return body;
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
  const servings = state.page?.kind === "recipe" ? state.page.servings : state.todayServings;
  state.cookReturn = { page: state.page ? { ...state.page } : null, tab: state.tab };
  state.page = { kind: "cook", id, step: 0, servings: servings || recipe.servings };
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
  if (back?.tab) state.tab = back.tab;
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
    state.page = state.feedbackFrom === "recipe"
      ? { kind: "recipe", id, servings: data.recipe.servings, panel: "ingredients", planDate: state.page?.planDate || null, planMeal: state.page?.planMeal || null }
      : null;
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
  if (item.checked) {
    if (state.undo?.id === id) clearUndo();
    try {
      await api(`/api/items/${id}`, { method: "PATCH", body: { checked: false } });
      await refresh(true);
    } catch (error) {
      state.error = error.message;
      render();
    }
    return;
  }
  const generation = ++checkGeneration;
  state.checking = id;
  render();
  await wait(700);
  if (generation !== checkGeneration) return;
  document.querySelector(`.g-swipe[data-id="${cssEscape(id)}"]`)?.classList.add("is-leaving");
  await wait(220);
  if (generation !== checkGeneration) return;
  try {
    await api(`/api/items/${id}`, { method: "PATCH", body: { checked: true } });
    state.checking = null;
    showUndo({ id, name: item.name, kind: "check" });
    await refresh(true);
  } catch (error) {
    state.checking = null;
    state.error = error.message;
    render();
  }
}

async function undoCheck() {
  const undo = state.undo;
  if (!undo) return;
  checkGeneration += 1;
  clearUndo();
  state.checking = null;
  try {
    if (undo.kind === "plan") await api("/api/plan", { method: "POST", body: planRestoreBody(undo.snapshot) });
    else {
      const body = undo.kind === "delete" ? { deleted: false } : { checked: false };
      await api(`/api/items/${undo.id}`, { method: "PATCH", body });
    }
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

function clearUndo() {
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = null;
  state.undo = null;
}

function showUndo(undo) {
  state.undo = undo;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    state.undo = null;
    undoTimer = null;
    render();
  }, 5000);
}

async function deleteGrocery(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  state.sheet = null;
  state.swipeId = null;
  if (state.page?.kind === "item" && state.page.id === id) state.page = null;
  render();
  const row = document.querySelector(`.g-swipe[data-id="${cssEscape(id)}"]`);
  row?.classList.add("is-leaving");
  if (row) await wait(180);
  try {
    await api(`/api/items/${id}`, { method: "PATCH", body: { deleted: true } });
    showUndo({ id, name: item.name, kind: "delete" });
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

function toastHtml() {
  if (!state.undo) return "";
  const verb = state.undo.kind === "delete" ? "deleted" : state.undo.kind === "plan" ? "removed" : "checked off";
  return `<div class="toast" role="status"><span>${esc(state.undo.name)} ${verb}</span><button type="button" data-action="undo-check">Undo</button></div>`;
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
  state.swipeId = null;
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
  const night = (recipe.nightBefore || []).filter(Boolean).map((text) => ({ text, label: "Night before", ingredients: [] }));
  const prep = (recipe.prepSteps || []).filter(Boolean).map((text) => ({ text, label: "Prep", ingredients: [] }));
  const cook = (recipe.cookSteps || []).filter((step) => step && step.text).map((step) => ({ ...step, label: night.length || prep.length ? "Cook" : "" }));
  if (night.length || prep.length || cook.length) return [...night, ...prep, ...cook];
  return (recipe.steps || []).filter(Boolean).map((text) => ({ text, ingredients: [] }));
}

function cookSequence(recipe) {
  if (!recipe) return [];
  const prep = (recipe.prepSteps || []).filter(Boolean).map((text) => ({ text, label: "Prep", minutes: null, seconds: null, ingredients: [] }));
  const cook = (recipe.cookSteps || []).filter((step) => step && step.text).map((step) => ({
    text: step.text,
    label: prep.length ? "Cook" : "",
    minutes: step.minutes ?? null,
    seconds: step.seconds ?? null,
    ingredients: step.ingredients || [],
  }));
  const steps = [...prep, ...cook];
  if (recipe.kidsPlates) steps.push({ text: recipe.kidsPlates, label: "Kids' plates", minutes: null, seconds: null, ingredients: [] });
  if (steps.length) return steps;
  return (recipe.steps || []).filter(Boolean).map((text) => ({ text, label: "", minutes: null, seconds: null, ingredients: [] }));
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
  return unicodeFractions(split.trim());
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
  const fractions = [[1, 2, "½"], [1, 3, "⅓"], [2, 3, "⅔"], [1, 4, "¼"], [3, 4, "¾"], [1, 8, "⅛"], [3, 8, "⅜"]];
  if (fraction < 0.02) return String(whole);
  for (const [numerator, denominator, glyph] of fractions) {
    if (Math.abs(fraction - numerator / denominator) < 0.03) return whole ? `${whole} ${glyph}` : glyph;
  }
  return String(Math.round(rounded * 100) / 100);
}

function unicodeFractions(text) {
  return String(text ?? "")
    .replace(/\b1\/2\b/g, "½")
    .replace(/\b1\/3\b/g, "⅓")
    .replace(/\b2\/3\b/g, "⅔")
    .replace(/\b1\/4\b/g, "¼")
    .replace(/\b3\/4\b/g, "¾")
    .replace(/\b1\/8\b/g, "⅛")
    .replace(/\b3\/8\b/g, "⅜");
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
  const recipe = recipeForEntry(entry);
  if (entry.type === "leftovers") return recipe ? `Leftovers · ${recipe.name}` : entry.note ? `Leftovers · ${entry.note}` : "Leftovers";
  if (entry.type === "note") return entry.note || "Note";
  return entry.recipeName || recipe?.name || "Recipe";
}

function recipeForEntry(entry) {
  if (!entry) return null;
  if (entry.recipeId) {
    return withPhoto(recipeById(entry.recipeId), entry) || {
      id: entry.recipeId,
      name: entry.recipeName || "Recipe",
      imageUrl: entry.imageUrl || null,
      servings: 4,
      ingredients: [],
      cookSteps: [],
      prepSteps: [],
      nightBefore: [],
    };
  }
  if (entry.type !== "leftovers") return null;
  const note = (entry.note || "").trim().toLowerCase();
  if (note) {
    const named = state.recipes.find((recipe) => recipe.name.toLowerCase() === note);
    if (named) return withPhoto(named, entry);
  }
  const earlier = state.plan
    .filter((other) => other.type === "recipe" && other.recipeId && other.meal === entry.meal && other.date < entry.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const previous = earlier[0];
  if (!previous) return null;
  const recipe = recipeById(previous.recipeId);
  const gap = daysBetween(previous.date, entry.date);
  const cover = recipe?.coversNights > 1 ? recipe.coversNights - 1 : 6;
  return gap >= 1 && gap <= cover ? withPhoto(recipe, previous) : null;
}

function withPhoto(recipe, entry) {
  if (!recipe) return null;
  const imageUrl = recipe.imageUrl || entry?.imageUrl || null;
  return imageUrl && imageUrl !== recipe.imageUrl ? { ...recipe, imageUrl } : recipe;
}

function tonightRecipe() {
  return recipeForEntry(mealOn(nyToday(), "dinner"));
}

function swappedAlternates(entry, nextId) {
  const previous = (entry?.alternates || []).filter((id) => id && id !== nextId);
  const oldId = entry?.type === "recipe" ? entry.recipeId : null;
  const next = [];
  if (oldId && oldId !== nextId) next.push(oldId);
  for (const id of previous) if (!next.includes(id)) next.push(id);
  return next.slice(0, 3);
}

function leftoversPlan(date, meal) {
  const current = mealOn(date, meal);
  const source = leftoverSource(date, meal);
  const note = current?.note || source?.name || null;
  const recipeId = current?.note ? current.recipeId || source?.id || null : source?.id || current?.recipeId || null;
  const body = { date, meal, type: "leftovers" };
  if (recipeId) body.recipeId = recipeId;
  if (note) body.note = note;
  return body;
}

function leftoverSource(date, meal) {
  const earlier = state.plan
    .filter((entry) => entry.type === "recipe" && entry.recipeId && entry.meal === meal && entry.date < date)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return earlier[0] ? recipeById(earlier[0].recipeId) : null;
}

function canShiftMonth(delta) {
  if (delta > 0) return true;
  const current = state.calStart || `${nyToday().slice(0, 7)}-01`;
  const [year, month] = current.split("-").map(Number);
  const previousLast = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
  return previousLast >= nyToday();
}

function shiftCalendar(delta) {
  if (state.calMode !== "month" || !canShiftMonth(delta)) return;
  const current = state.calStart || `${nyToday().slice(0, 7)}-01`;
  const [year, month] = current.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  state.calStart = next.toISOString().slice(0, 10);
  state.monthPick = null;
  render();
  refresh(true);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
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
  const today = nyToday();
  if (state.calMode === "month") {
    const start = state.calStart || `${today.slice(0, 7)}-01`;
    const gridStart = mondayOf(`${start.slice(0, 7)}-01`);
    const gridEnd = addDays(gridStart, 41);
    let from = gridStart;
    if (daysBetween(from, gridEnd) > 60) from = addDays(gridEnd, -60);
    return { from, to: gridEnd };
  }
  const end = state.page?.kind === "day" && state.page.date > addDays(today, 6) ? state.page.date : addDays(today, 6);
  return { from: today, to: addDays(end, 1) };
}
function formatUtc(iso, options) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(new Date(Date.UTC(year, month - 1, day)));
}
function longDate(iso) {
  return formatUtc(iso, { weekday: "long", month: "long", day: "numeric" });
}
function shortDate(iso) {
  return `${formatUtc(iso, { weekday: "short" })} ${Number(iso.slice(8))}`;
}
function photo(url) {
  return url ? `<img class="photo-frame fallback-photo" src="${esc(safeSrc(url))}" alt="">` : "";
}
function onPhotoError(event) {
  const img = event.target;
  if (!img || img.tagName !== "IMG" || !img.classList.contains("fallback-photo")) return;
  const hero = img.closest(".hero");
  const tile = document.createElement("span");
  tile.setAttribute("aria-hidden", "true");
  tile.innerHTML = plateIcon();
  if (hero) {
    hero.classList.add("hero-empty");
    tile.className = "hero-mark";
  } else if (img.classList.contains("photo-edge") || img.classList.contains("photo-frame")) {
    tile.className = "photo-fallback";
  } else {
    tile.className = "thumb-tile";
  }
  img.replaceWith(tile);
}
function timerSpec(step) {
  if (step.seconds) return { seconds: Number(step.seconds), label: `${step.seconds} sec` };
  if (typeof step.minutes === "string") {
    const text = step.minutes.trim().toLowerCase().replace(/[–—]/g, "-");
    const range = /^(\d+)\s*-\s*(\d+)/.exec(text);
    if (range) return { seconds: Number(range[2]) * 60, label: `${range[1]}–${range[2]} min` };
    const secs = /^(\d+)\s*sec/.exec(text);
    if (secs) return { seconds: Number(secs[1]), label: `${secs[1]} sec` };
    const mins = /^(\d+)/.exec(text);
    if (mins) return { seconds: Number(mins[1]) * 60, label: `${mins[1]} min` };
  }
  if (typeof step.minutes === "number" && step.minutes > 0) return { seconds: step.minutes * 60, label: `${step.minutes} min` };
  const text = step.text || "";
  const range = /(\d+)\s*[-–—]\s*(\d+)\s*(?:min|minutes)\b/i.exec(text);
  if (range) return { seconds: Number(range[2]) * 60, label: `${range[1]}–${range[2]} min` };
  const secs = /(\d+)\s*(?:sec|seconds)\b/i.exec(text);
  if (secs) return { seconds: Number(secs[1]), label: `${secs[1]} sec` };
  const mins = /(\d+)\s*(?:min|minutes)\b/i.exec(text);
  if (mins) return { seconds: Number(mins[1]) * 60, label: `${mins[1]} min` };
  return null;
}

function timerHtml(step, index) {
  const spec = timerSpec(step);
  if (!spec) return "";
  const timer = state.timer;
  if (timer && timer.step === index && timer.done) return `<p class="timer">Time's up</p>`;
  if (timer && timer.step === index) return `<p class="timer">${formatClock(timer.remaining)}</p><button class="gray-btn" type="button" data-action="timer-cancel">Cancel timer</button>`;
  return `<button class="gray-btn" type="button" data-action="timer-start" data-seconds="${spec.seconds}">Start ${esc(spec.label)} timer</button>`;
}
function formatClock(totalSeconds) {
  const seconds = Math.max(0, totalSeconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function startTimer(seconds) {
  stopTimer(false);
  const step = state.page?.step || 0;
  const total = Math.max(1, Number(seconds) || 0);
  state.timer = { step, remaining: total, endsAt: Date.now() + total * 1000, done: false };
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
  try {
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    /* The browser can refuse the lock. Cooking still works. */
  }
}
function unlockScreen() {
  const current = wakeLock;
  wakeLock = null;
  current?.release?.().catch(() => {});
}
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
function recipeThumb(recipe) {
  if (recipe.imageUrl) return `<img class="thumb fallback-photo" src="${esc(safeSrc(recipe.imageUrl))}" alt="">`;
  return `<span class="thumb-tile" aria-hidden="true">${plateIcon()}</span>`;
}

function markImg(size) {
  return `<img class="app-mark" src="/mark.svg" alt="" width="${size}" height="${size}">`;
}

function plateIcon() {
  return markImg(76);
}

function heart(on) {
  return `<svg viewBox="0 0 24 24" width="28" height="28" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"/></svg>`;
}
function chevLeft() { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#222" stroke-width="2.4"><path d="M15 5 8 12l7 7"/></svg>`; }
function chevRight() { return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#222" stroke-width="2.4"><path d="m9 5 7 7-7 7"/></svg>`; }
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
