const STORES = ["costco", "local", "amazon"];
const STORE_LABEL = { costco: "Costco", local: "Local store", amazon: "Amazon" };
const CATEGORY_LABEL = {
  produce: "Produce",
  shelf: "Shelf-stable",
  refrigerated: "Refrigerated",
  frozen: "Frozen",
  general: "Everything",
};
const CATEGORY_ORDER = {
  costco: ["shelf", "refrigerated", "frozen"],
  local: ["produce", "shelf", "refrigerated", "frozen"],
  amazon: ["general"],
};

const state = {
  booting: true,
  authed: false,
  bootFailed: false,
  offline: false,
  items: [],
  staples: [],
  snap: "",
  tab: loadTab(),
  category: { costco: "shelf", local: "produce", amazon: "general" },
  quickName: "",
  passcode: "",
  loginError: "",
  sheet: null,
  confirm: null,
  toast: "",
  saving: false,
  pendingRender: false,
  pendingIds: new Set(),
};

let pullSeq = 0;
let inflight = 0;
let toastTimer = 0;

function shouldDelayRender() {
  const active = document.activeElement;
  if (state.sheet || state.confirm) return true;
  if (!active) return false;
  return active.id === "quick-name" || active.id === "passcode";
}

function loadTab() {
  try {
    const saved = localStorage.getItem("grocery-tab");
    if (saved === "costco" || saved === "local" || saved === "amazon" || saved === "staples") return saved;
  } catch {
    /* private mode */
  }
  return "costco";
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonHeaders() {
  return { "Content-Type": "application/json", Accept: "application/json" };
}

function syncTheme() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#141311" : "#f4efe4");
}

function snapshot() {
  return JSON.stringify(state.items) + "|" + JSON.stringify(state.staples);
}

function showToast(message) {
  state.toast = message;
  const el = document.getElementById("toast");
  if (el) {
    el.hidden = false;
    el.textContent = message;
  } else {
    render();
  }
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = "";
    const node = document.getElementById("toast");
    if (node) node.remove();
  }, 2600);
}

function render(options = {}) {
  state.pendingRender = false;
  const keepScroll = options.keepScroll !== false;
  const focus = options.focus;
  const active = document.activeElement;
  const focusId = focus === undefined && active && active.id ? active.id : focus || "";
  const selection =
    !focus && active && typeof active.selectionStart === "number"
      ? [active.selectionStart, active.selectionEnd]
      : null;
  const scrollY = keepScroll ? window.scrollY : 0;
  document.getElementById("app").innerHTML = view();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (selection && typeof el.setSelectionRange === "function") {
        try {
          el.setSelectionRange(selection[0], selection[1]);
        } catch {
          /* number inputs */
        }
      }
    }
  }
  if (keepScroll) window.scrollTo(0, scrollY);
}

function view() {
  if (state.booting) return bootHtml();
  if (!state.authed) return loginHtml();
  return appHtml() + overlayHtml() + toastHtml();
}

function brand() {
  return `<img src="/icons/icon-192.png" alt="" width="48" height="48">`;
}

function bootHtml() {
  return `<main class="boot"><div class="mast">${brand()}<div><h1>Groceries</h1><p class="for">Mark and Emma</p></div></div><p class="intro">${
    state.bootFailed ? "Can't reach the list right now." : "Opening the list…"
  }</p>${state.bootFailed ? `<p class="stack"><button class="btn-primary full" data-action="retry">Try again</button></p>` : ""}</main>`;
}

function loginHtml() {
  return `<main class="login"><div class="login-card"><div class="mast">${brand()}<div><p class="for">Mark and Emma</p></div></div>
    <h1>Groceries</h1>
    <p class="intro">One shared list. One passcode for both phones.</p>
    <form id="login-form" class="stack">
      <input class="sr-only" type="text" name="username" autocomplete="username" value="family" tabindex="-1" aria-hidden="true">
      <label class="field" for="passcode">Passcode
        <input id="passcode" name="password" type="password" autocomplete="current-password" enterkeyhint="go" value="${esc(state.passcode)}" ${state.saving ? "disabled" : ""}>
      </label>
      ${state.loginError ? `<p class="error" role="alert">${esc(state.loginError)}</p>` : ""}
      <button class="btn-primary full" type="submit" ${state.saving ? "disabled" : ""}>Open the list</button>
    </form>
  </div></main>`;
}

