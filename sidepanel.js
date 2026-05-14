// App Dashboard - side panel logic.
// State shape:
//   { sections: [ { id, name, apps: [ { id, name, url } ] } ] }

const STORAGE_KEY = "dashboard";

const DEFAULT_STATE = {
  sections: [
    {
      id: "default",
      name: "My Apps",
      apps: [],
    },
  ],
};

let state = structuredClone(DEFAULT_STATE);

// ---------- Persistence ----------

async function loadState() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  if (result[STORAGE_KEY] && Array.isArray(result[STORAGE_KEY].sections)) {
    state = result[STORAGE_KEY];
  } else {
    state = structuredClone(DEFAULT_STATE);
    await saveState();
  }
}

async function saveState() {
  await chrome.storage.sync.set({ [STORAGE_KEY]: state });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes[STORAGE_KEY]) {
    const next = changes[STORAGE_KEY].newValue;
    if (next && JSON.stringify(next) !== JSON.stringify(state)) {
      state = next;
      render();
    }
  }
});

// ---------- Helpers ----------

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function findSection(sectionId) {
  return state.sections.find((s) => s.id === sectionId);
}

function faviconUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    // Chrome's built-in favicon service via Google.
    return `https://www.google.com/s2/favicons?sz=64&domain=${u.hostname}`;
  } catch {
    return null;
  }
}

function initials(name) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

// ---------- Rendering ----------

const container = document.getElementById("sections-container");

function render() {
  container.innerHTML = "";
  if (state.sections.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No sections yet. Click + Section to add one.";
    container.appendChild(empty);
    return;
  }
  for (const section of state.sections) {
    container.appendChild(renderSection(section));
  }
}

function renderSection(section) {
  const el = document.createElement("section");
  el.className = "section";
  el.dataset.sectionId = section.id;

  const header = document.createElement("div");
  header.className = "section-header";

  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.title = "Drag to reorder section";
  handle.textContent = "⋮⋮";
  handle.draggable = true;
  header.appendChild(handle);

  const title = document.createElement("h2");
  title.textContent = section.name;
  title.title = "Click to rename";
  title.addEventListener("click", () => openSectionDialog(section));
  header.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "section-actions";

  const renameBtn = document.createElement("button");
  renameBtn.className = "icon-btn";
  renameBtn.title = "Rename section";
  renameBtn.textContent = "✎";
  renameBtn.addEventListener("click", () => openSectionDialog(section));
  actions.appendChild(renameBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "icon-btn danger";
  deleteBtn.title = "Delete section";
  deleteBtn.textContent = "✕";
  deleteBtn.addEventListener("click", () => deleteSection(section.id));
  actions.appendChild(deleteBtn);

  header.appendChild(actions);
  el.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "app-grid";
  grid.dataset.sectionId = section.id;

  for (const app of section.apps) {
    grid.appendChild(renderApp(app, section.id));
  }

  const addTile = document.createElement("button");
  addTile.className = "add-app-tile";
  addTile.title = "Add app";
  addTile.textContent = "+";
  addTile.addEventListener("click", () => openAppDialog(section.id, null));
  grid.appendChild(addTile);

  el.appendChild(grid);
  attachGridDnD(grid);

  attachSectionDnD(el, handle, section.id);
  return el;
}

function renderApp(app, sectionId) {
  const tile = document.createElement("a");
  tile.className = "app-tile";
  tile.href = app.url;
  tile.target = "_blank";
  tile.rel = "noopener noreferrer";
  tile.draggable = true;
  tile.dataset.appId = app.id;
  tile.dataset.sectionId = sectionId;

  const icon = document.createElement("div");
  icon.className = "app-icon";
  const fav = faviconUrl(app.url);
  if (fav) {
    icon.classList.add("has-favicon");
    icon.style.setProperty("--favicon", `url("${fav}")`);
  }
  icon.textContent = initials(app.name);
  tile.appendChild(icon);

  const name = document.createElement("div");
  name.className = "app-name";
  name.textContent = app.name;
  tile.appendChild(name);

  const tileActions = document.createElement("div");
  tileActions.className = "tile-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "icon-btn";
  editBtn.title = "Edit app";
  editBtn.textContent = "✎";
  editBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openAppDialog(sectionId, app.id);
  });
  tileActions.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn danger";
  delBtn.title = "Delete app";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    deleteApp(sectionId, app.id);
  });
  tileActions.appendChild(delBtn);

  tile.appendChild(tileActions);

  attachTileDnD(tile);
  return tile;
}

// ---------- Drag and Drop ----------

let dragData = null; // { kind: "app", sectionId, appId } | { kind: "section", sectionId }

