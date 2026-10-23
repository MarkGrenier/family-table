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
  stores: [],
  recipeQuery: "",
  recipeSort: "favorites",
  addQuery: "",
  pickBack: null,
  addOrigin: null,
  notice: "",
  error: "",
  loginError: "",
  passcode: "",
  showMeals: {},
  doneOpen: false,
  timer: null,
  timerHandle: null,
  stars: 0,
  comment: "",
  calMode: "week",
  calStart: null,
  monthPick: null,
  weekPick: null,
  scrollTo: null,
  prepDone: {},
  undo: null,
  undoFading: false,
  swipeId: null,
  addDraft: blankAddDraft(),
  todayPanel: "ingredients",
  todayServings: null,
  todayServingsOpen: false,
  todayId: null,
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

const AISLE_GROUPS = [
  ["produce", "Produce"],
  ["shelf", "Shelf-stable"],
  ["refrigerated", "Refrigerated"],
  ["frozen", "Frozen"],
];

function blankAddDraft() {
  return { quantityNote: "", store: "local", category: "shelf", section: "other", notes: "", fresh: false, sectionTouched: false };
}

const app = document.getElementById("app");
app.addEventListener("click", onClick);
app.addEventListener("keydown", onKeyDown);
app.addEventListener("error", onPhotoError, true);
app.addEventListener("submit", onSubmit);
app.addEventListener("input", onInput);
app.addEventListener("pointerdown", onPointerDown);
app.addEventListener("pointermove", onPointerMove);
app.addEventListener("pointerup", onPointerUp);
app.addEventListener("pointercancel", onPointerCancel);
app.addEventListener("touchmove", (event) => {
  if (gesture?.kind !== "back") return;
  const touch = event.touches[0];
  if (!touch) return;
  const dx = touch.clientX - gesture.x;
  const dy = touch.clientY - gesture.y;
  if (!gesture.dragging && !(dx > 8 && dx > Math.abs(dy))) return;
  if (event.cancelable) event.preventDefault();
}, { passive: false });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.page?.kind === "cook") lockScreen();
});
document.addEventListener("scroll", () => {
  if (state.swipeId || gesture?.dragging) avoidFab();
}, true);

let gesture = null;
let wakeLock = null;
let undoTimer = null;
let undoFadeTimer = null;
const UNDO_MS = 2000;
const UNDO_FADE_MS = 400;
const CHECK_HOLD_MS = 600;
const CHECK_LEAVE_MS = 380;
const EDGE_PX = 30;
const BACK_LOCK_PX = 10;
const BACK_FLICK_PX = 16;
const BACK_FLICK_V = 0.35;
const BACK_SNAP_MS = 200;
const BACK_UNDER = 0.28;
const BACK_SELECTOR = '[data-action="back"], [data-action="close-sheet"], [data-action="close-cook"], [data-action="close-feedback"], [data-action="cancel-pick"], [data-action="plan-cancel"]';
let noticeTimer = null;
let renderQueued = false;
const checkouts = new Map();
const desiredChecked = new Map();
const checkFlight = new Map();
let refreshSerial = 0;
let planSerial = 0;
const pendingDeletes = new Set();
const pendingAlso = new Set();
const pendingSlots = new Map();
const deleteJobs = new Map();
const removeSerial = new Map();
let swallowClick = false;
let edgeClick = false;
let backSettle = 0;
let edgeAnimating = 0;
let viewKeySeen = "";

function swallowNextClick() {
  swallowClick = true;
  setTimeout(() => {
    swallowClick = false;
  }, 0);
}

boot();
setInterval(() => refresh(false), 5000);

const SPLASH_MS = 1500;

async function boot() {
  const started = performance.now();
  const fonts = splashFonts();
  if (app.dataset.session === "0") state.authed = false;
  const me = await fetch("/api/items");
  const typed = document.getElementById("passcode");
  if (typed) state.passcode = typed.value;
  state.authed = me.status !== 401;
  if (state.authed) await refresh(true);
  await fonts;
  const remain = SPLASH_MS - (performance.now() - started);
  if (remain > 0) await wait(remain);
  state.loading = false;
  render();
  dismissSplash();
}

async function splashFonts() {
  if (!document.fonts?.load) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load("italic 450 26px Fraunces"),
        document.fonts.load("640 46px Fraunces"),
      ]),
      wait(800),
    ]);
  } catch {
    /* The lockup still reads in the fallback serif. */
  }
}

function dismissSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  splash.classList.add("is-done");
  const remove = () => splash.remove();
  splash.addEventListener("transitionend", remove, { once: true });
  setTimeout(remove, 360);
}