function appHtml() {
  const tab = state.tab;
  return `<main class="wrap">
    <header class="mast">${brand()}<div><h1>Groceries</h1><p class="for">Mark and Emma</p></div></header>
    <p id="banner" class="banner" role="status" ${state.offline ? "" : "hidden"}>Can't reach the list right now. We'll keep trying.</p>
    <div class="tabs" role="tablist" aria-label="Stores">
      ${tabButton("costco")}${tabButton("local")}${tabButton("amazon")}${tabButton("staples", "Staples")}
    </div>
    ${tab === "staples" ? staplesHtml() : storeHtml(tab)}
    <button class="signout" type="button" data-action="logout">Sign out on this phone</button>
  </main>`;
}

function tabButton(store, label) {
  const selected = state.tab === store;
  const text = label || (store === "local" ? "Local" : STORE_LABEL[store]);
  const aria = store === "local" ? "Local store" : text;
  return `<button type="button" role="tab" data-action="tab" data-store="${store}" aria-selected="${selected ? "true" : "false"}" aria-label="${esc(aria)}">${esc(text)}</button>`;
}

function storeHtml(store) {
  const open = state.items.filter((item) => item.store === store && !item.checked);
  const checked = state.items
    .filter((item) => item.store === store && item.checked)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const categories = store === "amazon" ? [] : CATEGORY_ORDER[store];
  let groups = "";
  if (store === "amazon") {
    const ordered = [...open].sort(newestFirst);
    groups = ordered.length ? `<ul class="items">${ordered.map(itemHtml).join("")}</ul>` : "";
  } else {
    groups = categories
      .map((category) => {
        const rows = open.filter((item) => item.category === category).sort(newestFirst);
        if (!rows.length) return "";
        return `<section class="group"><h2>${esc(CATEGORY_LABEL[category])}</h2><ul class="items">${rows.map(itemHtml).join("")}</ul></section>`;
      })
      .join("");
  }
  const empty = !open.length && !checked.length;
  const doneLine = !open.length && checked.length ? `<p class="empty">Nothing left to buy here.</p>` : "";
  const emptyLine = empty
    ? `<p class="empty">Nothing for ${store === "local" ? "the local store" : esc(STORE_LABEL[store])} yet. Type it above.</p>`
    : "";
  const checkedBlock = checked.length
    ? `<section class="group"><h2>Already got</h2><ul class="items">${checked.map(itemHtml).join("")}</ul></section>
       <div class="clear-row"><button class="btn-secondary full" type="button" data-action="clear">Clear already got</button></div>`
    : "";
  return `${quickHtml(store)}${emptyLine}${doneLine}${groups}${checkedBlock}`;
}

function newestFirst(a, b) {
  if (a.createdAt === b.createdAt) return a.name.localeCompare(b.name);
  return a.createdAt < b.createdAt ? 1 : -1;
}

function quickHtml(store) {
  const chips =
    store === "amazon"
      ? ""
      : `<div class="chips" role="group" aria-label="Aisle">${CATEGORY_ORDER[store]
          .map((category) => {
            const on = state.category[store] === category;
            return `<button type="button" data-action="chip" data-category="${category}" aria-pressed="${on ? "true" : "false"}">${esc(CATEGORY_LABEL[category])}</button>`;
          })
          .join("")}</div>`;
  return `<form id="quick-form" class="quick">
    <div class="quick-row">
      <label class="sr-only" for="quick-name">Add an item</label>
      <input id="quick-name" type="text" maxlength="80" enterkeyhint="done" autocomplete="off" placeholder="${esc(placeholder(store))}" value="${esc(state.quickName)}">
      <button class="btn-primary btn-add" type="submit" ${state.saving ? "disabled" : ""}>Add</button>
    </div>
    ${chips}
    <button class="linkish full" type="button" data-action="details">Add details</button>
  </form>`;
}

function placeholder(store) {
  if (store === "local") return "Add something for the local store";
  if (store === "amazon") return "Add something for Amazon";
  return "Add something for Costco";
}

