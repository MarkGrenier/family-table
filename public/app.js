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

const STORE_TABS = ["costco", "local", "amazon"];
const savedTab = loadTab();

const state = {
  booting: true,
  authed: false,
  bootFailed: false,
  offline: false,
  items: [],
  staples: [],
  snap: "",
  tab: savedTab,
  listTab: savedTab === "staples" ? "costco" : savedTab,
  quickName: "",
  passcode: "",
  loginError: "",
  edit: null,
  confirm: null,
  scanner: null,
  toast: "",
  onUndo: null,
  saving: false,
  pendingRender: false,
  pendingIds: new Set(),
  hiddenIds: new Set(),
  hiddenStapleIds: new Set(),
};

let pullSeq = 0;
let inflight = 0;
let toastTimer = 0;

function shouldDelayRender() {
  const active = document.activeElement;
  if (state.edit || state.confirm || state.scanner) return true;
  if (!active) return false;
  return active.id === "quick-name" || active.id === "passcode" || active.id === "scan-name" || active.id === "scan-code" || active.id === "edit-name" || active.id === "edit-qty";
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

function showToast(message, onUndo) {
  state.toast = message;
  state.onUndo = onUndo || null;
  const existing = document.getElementById("toast");
  if (existing) existing.outerHTML = toastHtml();
  else document.getElementById("app")?.insertAdjacentHTML("beforeend", toastHtml());
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = "";
    state.onUndo = null;
    document.getElementById("toast")?.remove();
  }, onUndo ? 4800 : 2600);
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

function visibleItem(item) {
  return !state.hiddenIds.has(item.id);
}

function storeHtml(store) {
  const open = state.items.filter((item) => item.store === store && !item.checked && visibleItem(item));
  const checked = state.items
    .filter((item) => item.store === store && item.checked && visibleItem(item))
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
  return `<form id="quick-form" class="quick">
    <div class="quick-row">
      <label class="sr-only" for="quick-name">Add an item</label>
      <input id="quick-name" type="text" maxlength="80" enterkeyhint="done" autocomplete="off" placeholder="${esc(placeholder(store))}" value="${esc(state.quickName)}">
      <button class="btn-primary btn-add" type="submit" ${state.saving ? "disabled" : ""}>Add</button>
      <button class="btn-secondary btn-scan" type="button" data-action="scan">Scan</button>
    </div>
  </form>`;
}

function placeholder(store) {
  if (store === "local") return "Add something for the local store";
  if (store === "amazon") return "Add something for Amazon";
  return "Add something for Costco";
}

function defaultsFor(name, store) {
  const key = name.trim().toLowerCase();
  const matches = [...state.staples, ...state.items].filter((entry) => entry.name.trim().toLowerCase() === key);
  const match = matches.find((entry) => entry.store === store) || matches[0] || null;
  const allowed = CATEGORY_ORDER[store] || CATEGORY_ORDER.costco;
  let category = store === "amazon" ? "general" : "shelf";
  if (match && allowed.includes(match.category)) category = match.category;
  const brand = (match && match.brand) || (matches.find((entry) => entry.brand) || {}).brand || "";
  return { category, brand };
}

function rememberTab(tab) {
  try {
    localStorage.setItem("grocery-tab", tab);
  } catch {
    /* private mode */
  }
}

function goToStore(store) {
  const next = STORE_TABS.includes(store) ? store : "costco";
  state.tab = next;
  state.listTab = next;
  rememberTab(next);
}

function itemHtml(item) {
  if (state.edit && state.edit.id === item.id) return editingHtml(item);
  const bits = [];
  if (item.quantityNote) bits.push(item.quantityNote);
  if (item.brand) bits.push(item.brand);
  const note = bits.join(" · ");
  const label = item.checked ? `Put ${item.name} back on the list` : `Mark ${item.name} as bought`;
  return `<li class="item${item.checked ? " checked" : ""}" data-id="${esc(item.id)}">
    <span class="swipe-label">Remove</span>
    <button class="check" type="button" data-action="toggle" data-id="${esc(item.id)}" aria-pressed="${item.checked ? "true" : "false"}" aria-label="${esc(label)}" ${state.pendingIds.has(item.id) ? "disabled" : ""}>
      ${item.checked ? boxOn() : `<span class="box" aria-hidden="true"></span>`}
      <span class="item-text">
        <span class="name">${esc(item.name)}${item.staple ? `<span class="star-mark" aria-hidden="true">★</span>` : ""}</span>
        ${note ? `<span class="note">${esc(note)}</span>` : ""}
      </span>
    </button>
  </li>`;
}