function attachTileDnD(tile) {
  tile.addEventListener("dragstart", (e) => {
    dragData = {
      kind: "app",
      sectionId: tile.dataset.sectionId,
      appId: tile.dataset.appId,
    };
    tile.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tile.dataset.appId);
  });
  tile.addEventListener("dragend", () => {
    tile.classList.remove("dragging");
    dragData = null;
    clearAppDropIndicators();
    clearSectionDropIndicators();
    document.querySelectorAll(".section.drag-over").forEach((el) =>
      el.classList.remove("drag-over")
    );
  });
}

function attachGridDnD(grid) {
  const sectionEl = grid.closest(".section");

  grid.addEventListener("dragover", (e) => {
    if (!dragData || dragData.kind !== "app") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    sectionEl.classList.add("drag-over");
    updateAppDropIndicator(grid, e);
  });

  grid.addEventListener("dragleave", (e) => {
    if (!sectionEl.contains(e.relatedTarget)) {
      sectionEl.classList.remove("drag-over");
      clearAppDropIndicators(grid);
    }
  });

  grid.addEventListener("drop", async (e) => {
    if (!dragData || dragData.kind !== "app") return;
    e.preventDefault();
    sectionEl.classList.remove("drag-over");
    clearAppDropIndicators(grid);

    const targetSectionId = grid.dataset.sectionId;
    const { targetIndex, after } = computeAppDropTarget(grid, e);
    moveApp(dragData.sectionId, dragData.appId, targetSectionId, targetIndex, after);
  });
}

function computeAppDropTarget(grid, e) {
  const targetTile = e.target.closest(".app-tile");
  if (!targetTile || !grid.contains(targetTile) || targetTile.classList.contains("dragging")) {
    return { targetTile: null, targetIndex: -1, after: false };
  }
  const rect = targetTile.getBoundingClientRect();
  const after = e.clientX > rect.left + rect.width / 2;
  const targetIndex = indexOfApp(grid.dataset.sectionId, targetTile.dataset.appId);
  return { targetTile, targetIndex, after };
}

function updateAppDropIndicator(grid, e) {
  clearAppDropIndicators(grid);
  const { targetTile, after } = computeAppDropTarget(grid, e);
  if (targetTile) {
    targetTile.classList.add(after ? "drop-after" : "drop-before");
  } else {
    grid.classList.add("drop-end");
  }
}

function clearAppDropIndicators(scope) {
  const root = scope || document;
  root.querySelectorAll(".app-tile.drop-before, .app-tile.drop-after").forEach((el) =>
    el.classList.remove("drop-before", "drop-after")
  );
  root.querySelectorAll(".app-grid.drop-end").forEach((el) =>
    el.classList.remove("drop-end")
  );
  if (scope && scope.classList && scope.classList.contains("app-grid")) {
    scope.classList.remove("drop-end");
  }
}

function indexOfApp(sectionId, appId) {
  const section = findSection(sectionId);
  if (!section) return -1;
  return section.apps.findIndex((a) => a.id === appId);
}

async function moveApp(fromSectionId, appId, toSectionId, toIndex, after) {
  const fromSection = findSection(fromSectionId);
  const toSection = findSection(toSectionId);
  if (!fromSection || !toSection) return;

  const fromIndex = fromSection.apps.findIndex((a) => a.id === appId);
  if (fromIndex === -1) return;

  let insertIndex;
  if (toIndex === -1) {
    insertIndex = toSection.apps.length;
  } else {
    insertIndex = after ? toIndex + 1 : toIndex;
  }

  const [app] = fromSection.apps.splice(fromIndex, 1);

  // Same-section move: account for the splice that shifted later items left by one.
  if (fromSection === toSection && fromIndex < insertIndex) {
    insertIndex -= 1;
  }
  insertIndex = Math.max(0, Math.min(insertIndex, toSection.apps.length));

  toSection.apps.splice(insertIndex, 0, app);
  await saveState();
  render();
}

function attachSectionDnD(sectionEl, handle, sectionId) {
  handle.addEventListener("dragstart", (e) => {
    dragData = { kind: "section", sectionId };
    sectionEl.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sectionId);
  });
  handle.addEventListener("dragend", () => {
    sectionEl.classList.remove("dragging");
    dragData = null;
    clearSectionDropIndicators();
  });

  sectionEl.addEventListener("dragover", (e) => {
    if (!dragData || dragData.kind !== "section") return;
    if (dragData.sectionId === sectionId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = sectionEl.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    clearSectionDropIndicators();
    sectionEl.classList.add(after ? "drop-after" : "drop-before");
  });

  sectionEl.addEventListener("dragleave", (e) => {
    if (!sectionEl.contains(e.relatedTarget)) {
      sectionEl.classList.remove("drop-before", "drop-after");
    }
  });

  sectionEl.addEventListener("drop", async (e) => {
    if (!dragData || dragData.kind !== "section") return;
    e.preventDefault();
    e.stopPropagation();
    const rect = sectionEl.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    clearSectionDropIndicators();
    moveSection(dragData.sectionId, sectionId, after);
  });
}