function itemHtml(item) {
  const bits = [];
  if (item.quantityNote) bits.push(item.quantityNote);
  if (item.brand) bits.push(item.brand);
  const aisle = item.store !== "amazon" && item.checked ? CATEGORY_LABEL[item.category] : "";
  if (aisle) bits.push(aisle);
  const note = bits.join(" · ");
  const label = item.checked ? `Put ${item.name} back on the list` : `Mark ${item.name} as bought`;
  return `<li class="item${item.checked ? " checked" : ""}" data-id="${esc(item.id)}">
    <button class="check" type="button" data-action="toggle" data-id="${esc(item.id)}" aria-pressed="${item.checked ? "true" : "false"}" aria-label="${esc(label)}" ${state.pendingIds.has(item.id) ? "disabled" : ""}>
      ${item.checked ? boxOn() : `<span class="box" aria-hidden="true"></span>`}
      <span class="item-text">
        <span class="name">${esc(item.name)}${item.staple ? `<span class="tag">Staple</span>` : ""}</span>
        ${note ? `<span class="note">${esc(note)}</span>` : ""}
      </span>
    </button>
    <button class="edit" type="button" data-action="edit" data-id="${esc(item.id)}">Edit</button>
  </li>`;
}

function boxOn() {
  return `<span class="box on" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12.5 10 17.5 19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg></span>`;
}

function staplesHtml() {
  const rank = { costco: 0, local: 1, amazon: 2 };
  const staples = [...state.staples].sort(
    (a, b) => rank[a.store] - rank[b.store] || a.name.localeCompare(b.name),
  );
  const list = staples.length
    ? `<ul class="staples">${staples.map(stapleHtml).join("")}</ul>`
    : `<p class="empty">No staples yet. Staples are things you buy again and again, like oat milk.</p>`;
  return `<p class="intro">Things you buy often. Add one to a store when you need it this week.</p>
    <p class="stack"><button class="btn-primary full" type="button" data-action="new-staple">Add a staple</button></p>
    ${list}`;
}

function stapleOnList(staple) {
  return state.items.some((item) => item.stapleId === staple.id && !item.checked);
}

function stapleHtml(staple) {
  const onList = stapleOnList(staple);
  const bits = [STORE_LABEL[staple.store]];
  if (staple.store !== "amazon") bits.push(CATEGORY_LABEL[staple.category]);
  if (staple.brand) bits.push(staple.brand);
  return `<li class="staple">
    <h3>${esc(staple.name)}</h3>
    <p class="meta">${esc(bits.join(" · "))}</p>
    <button class="btn-primary full" type="button" data-action="add-staple" data-id="${esc(staple.id)}" ${onList || state.pendingIds.has(staple.id) ? "disabled" : ""}>${onList ? "On the list" : "Add to this week"}</button>
    <button class="btn-quiet full" type="button" data-action="remove-staple" data-id="${esc(staple.id)}">Remove staple</button>
  </li>`;
}

function overlayHtml() {
  if (state.confirm) return confirmHtml();
  if (state.sheet) return sheetHtml();
  return "";
}

function confirmHtml() {
  const confirm = state.confirm;
  return `<div class="backdrop" data-action="confirm-backdrop">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" data-action="noop">
      <h2 id="confirm-title">${esc(confirm.title)}</h2>
      <p>${esc(confirm.text)}</p>
      <div class="stack">
        <button class="btn-primary full" type="button" data-action="confirm-yes">${esc(confirm.yes)}</button>
        <button class="btn-secondary full" type="button" data-action="confirm-no">${esc(confirm.no)}</button>
      </div>
    </div>
  </div>`;
}