function chip(action, value, label, pressed, aria) {
  return `<button type="button" class="mini" data-action="${action}" data-value="${esc(value)}" aria-pressed="${pressed ? "true" : "false"}" aria-label="${esc(aria)}">${esc(label)}</button>`;
}

function editingHtml(item) {
  const edit = state.edit;
  const aisles = CATEGORY_ORDER[edit.store] || [];
  const aisleChips =
    edit.store === "amazon"
      ? ""
      : `<div class="minis" role="group" aria-label="Aisle">${aisles
          .map((category) =>
            chip(
              "pick-aisle",
              category,
              category === "shelf" ? "Shelf" : category === "refrigerated" ? "Cold" : CATEGORY_LABEL[category],
              edit.category === category,
              CATEGORY_LABEL[category],
            ),
          )
          .join("")}</div>`;
  return `<li class="item editing${item.checked ? " checked" : ""}" data-id="${esc(item.id)}">
    <span class="swipe-label">Remove</span>
    <div class="check">
      <button class="box-hit" type="button" data-action="toggle" data-id="${esc(item.id)}" aria-pressed="${item.checked ? "true" : "false"}" aria-label="${item.checked ? "Put it back" : "Mark as bought"}">
        ${item.checked ? boxOn() : `<span class="box" aria-hidden="true"></span>`}
      </button>
      <div class="item-text">
        <input id="edit-name" class="inline-name" type="text" maxlength="80" enterkeyhint="done" autocomplete="off" aria-label="Name" value="${esc(edit.name)}">
        ${item.brand ? `<span class="note">${esc(item.brand)}</span>` : ""}
        <div class="edit-line">
          <input id="edit-qty" class="inline-qty" type="text" maxlength="140" enterkeyhint="done" autocomplete="off" aria-label="Quantity" placeholder="Qty" value="${esc(edit.quantity)}">
          <button class="star" type="button" data-action="star" aria-pressed="${edit.staple ? "true" : "false"}" aria-label="${edit.staple ? "Staple. Tap to turn off." : "Tap to make it a staple."}">${edit.staple ? "★" : "☆"}</button>
        </div>
        <div class="minis" role="group" aria-label="Store">${STORES.map((store) => chip("pick-store", store, store === "local" ? "Local" : STORE_LABEL[store], edit.store === store, STORE_LABEL[store])).join("")}</div>
        ${aisleChips}
      </div>
    </div>
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
  const visible = staples.filter((staple) => !state.hiddenStapleIds.has(staple.id));
  if (!visible.length) return "";
  return `<ul class="staples">${visible.map(stapleHtml).join("")}</ul>`;
}

function stapleOnList(staple) {
  return state.items.some((item) => item.stapleId === staple.id && !item.checked);
}

function stapleHtml(staple) {
  const onList = stapleOnList(staple);
  const bits = [STORE_LABEL[staple.store]];
  if (staple.store !== "amazon") bits.push(CATEGORY_LABEL[staple.category]);
  if (staple.brand) bits.push(staple.brand);
  return `<li class="staple" data-id="${esc(staple.id)}">
    <span class="swipe-label">Remove</span>
    <div class="staple-face">
      <h3>${esc(staple.name)}</h3>
      <p class="meta">${esc(bits.join(" · "))}</p>
      <button class="btn-primary full" type="button" data-action="add-staple" data-id="${esc(staple.id)}" ${onList || state.pendingIds.has(staple.id) ? "disabled" : ""}>${onList ? "On the list" : "Add to this week"}</button>
    </div>
  </li>`;
}

function overlayHtml() {
  if (state.confirm) return confirmHtml();
  if (state.scanner) return scannerHtml();
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

function toastHtml() {
  if (!state.toast) return "";
  if (state.onUndo) {
    return `<button id="toast" class="toast" type="button" data-action="undo"><span>${esc(state.toast)}</span><span class="undo-label">Undo</span></button>`;
  }
  return `<div id="toast" class="toast" role="status"><span>${esc(state.toast)}</span></div>`;
}

function scannerHtml() {
  const scanner = state.scanner;
  if (scanner.phase === "name") {
    return `<div class="backdrop" data-action="backdrop">
      <form class="sheet" id="scan-name-form" role="dialog" aria-modal="true" aria-labelledby="scan-title">
        <h2 id="scan-title">New item</h2>
        <p class="intro">${scanner.brand ? esc(scanner.brand) : "Type what this is. Next time the scan will add it."}</p>
        <div class="stack">
          <label class="field" for="scan-name">Name
            <input id="scan-name" type="text" maxlength="80" value="${esc(scanner.name)}" placeholder="Name">
          </label>
          ${scanner.error ? `<p class="error" role="alert">${esc(scanner.error)}</p>` : ""}
          <button class="btn-primary full" type="submit" ${state.saving ? "disabled" : ""}>Add it</button>
        </div>
      </form>
    </div>`;
  }
  return `<div class="scanner" role="dialog" aria-modal="true" aria-labelledby="scan-title">
    <button class="close-x" type="button" data-action="close-scan" aria-label="Close">×</button>
    <h2 id="scan-title">Scan a barcode</h2>
    <p class="intro">Point the camera at the barcode on the package.</p>
    <video id="scan-video" playsinline autoplay muted></video>
    ${scanner.error ? `<p class="error" role="alert">${esc(scanner.error)}</p>` : ""}
    <form id="scan-code-form" class="stack">
      <label class="field" for="scan-code">Or type the barcode
        <input id="scan-code" type="text" inputmode="numeric" autocomplete="off" maxlength="20" placeholder="Numbers under the bars">
      </label>
      <button class="btn-primary full" type="submit">Look up</button>
    </form>
  </div>`;
}

let editGen = 0;
let editStayUntil = 0;

function readEditDom() {
  const edit = state.edit;
  if (!edit) return;
  const name = document.getElementById("edit-name");
  const qty = document.getElementById("edit-qty");
  if (name) edit.name = name.value;
  if (qty) edit.quantity = qty.value;
}

function openEdit(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (state.edit && state.edit.id !== id) {
    const pending = closeEdit(true);
    if (pending) sendEdit(pending);
  }
  state.edit = {
    id: item.id,
    name: item.name,
    quantity: item.quantityNote || "",
    store: item.store,
    category: item.category,
    staple: Boolean(item.staple),
  };
  render({ keepScroll: true, focus: "edit-name" });
  const input = document.getElementById("edit-name");
  if (input && typeof input.select === "function") input.select();
}

function closeEdit(save) {
  const edit = state.edit;
  if (!edit) return null;
  readEditDom();
  editGen += 1;
  state.edit = null;
  const item = state.items.find((entry) => entry.id === edit.id);
  if (!save || !item) return null;
  const name = edit.name.trim().replace(/\s+/g, " ");
  if (!name) return null;
  const quantity = edit.quantity.trim().replace(/\s+/g, " ");
  const staple = Boolean(edit.staple);
  const changed =
    name !== item.name ||
    quantity !== (item.quantityNote || "") ||
    edit.store !== item.store ||
    edit.category !== item.category ||
    staple !== Boolean(item.staple);
  if (!changed) return null;
  item.name = name;
  item.quantityNote = quantity || null;
  item.store = edit.store;
  item.category = edit.category;
  item.staple = staple;
  return {
    id: item.id,
    store: edit.store,
    body: {
      name,
      quantityNote: quantity,
      store: edit.store,
      category: edit.category,
      staple,
    },
  };
}

function sendEdit(pending) {
  if (!pending) return;
  inflight += 1;
  fetch(`/api/items/${pending.id}`, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(pending.body) })
    .then(async (res) => {
      if (!res.ok) throw new Error("status");
      await pull({ force: true });
    })
    .catch(() => {
      showToast("Couldn't save that.");
      pull({ force: true });
    })
    .finally(() => {
      inflight -= 1;
    });
}

function finishEdit(save) {
  const pending = closeEdit(save);
  if (pending && pending.store && pending.store !== state.tab && STORE_TABS.includes(pending.store)) {
    goToStore(pending.store);
  }
  render({ keepScroll: true });
  sendEdit(pending);
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
      if (shouldDelayRender() && (!options.force || state.edit || state.scanner || state.confirm)) {
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
  const store = STORE_TABS.includes(state.tab) ? state.tab : state.listTab;
  const remembered = defaultsFor(name, store);
  const payload = { name, store, category: remembered.category, staple: false };
  if (remembered.brand) payload.brand = remembered.brand;
  inflight += 1;
  state.saving = true;
  render({ keepScroll: true, focus: "quick-name" });
  try {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
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

async function removeStaple(id, options = {}) {
  inflight += 1;
  try {
    const res = await fetch(`/api/staples/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "status");
    if (!options.quiet) showToast("Removed from staples");
    await pull({ force: true });
  } catch {
    state.hiddenStapleIds.delete(id);
    showToast("Couldn't remove that staple.");
    render({ keepScroll: true });
  } finally {
    inflight -= 1;
  }
}