async function refresh(force) {
  if (!state.authed) return;
  if (checkouts.size && !force) return;
  const serial = ++refreshSerial;
  try {
    const range = visibleRange();
    const [items, recipes, plan, events, stores] = await Promise.all([
      api("/api/items"),
      api("/api/recipes"),
      api(`/api/plan?from=${range.from}&to=${range.to}`),
      api(`/api/events?from=${range.from}&to=${range.to}`),
      api("/api/stores"),
    ]);
    if (serial !== refreshSerial) return;
    state.items = items.items || [];
    state.stores = stores.stores || [];
    state.recipes = recipes.recipes || [];
    state.plan = applyPlanPending(mergeDated(state.plan, plan.plan || [], range));
    state.events = mergeDated(state.events, events.events || [], range);
    state.error = "";
    if ((force || !isTyping()) && !gesture?.dragging && gesture?.kind !== "back" && !edgeAnimating) render();
  } catch (error) {
    if (serial !== refreshSerial) return;
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
  if (page.kind === "pick") return `pick:${page.date}:${page.meal || "dinner"}`;
  if (page.kind === "feedback") return `feedback:${page.id}`;
  if (page.kind === "item") return `item:${page.id}`;
  return page.kind;
}

function scrollToTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function render(force = false) {
  if (!force && deferGroceryPaint()) {
    renderQueued = true;
    paintToast();
    paintBadge();
    return;
  }
  renderQueued = false;
  const key = viewKey();
  const moved = key !== viewKeySeen;
  if (moved && key.startsWith("tab:today")) state.todayPanel = "ingredients";
  viewKeySeen = key;
  const finish = () => {
    if (moved) scrollToTop();
    if (state.scrollTo) {
      const id = state.scrollTo;
      state.scrollTo = null;
      document.getElementById(id)?.scrollIntoView({ block: "center" });
    }
    avoidFab();
    markSwipeBack();
  };
  if (state.loading) {
    finish();
    return;
  }
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
  app.innerHTML = appHtml();
  const focus = document.getElementById("add-search");
  if (focus && state.page?.kind === "add-item") focus.focus();
  finish();
}

function appHtml() {
  if (state.page?.kind === "cook") return cookHtml() + sheetHtml();
  const bare = ["recipe", "feedback", "item", "add-item"].includes(state.page?.kind);
  const dinnerTonight = state.tab === "today" && !state.page ? mealOn(nyToday(), "dinner") : null;
  const dayDinner = state.page?.kind === "day" ? mealOn(state.page.date, "dinner") : null;
  const todayCook = dinnerTonight?.type === "recipe" && Boolean(recipeForEntry(dinnerTonight));
  const leftoversNightOn =
    (dinnerTonight?.type === "leftovers" && !(dinnerTonight.also || []).length) ||
    (dayDinner?.type === "leftovers" && !(dayDinner.also || []).length);
  const monthOn = state.tab === "calendar" && state.calMode === "month" && !state.page;
  const groceryOn = state.tab === "groceries" && !state.page;
  const mainClass = bare ? "bare" : todayCook ? "screen today-screen" : leftoversNightOn ? "screen today-screen no-dock night-screen" : monthOn ? "screen month-screen" : groceryOn ? "screen grocery-screen" : "screen";
  return `<main class="${mainClass}">${bodyHtml()}</main>${bare ? "" : tabsHtml()}${sheetHtml()}${toastHtml()}`;
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
  if (state.page?.kind === "pick") return pickHtml();
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
  const today = nyToday();
  const count = state.items.filter((item) => !item.checked && !freshWaiting(item, today)).length;
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
  if (dinner?.type === "leftovers" && !(dinner.also || []).length) {
    const night = leftoversNight(dinner, recipe);
    return `${todayHead()}${night}`;
  }
  if (recipe && dinner) {
    if (state.todayId !== recipe.id) {
      state.todayId = recipe.id;
      state.todayServings = recipe.servings || 4;
      state.todayPanel = "ingredients";
      state.todayServingsOpen = false;
    }
  }
  return `${todayHead()}${recipe && dinner ? recipeView(recipe, "today") : emptyTonight()}
    ${eventsHtml(events)}
    ${recipe ? cookDock(recipe, true) : ""}`;
}

function todayHead() {
  return `<div class="today-head"><h1>Today</h1></div>`;
}

function leftoversNight(entry, recipe, options = {}) {
  const photo = foodPhoto(recipe, entry);
  const back = options.back ? `<button class="float left" type="button" data-action="back" aria-label="Back">${chevLeft()}</button>` : "";
  const remove = options.remove ? `<button class="text-green night-remove" type="button" data-action="clear-meal" data-id="${esc(entry.id)}">Remove</button>` : "";
  return `<article class="leftover-night">
      <div class="hero night-hero">
        <img class="fallback-photo" src="${esc(photo || "/photos/leftovers-hero.jpg")}" alt="">
        ${back}
        <button class="float right" type="button" data-action="recipe-menu" data-id="${esc(entry.id)}" data-date="${esc(entry.date)}" data-meal="${esc(entry.meal)}"${options.back ? "" : ` data-from="today"`} aria-label="More">${dots()}</button>
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

function leftoversRow(entry, recipe, scope) {
  const thumb = recipe ? recipeThumb(recipe) : `<span class="thumb-tile" aria-hidden="true">${plateIcon()}</span>`;
  return `<div class="leftover-row">${thumb}
      <button class="copy" type="button" data-action="open-day" data-date="${esc(entry.date)}">
        <strong>${esc(dishName(entry, recipe))}</strong>
        <span class="leftover-meta"><span class="meal-kind">${esc(mealLabel(entry.meal))}</span><span class="lo-pill">Leftovers</span></span>
      </button>
      ${mealMenu(entry, scope)}
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
  const today = date === nyToday();
  const label = today ? `Today · ${shortDate(date)}` : shortDate(date);
  return `<section class="month-panel" id="month-panel">
      <div class="month-panel-head${today ? " is-today" : ""}"><p class="week-date">${esc(label)}</p>${addDinnerButton(date)}</div>
      ${meals.length ? meals.map((entry) => mealRow(entry, "calendar")).join("") : `<p class="week-empty">Nothing planned</p>`}
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
  const picked = state.weekPick === date;
  return `<section class="week-day${today ? " is-today" : ""}${picked ? " is-picked" : ""}" id="week-${esc(date)}">
      <div class="week-day-head"><button class="week-date" type="button" data-action="open-day" data-date="${esc(date)}">${esc(label)}</button>${addDinnerButton(date)}</div>
      ${meals.length ? meals.map((entry) => mealRow(entry, "calendar")).join("") : `<button class="week-empty" type="button" data-action="open-day" data-date="${esc(date)}">Nothing planned</button>`}
      ${events.map((event) => `<p class="event-line">${event.time ? `<time>${esc(event.time)}</time>` : ""}${esc(event.title)}</p>`).join("")}
    </section>`;
}

function addDinnerButton(date) {
  if (!date || date < nyToday() || mealOn(date, "dinner")) return "";
  return `<button class="icon-btn add-plus" type="button" data-action="add-meal" data-date="${esc(date)}" data-meal="dinner" aria-label="Add dinner">${plus()}</button>`;
}

function mealMenu(entry, scope) {
  const from = scope ? ` data-from="${scope}"` : "";
  return `<button class="icon-btn" type="button" data-action="recipe-menu" data-id="${esc(entry.id)}" data-date="${esc(entry.date)}" data-meal="${esc(entry.meal)}"${from} aria-label="More">${dots()}</button>`;
}

function mealRow(entry, scope) {
  const recipe = recipeForEntry(entry);
  if (entry.type === "leftovers") return leftoversRow(entry, recipe, scope);
  const title = planTitle(entry);
  const meal = mealLabel(entry.meal);
  if (!recipe) {
    return `<div class="meal-row meal-line"><button class="meal-open" type="button" data-action="open-day" data-date="${esc(entry.date)}"><span class="meal-copy"><strong>${esc(title)}</strong><span>${esc(meal)}</span></span></button>${mealMenu(entry, scope)}</div>`;
  }
  return `<div class="meal-row meal-line"><button class="meal-open" type="button" data-action="open-recipe" data-id="${esc(recipe.id)}" data-date="${esc(entry.date)}" data-meal="${esc(entry.meal)}">${recipeThumb(recipe)}<span class="meal-copy"><strong>${esc(title)}</strong><span>${esc(meal)}</span></span></button>${mealMenu(entry, scope)}</div>`;
}

function mealLabel(meal) {
  if (meal === "breakfast") return "Breakfast";
  if (meal === "lunch") return "Lunch";
  return "Dinner";
}

function monthGrid(iso, selected, action = "select-day") {
  const [year, month] = iso.split("-").map(Number);
  const first = `${iso.slice(0, 7)}-01`;
  const start = sundayOf(first);
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(start, index);
    if (index >= 35 && Number(date.slice(5, 7)) !== month) break;
    cells.push(date);
  }
  const names = ["S", "M", "T", "W", "T", "F", "S"];
  return `<div class="month-names">${names.map((name) => `<span>${name}</span>`).join("")}</div>
    <div class="month-grid">${cells.map((date) => monthCell(date, Number(date.slice(5, 7)) === month, selected, action)).join("")}</div>`;
}

function monthCell(date, inMonth, selected, action = "select-day") {
  const today = date === nyToday();
  const past = date < nyToday();
  const planned = inMonth && !past && (mealsOn(date).length > 0 || eventsOn(date).length > 0);
  const open = inMonth && !past;
  const picked = open && date === selected;
  return `<div class="month-cell${inMonth ? "" : " is-out"}${today ? " is-today" : ""}${past ? " is-past" : ""}${picked ? " is-picked" : ""}">
      <button type="button" ${open ? `data-action="${action}" data-date="${esc(date)}" aria-pressed="${picked ? "true" : "false"}"` : "disabled"}>${Number(date.slice(8))}<span class="dot${planned ? " is-on" : ""}"></span></button>
    </div>`;
}


function mealsOn(date) {
  const rows = [];
  for (const meal of ["breakfast", "lunch", "dinner"]) {
    const entry = mealOn(date, meal);
    if (!entry) continue;
    rows.push(entry);
    for (const recipeId of entry.also || []) {
      if (!recipeId || recipeId === entry.recipeId) continue;
      const extra = entryById(`${entry.id}:also:${recipeId}`);
      if (extra) rows.push(extra);
    }
  }
  return rows;
}

function entryById(id) {
  if (!id) return null;
  const match = /^(.*):also:(.+)$/.exec(id);
  if (!match) return state.plan.find((entry) => entry.id === id) || null;
  const parent = state.plan.find((entry) => entry.id === match[1]);
  if (!parent) return null;
  const recipe = recipeById(match[2]);
  return {
    id,
    parentId: parent.id,
    date: parent.date,
    meal: parent.meal,
    type: "recipe",
    recipeId: match[2],
    recipeName: recipe?.name || "Recipe",
    imageUrl: recipe?.imageUrl || null,
    note: null,
    alternates: [],
    also: [],
  };
}

function pickHtml() {
  const date = state.page.date;
  const meal = state.page.meal || "dinner";
  const mealName = meal === "lunch" ? "lunch" : meal === "breakfast" ? "breakfast" : "dinner";
  const label = formatUtc(date, { weekday: "short", month: "short", day: "numeric" });
  return `<div class="sheet pick-sheet"><div class="sheet-card pick-card" role="dialog" aria-label="Pick a recipe">
    <div class="pick-bar"><button class="text-green" type="button" data-action="cancel-pick">Cancel</button><h1>Pick ${esc(mealName)} for ${esc(label)}</h1></div>
    ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
    <label class="search">
      <input id="recipe-search" class="field-box" type="search" value="${esc(state.recipeQuery)}" placeholder="Search recipes" aria-label="Search recipes" autocomplete="off">
    </label>
    <div class="sort" role="group" aria-label="Sort recipes">
      ${sortButton("favorites", "Favorites")}${sortButton("recent", "Recent")}${sortButton("az", "A-Z")}
    </div>
    <div id="recipe-list">${recipeListHtml()}</div>
  </div></div>`;
}

function recipesHtml() {
  return `<div class="recipes-head"><h1>Recipes</h1></div>
    <label class="search">
      <input id="recipe-search" class="field-box" type="search" value="${esc(state.recipeQuery)}" placeholder="Search recipes" aria-label="Search recipes" autocomplete="off">
    </label>
    <div class="sort" role="group" aria-label="Sort recipes">
      ${sortButton("favorites", "Favorites")}${sortButton("recent", "Recent")}${sortButton("az", "A-Z")}
    </div>
    <div id="recipe-list">${recipeListHtml()}</div>`;
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

function recipeListHtml() {
  const recipes = visibleRecipes();
  if (state.page?.kind !== "pick") return recipeList(recipes);
  return recipeList(recipes, { pick: true, date: state.page.date, meal: state.page.meal || "dinner" });
}

function recipeList(recipes, options) {
  if (!recipes.length) return `<p class="empty">${state.recipeQuery ? "Nothing matches that." : "No recipes yet."}</p>`;
  return recipeRows(recipes, options);
}

function recipeRows(recipes, options = {}) {
  const action = options.pick ? "pick-recipe" : "open-recipe";
  const when = options.pick ? ` data-date="${esc(options.date)}" data-meal="${esc(options.meal)}"` : "";
  return recipes.map((recipe) => `<div class="recipe-row${options.pick ? " is-pick" : ""}" data-id="${esc(recipe.id)}">
      <button type="button" data-action="${action}" data-id="${esc(recipe.id)}"${when} class="recipe-open">
        ${recipeThumb(recipe)}
        <span class="recipe-copy"><span class="recipe-name">${esc(recipe.name)}</span>${recipe.needsReview ? `<span class="review-pill">Needs a look</span>` : ""}${lastMadeText(recipe) ? `<span class="small">${esc(lastMadeText(recipe))}</span>` : ""}</span>
      </button>
      ${options.pick ? "" : `<span class="recipe-actions"><button class="icon-btn add-plus" type="button" data-action="add-to-date" data-id="${esc(recipe.id)}" aria-label="Add to date">${plus()}</button><button class="icon-btn" type="button" data-action="recipe-row-menu" data-id="${esc(recipe.id)}" aria-label="More">${dots()}</button><button class="heart${recipe.favorite ? " is-on" : ""}" type="button" data-action="favorite" data-id="${esc(recipe.id)}" aria-label="${recipe.favorite ? "Unfavorite" : "Favorite"}">${heart(recipe.favorite)}</button></span>`}
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
  const tonight = mode === "today" ? mealOn(nyToday(), "dinner") : null;
  return `${hero(recipe, !embedded, tag, tonight)}
    <div class="pad">
      ${mode === "leftovers" ? `<span class="lo-pill">Leftovers</span>` : ""}
      <div class="title-row"><h1>${esc(recipe.name)}</h1>
        <button class="heart${recipe.favorite ? " is-on" : ""}" type="button" data-action="favorite" data-id="${esc(recipe.id)}" aria-label="Favorite">${heart(recipe.favorite)}</button>
      </div>
      ${mode === "page" ? `<button class="outline-btn add-date" type="button" data-action="add-to-date" data-id="${esc(recipe.id)}">Add to date</button>` : ""}
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
      ${cooked ? `<div class="cooked-pill">✓ Cooked</div><button class="gray-btn" type="button" data-action="feedback" data-id="${esc(recipe.id)}">Give Feedback</button>` : `<button class="outline-btn" type="button" data-action="mark-cooked" data-id="${esc(recipe.id)}">${checkOutline()} Cooked</button>${start}`}
    </div>`;
}

function hero(recipe, showBack, prepTag = "", entry = null) {
  const today = entry
    ? ` data-from="today" data-id="${esc(entry.id)}" data-date="${esc(entry.date)}" data-meal="${esc(entry.meal)}"`
    : "";
  const menu = `<button class="float right" type="button" data-action="recipe-menu"${today} aria-label="More">${dots()}</button>`;
  const add = showBack && !entry ? `<button class="float right add-float" type="button" data-action="add-to-date" data-id="${esc(recipe.id)}" aria-label="Add to date">${plus()}</button>` : "";
  const back = showBack ? `<button class="float left" type="button" data-action="back" aria-label="Back">${chevLeft()}</button>` : "";
  if (!recipe.imageUrl) {
    return `<div class="hero hero-empty">${back}<span class="hero-mark" aria-hidden="true">${plateIcon()}</span>${prepTag}${add}${menu}</div>`;
  }
  return `<div class="hero"><img class="fallback-photo" src="${esc(safeSrc(recipe.imageUrl))}" alt="">
      ${back}
      ${prepTag}
      ${add}
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
  const today = nyToday();
  const open = state.items.filter((item) => !item.checked || checkouts.has(item.id));
  const buyToday = [];
  const freshByStore = new Map();
  const rest = [];
  for (const item of open) {
    if (item.fresh && item.dueDate && item.dueDate <= today) buyToday.push(item);
    else if (freshWaiting(item, today)) {
      const id = storeIdOf(item);
      if (!freshByStore.has(id)) freshByStore.set(id, []);
      freshByStore.get(id).push(item);
    } else rest.push(item);
  }
  for (const waiting of freshByStore.values()) {
    waiting.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.name.localeCompare(b.name));
  }
  const byStore = new Map();
  for (const item of rest) {
    const id = storeIdOf(item);
    if (!byStore.has(id)) byStore.set(id, []);
    byStore.get(id).push(item);
  }
  const ordered = [];
  const seen = new Set();
  const consider = (id) => {
    if (seen.has(id) || (!byStore.has(id) && !freshByStore.has(id))) return;
    seen.add(id);
    ordered.push(id);
  };
  for (const store of state.stores || []) consider(store.id);
  for (const id of byStore.keys()) if (id) consider(id);
  for (const id of freshByStore.keys()) if (id) consider(id);
  consider("");
  const blocks = ordered.map((id) => {
    const items = byStore.get(id) || [];
    const store = (state.stores || []).find((entry) => entry.id === id);
    const label = id ? store?.name || "Store" : "No store";
    const aisles = AISLE_GROUPS.map(([aisle, aisleLabel]) => ({
      label: aisleLabel,
      items: items.filter((item) => aisleOf(item) === aisle),
    })).filter((group) => group.items.length);
    return { label, aisles, waiting: freshByStore.get(id) || [] };
  }).filter((block) => block.aisles.length || block.waiting.length);
  const done = state.items.filter((item) => item.checked && !checkouts.has(item.id));
  const body = blocks.map((block) => {
    const aisles = block.aisles.map((aisle) => `<h3 class="aisle-head">${esc(aisle.label)}</h3>${aisle.items.map((item) => groceryRow(item)).join("")}`).join("");
    const waiting = block.waiting.map((item) => groceryRow(item, buyHint(item))).join("");
    const fresh = waiting ? `<h3 class="aisle-head">Fresh</h3>${waiting}` : "";
    return `<h2 class="section-head store-head">${esc(block.label)}</h2>${aisles}${fresh}`;
  }).join("");
  const clear = !body && !buyToday.length;
  return `<div class="title-row"><h1>Groceries</h1><button class="icon-green" type="button" data-action="grocery-menu" aria-label="List options">${dots()}</button></div>
    ${buyToday.length ? `<h2 class="section-head">Buy today</h2>${buyToday.map((item) => groceryRow(item)).join("")}` : ""}
    ${body}
    ${clear ? `<p class="empty">The list is clear.</p>` : ""}
    ${state.doneOpen && done.length ? `<h2 class="section-head">Completed</h2>${done.map((item) => groceryRow(item)).join("")}` : ""}
    <button class="fab" type="button" data-action="add-item" aria-label="Add">+</button>`;
}

function groceryRow(item, hint) {
  const phase = checkouts.get(item.id)?.phase;
  const done = item.checked || Boolean(phase);
  const open = state.swipeId === item.id;
  const leaving = phase === "leave" ? " is-checking-out" : "";
  return `<div class="g-swipe${open ? " is-open" : ""}${leaving}" data-id="${esc(item.id)}">
      <div class="g-clip">
      <button class="g-delete" type="button" data-action="delete-item" data-id="${esc(item.id)}">Delete</button>
      <div class="g-row${done ? " is-done" : ""}" data-id="${esc(item.id)}">
        <button class="check${done ? " is-on" : ""} g-check" type="button" data-action="toggle-item" data-id="${esc(item.id)}" aria-label="${done ? "Put back" : "Mark bought"} ${esc(item.name)}">${done ? checkIcon() : ""}</button>
        <span class="g-name">${esc(item.name)}${hint ? `<span class="buy-hint">${esc(hint)}</span>` : ""}</span>
        <span class="qty">${esc(qtyOf(item))}</span>
      </div>
      </div>
    </div>`;
}

function freshWaiting(item, today) {
  return Boolean(item.fresh) && !(item.dueDate && item.dueDate <= today);
}

function buyHint(item) {
  if (!item.dueDate) return "";
  return `Buy ${formatUtc(item.dueDate, { weekday: "short" })}`;
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
  const draft = state.addDraft || blankAddDraft();
  const names = filteredSuggestions();
  const section = draft.sectionTouched ? draft.section : state.addQuery.trim() ? guessSection(state.addQuery) : "other";
  return `<div class="sheet add-sheet"><form id="add-form" class="add-form sheet-card" data-form="add-item">
      <div class="topbar"><button class="back" type="button" data-action="back" aria-label="Close">✕</button><h1>Add</h1><span></span></div>
      <div class="pad">
        <input id="add-search" name="name" class="search-box" type="text" placeholder="Add something..." value="${esc(state.addQuery)}" maxlength="80" autocomplete="off" enterkeyhint="done" aria-label="Name">
        <label class="field-label">Quantity<input class="field-box" name="quantityNote" maxlength="140" value="${esc(draft.quantityNote)}" placeholder="2 lb, a bunch" enterkeyhint="done"></label>
        <label class="field-label">Section<span class="select-wrap"><select class="box" name="section">${choiceHtml(SECTIONS, section)}</select></span></label>
        ${storeFieldHtml(draft.store)}
        ${freshRowHtml(draft.fresh)}
        <label class="field-label">Note<input class="field-box" name="notes" maxlength="500" value="${esc(draft.notes)}" enterkeyhint="done"></label>
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
        <button class="green-btn" type="submit">Add</button>
        <div id="suggest-list">${suggestHtml(names)}</div>
      </div>
    </form></div>`;
}

function newRecipeHtml() {
  return `<div class="pad"><button class="text-green" type="button" data-action="back">Recipes</button><h1>Add a recipe</h1>
    <form data-form="fetch-recipe" class="stack"><input class="field-box" name="url" type="url" placeholder="Paste a link"><button class="green-btn" type="submit">Fetch recipe</button></form>
    ${state.page.error ? `<p class="error">${esc(state.page.error)}</p>` : ""}</div>`;
}

function mealContext() {
  const sheet = state.sheet;
  if (sheet?.date && sheet?.meal && (sheet.kind === "recipe-menu" || sheet.kind === "edit-recipe")) {
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
  if (state.sheet?.entryId) {
    const planned = recipeForEntry(entryById(state.sheet.entryId));
    if (planned) return recipeById(planned.id) || planned;
  }
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
    return `<div class="sheet"><form class="sheet-card" data-form="item-edit" role="dialog" aria-label="Edit item">
        <div class="sheet-head"><button class="text-green" type="button" data-action="close-sheet">Cancel</button><button class="text-green" type="submit">Done</button></div>
        <label class="field-label">Name<input class="field-box" name="name" required maxlength="80" value="${esc(item.name)}"></label>
        <label class="field-label">Quantity<input class="field-box" name="quantityNote" maxlength="140" value="${esc(qtyOf(item))}"></label>
        <label class="field-label">Section<span class="select-wrap"><select class="box" name="section">${choiceHtml(SECTIONS, item.section || "other")}</select></span></label>
        ${storeFieldHtml(storeIdOf(item))}
        ${freshRowHtml(item.fresh)}
        <label class="field-label">Note<input class="field-box" name="notes" maxlength="500" value="${esc(item.notes || "")}" enterkeyhint="done"></label>
      </form></div>`;
  }
  if (state.sheet?.kind === "recipe-menu") {
    const mealMenu = Boolean(state.sheet.date && state.sheet.meal);
    const onToday = state.sheet.from === "today";
    const hideAdd = onToday || state.sheet.from === "calendar";
    const planned = mealMenu ? (state.sheet.entryId ? entryById(state.sheet.entryId) : mealOn(state.sheet.date, state.sheet.meal)) : null;
    const recipe = activeRecipe();
    if (!mealMenu) {
      return `<div class="sheet"><div class="sheet-card" role="dialog" aria-label="Recipe">
        <div class="sheet-head"><span></span><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
        ${recipe ? recipeMenuRows(recipe.id) : ""}
      </div></div>`;
    }
    return `<div class="sheet"><div class="sheet-card" role="dialog" aria-label="Meal">
        <div class="sheet-head"><span></span><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
        ${planned && !hideAdd ? `<button class="menu-row" type="button" data-action="add-meal" data-date="${esc(planned.date)}" data-meal="${esc(planned.meal)}">Add</button>` : ""}
        ${planned ? `<button class="menu-row" type="button" data-action="remove-meal" data-id="${esc(planned.id)}">Remove</button>` : ""}
        ${recipe ? `<button class="menu-row" type="button" data-action="edit-recipe">Edit recipe</button>` : ""}
      </div></div>`;
  }
  if (state.sheet?.kind === "recipe-row-menu") {
    return `<div class="sheet"><div class="sheet-card" role="dialog" aria-label="Recipe options">
        <div class="sheet-head"><span></span><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
        ${recipeMenuRows(state.sheet.recipeId)}
      </div></div>`;
  }
  if (state.sheet?.kind === "pick-date") return dateSheetHtml();
  if (state.sheet?.kind === "plan-choice") {
    return `<div class="sheet"><div class="sheet-card plan-choice" role="dialog" aria-label="This day already has a dinner">
        <div class="sheet-head"><span></span><button type="button" data-action="plan-cancel" aria-label="Close">✕</button></div>
        <p>${esc(state.sheet.when)} already has ${esc(state.sheet.name)}.</p>
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
        <div class="choice-stack">
          <button class="choice-btn is-go" type="button" data-action="plan-replace">Replace</button>
          <button class="choice-btn is-quiet" type="button" data-action="plan-cancel">Cancel</button>
        </div>
      </div></div>`;
  }
  if (state.sheet?.kind === "remove-choice") {
    return `<div class="sheet"><div class="sheet-card plan-choice" role="dialog" aria-label="Remove meal">
        <div class="sheet-head"><span></span><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
        <p>Remove from ${esc(state.sheet.when)}?</p>
        <div class="choice-stack">
          <button class="choice-btn is-danger" type="button" data-action="confirm-remove" data-id="${esc(state.sheet.id)}">Remove</button>
          <button class="choice-btn is-quiet" type="button" data-action="close-sheet">Cancel</button>
        </div>
      </div></div>`;
  }
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

function findBackLayer() {
  const sheets = [...app.querySelectorAll(".sheet")];
  for (let i = sheets.length - 1; i >= 0; i -= 1) {
    const sheet = sheets[i];
    const control = backControl(sheet);
    if (!control) continue;
    return { layer: sheet, touch: sheet, control, overlay: sheet.parentElement === app };
  }
  const main = app.querySelector("main");
  const control = backControl(main);
  if (!control || !main) return null;
  return { layer: main, touch: main, control, overlay: false };
}

function backControl(root) {
  if (!root) return null;
  const buttons = [...root.querySelectorAll(BACK_SELECTOR)];
  if (!buttons.length) return null;
  return buttons.find((button) => button.closest(".sheet-head, .topbar, .pick-bar") || button.classList.contains("cook-x") || button.classList.contains("float") || button.classList.contains("back")) || buttons[0];
}

function markSwipeBack() {
  const found = findBackLayer();
  for (const el of app.querySelectorAll(".can-swipe-back")) {
    if (!found || el !== found.touch) el.classList.remove("can-swipe-back");
  }
  found?.touch?.classList.add("can-swipe-back");
}

function beginEdgeBack(event) {
  if (event.button !== 0 || event.isPrimary === false) return false;
  if (event.clientX > EDGE_PX) return false;
  if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return false;
  const found = findBackLayer();
  if (!found) return false;
  clearGesture();
    gesture = {
    kind: "back",
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    t: event.timeStamp,
    lastX: event.clientX,
    lastT: event.timeStamp,
    velocity: 0,
    dx: 0,
    dragging: false,
    layer: found.layer,
    touch: found.touch,
    control: found.control,
    overlay: found.overlay,
    under: null,
    dim: null,
  };
  return true;
}

function moveEdgeBack(event) {
  if (!gesture || gesture.kind !== "back" || gesture.pointerId !== event.pointerId) return;
  if (!gesture.layer?.isConnected) {
    clearGesture();
    return;
  }
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  const dt = event.timeStamp - gesture.lastT;
  if (dt > 0 && dt < 80) gesture.velocity = (event.clientX - gesture.lastX) / dt;
  else if (dt >= 80) gesture.velocity = 0;
  gesture.lastX = event.clientX;
  gesture.lastT = event.timeStamp;
  if (!gesture.dragging) {
    if (Math.abs(dx) < BACK_LOCK_PX && Math.abs(dy) < BACK_LOCK_PX) return;
    if (dx < BACK_LOCK_PX || Math.abs(dy) > dx) {
      clearGesture();
      return;
    }
    gesture.dragging = true;
    gesture.dx = Math.max(0, dx);
    backSettle += 1;
    try {
      gesture.touch?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can throw if the pointer already ended.
    }
    document.documentElement.classList.add("is-edge-dragging");
    if (event.cancelable) event.preventDefault();
    if (reduceMotion()) return;
    mountEdgeUnder(gesture);
    paintEdge(gesture, gesture.dx, false);
    return;
  }
  gesture.dx = Math.max(0, dx);
  if (reduceMotion()) return;
  if (event.cancelable) event.preventDefault();
  paintEdge(gesture, gesture.dx, false);
}

function endEdgeBack(event) {
  const current = gesture;
  if (!current || current.kind !== "back") return;
  if (event.timeStamp - current.lastT > 80) current.velocity = 0;
  const dx = Math.max(0, event.clientX - current.x);
  const width = backWidth(current.layer);
  const commit = current.dragging && (dx >= width / 3 || (current.velocity >= BACK_FLICK_V && dx >= BACK_FLICK_PX));
  clearGesture();
  if (!current.dragging) {
    document.documentElement.classList.remove("is-edge-dragging");
    const upDy = event.clientY - current.y;
    if (dx >= width / 3 && dx > Math.abs(upDy)) {
      swallowNextClick();
      runBackControl(current.control);
    }
    return;
  }
  if (!commit) {
    swallowNextClick();
    if (reduceMotion()) clearEdge(current);
    else snapEdgeBack(current);
    return;
  }
  if (reduceMotion()) {
    clearEdge(current);
    runBackControl(current.control);
    swallowNextClick();
    return;
  }
  swallowNextClick();
  paintEdge(current, width, true);
  settleEdge(current, () => finishEdge(current));
}

function cancelEdgeBack() {
  const current = gesture;
  clearGesture();
  if (!current?.dragging) {
    document.documentElement.classList.remove("is-edge-dragging");
    return;
  }
  swallowNextClick();
  if (reduceMotion()) clearEdge(current);
  else snapEdgeBack(current);
}

function backWidth(layer) {
  const width = layer?.getBoundingClientRect().width || window.innerWidth;
  return Math.max(1, width);
}

function underShift(progress, width) {
  return Math.round(-width * BACK_UNDER * (1 - progress));
}

function cloneState() {
  return structuredClone(state);
}

function restoreState(copy) {
  for (const key of Object.keys(state)) {
    if (!Object.prototype.hasOwnProperty.call(copy, key)) delete state[key];
  }
  Object.assign(state, copy);
}

function applyBackState(action) {
  if (action === "cancel-pick" || (action === "back" && state.page?.kind === "pick")) {
    const back = state.pickBack;
    state.addOrigin = null;
    state.recipeQuery = "";
    state.error = "";
    state.sheet = null;
    state.pickBack = null;
    state.tab = back?.tab || state.tab;
    state.page = back?.page || null;
    return;
  }
  if (action === "close-cook") {
    const back = state.cookReturn;
    state.page = back?.page || null;
    if (back?.tab) state.tab = back.tab;
    state.sheet = null;
    return;
  }
  if (action === "close-feedback") {
    state.page = state.feedbackFrom === "recipe"
      ? { kind: "recipe", id: state.page.id, servings: state.page.servings || recipeById(state.page.id)?.servings, panel: "ingredients", planDate: state.page.planDate || null, planMeal: state.page.planMeal || null }
      : null;
    return;
  }
  if (action === "close-sheet" || action === "plan-cancel") {
    if (state.sheet?.kind === "plan-choice" || state.sheet?.back) {
      state.error = "";
      state.sheet = state.sheet.back || null;
      return;
    }
    state.sheet = null;
    state.error = "";
    return;
  }
  const kind = state.page?.kind;
  state.sheet = null;
  if (kind === "recipe" && state.recipeBack) {
    state.tab = state.recipeBack.tab;
    state.page = state.recipeBack.page;
  } else if (kind === "item" || kind === "add-item") {
    state.page = null;
    state.tab = "groceries";
  } else {
    state.page = null;
    if (kind === "recipe" || kind === "new-recipe") state.tab = "recipes";
  }
}

function previewBackHtml(action) {
  const backup = cloneState();
  try {
    applyBackState(action);
    return appHtml();
  } finally {
    restoreState(backup);
  }
}

function mountEdgeUnder(gesture) {
  gesture.layer.classList.add("is-swipe-back");
  app.querySelector(".swipe-under")?.remove();
  if (gesture.overlay) return;
  const under = document.createElement("div");
  under.className = "swipe-under";
  under.setAttribute("aria-hidden", "true");
  under.inert = true;
  try {
    under.innerHTML = previewBackHtml(gesture.control?.dataset.action || "back");
  } catch {
    under.innerHTML = "";
  }
  const dim = document.createElement("div");
  dim.className = "swipe-dim";
  under.appendChild(dim);
  const width = backWidth(gesture.layer);
  const progress = Math.max(0, Math.min(1, gesture.dx / width));
  under.style.transform = `translate3d(${underShift(progress, width)}px,0,0)`;
  dim.style.opacity = (0.16 * (1 - progress)).toFixed(3);
  gesture.under = under;
  gesture.dim = dim;
  app.insertBefore(under, app.firstChild);
}

function paintEdge(gesture, dx, animate) {
  if (!gesture?.layer?.isConnected) return;
  const width = backWidth(gesture.layer);
  const progress = Math.max(0, Math.min(1, dx / width));
  const timing = `transform ${BACK_SNAP_MS}ms ease-out`;
  gesture.layer.style.transition = animate ? timing : "none";
  gesture.layer.style.transform = `translate3d(${Math.round(dx)}px,0,0)`;
  if (gesture.under) {
    gesture.under.style.transition = animate ? timing : "none";
    gesture.under.style.transform = `translate3d(${underShift(progress, width)}px,0,0)`;
  }
  if (gesture.dim) {
    gesture.dim.style.transition = animate ? `opacity ${BACK_SNAP_MS}ms ease-out` : "none";
    gesture.dim.style.opacity = (0.16 * (1 - progress)).toFixed(3);
  }
}

function snapEdgeBack(gesture) {
  if (!gesture?.layer?.isConnected) {
    clearEdge(gesture);
    return;
  }
  paintEdge(gesture, 0, true);
  settleEdge(gesture, () => clearEdge(gesture));
}

function settleEdge(gesture, run) {
  const token = ++backSettle;
  const layer = gesture?.layer;
  let finished = false;
  edgeAnimating += 1;
  const finish = () => {
    if (finished) return;
    finished = true;
    edgeAnimating = Math.max(0, edgeAnimating - 1);
    layer?.removeEventListener("transitionend", onEnd);
    if (token !== backSettle) return;
    run?.();
  };
  const onEnd = (event) => {
    if (event.target !== layer || event.propertyName !== "transform") return;
    finish();
  };
  layer?.addEventListener("transitionend", onEnd);
  setTimeout(finish, BACK_SNAP_MS + 40);
}

function clearEdge(gesture) {
  document.documentElement.classList.remove("is-edge-dragging");
  gesture?.under?.remove();
  if (gesture) {
    gesture.under = null;
    gesture.dim = null;
  }
  if (gesture?.layer) {
    gesture.layer.classList.remove("is-swipe-back");
    gesture.layer.style.transition = "";
    gesture.layer.style.transform = "";
  }
}

function finishEdge(gesture) {
  document.documentElement.classList.remove("is-edge-dragging");
  const action = gesture?.control?.dataset.action;
  const stacked = state.sheet?.kind === "plan-choice" || state.sheet?.back;
  if (gesture?.overlay && (action === "close-sheet" || action === "plan-cancel") && !stacked) {
    gesture.layer?.remove();
    state.sheet = null;
    state.error = "";
    markSwipeBack();
    return;
  }
  if (gesture?.under) {
    gesture.under.style.transition = "none";
    gesture.under.style.transform = "none";
  }
  if (gesture?.dim) gesture.dim.style.opacity = "0";
  const control = gesture?.control;
  if (control?.isConnected) {
    edgeClick = true;
    control.click();
    edgeClick = false;
  }
  if (gesture?.layer?.isConnected) clearEdge(gesture);
}

function runBackControl(control) {
  if (!control?.isConnected) return;
  edgeClick = true;
  control.click();
  edgeClick = false;
}

function onPointerDown(event) {
  if (beginEdgeBack(event)) return;
  const board = event.target.closest(".cal-board");
  if (board) {
    if (state.sheet?.kind === "pick-date") return;
    gesture = { kind: "cal", x: event.clientX, y: event.clientY };
    return;
  }
  const recipeRow = event.target.closest(".recipe-row[data-id]");
  if (recipeRow && state.page?.kind !== "pick" && !event.target.closest(".heart") && !event.target.closest(".icon-btn")) {
    clearGesture();
    const id = recipeRow.dataset.id;
    gesture = { kind: "recipe", id, x: event.clientX, y: event.clientY, long: false, pointerId: event.pointerId };
    gesture.timer = setTimeout(() => {
      if (!gesture || gesture.kind !== "recipe") return;
      gesture.long = true;
      state.sheet = { kind: "recipe-row-menu", recipeId: id };
      render();
    }, 520);
    return;
  }
  const row = event.target.closest(".g-row");
  if (!row || event.target.closest(".g-check") || event.target.closest(".g-delete")) return;
  clearGesture();
  gesture = { id: row.dataset.id, x: event.clientX, y: event.clientY, long: false, dragging: false, pointerId: event.pointerId };
}

function onPointerMove(event) {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  if (gesture.kind === "back") {
    moveEdgeBack(event);
    return;
  }
  if (gesture.kind === "cal") return;
  if (gesture.kind === "recipe") {
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      if (gesture.timer) clearTimeout(gesture.timer);
      gesture.timer = null;
      gesture.scroll = true;
    }
    return;
  }
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
  avoidFab();
}

function avoidFab() {
  const fab = document.querySelector(".fab");
  if (!fab) return;
  fab.classList.remove("is-away");
  const open = document.querySelector(".g-swipe.is-open");
  const dragging = gesture?.dragging && gesture.id ? document.querySelector(`.g-swipe[data-id="${cssEscape(gesture.id)}"]`) : null;
  const row = open || dragging;
  if (!row) return;
  const d = row.getBoundingClientRect();
  const f = fab.getBoundingClientRect();
  const hit = !(d.right - 96 >= f.right || d.right <= f.left || d.bottom <= f.top || d.top >= f.bottom);
  if (hit) fab.classList.add("is-away");
}

function onPointerUp(event) {
  if (!gesture) return;
  if (gesture.kind === "back") {
    if (gesture.pointerId !== event.pointerId) return;
    endEdgeBack(event);
    return;
  }
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (gesture.kind === "recipe") {
    const long = gesture.long;
    clearGesture();
    if (long) swallowNextClick();
    return;
  }
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
    swallowNextClick();
    openEdit(id);
    return;
  }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    swallowNextClick();
    openEdit(id);
  }
}

function onPointerCancel(event) {
  if (!gesture) return;
  if (gesture.kind === "back") {
    if (event && gesture.pointerId !== event.pointerId) return;
    cancelEdgeBack();
    return;
  }
  if (gesture.kind === "cal" || gesture.kind === "recipe") {
    clearGesture();
    return;
  }
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

function dismissSheet() {
  if (state.sheet?.kind === "plan-choice" || state.sheet?.back) {
    state.error = "";
    state.sheet = state.sheet.back || null;
    render();
    return;
  }
  state.sheet = null;
  state.error = "";
  render();
}

async function onClick(event) {
  if (swallowClick && !edgeClick) {
    swallowClick = false;
    return;
  }
  const storeLabel = event.target.closest?.(".field-label");
  if (state.storeOpen && !event.target.closest(".store-drop") && !storeLabel?.querySelector("[data-action=toggle-stores]")) {
    closeStoreDrop();
  }
  if (event.target.classList?.contains("sheet")) {
    if (state.sheet) dismissSheet();
    else if (state.page?.kind === "pick") closePick();
    else if (state.page?.kind === "add-item") {
      state.page = null;
      state.tab = "groceries";
      state.addQuery = "";
      state.addDraft = blankAddDraft();
      state.error = "";
      render();
    }
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
    state.pickBack = null;
    render();
    if (state.tab === "today") refresh(true);
    return;
  }
  if (action === "back") {
    if (state.page?.kind === "pick") return closePick();
    const kind = state.page?.kind;
    state.sheet = null;
    if (kind === "recipe" && state.recipeBack) {
      state.tab = state.recipeBack.tab;
      state.page = state.recipeBack.page;
    } else if (kind === "item" || kind === "add-item") {
      state.page = null;
      state.tab = "groceries";
    } else {
      state.page = null;
      if (kind === "recipe" || kind === "new-recipe") state.tab = "recipes";
    }
    render();
    return;
  }
  if (action === "plan-dinner") {
    const date = button.dataset.date || nyToday();
    if (date < nyToday()) return;
    return openAddMeal(date, "dinner");
  }
  if (action === "open-day") {
    const date = button.dataset.date || nyToday();
    if (date < nyToday()) return;
    state.tab = "calendar";
    state.page = null;
    state.sheet = null;
    focusCalendarDate(date);
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
  if (action === "add-meal") return openAddMeal(button.dataset.date || nyToday(), button.dataset.meal || "dinner");
  if (action === "cancel-pick") return closePick();
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
  if (action === "pick-recipe") return askPlan(button.dataset.date, button.dataset.meal, button.dataset.id);
  if (action === "pick-date-day") return askPlan(button.dataset.date, "dinner", state.sheet?.recipeId);
  if (action === "date-shift") return shiftDateMonth(Number(button.dataset.delta));
  if (action === "add-to-date") return openDatePicker(button.dataset.id || state.page?.id);
  if (action === "recipe-row-menu") {
    state.sheet = { kind: "recipe-row-menu", recipeId: button.dataset.id };
    render();
    return;
  }
  if (action === "plan-replace") {
    const sheet = state.sheet;
    if (sheet?.kind !== "plan-choice") return;
    return planRecipe(sheet.date, sheet.meal, sheet.recipeId, false);
  }
  if (action === "plan-cancel") {
    dismissSheet();
    return;
  }
  if (action === "clear-meal" || action === "remove-meal") return confirmRemove(button.dataset.id);
  if (action === "confirm-remove") return removeMeal(button.dataset.id);
  if (action === "open-recipe") {
    const recipe = recipeById(button.dataset.id);
    const fromToday = !state.page && state.tab === "today";
    state.recipeBack = state.page?.kind === "item"
      ? { tab: "groceries", page: state.page }
      : state.tab === "calendar"
        ? { tab: "calendar", page: null }
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
    state.sheet = {
      kind: "recipe-menu",
      date: button.dataset.date || null,
      meal: button.dataset.meal || null,
      entryId: button.dataset.id || null,
      from: button.dataset.from || null,
    };
    render();
    return;
  }
  if (action === "edit-recipe") {
    const recipe = (button.dataset.id && recipeById(button.dataset.id)) || activeRecipe();
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
    dismissSheet();
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
    state.addDraft = blankAddDraft();
    state.storeOpen = false;
    state.storeAdd = false;
    state.storeEditOpen = false;
    state.storeEdit = null;
    state.storeConfirm = null;
    state.error = "";
    state.swipeId = null;
    state.tab = "groceries";
    render();
    return;
  }
  if (action === "toggle-stores") return toggleStores(button);
  if (action === "pick-store") return pickStore(button);
  if (action === "add-store-row") return showNewStore(button);
  if (action === "save-store") return saveStore(button);
  if (action === "edit-stores") return showEditStores(button);
  if (action === "edit-store") return editStoreRow(button);
  if (action === "save-rename") return saveRename(button);
  if (action === "ask-remove-store") {
    state.storeConfirm = button.dataset.id;
    paintStoreMenus(button.closest("form"));
    return;
  }
  if (action === "confirm-remove-store") return removeStore(button.dataset.id);
  if (action === "quick-add") return addGrocery(button.dataset.name);
  if (action === "edit-item") {
    state.swipeId = null;
    state.storeOpen = false;
    state.storeAdd = false;
    state.storeEditOpen = false;
    state.storeEdit = null;
    state.storeConfirm = null;
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
  if (form.dataset.form === "add-item") return submitAdd(form);
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
    if (list) list.innerHTML = recipeListHtml();
    return;
  }
  if (event.target.id === "add-search") {
    state.addQuery = event.target.value;
    const list = document.getElementById("suggest-list");
    if (list) list.innerHTML = suggestHtml(filteredSuggestions());
    const form = event.target.form;
    const draft = state.addDraft;
    if (form && draft && !draft.sectionTouched) {
      draft.section = state.addQuery.trim() ? guessSection(state.addQuery) : "other";
      const section = form.querySelector("[name=section]");
      if (section) section.value = draft.section;
      draft.category = aisleFor(draft.store, draft.section);
    }
    return;
  }
  if (onAddField(event)) return;
  if (event.target.id === "feedback-comment") state.comment = event.target.value;
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

function openAddMeal(date, meal) {
  if (!date || date < nyToday()) return;
  state.addOrigin = !state.page && state.tab === "today" ? "today" : "calendar";
  state.pickBack = { tab: state.tab, page: state.page ? { ...state.page } : null };
  state.recipeQuery = "";
  state.error = "";
  state.sheet = null;
  state.tab = "recipes";
  state.page = { kind: "pick", date, meal: meal || "dinner" };
  render();
}

function closePick() {
  const back = state.pickBack;
  state.addOrigin = null;
  state.recipeQuery = "";
  state.error = "";
  state.sheet = null;
  state.pickBack = null;
  state.tab = back?.tab || state.tab;
  state.page = back?.page || null;
  render();
}

function openDatePicker(recipeId) {
  if (!recipeId) return;
  state.addOrigin = "recipe";
  state.error = "";
  state.sheet = { kind: "pick-date", recipeId, month: `${nyToday().slice(0, 7)}-01` };
  render();
  refresh(true);
}

function shiftDateMonth(delta) {
  if (state.sheet?.kind !== "pick-date" || !canShiftDateMonth(delta)) return;
  const [year, month] = String(state.sheet.month).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  state.sheet = { ...state.sheet, month: next.toISOString().slice(0, 10) };
  render();
  refresh(true);
}

function canShiftDateMonth(delta) {
  if (delta > 0) return true;
  const current = state.sheet?.month || `${nyToday().slice(0, 7)}-01`;
  const [year, month] = String(current).split("-").map(Number);
  const previousLast = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
  return previousLast >= nyToday();
}

function recipeMenuRows(recipeId) {
  return `<button class="menu-row" type="button" data-action="add-to-date" data-id="${esc(recipeId)}">Add to date</button>
        <button class="menu-row" type="button" data-action="edit-recipe" data-id="${esc(recipeId)}">Edit recipe</button>`;
}

function dateSheetHtml() {
  const month = state.sheet?.month || `${nyToday().slice(0, 7)}-01`;
  const prev = canShiftDateMonth(-1);
  return `<div class="sheet date-sheet"><div class="sheet-card" role="dialog" aria-label="Add to date">
      <div class="sheet-head"><strong>Add to date</strong><button type="button" data-action="close-sheet" aria-label="Close">✕</button></div>
      <div class="month-bar">
        <button type="button" data-action="date-shift" data-delta="-1" aria-label="Previous month" ${prev ? "" : "disabled"}>${chevLeft()}</button>
        <h2>${esc(monthTitle(month))}</h2>
        <button type="button" data-action="date-shift" data-delta="1" aria-label="Next month">${chevRight()}</button>
      </div>
      ${monthGrid(month, "", "pick-date-day")}
    </div></div>`;
}

function askPlan(date, meal, recipeId) {
  const slot = meal || "dinner";
  if (!date || !recipeId || date < nyToday()) return;
  const existing = mealOn(date, slot);
  if (!existing) return planRecipe(date, slot, recipeId, false);
  if (existing.recipeId === recipeId || (existing.also || []).includes(recipeId)) return finishAdd(date);
  const back = state.sheet?.kind === "pick-date" ? { kind: "pick-date", recipeId: state.sheet.recipeId, month: state.sheet.month } : null;
  state.error = "";
  state.sheet = {
    kind: "plan-choice",
    date,
    meal: slot,
    recipeId,
    when: formatUtc(date, { weekday: "short", month: "short", day: "numeric" }),
    name: planTitle(existing),
    back,
  };
  render();
}

function focusCalendarDate(date) {
  const today = nyToday();
  const inRollingWeek = date >= today && date <= addDays(today, 6);
  if (state.calMode !== "month" && inRollingWeek) {
    state.weekPick = date;
    state.scrollTo = `week-${date}`;
    return;
  }
  state.calMode = "month";
  state.calStart = `${date.slice(0, 7)}-01`;
  state.monthPick = date;
  state.scrollTo = "month-panel";
}

function finishAdd(date) {
  const origin = state.addOrigin || (state.page?.kind === "pick" ? "calendar" : "recipe");
  state.addOrigin = null;
  state.recipeQuery = "";
  state.error = "";
  state.sheet = null;
  state.pickBack = null;
  if (origin === "recipe") {
    showNotice(`Added to ${formatUtc(date, { weekday: "short", month: "short", day: "numeric" })}`);
    render();
    return;
  }
  state.page = null;
  if (origin === "today") {
    state.tab = "today";
    render();
    return;
  }
  state.tab = "calendar";
  focusCalendarDate(date);
  render();
}

async function planRecipe(date, meal, recipeId, keep = false) {
  const slot = meal || "dinner";
  const body = { date, meal: slot, type: "recipe", recipeId };
  if (keep) body.keep = true;
  const existing = mealOn(date, slot);
  const snapshot = existing ? copyPlan(existing) : null;
  const optimistic = optimisticPlan(date, slot, recipeId, existing, keep);
  const key = planKey(date, slot);
  const serial = ++planSerial;
  pendingSlots.set(key, optimistic);
  state.plan = state.plan.filter((entry) => planKey(entry.date, entry.meal) !== key);
  state.plan.push(optimistic);
  finishAdd(date);
  try {
    const data = await api("/api/plan", { method: "POST", body });
    if (serial !== planSerial) return;
    const saved = data.entry || optimistic;
    pendingSlots.set(key, saved);
    state.plan = state.plan.filter((entry) => planKey(entry.date, entry.meal) !== key);
    state.plan.push(saved);
    render();
    await refresh(true);
    if (serial !== planSerial) return;
    pendingSlots.delete(key);
  } catch (error) {
    if (serial !== planSerial) return;
    pendingSlots.delete(key);
    state.plan = state.plan.filter((entry) => planKey(entry.date, entry.meal) !== key);
    if (snapshot) state.plan.push(snapshot);
    state.notice = "";
    state.error = error.message;
    render();
  }
}

function optimisticPlan(date, slot, recipeId, existing, keep) {
  const recipe = recipeById(recipeId);
  if (keep && existing) {
    const also = [...(existing.also || [])];
    if (existing.recipeId !== recipeId && !also.includes(recipeId)) also.push(recipeId);
    return { ...existing, also };
  }
  return {
    id: existing?.id || `pending-${date}-${slot}`,
    date,
    meal: slot,
    type: "recipe",
    recipeId,
    recipeName: recipe?.name || "Recipe",
    imageUrl: recipe?.imageUrl || null,
    note: null,
    alternates: [],
    also: [],
  };
}

function copyPlan(entry) {
  return {
    ...entry,
    alternates: [...(entry.alternates || [])],
    also: [...(entry.also || [])],
  };
}

function planKey(date, meal) {
  return `${date}|${meal}`;
}

function confirmRemove(id) {
  const entry = entryById(id);
  if (!entry) return removeMeal(id);
  state.sheet = {
    kind: "remove-choice",
    id,
    name: planTitle(entry),
    when: formatUtc(entry.date, { weekday: "short", month: "short", day: "numeric" }),
  };
  render();
}

async function removeMeal(id) {
  const also = /^(.*):also:(.+)$/.exec(id || "");
  if (also) {
    const parent = state.plan.find((item) => item.id === also[1]);
    const name = recipeById(also[2])?.name || "Meal";
    const previousAlso = parent ? [...(parent.also || [])] : null;
    if (parent) parent.also = (parent.also || []).filter((recipeId) => recipeId !== also[2]);
    const marker = `${also[1]}:${also[2]}`;
    pendingAlso.add(marker);
    state.sheet = null;
    if (parent) showUndo({ id, name, kind: "plan-also", snapshot: { date: parent.date, meal: parent.meal, recipeId: also[2] } });
    render();
    const serial = bumpRemove(id);
    const job = api(`/api/plan/${also[1]}/also/${also[2]}`, { method: "DELETE" })
      .then(() => {
        if (removeSerial.get(id) !== serial) return;
        pendingAlso.delete(marker);
        refresh(true);
      })
      .catch((error) => {
        if (removeSerial.get(id) !== serial) return;
        pendingAlso.delete(marker);
        if (parent && previousAlso) parent.also = previousAlso;
        if (state.undo?.id === id) clearUndo();
        state.error = error.message;
        render();
        throw error;
      });
    deleteJobs.set(id, job);
    return;
  }
  const entry = state.plan.find((item) => item.id === id);
  const snapshot = entry ? copyPlan(entry) : null;
  const name = entry ? planTitle(entry) : "Meal";
  if (entry) {
    state.plan = state.plan.filter((item) => item.id !== id);
    pendingDeletes.add(id);
  }
  state.sheet = null;
  if (snapshot) showUndo({ id, name, kind: "plan", snapshot });
  render();
  const serial = bumpRemove(id);
  const job = api(`/api/plan/${id}`, { method: "DELETE" })
    .then(() => {
      if (removeSerial.get(id) !== serial) return;
      pendingDeletes.delete(id);
      refresh(true);
    })
    .catch((error) => {
      if (removeSerial.get(id) !== serial) return;
      pendingDeletes.delete(id);
      if (snapshot && !state.plan.some((item) => item.id === id)) state.plan.push(snapshot);
      if (state.undo?.id === id) clearUndo();
      state.error = error.message;
      render();
      throw error;
    });
  deleteJobs.set(id, job);
}

function bumpRemove(id) {
  const next = (removeSerial.get(id) || 0) + 1;
  removeSerial.set(id, next);
  return next;
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

function deferGroceryPaint() {
  if (state.loading || !state.authed || state.page || state.sheet) return false;
  if (state.tab !== "groceries") return false;
  return [...checkouts.values()].some((entry) => entry.phase === "leave");
}

function paintToast() {
  const html = toastHtml();
  const current = app.querySelector(":scope > .toast");
  if (!html) {
    current?.remove();
    return;
  }
  if (current) current.outerHTML = html;
  else app.insertAdjacentHTML("beforeend", html);
}

function paintBadge() {
  const btn = document.querySelector('.tabs button[data-tab="groceries"]');
  if (!btn) return;
  const today = nyToday();
  const count = state.items.filter((item) => !item.checked && !freshWaiting(item, today)).length;
  const label = btn.querySelector("span:last-child");
  const badge = btn.querySelector(".badge");
  if (!count) {
    badge?.remove();
    return;
  }
  if (!badge) {
    label?.insertAdjacentHTML("beforebegin", `<span class="badge">${count}</span>`);
    return;
  }
  badge.textContent = String(count);
}

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function restoreRow(id, name) {
  const swipe = document.querySelector(`.g-swipe[data-id="${cssEscape(id)}"]`);
  if (!swipe) return false;
  swipe.classList.remove("is-checking-out", "is-open");
  swipe.querySelector(".g-row")?.classList.remove("is-done");
  const check = swipe.querySelector(".g-check");
  if (check) {
    check.classList.remove("is-on");
    check.setAttribute("aria-label", `Mark bought ${name}`);
    check.textContent = "";
  }
  return true;
}

function putBack(id, name) {
  const onScreen = restoreRow(id, name);
  if (onScreen && deferGroceryPaint()) {
    paintToast();
    paintBadge();
    return;
  }
  render(deferGroceryPaint());
}

function cancelCheckout(id) {
  const entry = checkouts.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  checkouts.delete(id);
}

function armCheckout(id) {
  cancelCheckout(id);
  const entry = { phase: "hold", timer: 0 };
  checkouts.set(id, entry);
  entry.timer = setTimeout(() => beginLeave(id), CHECK_HOLD_MS);
}

function beginLeave(id) {
  const entry = checkouts.get(id);
  if (!entry || entry.phase !== "hold") return;
  const item = state.items.find((entryItem) => entryItem.id === id);
  if (!item?.checked) {
    cancelCheckout(id);
    return;
  }
  if (reduceMotion() || state.tab !== "groceries" || state.page) {
    cancelCheckout(id);
    render();
    return;
  }
  entry.phase = "leave";
  const row = document.querySelector(`.g-swipe[data-id="${cssEscape(id)}"]`);
  if (!row) {
    cancelCheckout(id);
    render();
    return;
  }
  row.classList.add("is-checking-out");
  entry.timer = setTimeout(() => finishLeave(id), CHECK_LEAVE_MS);
}

function finishLeave(id) {
  const entry = checkouts.get(id);
  if (!entry || entry.phase !== "leave") return;
  checkouts.delete(id);
  const still = [...checkouts.values()].some((other) => other.phase === "leave");
  if (still) {
    document.querySelector(`.g-swipe[data-id="${cssEscape(id)}"]`)?.remove();
    return;
  }
  render();
}

function settleCheck(id, checked) {
  desiredChecked.set(id, checked);
  if (checkFlight.has(id)) return checkFlight.get(id);
  const job = (async () => {
    try {
      while (desiredChecked.has(id)) {
        const want = desiredChecked.get(id);
        await api(`/api/items/${id}`, { method: "PATCH", body: { checked: want } });
        if (desiredChecked.get(id) === want) {
          desiredChecked.delete(id);
          break;
        }
      }
    } catch (error) {
      desiredChecked.delete(id);
      cancelCheckout(id);
      if (state.undo?.id === id && state.undo.kind === "check") clearUndo();
      state.error = error.message;
      try {
        await refresh(true);
      } catch {
        render();
      }
      throw error;
    }
  })().finally(() => {
    checkFlight.delete(id);
    if (desiredChecked.has(id)) settleCheck(id, desiredChecked.get(id));
  });
  checkFlight.set(id, job);
  return job;
}

async function toggleItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (item.checked || checkouts.has(id)) {
    if (state.undo?.id === id && state.undo.kind === "check") clearUndo();
    cancelCheckout(id);
    item.checked = false;
    if (state.swipeId === id) state.swipeId = null;
    putBack(id, item.name);
    try {
      await settleCheck(id, false);
    } catch {
      /* settleCheck already refreshed */
    }
    return;
  }
  if (state.swipeId === id) state.swipeId = null;
  item.checked = true;
  armCheckout(id);
  showUndo({ id, name: item.name, kind: "check" });
  render();
  try {
    await settleCheck(id, true);
  } catch {
    /* settleCheck already refreshed */
  }
}

async function undoCheck() {
  const undo = state.undo;
  if (!undo) return;
  if (undo.kind === "check") {
    const item = state.items.find((entry) => entry.id === undo.id);
    clearUndo();
    cancelCheckout(undo.id);
    if (item) item.checked = false;
    putBack(undo.id, item?.name || undo.name);
    try {
      await settleCheck(undo.id, false);
    } catch {
      /* settleCheck already refreshed */
    }
    return;
  }
  clearUndo();
  try {
    if (undo.kind === "plan") {
      bumpRemove(undo.id);
      const job = deleteJobs.get(undo.id);
      pendingDeletes.delete(undo.id);
      const restored = copyPlan(undo.snapshot);
      const key = planKey(restored.date, restored.meal);
      const serial = ++planSerial;
      pendingSlots.set(key, restored);
      state.plan = state.plan.filter((entry) => planKey(entry.date, entry.meal) !== key);
      state.plan.push(restored);
      render();
      if (job) await job.catch(() => {});
      await api("/api/plan", { method: "POST", body: planRestoreBody(undo.snapshot) });
      for (const recipeId of undo.snapshot.also || []) {
        await api("/api/plan", { method: "POST", body: { date: undo.snapshot.date, meal: undo.snapshot.meal, type: "recipe", recipeId, keep: true } });
      }
      if (serial !== planSerial) return;
      await refresh(true);
      if (serial !== planSerial) return;
      pendingSlots.delete(key);
      return;
    } else if (undo.kind === "plan-also") {
      bumpRemove(undo.id);
      const job = deleteJobs.get(undo.id);
      const parentId = undo.id.split(":also:")[0];
      pendingAlso.delete(`${parentId}:${undo.snapshot.recipeId}`);
      const parent = state.plan.find((item) => item.id === parentId);
      if (parent && !(parent.also || []).includes(undo.snapshot.recipeId)) parent.also = [...(parent.also || []), undo.snapshot.recipeId];
      render();
      if (job) await job.catch(() => {});
      await api("/api/plan", {
        method: "POST",
        body: { date: undo.snapshot.date, meal: undo.snapshot.meal, type: "recipe", recipeId: undo.snapshot.recipeId, keep: true },
      });
    }
    else {
      const body = undo.kind === "delete" ? { deleted: false } : { checked: false };
      await api(`/api/items/${undo.id}`, { method: "PATCH", body });
    }
    await refresh(true);
  } catch (error) {
    if (undo.kind === "plan" && undo.snapshot) {
      const key = planKey(undo.snapshot.date, undo.snapshot.meal);
      pendingSlots.delete(key);
      state.plan = state.plan.filter((entry) => planKey(entry.date, entry.meal) !== key);
    }
    state.error = error.message;
    render();
  }
}

function clearUndoTimers() {
  if (undoTimer) clearTimeout(undoTimer);
  if (undoFadeTimer) clearTimeout(undoFadeTimer);
  undoTimer = null;
  undoFadeTimer = null;
}

function clearUndo() {
  clearUndoTimers();
  state.undo = null;
  state.undoFading = false;
}

function showUndo(undo) {
  state.undo = undo;
  state.undoFading = false;
  clearUndoTimers();
  undoFadeTimer = setTimeout(() => {
    if (!state.undo) return;
    state.undoFading = true;
    document.querySelector(".toast:not(.toast-note)")?.classList.add("is-fading");
  }, UNDO_MS - UNDO_FADE_MS);
  undoTimer = setTimeout(() => {
    state.undo = null;
    state.undoFading = false;
    undoTimer = null;
    undoFadeTimer = null;
    render();
  }, UNDO_MS);
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

function showNotice(text) {
  state.notice = text;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    state.notice = "";
    noticeTimer = null;
    render();
  }, 2200);
}

function toastHtml() {
  if (state.notice) return `<div class="toast toast-note" role="status"><span>${esc(state.notice)}</span></div>`;
  if (!state.undo) return "";
  const verb = state.undo.kind === "delete" ? "deleted" : state.undo.kind === "plan" || state.undo.kind === "plan-also" ? "removed" : "checked off";
  return `<div class="toast${state.undoFading ? " is-fading" : ""}" role="status"><span>${esc(state.undo.name)} ${verb}</span><button type="button" data-action="undo-check">Undo</button></div>`;
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

function choiceHtml(pairs, selected) {
  return pairs.map(([id, label]) => `<option value="${id}" ${id === selected ? "selected" : ""}>${esc(label)}</option>`).join("");
}

function aisleOptions() {
  return AISLE_GROUPS;
}

function freshRowHtml(on) {
  return `<label class="fresh-row"><span>Fresh</span><input class="fresh-box" type="checkbox" name="fresh"${on ? " checked" : ""}></label>`;
}

function aisleFor(_store, section) {
  if (section === "produce") return "produce";
  if (section === "frozen") return "frozen";
  if (section === "meat" || section === "dairy") return "refrigerated";
  return "shelf";
}

function storeIdOf(item) {
  if (!item) return "";
  if (item.storeTag === "") return "";
  if (item.storeTag) return item.storeTag;
  return item.store || "";
}

function aisleOf(item) {
  if (item?.category === "produce" || item?.category === "refrigerated" || item?.category === "frozen" || item?.category === "shelf") return item.category;
  return "shelf";
}

function storeLabel(id) {
  if (!id) return "No store";
  return (state.stores || []).find((store) => store.id === id)?.name || "No store";
}

function storeEditIcon() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="m13 7 4 4"/></svg>`;
}

function storeFieldHtml(selected) {
  const open = state.storeOpen ? "" : " is-hidden";
  const adding = state.storeAdd ? "" : " is-hidden";
  const editing = state.storeEditOpen ? "" : " is-hidden";
  return `<label class="field-label">Store<span class="select-wrap"><button class="box" type="button" data-action="toggle-stores" aria-haspopup="listbox" aria-expanded="${state.storeOpen ? "true" : "false"}">${esc(storeLabel(selected))}</button></span></label>
    <input type="hidden" name="store" value="${esc(selected || "")}">
    <div class="store-drop${open}" role="listbox">${storeOptionsHtml(selected)}</div>
    <div class="new-store${adding}"><input class="field-box" name="newStore" maxlength="40" placeholder="Store name" aria-label="New store" autocomplete="off" enterkeyhint="done"><button class="text-green" type="button" data-action="save-store">Add</button></div>
    <div class="store-edit-menu${editing}">${editStoresHtml()}</div>`;
}

function storeOptionsHtml(selected) {
  const current = selected || "";
  const rows = [`<button class="store-option${current ? "" : " is-on"}" type="button" data-action="pick-store" data-store="">No store</button>`];
  (state.stores || []).forEach((store) => {
    const on = store.id === current ? " is-on" : "";
    rows.push(`<button class="store-option${on}" type="button" data-action="pick-store" data-store="${esc(store.id)}">${esc(store.name)}</button>`);
  });
  rows.push(`<button class="store-option" type="button" data-action="add-store-row">Add store…</button>`);
  rows.push(`<button class="store-option" type="button" data-action="edit-stores">Edit stores…</button>`);
  return rows.join("");
}

function editStoresHtml() {
  const stores = state.stores || [];
  if (!stores.length) return `<p class="muted store-empty">No stores yet.</p>`;
  return stores.map((store) => {
    if (state.storeConfirm === store.id) {
      return `<div class="store-confirm" data-id="${esc(store.id)}"><span>Remove ${esc(store.name)}? Its items will have no store.</span><button class="text-btn" type="button" data-action="confirm-remove-store" data-id="${esc(store.id)}">Remove</button><button class="text-green" type="button" data-action="edit-store" data-id="${esc(store.id)}">Cancel</button></div>`;
    }
    if (state.storeEdit === store.id) {
      return `<div class="store-rename" data-id="${esc(store.id)}"><input class="field-box" name="renameStore" maxlength="40" value="${esc(store.name)}" aria-label="Rename ${esc(store.name)}"><button class="text-green" type="button" data-action="save-rename" data-id="${esc(store.id)}">Save</button><button class="text-btn" type="button" data-action="ask-remove-store" data-id="${esc(store.id)}">Remove</button></div>`;
    }
    return `<div class="store-line"><span class="store-pick">${esc(store.name)}</span><button class="store-edit" type="button" data-action="edit-store" data-id="${esc(store.id)}" aria-label="Edit ${esc(store.name)}">${storeEditIcon()}</button></div>`;
  }).join("");
}

function paintStoreMenus(form) {
  if (!form) return;
  const selected = form.querySelector("[name=store]")?.value || "";
  const drop = form.querySelector(".store-drop");
  if (drop) drop.innerHTML = storeOptionsHtml(selected);
  const menu = form.querySelector(".store-edit-menu");
  if (menu) menu.innerHTML = editStoresHtml();
  const label = form.querySelector("[data-action=toggle-stores]");
  if (label) label.textContent = storeLabel(selected);
}

function closeStoreDrop() {
  state.storeOpen = false;
  document.querySelectorAll(".store-drop").forEach((menu) => menu.classList.add("is-hidden"));
  document.querySelectorAll("[data-action=toggle-stores]").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function toggleStores(button) {
  const form = button.closest("form");
  const menu = form?.querySelector(".store-drop");
  if (!menu) return;
  const open = menu.classList.contains("is-hidden");
  menu.classList.toggle("is-hidden", !open);
  state.storeOpen = open;
  button.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    state.storeAdd = false;
    state.storeEditOpen = false;
    form.querySelector(".new-store")?.classList.add("is-hidden");
    form.querySelector(".store-edit-menu")?.classList.add("is-hidden");
  }
}

function pickStore(button) {
  const form = button.closest("form");
  if (!form) return;
  const choice = button.dataset.store ?? "";
  const hidden = form.querySelector("[name=store]");
  if (hidden) hidden.value = choice;
  const label = form.querySelector("[data-action=toggle-stores]");
  if (label) label.textContent = storeLabel(choice);
  closeStoreDrop();
  state.storeAdd = false;
  state.storeEditOpen = false;
  state.storeEdit = null;
  state.storeConfirm = null;
  form.querySelector(".new-store")?.classList.add("is-hidden");
  form.querySelector(".store-edit-menu")?.classList.add("is-hidden");
  if (form.id === "add-form" && state.addDraft) state.addDraft.store = choice;
}

function showNewStore(button) {
  const form = button.closest("form");
  if (!form) return;
  closeStoreDrop();
  state.storeAdd = true;
  state.storeEditOpen = false;
  form.querySelector(".store-edit-menu")?.classList.add("is-hidden");
  const row = form.querySelector(".new-store");
  row?.classList.remove("is-hidden");
  row?.querySelector("[name=newStore]")?.focus();
}

async function saveStore(button) {
  const form = button.closest("form");
  if (!form) return;
  const raw = String(form.querySelector("[name=newStore]")?.value || "").trim().replace(/\s+/g, " ");
  if (!raw) {
    showFormError(form, "Type a store name.");
    return;
  }
  try {
    const data = await api("/api/stores", { method: "POST", body: { name: raw } });
    const saved = data.store;
    if (saved && !(state.stores || []).some((store) => store.id === saved.id)) state.stores.push(saved);
    showFormError(form, "");
    const input = form.querySelector("[name=newStore]");
    if (input) input.value = "";
    state.storeAdd = false;
    form.querySelector(".new-store")?.classList.add("is-hidden");
    const hidden = form.querySelector("[name=store]");
    if (hidden) hidden.value = saved?.id || "";
    if (form.id === "add-form" && state.addDraft) state.addDraft.store = saved?.id || "";
    paintStoreMenus(form);
  } catch (error) {
    showFormError(form, error.message);
  }
}

function showEditStores(button) {
  const form = button.closest("form");
  if (!form) return;
  closeStoreDrop();
  state.storeAdd = false;
  state.storeEditOpen = true;
  state.storeEdit = null;
  state.storeConfirm = null;
  form.querySelector(".new-store")?.classList.add("is-hidden");
  const menu = form.querySelector(".store-edit-menu");
  if (menu) {
    menu.innerHTML = editStoresHtml();
    menu.classList.remove("is-hidden");
  }
}

function editStoreRow(button) {
  state.storeEdit = button.dataset.id || null;
  state.storeConfirm = null;
  const form = button.closest("form");
    paintStoreMenus(form);
    form?.querySelector("[name=renameStore]")?.focus();
}

async function saveRename(button) {
  const form = button.closest("form");
  const id = button.dataset.id;
  const name = String(form?.querySelector("[name=renameStore]")?.value || "").trim().replace(/\s+/g, " ");
  if (!form || !id || !name) return;
  try {
    const data = await api(`/api/stores/${id}`, { method: "PATCH", body: { name } });
    const index = (state.stores || []).findIndex((store) => store.id === id);
    if (index >= 0 && data.store) state.stores[index] = data.store;
    state.storeEdit = null;
    state.storeConfirm = null;
    showFormError(form, "");
    paintStoreMenus(form);
  } catch (error) {
    showFormError(form, error.message);
  }
}

function showFormError(form, message) {
  if (!form) return;
  let node = form.querySelector(".store-error");
  if (!message) {
    node?.remove();
    return;
  }
  if (!node) {
    node = document.createElement("p");
    node.className = "error store-error";
    const menu = form.querySelector(".new-store");
    if (menu) menu.insertAdjacentElement("afterend", node);
    else form.appendChild(node);
  }
  node.textContent = message;
}

async function removeStore(id) {
  if (!id) return;
  try {
    await api(`/api/stores/${id}`, { method: "DELETE" });
    state.stores = (state.stores || []).filter((store) => store.id !== id);
    if (state.addDraft?.store === id) state.addDraft.store = "";
    state.storeEdit = null;
    state.storeConfirm = null;
    state.storeOpen = false;
    state.storeEditOpen = true;
    await refresh(true);
  } catch (error) {
    state.error = error.message;
    render();
  }
}

function onKeyDown(event) {
  if (event.key !== "Enter") return;
  const name = event.target?.name;
  if (name !== "newStore" && name !== "renameStore") return;
  event.preventDefault();
  const form = event.target.form;
  if (name === "renameStore") {
    const button = event.target.closest(".store-rename")?.querySelector("[data-action=save-rename]");
    if (button) saveRename(button);
    return;
  }
  const add = form?.querySelector("[data-action=save-store]");
  if (add) saveStore(add);
}

function guessSection(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return "other";
  if (/soap|detergent|paper towel|trash bag|foil|sponge|cleaner|bleach/.test(n)) return "household";
  if (/frozen|ice cream/.test(n)) return "frozen";
  if (/bread|bagel|bun|roll|tortilla|pita|baguette/.test(n)) return "bakery";
  if (/milk|cheese|yogurt|butter|cream|egg/.test(n) && !/eggplant|cream of/.test(n)) return "dairy";
  if (/chicken|beef|pork|turkey|salmon|shrimp|fish|bacon|sausage|steak|lamb|cod|tuna|meat/.test(n)) return "meat";
  if (/flour|sugar|yeast|baking powder|baking soda|vanilla|cornstarch|cocoa|chocolate chip/.test(n)) return "baking";
  if (/soy sauce|vinegar|ketchup|mustard|mayonnaise|mayo|salsa|hot sauce|sriracha|dressing|broth|stock/.test(n)) return "oils";
  if (/\boil\b|sauce|condiment/.test(n)) return "oils";
  if (/chip|cracker|pretzel|popcorn|cookie|granola bar/.test(n)) return "snacks";
  if (/juice|soda|coffee|tea|wine|beer|kombucha|sparkling/.test(n)) return "beverages";
  if (/onion|garlic|tomato|lettuce|cilantro|lime|lemon|avocado|potato|apple|banana|spinach|carrot|celery|cucumber|broccoli|zucchini|pepper|herb|scallion|ginger|mushroom|cabbage|kale|berry|berries|corn|peas|green bean/.test(n)) {
    if (/powder|flake|seasoning|black pepper|white pepper/.test(n)) return "baking";
    return "produce";
  }
  if (/rice|pasta|bean|lentil|oat|cereal|noodle|spaghetti|canned|can of/.test(n)) return "pantry";
  return "pantry";
}

function onAddField(event) {
  const form = event.target.closest("#add-form");
  if (!form || !state.addDraft) return false;
  const draft = state.addDraft;
  const name = event.target.name;
  if (name === "quantityNote" || name === "notes") {
    draft[name] = event.target.value;
    return true;
  }
  if (name === "fresh") {
    draft.fresh = event.target.checked;
    return true;
  }
  if (name === "section") {
    draft.section = event.target.value;
    draft.sectionTouched = true;
    draft.category = aisleFor(draft.store, draft.section);
    return true;
  }
  return false;
}

async function submitAdd(form) {
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  if (!name) return;
  const picked = data.get("store");
  const store = picked == null ? "local" : String(picked);
  if (store === "__add__") return;
  const section = String(data.get("section") || guessSection(name));
  const category = aisleFor(store, section);
  const ok = await addGrocery(name, {
    quantityNote: String(data.get("quantityNote") || "") || null,
    store,
    category,
    section,
    notes: String(data.get("notes") || "") || null,
    fresh: data.get("fresh") === "on",
  });
  if (!ok) return;
  state.page = null;
  state.tab = "groceries";
  state.addDraft = blankAddDraft();
  render();
}

async function addGrocery(name, extra) {
  const clean = String(name || "").trim();
  if (!clean) return false;
  const section = extra?.section || guessSection(clean);
  const store = extra && Object.prototype.hasOwnProperty.call(extra, "store") ? extra.store : "local";
  let category = extra?.category || aisleFor(store, section);
  const allowed = aisleOptions(store).map(([id]) => id);
  if (!allowed.includes(category)) category = aisleFor(store, section);
  try {
    await api("/api/items", {
      method: "POST",
      body: {
        name: clean,
        store,
        category,
        section,
        quantityNote: extra?.quantityNote || null,
        notes: extra?.notes || null,
        fresh: extra?.fresh === true,
      },
    });
    state.addQuery = "";
    state.addDraft = blankAddDraft();
    await refresh(true);
    return true;
  } catch (error) {
    state.error = error.message;
    render();
    return false;
  }
}

function openEdit(id) {
  if (!id) return;
  state.swipeId = null;
  state.storeOpen = false;
  state.storeAdd = false;
  state.storeEditOpen = false;
  state.storeEdit = null;
  state.storeConfirm = null;
  state.sheet = { kind: "edit-item", id };
  render();
}

async function saveItem(form) {
  const id = state.sheet?.id;
  if (!id) return;
  const section = String(form.get("section") || "other");
  const picked = form.get("store");
  const store = picked == null ? "local" : String(picked);
  try {
    await api(`/api/items/${id}`, {
      method: "PATCH",
      body: {
        name: String(form.get("name") || ""),
        quantityNote: String(form.get("quantityNote") || "") || null,
        section,
        store,
        notes: String(form.get("notes") || "") || null,
        fresh: form.get("fresh") === "on",
      },
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
function sundayOf(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(iso, -weekday);
}
function mergeDated(existing, incoming, range) {
  const prior = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!range?.from || !range?.to) return next;
  const seen = new Set(next.map((entry) => entry.id));
  const kept = prior.filter((entry) => (entry.date < range.from || entry.date > range.to) && !seen.has(entry.id));
  return kept.concat(next);
}

function applyPlanPending(entries) {
  const cleaned = entries
    .filter((entry) => !pendingDeletes.has(entry.id))
    .map((entry) => {
      if (!entry?.also?.length || !entry.also.some((recipeId) => pendingAlso.has(`${entry.id}:${recipeId}`))) return entry;
      return { ...entry, also: entry.also.filter((recipeId) => !pendingAlso.has(`${entry.id}:${recipeId}`)) };
    })
    .filter((entry) => !pendingSlots.has(planKey(entry.date, entry.meal)));
  for (const entry of pendingSlots.values()) cleaned.push(entry);
  return cleaned;
}

function visibleRange() {
  const today = nyToday();
  if (!state.page && state.tab === "today") return { from: today, to: addDays(today, 6) };
  let from;
  let to;
  if (state.calMode === "month") {
    const start = state.calStart || `${today.slice(0, 7)}-01`;
    const gridStart = sundayOf(`${start.slice(0, 7)}-01`);
    const gridEnd = addDays(gridStart, 41);
    from = gridStart;
    to = gridEnd;
    if (daysBetween(from, to) > 60) from = addDays(to, -60);
  } else {
    const focus = state.page?.kind === "day" || state.page?.kind === "pick" ? state.page.date : "";
    const end = focus > addDays(today, 6) ? focus : addDays(today, 6);
    from = today;
    to = addDays(end, 1);
  }
  if (state.sheet?.kind === "pick-date" && state.sheet.month) {
    const gridStart = sundayOf(`${String(state.sheet.month).slice(0, 7)}-01`);
    const gridEnd = addDays(gridStart, 41);
    if (gridStart < from) from = gridStart;
    if (gridEnd > to) to = gridEnd;
    if (daysBetween(from, to) > 60) {
      from = gridStart < today ? today : gridStart;
      to = gridEnd;
      if (daysBetween(from, to) > 60) from = addDays(to, -60);
    }
  }
  return { from, to };
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
function plus() {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
}
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