function sheetHtml() {
  const sheet = state.sheet;
  const stapleMode = sheet.mode === "staple";
  const title = stapleMode ? "New staple" : sheet.id ? "Edit item" : "New item";
  const categories = CATEGORY_ORDER[sheet.store] || CATEGORY_ORDER.costco;
  const categoryField =
    sheet.store === "amazon"
      ? ""
      : `<label class="field" for="f-category">Aisle
          <select id="f-category">${categories
            .map((category) => `<option value="${category}" ${sheet.category === category ? "selected" : ""}>${esc(CATEGORY_LABEL[category])}</option>`)
            .join("")}</select>
        </label>`;
  const asin = String(sheet.asin || "").trim().toUpperCase();
  const amazonLink = /^[A-Z0-9]{10}$/.test(asin)
    ? `<a class="btn-secondary full amazon-link" href="https://www.amazon.com/dp/${asin}" target="_blank" rel="noopener noreferrer">Open on Amazon</a>`
    : "";
  return `<div class="backdrop" data-action="backdrop">
    <form class="sheet" id="sheet-form" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">${esc(title)}</h2>
      <div class="stack">
        <label class="field" for="f-name">Name
          <input id="f-name" type="text" maxlength="80" required value="${esc(sheet.name)}">
        </label>
        ${
          stapleMode
            ? ""
            : `<label class="field" for="f-note">Quantity or note
                <input id="f-note" type="text" maxlength="140" placeholder="2 cartons, or a note" value="${esc(sheet.quantityNote)}">
              </label>`
        }
        <label class="field" for="f-store">Store
          <select id="f-store">
            ${STORES.map((store) => `<option value="${store}" ${sheet.store === store ? "selected" : ""}>${esc(STORE_LABEL[store])}</option>`).join("")}
          </select>
        </label>
        ${categoryField}
        <label class="field" for="f-brand">Brand
          <input id="f-brand" type="text" maxlength="80" placeholder="Optional" value="${esc(sheet.brand)}">
        </label>
        <label class="field" for="f-asin">Amazon code
          <input id="f-asin" type="text" maxlength="200" placeholder="Optional ASIN or product link" autocapitalize="characters" value="${esc(sheet.asin)}">
        </label>
        ${amazonLink}
        ${
          stapleMode
            ? ""
            : `<label class="checkline" for="f-staple">
                <input id="f-staple" type="checkbox" ${sheet.staple ? "checked" : ""}>
                <span>Staple — we buy this often<span class="help"><br>It stays on the Staples tab. Uncheck this to take it off that list. This week's name, store, and brand are kept with the staple.</span></span>
              </label>`
        }
        ${sheet.error ? `<p class="error" role="alert">${esc(sheet.error)}</p>` : ""}
        <button class="btn-primary full" type="submit" ${state.saving ? "disabled" : ""}>${stapleMode ? "Save staple" : "Save"}</button>
        ${sheet.id ? `<button class="btn-danger full" type="button" data-action="delete-item" data-id="${esc(sheet.id)}">Delete this item</button>` : ""}
        <button class="btn-secondary full" type="button" data-action="close-sheet">Cancel</button>
      </div>
    </form>
  </div>`;
}

function toastHtml() {
  if (!state.toast) return "";
  return `<div id="toast" class="toast" role="status">${esc(state.toast)}</div>`;
}

function readSheet() {
  const sheet = state.sheet;
  if (!sheet) return;
  const value = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : undefined;
  };
  const name = value("f-name");
  if (name !== undefined) sheet.name = name;
  const note = value("f-note");
  if (note !== undefined) sheet.quantityNote = note;
  const store = value("f-store");
  if (store) sheet.store = store;
  const category = value("f-category");
  if (category) sheet.category = category;
  const brand = value("f-brand");
  if (brand !== undefined) sheet.brand = brand;
  const asin = value("f-asin");
  if (asin !== undefined) sheet.asin = asin;
  const staple = document.getElementById("f-staple");
  if (staple) sheet.staple = staple.checked;
}

function blankSheet(mode, store) {
  const chosen = store || "costco";
  return {
    mode,
    id: null,
    name: mode === "item" ? state.quickName : "",
    quantityNote: "",
    store: chosen,
    category: chosen === "amazon" ? "general" : state.category[chosen] || CATEGORY_ORDER[chosen][0],
    brand: "",
    asin: "",
    staple: mode === "staple",
    error: "",
  };
}