async function removeItem(id, options = {}) {
  inflight += 1;
  if (!options.quiet) state.confirm = null;
  try {
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "status");
    if (!options.quiet) showToast("Removed");
    await pull({ force: true });
  } catch {
    state.hiddenIds.delete(id);
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

let scanControls = null;
let scanBusy = false;
let scanSession = 0;
let scannerScript = null;
let pendingDelete = null;
let deleteToken = 0;

const gesture = {
  id: 0,
  pointerId: null,
  startX: 0,
  startY: 0,
  x: 0,
  y: 0,
  kind: null,
  itemEl: null,
  itemId: "",
  axis: null,
  longTimer: 0,
  longFired: false,
  moved: false,
  suppressClick: false,
  suppressToken: 0,
};

function loadScannerScript() {
  if (window.GroceryScanner) return Promise.resolve();
  if (!scannerScript) {
    scannerScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/scanner.js";
      script.onload = () => resolve();
      script.onerror = () => {
        scannerScript = null;
        script.remove();
        reject(new Error("script"));
      };
      document.body.appendChild(script);
    });
  }
  return scannerScript;
}

function stopCamera() {
  scanSession += 1;
  const controls = scanControls;
  scanControls = null;
  if (controls) {
    try {
      controls.stop();
    } catch {
      /* already stopped */
    }
  }
  const video = document.getElementById("scan-video");
  const stream = video && video.srcObject;
  if (stream && typeof stream.getTracks === "function") {
    stream.getTracks().forEach((track) => track.stop());
  }
  if (video) video.srcObject = null;
}