function clearSectionDropIndicators() {
  document.querySelectorAll(".section.drop-before, .section.drop-after").forEach((el) =>
    el.classList.remove("drop-before", "drop-after")
  );
}

async function moveSection(fromId, toId, after) {
  if (fromId === toId) return;
  const fromIndex = state.sections.findIndex((s) => s.id === fromId);
  const toIndex = state.sections.findIndex((s) => s.id === toId);
  if (fromIndex === -1 || toIndex === -1) return;

  let insertIndex = after ? toIndex + 1 : toIndex;
  const [section] = state.sections.splice(fromIndex, 1);
  if (fromIndex < insertIndex) insertIndex -= 1;
  insertIndex = Math.max(0, Math.min(insertIndex, state.sections.length));
  state.sections.splice(insertIndex, 0, section);

  await saveState();
  render();
}

// ---------- Dialogs ----------

const appDialog = document.getElementById("app-dialog");
const appForm = document.getElementById("app-form");
const appDialogTitle = document.getElementById("app-dialog-title");
const appNameInput = document.getElementById("app-name");
const appUrlInput = document.getElementById("app-url");
const appSectionIdInput = document.getElementById("app-section-id");
const appIdInput = document.getElementById("app-id");

function openAppDialog(sectionId, appId) {
  appSectionIdInput.value = sectionId;
  appIdInput.value = appId || "";
  if (appId) {
    const section = findSection(sectionId);
    const app = section?.apps.find((a) => a.id === appId);
    if (!app) return;
    appDialogTitle.textContent = "Edit App";
    appNameInput.value = app.name;
    appUrlInput.value = app.url;
  } else {
    appDialogTitle.textContent = "Add App";
    appNameInput.value = "";
    appUrlInput.value = "";
  }
  appDialog.showModal();
  appNameInput.focus();
}

document.getElementById("app-cancel-btn").addEventListener("click", () => {
  appDialog.close();
});

appForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const sectionId = appSectionIdInput.value;
  const appId = appIdInput.value;
  let url = appUrlInput.value.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const name = appNameInput.value.trim();
  if (!name || !url) return;

  const section = findSection(sectionId);
  if (!section) return;

  if (appId) {
    const app = section.apps.find((a) => a.id === appId);
    if (app) {
      app.name = name;
      app.url = url;
    }
  } else {
    section.apps.push({ id: uid(), name, url });
  }
  await saveState();
  render();
  appDialog.close();
});

const sectionDialog = document.getElementById("section-dialog");
const sectionForm = document.getElementById("section-form");
const sectionDialogTitle = document.getElementById("section-dialog-title");
const sectionNameInput = document.getElementById("section-name");
const sectionIdInput = document.getElementById("section-id");

function openSectionDialog(section) {
  if (section) {
    sectionDialogTitle.textContent = "Rename Section";
    sectionIdInput.value = section.id;
    sectionNameInput.value = section.name;
  } else {
    sectionDialogTitle.textContent = "New Section";
    sectionIdInput.value = "";
    sectionNameInput.value = "";
  }
  sectionDialog.showModal();
  sectionNameInput.focus();
}

document.getElementById("section-cancel-btn").addEventListener("click", () => {
  sectionDialog.close();
});

sectionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = sectionIdInput.value;
  const name = sectionNameInput.value.trim();
  if (!name) return;

  if (id) {
    const section = findSection(id);
    if (section) section.name = name;
  } else {
    state.sections.push({ id: uid(), name, apps: [] });
  }
  await saveState();
  render();
  sectionDialog.close();
});

// ---------- CRUD ----------

async function deleteSection(sectionId) {
  const section = findSection(sectionId);
  if (!section) return;
  const msg =
    section.apps.length > 0
      ? `Delete section "${section.name}" and its ${section.apps.length} app(s)?`
      : `Delete section "${section.name}"?`;
  if (!confirm(msg)) return;
  state.sections = state.sections.filter((s) => s.id !== sectionId);
  await saveState();
  render();
}

async function deleteApp(sectionId, appId) {
  const section = findSection(sectionId);
  if (!section) return;
  const app = section.apps.find((a) => a.id === appId);
  if (!app) return;
  if (!confirm(`Remove "${app.name}"?`)) return;
  section.apps = section.apps.filter((a) => a.id !== appId);
  await saveState();
  render();
}

// ---------- Init ----------

document
  .getElementById("add-section-btn")
  .addEventListener("click", () => openSectionDialog(null));

(async function init() {
  await loadState();
  render();
})();