async function pull(options = {}) {
  if (!options.force && inflight > 0) return;
  const seq = ++pullSeq;
  try {
    const [itemsRes, staplesRes] = await Promise.all([
      fetch("/api/items", { headers: { Accept: "application/json" } }),
      fetch("/api/staples", { headers: { Accept: "application/json" } }),
    ]);
    if (seq !== pullSeq) return;
    if (itemsRes.status === 401 || staplesRes.status === 401) {
      state.authed = false;
      state.booting = false;
      state.offline = false;
      render();
      return;
    }
    if (!itemsRes.ok || !staplesRes.ok) throw new Error("status");
    const itemsBody = await itemsRes.json();
    const staplesBody = await staplesRes.json();
    if (seq !== pullSeq) return;
    if (!options.force && inflight > 0) return;
    state.authed = true;
    state.booting = false;
    state.bootFailed = false;
    state.offline = false;
    const nextSnap = JSON.stringify(itemsBody.items) + "|" + JSON.stringify(staplesBody.staples);
    const changed = nextSnap !== state.snap;
    state.snap = nextSnap;
    state.items = itemsBody.items;
    state.staples = staplesBody.staples;
    if (changed || options.force) {
      if (!options.force && shouldDelayRender()) {
        state.pendingRender = true;
        return;
      }
      state.pendingRender = false;
      render({ keepScroll: true });
    } else {
      const banner = document.getElementById("banner");
      if (banner) banner.hidden = true;
    }
  } catch {
    if (seq !== pullSeq) return;
    state.booting = false;
    if (!state.authed) {
      state.bootFailed = true;
      render();
      return;
    }
    state.offline = true;
    const banner = document.getElementById("banner");
    if (banner) {
      banner.hidden = false;
    } else {
      render({ keepScroll: true });
    }
  }
}

async function login(event) {
  event.preventDefault();
  state.loginError = "";
  state.saving = true;
  render({ focus: "passcode" });
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ passcode: state.passcode.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    state.saving = false;
    if (!res.ok) {
      state.loginError = body.error || "That passcode didn't work.";
      render({ focus: "passcode" });
      return;
    }
    state.passcode = "";
    await pull({ force: true });
  } catch {
    state.saving = false;
    state.loginError = "Couldn't reach the list.";
    render({ focus: "passcode" });
  }
}

async function quickAdd(event) {
  event.preventDefault();
  const name = state.quickName.trim();
  if (!name) {
    showToast("Type a name first.");
    document.getElementById("quick-name")?.focus();
    return;
  }
  const store = state.tab;
  const category = store === "amazon" ? "general" : state.category[store];
  inflight += 1;
  state.saving = true;
  render({ keepScroll: true, focus: "quick-name" });
  try {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ name, store, category, staple: false }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(body.error || "Couldn't add that.");
      return;
    }
    state.quickName = "";
    showToast(`Added to ${STORE_LABEL[store]}`);
    await pull({ force: true });
    document.querySelector(`[data-id="${CSS.escape(body.item.id)}"]`)?.scrollIntoView({ block: "nearest" });
  } catch {
    showToast("Couldn't reach the list.");
  } finally {
    inflight -= 1;
    state.saving = false;
    if (document.getElementById("quick-name") && state.quickName === "") {
      document.getElementById("quick-name").value = "";
    }
  }
}

async function saveSheet(event) {
  event.preventDefault();
  readSheet();
  const sheet = state.sheet;
  if (!sheet.name.trim()) {
    sheet.error = "Add a name.";
    render({ focus: "f-name", keepScroll: true });
    return;
  }
  const payload = {
    name: sheet.name,
    store: sheet.store,
    category: sheet.store === "amazon" ? "general" : sheet.category,
    brand: sheet.brand,
    asin: sheet.asin,
  };
  if (sheet.mode === "item") {
    payload.quantityNote = sheet.quantityNote;
    payload.staple = Boolean(sheet.staple);
  }
  inflight += 1;
  state.saving = true;
  sheet.error = "";
  render({ keepScroll: true });
  try {
    const creatingItem = sheet.mode === "item" && !sheet.id;
    const path = sheet.mode === "staple" ? "/api/staples" : creatingItem ? "/api/items" : `/api/items/${sheet.id}`;
    const method = creatingItem || sheet.mode === "staple" ? "POST" : "PATCH";
    const res = await fetch(path, { method, headers: jsonHeaders(), body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      sheet.error = body.error || "Couldn't save that.";
      state.saving = false;
      render({ focus: "f-name", keepScroll: true });
      return;
    }
    const createdId = body.item && body.item.id;
    state.sheet = null;
    if (creatingItem) state.quickName = "";
    state.saving = false;
    showToast(sheet.mode === "staple" ? "Saved staple" : creatingItem ? `Added to ${STORE_LABEL[payload.store]}` : "Saved");
    await pull({ force: true });
    if (createdId) document.querySelector(`[data-id="${CSS.escape(createdId)}"]`)?.scrollIntoView({ block: "nearest" });
  } catch {
    sheet.error = "Couldn't reach the list.";
    state.saving = false;
    render({ keepScroll: true });
  } finally {
    inflight -= 1;
  }
}

async function toggleItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item || state.pendingIds.has(id)) return;
  const next = !item.checked;
  item.checked = next;
  item.updatedAt = new Date().toISOString();
  state.pendingIds.add(id);
  inflight += 1;
  render({ keepScroll: true });
  try {
    const res = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ checked: next }),
    });
    if (!res.ok) throw new Error("status");
    const body = await res.json();
    const current = state.items.find((entry) => entry.id === id);
    if (current && body.item) Object.assign(current, body.item);
    state.snap = snapshot();
  } catch {
    const current = state.items.find((entry) => entry.id === id);
    if (current) current.checked = !next;
    showToast("Couldn't update that. Try again.");
  } finally {
    state.pendingIds.delete(id);
    inflight -= 1;
    render({ keepScroll: true });
  }
}