function setScannerError(message) {
  if (!state.scanner) return;
  state.scanner.error = message;
  const box = document.querySelector(".scanner");
  if (!box) {
    render({ keepScroll: true });
    return;
  }
  let el = box.querySelector(".error");
  if (!message) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("p");
    el.className = "error";
    el.setAttribute("role", "alert");
    box.querySelector("form")?.before(el);
  }
  el.textContent = message;
}

function openScanner() {
  if (state.edit) {
    const pending = closeEdit(true);
    sendEdit(pending);
  }
  stopCamera();
  const session = ++scanSession;
  scanBusy = false;
  state.confirm = null;
  state.scanner = { phase: "camera", error: "", name: "", brand: "", code: "" };
  render({ keepScroll: false });
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    setScannerError("The camera didn't open. Type the barcode instead.");
    return;
  }
  const streamPromise = navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });
  const scriptPromise = loadScannerScript();
  streamPromise
    .then(async (stream) => {
      if (session !== scanSession || !state.scanner || state.scanner.phase !== "camera") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const live = document.getElementById("scan-video");
      if (!live) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      live.srcObject = stream;
      live.playsInline = true;
      live.muted = true;
      try {
        await live.play();
      } catch {
        /* the scanner will try again */
      }
      try {
        await scriptPromise;
      } catch {
        if (session === scanSession) setScannerError("The scanner didn't load. Type the barcode instead.");
        return;
      }
      if (session !== scanSession || !state.scanner || state.scanner.phase !== "camera") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const Reader = window.GroceryScanner && window.GroceryScanner.BrowserMultiFormatReader;
      if (!Reader) {
        setScannerError("The scanner didn't load. Type the barcode instead.");
        return;
      }
      try {
        const controls = await new Reader().decodeFromStream(stream, live, (result) => {
          if (!result || typeof result.getText !== "function") return;
          handleScan(result.getText());
        });
        if (session !== scanSession) {
          try {
            controls.stop();
          } catch {
            /* closed */
          }
          return;
        }
        scanControls = controls;
      } catch {
        if (session === scanSession) setScannerError("The camera didn't open. Type the barcode instead.");
      }
    })
    .catch(() => {
      if (session === scanSession) setScannerError("The camera didn't open. Type the barcode instead.");
    });
}

async function addKnownBarcode(body, digits) {
  inflight += 1;
  try {
    const res = body.stapleId
      ? await fetch(`/api/staples/${body.stapleId}/add`, { method: "POST" })
      : await fetch("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            name: body.name,
            store: body.store,
            category: body.category,
            brand: body.brand,
            asin: body.asin,
            barcode: digits,
            staple: true,
          }),
        });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      state.authed = false;
      render();
      return;
    }
    if (!res.ok) throw new Error(data.error || "status");
    goToStore(body.store);
    const place = STORE_LABEL[body.store] || "the list";
    showToast(data.alreadyOnList ? `Already on the ${place} list` : `Added to ${place}`);
    await pull({ force: true });
  } catch {
    showToast("Couldn't add that.");
    render({ keepScroll: true });
  } finally {
    inflight -= 1;
    scanBusy = false;
  }
}

async function handleScan(raw) {
  if (scanBusy || !state.scanner || state.scanner.phase !== "camera") return;
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 14) {
    setScannerError("That didn't look like a product barcode.");
    return;
  }
  scanBusy = true;
  setScannerError("");
  try {
    const res = await fetch(`/api/barcode/${digits}`, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      stopCamera();
      state.scanner = null;
      state.authed = false;
      render();
      return;
    }
    if (!res.ok) {
      scanBusy = false;
      setScannerError(body.error || "Couldn't look that up.");
      return;
    }
    stopCamera();
    if (body.known && body.alreadyOnList) {
      state.scanner = null;
      goToStore(body.store);
      showToast(`${body.name} is already on the ${STORE_LABEL[body.store] || "list"}`);
      scanBusy = false;
      render({ keepScroll: false });
      window.scrollTo(0, 0);
      return;
    }
    if (body.known) {
      state.scanner = null;
      render({ keepScroll: false });
      await addKnownBarcode(body, digits);
      return;
    }
    const suggestion = body.suggestion || {};
    state.scanner = {
      phase: "name",
      code: digits,
      name: suggestion.name || "",
      brand: suggestion.brand || "",
      error: "",
    };
    scanBusy = false;
    render({ focus: "scan-name", keepScroll: false });
  } catch {
    scanBusy = false;
    setScannerError("Couldn't reach the list. Type the barcode instead.");
  }
}