async function addStaple(id) {
  if (state.pendingIds.has(id)) return;
  const staple = state.staples.find((entry) => entry.id === id);
  state.pendingIds.add(id);
  inflight += 1;
  render({ keepScroll: true });
  try {
    const res = await fetch(`/api/staples/${id}/add`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "status");
    const place = staple ? STORE_LABEL[staple.store] : "the list";
    showToast(body.alreadyOnList ? `Already on the ${place} list` : `Added to ${place}`);
    await pull({ force: true });
  } catch {
    showToast("Couldn't add that staple.");
    render({ keepScroll: true });
  } finally {
    state.pendingIds.delete(id);
    inflight -= 1;
  }
}

async function removeStaple(id) {
  inflight += 1;
  state.confirm = null;
  try {
    const res = await fetch(`/api/staples/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "status");
    showToast("Removed from staples");
    await pull({ force: true });
  } catch {
    showToast("Couldn't remove that staple.");
    render({ keepScroll: true });
  } finally {
    inflight -= 1;
  }
}

async function removeItem(id) {
  inflight += 1;
  state.confirm = null;
  state.sheet = null;
  try {
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "status");
    showToast("Removed");
    await pull({ force: true });
  } catch {
    showToast("Couldn't remove that.");
    render({ keepScroll: true });
  } finally {
    inflight -= 1;
  }
}

async function clearStore(store) {
  inflight += 1;
  state.confirm = null;
  render({ keepScroll: true });
  try {
    const res = await fetch("/api/items/clear-checked", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ store }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "status");
    showToast(body.removed ? "Cleared bought items" : "Nothing to clear");
    await pull({ force: true });
  } catch {
    showToast("Couldn't clear those.");
    render({ keepScroll: true });
  } finally {
    inflight -= 1;
  }
}

function askClear() {
  const store = state.tab;
  const count = state.items.filter((item) => item.store === store && item.checked).length;
  if (!count) return;
  state.confirm = {
    title: "Clear bought items?",
    text: `Take ${count} bought ${count === 1 ? "item" : "items"} off the ${STORE_LABEL[store]} list? Staples stay, so you can add them again.`,
    yes: "Yes, clear them",
    no: "Keep them",
    run: () => clearStore(store),
  };
  render({ keepScroll: false });
}

function askDeleteItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  state.confirm = {
    title: "Remove this item?",
    text: item ? `Remove ${item.name} from this week's list?` : "Remove this item from this week's list?",
    yes: "Yes, remove it",
    no: "Keep it",
    run: () => removeItem(id),
  };
  render({ keepScroll: false });
}

function askRemoveStaple(id) {
  const staple = state.staples.find((entry) => entry.id === id);
  state.confirm = {
    title: "Remove this staple?",
    text: staple
      ? `Remove ${staple.name} from staples? It stays on this week's list if it's already there.`
      : "Remove this staple?",
    yes: "Yes, remove it",
    no: "Keep it",
    run: () => removeStaple(id),
  };
  render({ keepScroll: false });
}

document.body.addEventListener("click", (event) => {
  const backdrop = event.target.closest("[data-action='backdrop']");
  if (backdrop && event.target === backdrop) {
    state.sheet = null;
    render({ keepScroll: true });
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "tab") {
    state.tab = button.dataset.store;
    try {
      localStorage.setItem("grocery-tab", state.tab);
    } catch {
      /* ignore */
    }
    render({ keepScroll: false });
    window.scrollTo(0, 0);
    return;
  }
  if (action === "chip") {
    state.category[state.tab] = button.dataset.category;
    render({ keepScroll: true });
    return;
  }
  if (action === "noop") return;
  if (action === "confirm-backdrop") {
    if (event.target === button) {
      state.confirm = null;
      render({ keepScroll: true });
    }
    return;
  }
  if (action === "details") {
    const store = state.tab === "amazon" || state.tab === "costco" || state.tab === "local" ? state.tab : "costco";
    state.sheet = blankSheet("item", store);
    render({ keepScroll: false, focus: "f-name" });
    return;
  }
  if (action === "new-staple") {
    state.sheet = blankSheet("staple", "costco");
    render({ keepScroll: false, focus: "f-name" });
    return;
  }
  if (action === "edit") {
    const item = state.items.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    state.sheet = {
      mode: "item",
      id: item.id,
      name: item.name,
      quantityNote: item.quantityNote || "",
      store: item.store,
      category: item.category,
      brand: item.brand || "",
      asin: item.asin || "",
      staple: Boolean(item.staple),
      error: "",
    };
    render({ keepScroll: false, focus: "f-name" });
    return;
  }
  if (action === "toggle") {
    toggleItem(button.dataset.id);
    return;
  }
  if (action === "add-staple") {
    addStaple(button.dataset.id);
    return;
  }
  if (action === "remove-staple") {
    askRemoveStaple(button.dataset.id);
    return;
  }
  if (action === "delete-item") {
    askDeleteItem(button.dataset.id);
    return;
  }
  if (action === "clear") {
    askClear();
    return;
  }
  if (action === "close-sheet") {
    state.sheet = null;
    render({ keepScroll: true });
    return;
  }
  if (action === "confirm-no") {
    state.confirm = null;
    render({ keepScroll: true });
    return;
  }
  if (action === "confirm-yes") {
    const run = state.confirm && state.confirm.run;
    state.confirm = null;
    if (run) run();
    return;
  }
  if (action === "logout") {
    fetch("/api/logout", { method: "POST" }).finally(() => {
      state.authed = false;
      state.items = [];
      state.staples = [];
      state.snap = "";
      state.sheet = null;
      state.confirm = null;
      state.offline = false;
      render();
    });
    return;
  }
  if (action === "retry") {
    state.booting = true;
    state.bootFailed = false;
    render();
    pull({ force: true });
  }
});

document.body.addEventListener("submit", (event) => {
  if (event.target.id === "login-form") login(event);
  if (event.target.id === "quick-form") quickAdd(event);
  if (event.target.id === "sheet-form") saveSheet(event);
});

document.body.addEventListener("input", (event) => {
  if (event.target.id === "quick-name") state.quickName = event.target.value;
  if (event.target.id === "passcode") state.passcode = event.target.value;
  if (state.sheet && event.target.closest("#sheet-form")) readSheet();
});

document.body.addEventListener("focusout", () => {
  window.setTimeout(() => {
    if (!state.pendingRender || shouldDelayRender()) return;
    render({ keepScroll: true });
  }, 60);
});

document.body.addEventListener("change", (event) => {
  if (event.target.id === "f-store" && state.sheet) {
    readSheet();
    const allowed = CATEGORY_ORDER[state.sheet.store];
    if (!allowed.includes(state.sheet.category)) state.sheet.category = allowed[0];
    render({ keepScroll: true, focus: "f-store" });
  }
  if (event.target.id === "f-staple" && state.sheet) state.sheet.staple = event.target.checked;
  if (event.target.id === "f-category" && state.sheet) state.sheet.category = event.target.value;
});

syncTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
pull({ force: true });
setInterval(() => {
  if (document.visibilityState === "hidden") return;
  if (!state.authed) return;
  pull();
}, 5000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.authed) pull();
});
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