async function saveScannedName(event) {
  event.preventDefault();
  const scanner = state.scanner;
  if (!scanner) return;
  const typed = document.getElementById("scan-name");
  const name = (typed ? typed.value : scanner.name).trim();
  scanner.name = name;
  if (!name) {
    scanner.error = "Type a name.";
    render({ focus: "scan-name" });
    return;
  }
  const store = STORE_TABS.includes(state.listTab) ? state.listTab : "costco";
  const remembered = defaultsFor(name, store);
  const brand = scanner.brand || remembered.brand || null;
  inflight += 1;
  state.saving = true;
  scanner.error = "";
  render({ keepScroll: true });
  try {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name,
        store,
        category: remembered.category,
        brand,
        barcode: scanner.code,
        staple: true,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      scanner.error = body.error || "Couldn't add that.";
      state.saving = false;
      render({ focus: "scan-name" });
      return;
    }
    state.scanner = null;
    state.saving = false;
    goToStore(store);
    showToast(`Added to ${STORE_LABEL[store]}`);
    await pull({ force: true });
  } catch {
    scanner.error = "Couldn't reach the list.";
    state.saving = false;
    render({ keepScroll: true });
  } finally {
    inflight -= 1;
  }
}

function backToList() {
  stopCamera();
  scanBusy = false;
  state.scanner = null;
  if (!STORE_TABS.includes(state.tab)) {
    state.tab = state.listTab;
    rememberTab(state.tab);
  }
  render({ keepScroll: false });
  window.scrollTo(0, 0);
}

function shiftTab(direction) {
  const index = STORE_TABS.indexOf(state.tab);
  if (index < 0) return;
  const next = STORE_TABS[(index + direction + STORE_TABS.length) % STORE_TABS.length];
  goToStore(next);
  render({ keepScroll: false });
  window.scrollTo(0, 0);
}

function rowFace(el) {
  return el ? el.querySelector(".check, .staple-face") : null;
}

async function commitDelete(pending) {
  if (!pending) return;
  if (pending.kind === "staple") {
    await removeStaple(pending.id, { quiet: true });
    state.hiddenStapleIds.delete(pending.id);
    return;
  }
  await removeItem(pending.id, { quiet: true });
  state.hiddenIds.delete(pending.id);
}

function stageRemoval(kind, id, label) {
  const hidden = kind === "staple" ? state.hiddenStapleIds : state.hiddenIds;
  if (hidden.has(id)) return;
  if (pendingDelete) {
    const previous = pendingDelete;
    window.clearTimeout(previous.timer);
    pendingDelete = null;
    commitDelete(previous);
  }
  const token = ++deleteToken;
  hidden.add(id);
  pendingDelete = {
    id,
    kind,
    token,
    timer: window.setTimeout(() => {
      if (!pendingDelete || pendingDelete.token !== token) return;
      pendingDelete = null;
      commitDelete({ id, kind });
    }, 4800),
  };
  showToast(`Removed ${label}`, () => undoRemoval(token));
  render({ keepScroll: true });
}

function undoRemoval(token) {
  if (!pendingDelete || pendingDelete.token !== token) return;
  window.clearTimeout(pendingDelete.timer);
  const pending = pendingDelete;
  pendingDelete = null;
  if (pending.kind === "staple") state.hiddenStapleIds.delete(pending.id);
  else state.hiddenIds.delete(pending.id);
  state.toast = "";
  state.onUndo = null;
  window.clearTimeout(toastTimer);
  render({ keepScroll: true });
}

function gestureKind(target, x) {
  if (!state.authed || state.confirm) return "ignore";
  if (target.closest("#toast")) return "ignore";
  const field = target.closest("input, textarea, select");
  const onStaples = state.tab === "staples";
  const secondary = Boolean(state.scanner || onStaples);
  if (field && !(secondary && x < 28)) return "ignore";
  const row = target.closest(".item, .staple");
  if (row && row.classList.contains("item")) return "item";
  if (row && row.classList.contains("staple")) return "staple";
  if (secondary) return "back";
  if (STORE_TABS.includes(state.tab)) return "nav";
  return "ignore";
}

function resetGesture() {
  window.clearTimeout(gesture.longTimer);
  gesture.pointerId = null;
  gesture.kind = null;
  gesture.axis = null;
  gesture.itemEl?.classList.remove("dragging");
  gesture.itemEl = null;
}

document.body.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  if (gesture.pointerId != null) return;
  const target = event.target;
  if (target instanceof Element && state.edit && !target.closest(".editing")) {
    const pending = closeEdit(true);
    if (pending && pending.store && pending.store !== state.tab && STORE_TABS.includes(pending.store)) goToStore(pending.store);
    sendEdit(pending);
  }
  if (!(target instanceof Element)) return;
  const kind = gestureKind(target, event.clientX);
  if (kind === "ignore") return;
  gesture.id += 1;
  const id = gesture.id;
  gesture.pointerId = event.pointerId;
  gesture.startX = event.clientX;
  gesture.startY = event.clientY;
  gesture.x = event.clientX;
  gesture.y = event.clientY;
  gesture.kind = kind;
  gesture.itemEl = kind === "item" || kind === "staple" ? target.closest(".item, .staple") : null;
  gesture.itemId = gesture.itemEl ? gesture.itemEl.dataset.id || "" : "";
  gesture.axis = null;
  gesture.longFired = false;
  gesture.moved = false;
  window.clearTimeout(gesture.longTimer);
  if (kind === "item" && !(state.edit && state.edit.id === gesture.itemId)) {
    gesture.longTimer = window.setTimeout(() => {
      if (gesture.id !== id || gesture.moved) return;
      gesture.longFired = true;
      gesture.suppressClick = true;
      const face = rowFace(gesture.itemEl);
      if (face) face.style.transform = "";
      openEdit(gesture.itemId);
    }, 550);
  }
});

document.body.addEventListener("pointermove", (event) => {
  if (event.pointerId !== gesture.pointerId) return;
  gesture.x = event.clientX;
  gesture.y = event.clientY;
  const dx = gesture.x - gesture.startX;
  const dy = gesture.y - gesture.startY;
  if (!gesture.axis) {
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
    gesture.moved = true;
    window.clearTimeout(gesture.longTimer);
    const edgeBack = gesture.kind === "back" && gesture.startX < 36;
    const mostlyVertical = edgeBack ? Math.abs(dy) > Math.abs(dx) * 1.75 : Math.abs(dy) > Math.abs(dx);
    if (mostlyVertical) {
      gesture.axis = "y";
      return;
    }
    gesture.axis = "x";
    gesture.itemEl?.classList.add("dragging");
    try {
      document.body.setPointerCapture(event.pointerId);
    } catch {
      /* already captured */
    }
  }
  if (gesture.axis !== "x" || (gesture.kind !== "item" && gesture.kind !== "staple") || !gesture.itemEl) return;
  const shift = Math.max(Math.min(0, dx), -140);
  const face = rowFace(gesture.itemEl);
  if (face) face.style.transform = `translateX(${shift}px)`;
});

function finishPointer(event) {
  if (event.pointerId !== gesture.pointerId) return;
  const dx = gesture.x - gesture.startX;
  const kind = gesture.kind;
  const axis = gesture.axis;
  const itemEl = gesture.itemEl;
  const itemId = gesture.itemId;
  const longFired = gesture.longFired;
  const moved = gesture.moved;
  resetGesture();
  if (longFired || moved) {
    gesture.suppressClick = true;
    const token = ++gesture.suppressToken;
    window.setTimeout(() => {
      if (gesture.suppressToken === token) gesture.suppressClick = false;
    }, 500);
  }
  if (longFired || axis !== "x") return;
  if (kind === "item" || kind === "staple") {
    const face = rowFace(itemEl);
    if (face) face.style.transform = "";
    if (dx < -72) {
      if (kind === "staple") {
        const staple = state.staples.find((entry) => entry.id === itemId);
        if (staple) stageRemoval("staple", itemId, staple.name);
      } else {
        if (state.edit && state.edit.id === itemId) closeEdit(false);
        const item = state.items.find((entry) => entry.id === itemId);
        if (item) stageRemoval("item", itemId, item.name);
      }
    } else if (kind === "staple" && dx >= 40) {
      backToList();
    }
    return;
  }
  if (kind === "nav") {
    if (dx <= -56) shiftTab(1);
    else if (dx >= 56) shiftTab(-1);
    return;
  }
  if (kind === "back" && dx >= 40) backToList();
}

document.body.addEventListener("pointerup", finishPointer);
document.body.addEventListener("pointercancel", finishPointer);

document.body.addEventListener("contextmenu", (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest(".item")) event.preventDefault();
});

document.body.addEventListener("click", (event) => {
  const clicked = event.target instanceof Element ? event.target.closest("[data-action]") : null;
  const clickedAction = clicked ? clicked.dataset.action : "";
  if (gesture.suppressClick) {
    gesture.suppressClick = false;
    if (clickedAction === "toggle" || clickedAction === "add-staple") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "tab") {
    state.tab = button.dataset.store;
    if (state.tab !== "staples") state.listTab = state.tab;
    rememberTab(state.tab);
    render({ keepScroll: false });
    window.scrollTo(0, 0);
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
  if (action === "star" || action === "pick-store" || action === "pick-aisle") {
    if (!state.edit) return;
    editStayUntil = Date.now() + 400;
    readEditDom();
    if (action === "star") state.edit.staple = !state.edit.staple;
    if (action === "pick-store") {
      state.edit.store = button.dataset.value;
      const allowed = CATEGORY_ORDER[state.edit.store] || ["shelf"];
      if (!allowed.includes(state.edit.category)) state.edit.category = allowed[0];
    }
    if (action === "pick-aisle") state.edit.category = button.dataset.value;
    render({ keepScroll: true });
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
  if (action === "clear") {
    askClear();
    return;
  }
  if (action === "scan") {
    openScanner();
    return;
  }
  if (action === "close-scan") {
    backToList();
    return;
  }
  if (action === "undo") {
    if (state.onUndo) state.onUndo();
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
    const pending = pendingDelete;
    if (pending) {
      window.clearTimeout(pending.timer);
      pendingDelete = null;
      const path = pending.kind === "staple" ? `/api/staples/${pending.id}` : `/api/items/${pending.id}`;
      fetch(path, { method: "DELETE" }).catch(() => {});
    }
    stopCamera();
    fetch("/api/logout", { method: "POST" }).finally(() => {
      state.authed = false;
      state.items = [];
      state.staples = [];
      state.snap = "";
      state.edit = null;
      state.scanner = null;
      state.confirm = null;
      state.hiddenIds = new Set();
      state.hiddenStapleIds = new Set();
      state.onUndo = null;
      state.toast = "";
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
  if (event.target.id === "scan-name-form") saveScannedName(event);
  if (event.target.id === "scan-code-form") {
    event.preventDefault();
    const field = document.getElementById("scan-code");
    handleScan(field ? field.value : "");
  }
});

document.body.addEventListener("input", (event) => {
  if (event.target.id === "quick-name") state.quickName = event.target.value;
  if (event.target.id === "passcode") state.passcode = event.target.value;
  if (event.target.id === "scan-name" && state.scanner) state.scanner.name = event.target.value;
  if (state.edit && event.target.id === "edit-name") state.edit.name = event.target.value;
  if (state.edit && event.target.id === "edit-qty") state.edit.quantity = event.target.value;
});

document.body.addEventListener("keydown", (event) => {
  if (!state.edit) return;
  if (event.target.id !== "edit-name" && event.target.id !== "edit-qty") return;
  if (event.key === "Escape") {
    event.preventDefault();
    finishEdit(false);
  }
  if (event.key === "Enter") {
    event.preventDefault();
    finishEdit(true);
  }
});

document.body.addEventListener("focusout", () => {
  const gen = editGen;
  window.setTimeout(() => {
    if (state.edit && gen === editGen && Date.now() >= editStayUntil) {
      const active = document.activeElement;
      if (!(active && active.closest && active.closest(".editing"))) {
        finishEdit(true);
        return;
      }
    }
    if (!state.edit && document.querySelector(".editing")) {
      render({ keepScroll: true });
      return;
    }
    if (!state.pendingRender || shouldDelayRender()) return;
    render({ keepScroll: true });
  }, 80);
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
