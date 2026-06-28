const STORAGE_KEY = "knowledge-notes:v1";
const SETTINGS_KEY = "knowledge-notes:settings:v1";
const DELETED_KEY = "knowledge-notes:deleted:v1";

const DRAWING_WIDTH = 1024;
const DRAWING_HEIGHT = 640;
const MAX_IMAGE_SIDE = 1400;
const AUTO_SYNC_INTERVAL_MS = 30000;

const DEFAULT_SETTINGS = {
  notificationsEnabled: false,
  intervalMinutes: 1440,
  nextNotificationAt: null,
  lastNotificationAt: null,
  syncEndpoint: "",
  autoSyncEnabled: true,
  lastSyncAt: null
};

const state = {
  notes: [],
  deletedNotes: {},
  settings: { ...DEFAULT_SETTINGS },
  formAttachments: [],
  currentQuizId: null,
  timerId: null,
  syncDebounceId: null,
  syncIntervalId: null,
  syncBusy: false,
  deferredInstallPrompt: null,
  drawing: {
    strokes: [],
    activeStroke: null,
    color: "#2f5f46",
    size: 7
  }
};

const els = {
  form: document.querySelector("#noteForm"),
  noteId: document.querySelector("#noteId"),
  title: document.querySelector("#titleInput"),
  body: document.querySelector("#bodyInput"),
  source: document.querySelector("#sourceInput"),
  tags: document.querySelector("#tagsInput"),
  save: document.querySelector("#saveButton"),
  clear: document.querySelector("#clearButton"),
  newNote: document.querySelector("#newButton"),
  imageInput: document.querySelector("#imageInput"),
  openDraw: document.querySelector("#openDrawButton"),
  removeAllMedia: document.querySelector("#removeAllMediaButton"),
  attachmentPreview: document.querySelector("#attachmentPreview"),
  list: document.querySelector("#noteList"),
  emptyTemplate: document.querySelector("#emptyTemplate"),
  stats: document.querySelector("#statsText"),
  search: document.querySelector("#searchInput"),
  tagFilter: document.querySelector("#tagFilter"),
  sort: document.querySelector("#sortSelect"),
  reminderToggle: document.querySelector("#reminderToggle"),
  interval: document.querySelector("#intervalSelect"),
  testNotification: document.querySelector("#testNotificationButton"),
  notificationStatus: document.querySelector("#notificationStatus"),
  syncEndpoint: document.querySelector("#syncEndpointInput"),
  autoSync: document.querySelector("#autoSyncToggle"),
  syncNow: document.querySelector("#syncNowButton"),
  pullCloud: document.querySelector("#pullCloudButton"),
  pushCloud: document.querySelector("#pushCloudButton"),
  syncStatus: document.querySelector("#syncStatus"),
  randomQuiz: document.querySelector("#randomQuizButton"),
  quizDialog: document.querySelector("#quizDialog"),
  quizQuestion: document.querySelector("#quizQuestion"),
  quizAnswer: document.querySelector("#quizAnswer"),
  quizBody: document.querySelector("#quizBody"),
  quizMedia: document.querySelector("#quizMedia"),
  quizSource: document.querySelector("#quizSource"),
  revealAnswer: document.querySelector("#revealAnswerButton"),
  editQuiz: document.querySelector("#editQuizButton"),
  drawingDialog: document.querySelector("#drawingDialog"),
  drawingCanvas: document.querySelector("#drawingCanvas"),
  drawColor: document.querySelector("#drawColorInput"),
  drawSize: document.querySelector("#drawSizeInput"),
  undoDraw: document.querySelector("#undoDrawButton"),
  clearDraw: document.querySelector("#clearDrawButton"),
  saveDraw: document.querySelector("#saveDrawButton"),
  cancelDraw: document.querySelector("#cancelDrawButton"),
  closeDraw: document.querySelector("#closeDrawButton"),
  exportButton: document.querySelector("#exportButton"),
  importInput: document.querySelector("#importInput"),
  installButton: document.querySelector("#installButton")
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    showToast("保存容量がいっぱいです。画像を減らしてください");
    throw error;
  }
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function dateValue(iso) {
  const value = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function parseTags(value) {
  return value
    .split(/[,\s、，]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function uniqueTags(notes = state.notes) {
  return [...new Set(notes.flatMap((note) => note.tags || []))].sort((a, b) => a.localeCompare(b, "ja"));
}

function formatDate(iso) {
  if (!iso) return "未復習";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function formatNextTime(iso) {
  if (!iso) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function truncate(value, length = 260) {
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function contentTime(note) {
  return dateValue(note?.contentUpdatedAt || note?.updatedAt);
}

function inferContentUpdatedAt(note) {
  if (note?.contentUpdatedAt) return note.contentUpdatedAt;
  const updatedAt = note?.updatedAt || nowIso();
  const updatedTime = dateValue(updatedAt);
  const quizTime = dateValue(note?.lastQuizAt);
  if (updatedTime && quizTime && Math.abs(updatedTime - quizTime) < 10000) {
    return note.createdAt || updatedAt;
  }
  return updatedAt;
}

function latestIso(a, b) {
  return dateValue(a) >= dateValue(b) ? a || b || null : b || a || null;
}

function noteFingerprint(note) {
  return JSON.stringify({
    title: note.title,
    body: note.body,
    source: note.source,
    tags: note.tags || [],
    attachments: note.attachments || [],
    createdAt: note.createdAt
  });
}

function escapeForCsv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function makeQuizPrompt(note) {
  return `「${note.title}」は何だったでしょう？`;
}

function cloneAttachment(attachment) {
  return JSON.parse(JSON.stringify(attachment));
}

function normalizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  const dataUrl = String(attachment.dataUrl || "");
  if (!dataUrl.startsWith("data:image/")) return null;
  const type = attachment.type === "drawing" ? "drawing" : "image";
  return {
    id: String(attachment.id || uid()),
    type,
    name: String(attachment.name || (type === "drawing" ? "イラスト" : "画像")).slice(0, 120),
    dataUrl,
    width: Number(attachment.width) || null,
    height: Number(attachment.height) || null,
    strokes: type === "drawing" && Array.isArray(attachment.strokes) ? attachment.strokes : [],
    createdAt: attachment.createdAt || nowIso()
  };
}

function normalizeNote(note) {
  if (!note || typeof note !== "object") return null;
  const title = String(note.title || "").trim();
  const body = String(note.body || "").trim();
  if (!title || !body) return null;
  const attachments = Array.isArray(note.attachments)
    ? note.attachments.map(normalizeAttachment).filter(Boolean).slice(0, 12)
    : [];
  const timestamp = inferContentUpdatedAt(note);
  return {
    id: String(note.id || uid()),
    title,
    body,
    source: String(note.source || "").trim(),
    tags: Array.isArray(note.tags) ? note.tags.map(String).filter(Boolean) : parseTags(String(note.tags || "")),
    attachments,
    createdAt: note.createdAt || nowIso(),
    updatedAt: timestamp,
    contentUpdatedAt: timestamp,
    lastQuizAt: note.lastQuizAt || null
  };
}

function repairDuplicateNoteIds(notes) {
  const byId = new Map();
  const repaired = [];
  let changed = false;

  notes.forEach((note) => {
    const existing = byId.get(note.id);
    if (!existing) {
      byId.set(note.id, note);
      repaired.push(note);
      return;
    }

    if (noteFingerprint(existing) === noteFingerprint(note)) {
      existing.lastQuizAt = latestIso(existing.lastQuizAt, note.lastQuizAt);
      if (contentTime(note) > contentTime(existing)) {
        Object.assign(existing, note, { lastQuizAt: latestIso(existing.lastQuizAt, note.lastQuizAt) });
      }
      changed = true;
      return;
    }

    const timestamp = nowIso();
    const clone = {
      ...note,
      id: uid(),
      updatedAt: timestamp,
      contentUpdatedAt: timestamp
    };
    byId.set(clone.id, clone);
    repaired.push(clone);
    changed = true;
  });

  return { notes: repaired, changed };
}

function normalizeDeletedNotes(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id, deletedAt]) => id && dateValue(deletedAt))
      .map(([id, deletedAt]) => [String(id), String(deletedAt)])
  );
}

function normalizeSettings(settings) {
  const normalized = {
    ...DEFAULT_SETTINGS,
    ...(settings && typeof settings === "object" ? settings : {}),
    syncEndpoint: String(settings?.syncEndpoint || settings?.appsScriptUrl || ""),
    autoSyncEnabled: settings?.autoSyncEnabled !== false
  };
  delete normalized.syncToken;
  delete normalized.syncGistId;
  delete normalized.syncFileName;
  return normalized;
}

function persistNotes(options = {}) {
  writeJson(STORAGE_KEY, state.notes);
  if (options.sync !== false) queueAutoSync();
}

function persistDeletedNotes(options = {}) {
  writeJson(DELETED_KEY, state.deletedNotes);
  if (options.sync !== false) queueAutoSync();
}

function persistSettings() {
  writeJson(SETTINGS_KEY, state.settings);
}

function loadState() {
  const notes = readJson(STORAGE_KEY, []);
  const normalizedNotes = Array.isArray(notes) ? notes.map(normalizeNote).filter(Boolean) : [];
  const repaired = repairDuplicateNoteIds(normalizedNotes);
  state.notes = repaired.notes;
  state.deletedNotes = normalizeDeletedNotes(readJson(DELETED_KEY, {}));
  state.settings = normalizeSettings(readJson(SETTINGS_KEY, DEFAULT_SETTINGS));
  applyTombstones();
  if (repaired.changed) writeJson(STORAGE_KEY, state.notes);
}

function applyTombstones() {
  state.notes = state.notes.filter((note) => dateValue(state.deletedNotes[note.id]) < dateValue(note.updatedAt));
}

function resetForm() {
  els.noteId.value = "";
  els.form.reset();
  state.formAttachments = [];
  renderAttachmentPreview();
  els.save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>保存';
  els.title.focus();
}

function fillForm(note) {
  els.noteId.value = note.id;
  els.title.value = note.title;
  els.body.value = note.body;
  els.source.value = note.source || "";
  els.tags.value = (note.tags || []).join(", ");
  state.formAttachments = (note.attachments || []).map(cloneAttachment);
  renderAttachmentPreview();
  els.save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>更新';
  els.title.focus();
}

function getFilteredNotes() {
  const query = els.search.value.trim().toLowerCase();
  const tag = els.tagFilter.value;
  const sort = els.sort.value;
  let notes = [...state.notes];

  if (query) {
    notes = notes.filter((note) => {
      const mediaNames = (note.attachments || []).map((attachment) => attachment.name);
      const haystack = [note.title, note.body, note.source, ...mediaNames, ...(note.tags || [])].join("\n").toLowerCase();
      return haystack.includes(query);
    });
  }

  if (tag) {
    notes = notes.filter((note) => (note.tags || []).includes(tag));
  }

  notes.sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title, "ja");
    if (sort === "created") return dateValue(b.createdAt) - dateValue(a.createdAt);
    if (sort === "quiz") return dateValue(a.lastQuizAt) - dateValue(b.lastQuizAt);
    return dateValue(b.updatedAt) - dateValue(a.updatedAt);
  });

  return notes;
}

function renderTagFilter() {
  const current = els.tagFilter.value;
  const tags = uniqueTags();
  els.tagFilter.replaceChildren(new Option("すべてのタグ", ""));
  tags.forEach((tag) => els.tagFilter.append(new Option(tag, tag)));
  els.tagFilter.value = tags.includes(current) ? current : "";
}

function createSourceElement(source) {
  const value = source.trim();
  if (!value) return null;
  const isUrl = /^https?:\/\//i.test(value);
  const el = document.createElement(isUrl ? "a" : "span");
  el.className = "source-pill";
  el.textContent = `出典: ${value}`;
  if (isUrl) {
    el.href = value;
    el.target = "_blank";
    el.rel = "noopener noreferrer";
  }
  return el;
}

function iconButton(label, path, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${className}`.trim();
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  return button;
}

function createMediaThumb(attachment, options = {}) {
  const thumb = document.createElement(options.removable ? "div" : "button");
  if (!options.removable) thumb.type = "button";
  thumb.className = "media-thumb";
  thumb.title = attachment.name;
  thumb.setAttribute("aria-label", attachment.name);
  const img = document.createElement("img");
  img.src = attachment.dataUrl;
  img.alt = attachment.name;
  thumb.append(img);

  if (options.removable) {
    img.addEventListener("click", () => openMedia(attachment));
    const remove = iconButton("削除", '<path d="M18 6 6 18M6 6l12 12"/>', "danger");
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      state.formAttachments = state.formAttachments.filter((item) => item.id !== attachment.id);
      renderAttachmentPreview();
    });
    thumb.append(remove);
  } else {
    thumb.addEventListener("click", () => openMedia(attachment));
  }
  return thumb;
}

function createMediaStrip(attachments) {
  const strip = document.createElement("div");
  strip.className = "media-strip";
  attachments.forEach((attachment) => strip.append(createMediaThumb(attachment)));
  return strip;
}

function renderAttachmentPreview() {
  els.attachmentPreview.replaceChildren();
  state.formAttachments.forEach((attachment) => {
    els.attachmentPreview.append(createMediaThumb(attachment, { removable: true }));
  });
}

function openMedia(attachment) {
  const tab = window.open("", "_blank", "noopener,noreferrer");
  if (!tab) {
    showToast("画像を開けませんでした");
    return;
  }
  tab.document.title = attachment.name;
  const style = tab.document.createElement("style");
  style.textContent = "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111}img{max-width:100vw;max-height:100vh}";
  const img = tab.document.createElement("img");
  img.src = attachment.dataUrl;
  img.alt = attachment.name;
  tab.document.head.append(style);
  tab.document.body.append(img);
}

function renderNotes() {
  renderTagFilter();
  const filtered = getFilteredNotes();
  els.list.replaceChildren();
  els.stats.textContent = `${filtered.length}件 / 全${state.notes.length}件`;

  if (!state.notes.length) {
    els.list.append(els.emptyTemplate.content.cloneNode(true));
    return;
  }

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = '<h3>一致するメモがありません</h3><p>検索条件を変えると表示されます。</p>';
    els.list.append(empty);
    return;
  }

  filtered.forEach((note) => {
    const card = document.createElement("article");
    card.className = "note-card";

    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("h3");
    title.textContent = note.title;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const quizButton = iconButton("クイズ", '<path d="M8.5 9a3.5 3.5 0 1 1 5.5 2.9c-1.4.9-2 1.4-2 3.1"/><path d="M12 19h.01"/>');
    const editButton = iconButton("編集", '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>');
    const deleteButton = iconButton("削除", '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6"/>', "danger");
    quizButton.addEventListener("click", () => openQuiz(note.id));
    editButton.addEventListener("click", () => fillForm(note));
    deleteButton.addEventListener("click", () => deleteNote(note.id));
    actions.append(quizButton, editButton, deleteButton);
    head.append(title, actions);

    const body = document.createElement("p");
    body.className = "body-preview";
    body.textContent = truncate(note.body);

    const meta = document.createElement("div");
    meta.className = "meta-row";
    const date = document.createElement("span");
    date.className = "date-pill";
    date.textContent = `更新: ${formatDate(note.updatedAt)}`;
    meta.append(date);
    const source = createSourceElement(note.source || "");
    if (source) meta.append(source);
    (note.tags || []).forEach((tag) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "tag-pill";
      pill.textContent = tag;
      pill.addEventListener("click", () => {
        els.tagFilter.value = tag;
        renderNotes();
      });
      meta.append(pill);
    });

    card.append(head, body);
    if (note.attachments?.length) card.append(createMediaStrip(note.attachments));
    card.append(meta);
    els.list.append(card);
  });
}

function upsertNote(event) {
  event.preventDefault();
  const id = els.noteId.value;
  const title = els.title.value.trim();
  const body = els.body.value.trim();
  if (!title || !body) return;
  const contentUpdatedAt = nowIso();

  const payload = {
    title,
    body,
    source: els.source.value.trim(),
    tags: parseTags(els.tags.value),
    attachments: state.formAttachments.map(cloneAttachment),
    updatedAt: contentUpdatedAt,
    contentUpdatedAt
  };

  if (id) {
    const index = state.notes.findIndex((note) => note.id === id);
    if (index >= 0) {
      state.notes[index] = { ...state.notes[index], ...payload };
      delete state.deletedNotes[id];
      persistDeletedNotes({ sync: false });
      showToast("更新しました");
    }
  } else {
    state.notes.unshift({
      id: uid(),
      ...payload,
      createdAt: nowIso(),
      lastQuizAt: null
    });
    showToast("保存しました");
  }

  persistNotes();
  resetForm();
  renderNotes();
  updateReminderStatus();
}

function deleteNote(id) {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return;
  const ok = confirm(`「${note.title}」を削除しますか？`);
  if (!ok) return;
  state.deletedNotes[id] = nowIso();
  state.notes = state.notes.filter((item) => item.id !== id);
  persistNotes({ sync: false });
  persistDeletedNotes();
  if (els.noteId.value === id) resetForm();
  renderNotes();
  updateReminderStatus();
  showToast("削除しました");
}

function pickQuizNote() {
  const notes = [...state.notes];
  if (!notes.length) return null;
  notes.sort((a, b) => dateValue(a.lastQuizAt) - dateValue(b.lastQuizAt));
  return notes[0];
}

function markQuizReviewed(id) {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return;
  note.lastQuizAt = nowIso();
  persistNotes();
  renderNotes();
}

function renderQuizMedia(note) {
  els.quizMedia.replaceChildren();
  if (note.attachments?.length) {
    els.quizMedia.append(...note.attachments.map((attachment) => createMediaThumb(attachment)));
  }
}

function openQuiz(id) {
  const note = state.notes.find((item) => item.id === id) || pickQuizNote();
  if (!note) {
    showToast("クイズにできるメモがありません");
    return;
  }
  state.currentQuizId = note.id;
  els.quizQuestion.textContent = makeQuizPrompt(note);
  els.quizBody.textContent = note.body;
  els.quizSource.textContent = note.source ? `出典: ${note.source}` : "";
  renderQuizMedia(note);
  els.quizAnswer.hidden = true;
  els.revealAnswer.hidden = false;
  els.quizDialog.showModal();
}

function revealAnswer() {
  if (!state.currentQuizId) return;
  els.quizAnswer.hidden = false;
  els.revealAnswer.hidden = true;
  markQuizReviewed(state.currentQuizId);
}

function editCurrentQuiz() {
  const note = state.notes.find((item) => item.id === state.currentQuizId);
  if (!note) return;
  els.quizDialog.close();
  fillForm(note);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed"));
    image.src = src;
  });
}

async function imageFileToAttachment(file) {
  const originalDataUrl = await readFileAsDataUrl(file);
  if (file.type === "image/svg+xml") {
    return {
      id: uid(),
      type: "image",
      name: file.name || "画像",
      dataUrl: originalDataUrl,
      width: null,
      height: null,
      strokes: [],
      createdAt: nowIso()
    };
  }

  const image = await loadImage(originalDataUrl);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  let dataUrl = canvas.toDataURL("image/webp", 0.84);
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.86);
  }
  return {
    id: uid(),
    type: "image",
    name: file.name || "画像",
    dataUrl,
    width,
    height,
    strokes: [],
    createdAt: nowIso()
  };
}

async function addImageFromInput(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("画像ファイルを選んでください");
    event.target.value = "";
    return;
  }
  try {
    const attachment = await imageFileToAttachment(file);
    state.formAttachments.push(attachment);
    renderAttachmentPreview();
    showToast("画像を追加しました");
  } catch {
    showToast("画像を読み込めませんでした");
  } finally {
    event.target.value = "";
  }
}

function prepareDrawingCanvas(canvas, dpr = window.devicePixelRatio || 1) {
  canvas.width = Math.round(DRAWING_WIDTH * dpr);
  canvas.height = Math.round(DRAWING_HEIGHT * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawStrokes(ctx, strokes) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokes.forEach((stroke) => {
    if (!stroke.points?.length) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      ctx.lineTo(point.x + 0.01, point.y + 0.01);
    }
    ctx.stroke();
  });
}

function redrawDrawingCanvas() {
  if (!els.drawingCanvas) return;
  const ctx = prepareDrawingCanvas(els.drawingCanvas);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, DRAWING_WIDTH, DRAWING_HEIGHT);
  drawStrokes(ctx, state.drawing.strokes);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pointerToCanvasPoint(event) {
  const rect = els.drawingCanvas.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * DRAWING_WIDTH, 0, DRAWING_WIDTH),
    y: clamp(((event.clientY - rect.top) / rect.height) * DRAWING_HEIGHT, 0, DRAWING_HEIGHT)
  };
}

function beginDrawing(event) {
  event.preventDefault();
  els.drawingCanvas.setPointerCapture?.(event.pointerId);
  state.drawing.activeStroke = {
    color: state.drawing.color,
    size: state.drawing.size,
    points: [pointerToCanvasPoint(event)]
  };
  state.drawing.strokes.push(state.drawing.activeStroke);
  redrawDrawingCanvas();
}

function continueDrawing(event) {
  if (!state.drawing.activeStroke) return;
  event.preventDefault();
  const point = pointerToCanvasPoint(event);
  const points = state.drawing.activeStroke.points;
  const last = points[points.length - 1];
  if (Math.hypot(point.x - last.x, point.y - last.y) >= 1.2) {
    points.push(point);
    redrawDrawingCanvas();
  }
}

function endDrawing(event) {
  if (!state.drawing.activeStroke) return;
  event.preventDefault();
  state.drawing.activeStroke = null;
}

function openDrawingDialog() {
  state.drawing.strokes = [];
  state.drawing.activeStroke = null;
  state.drawing.color = els.drawColor.value;
  state.drawing.size = Number(els.drawSize.value);
  els.drawingDialog.showModal();
  requestAnimationFrame(redrawDrawingCanvas);
}

function closeDrawingDialog() {
  state.drawing.activeStroke = null;
  els.drawingDialog.close();
}

function undoDrawing() {
  state.drawing.strokes.pop();
  redrawDrawingCanvas();
}

function clearDrawing() {
  state.drawing.strokes = [];
  state.drawing.activeStroke = null;
  redrawDrawingCanvas();
}

function saveDrawingAttachment() {
  if (!state.drawing.strokes.length) {
    showToast("線を描いてから追加してください");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = DRAWING_WIDTH;
  canvas.height = DRAWING_HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, DRAWING_WIDTH, DRAWING_HEIGHT);
  drawStrokes(ctx, state.drawing.strokes);
  let dataUrl = canvas.toDataURL("image/webp", 0.9);
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/png");
  }
  state.formAttachments.push({
    id: uid(),
    type: "drawing",
    name: `イラスト ${formatDate(nowIso())}`,
    dataUrl,
    width: DRAWING_WIDTH,
    height: DRAWING_HEIGHT,
    strokes: JSON.parse(JSON.stringify(state.drawing.strokes)),
    createdAt: nowIso()
  });
  renderAttachmentPreview();
  closeDrawingDialog();
  showToast("イラストを追加しました");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("sw.js");
  } catch {
    return null;
  }
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("このブラウザは通知に対応していません");
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") {
    showToast("ブラウザ側で通知がブロックされています");
    return false;
  }
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

async function showQuizNotification(note) {
  if (!note) return false;
  const granted = await requestNotificationPermission();
  if (!granted) return false;
  const url = `${location.origin}${location.pathname}?quiz=${encodeURIComponent(note.id)}`;
  const options = {
    body: makeQuizPrompt(note),
    icon: "assets/app-icon.svg",
    badge: "assets/app-icon.svg",
    tag: "knowledge-note-quiz",
    data: { noteId: note.id, url }
  };

  const registration = await registerServiceWorker();
  if (registration?.showNotification) {
    await registration.showNotification("豆知識クイズ", options);
  } else {
    const notification = new Notification("豆知識クイズ", options);
    notification.onclick = () => {
      window.focus();
      openQuiz(note.id);
      notification.close();
    };
  }

  state.settings.lastNotificationAt = nowIso();
  state.settings.nextNotificationAt = new Date(Date.now() + state.settings.intervalMinutes * 60 * 1000).toISOString();
  persistSettings();
  updateReminderStatus();
  return true;
}

function scheduleReminder() {
  clearTimeout(state.timerId);
  state.timerId = null;
  if (!state.settings.notificationsEnabled) return;
  if (!state.notes.length) {
    updateReminderStatus();
    return;
  }

  const next = state.settings.nextNotificationAt ? new Date(state.settings.nextNotificationAt).getTime() : 0;
  const dueAt = Number.isFinite(next) && next > Date.now()
    ? next
    : Date.now() + state.settings.intervalMinutes * 60 * 1000;
  state.settings.nextNotificationAt = new Date(dueAt).toISOString();
  persistSettings();
  updateReminderStatus();

  state.timerId = setTimeout(async () => {
    await showQuizNotification(pickQuizNote());
    scheduleReminder();
  }, Math.max(500, dueAt - Date.now()));
}

function updateReminderStatus() {
  els.reminderToggle.checked = Boolean(state.settings.notificationsEnabled);
  els.interval.value = String(state.settings.intervalMinutes);
  if (!state.settings.notificationsEnabled) {
    els.notificationStatus.textContent = "未設定";
    return;
  }
  if (!state.notes.length) {
    els.notificationStatus.textContent = "メモを追加すると通知できます";
    return;
  }
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  if (permission === "denied") {
    els.notificationStatus.textContent = "通知がブロックされています";
    return;
  }
  els.notificationStatus.textContent = `次回: ${formatNextTime(state.settings.nextNotificationAt)}。アプリを開いている間に送信します。`;
}

async function toggleReminder() {
  const enabled = els.reminderToggle.checked;
  if (enabled) {
    const granted = await requestNotificationPermission();
    if (!granted) {
      state.settings.notificationsEnabled = false;
      persistSettings();
      updateReminderStatus();
      return;
    }
    state.settings.notificationsEnabled = true;
    state.settings.nextNotificationAt = new Date(Date.now() + state.settings.intervalMinutes * 60 * 1000).toISOString();
  } else {
    state.settings.notificationsEnabled = false;
    state.settings.nextNotificationAt = null;
  }
  persistSettings();
  scheduleReminder();
  updateReminderStatus();
}

function changeInterval() {
  state.settings.intervalMinutes = Number(els.interval.value);
  if (state.settings.notificationsEnabled) {
    state.settings.nextNotificationAt = new Date(Date.now() + state.settings.intervalMinutes * 60 * 1000).toISOString();
  }
  persistSettings();
  scheduleReminder();
  updateReminderStatus();
}

async function testNotification() {
  const note = pickQuizNote();
  if (!note) {
    showToast("先にメモを保存してください");
    return;
  }
  await showQuizNotification(note);
}

function safeSettingsForExport() {
  return { ...state.settings };
}

function buildDataPayload() {
  return {
    app: "knowledge-notes",
    version: 2,
    exportedAt: nowIso(),
    notes: state.notes,
    deletedNotes: state.deletedNotes,
    settings: safeSettingsForExport()
  };
}

function exportJson() {
  const blob = new Blob([JSON.stringify(buildDataPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `knowledge-notes-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function mergeRemotePayload(payload) {
  const incomingNormalized = Array.isArray(payload?.notes) ? payload.notes.map(normalizeNote).filter(Boolean) : [];
  const incomingNotes = repairDuplicateNoteIds(incomingNormalized).notes;
  const incomingDeleted = normalizeDeletedNotes(payload?.deletedNotes || {});
  const localRepaired = repairDuplicateNoteIds(state.notes.map(normalizeNote).filter(Boolean));
  const noteMap = new Map(localRepaired.notes.map((note) => [note.id, note]));
  let changed = localRepaired.changed ? 1 : 0;

  Object.entries(incomingDeleted).forEach(([id, deletedAt]) => {
    if (dateValue(deletedAt) > dateValue(state.deletedNotes[id])) {
      state.deletedNotes[id] = deletedAt;
      changed += 1;
    }
  });

  incomingNotes.forEach((note) => {
    const localDeletedAt = dateValue(state.deletedNotes[note.id]);
    if (localDeletedAt >= contentTime(note)) return;
    const local = noteMap.get(note.id);
    if (!local || contentTime(note) > contentTime(local)) {
      noteMap.set(note.id, note);
      changed += 1;
      return;
    }
    const mergedQuizAt = latestIso(local.lastQuizAt, note.lastQuizAt);
    if (mergedQuizAt !== local.lastQuizAt) {
      local.lastQuizAt = mergedQuizAt;
      changed += 1;
    }
  });

  state.notes = [...noteMap.values()].filter((note) => dateValue(state.deletedNotes[note.id]) < contentTime(note));
  state.notes.sort((a, b) => contentTime(b) - contentTime(a));
  persistNotes({ sync: false });
  persistDeletedNotes({ sync: false });
  renderNotes();
  updateReminderStatus();
  return changed;
}

function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || ""));
      if (Array.isArray(data)) {
        mergeRemotePayload({ notes: data, deletedNotes: {} });
      } else {
        mergeRemotePayload(data);
      }
      queueAutoSync();
      showToast("読み込みました");
    } catch {
      showToast("読み込めませんでした");
    } finally {
      els.importInput.value = "";
    }
  };
  reader.readAsText(file);
}

function exportCsv() {
  const rows = [
    ["見出し", "本文", "出典元", "タグ", "添付数", "作成日時", "更新日時", "最終復習日時"],
    ...state.notes.map((note) => [
      note.title,
      note.body,
      note.source || "",
      (note.tags || []).join(", "),
      String(note.attachments?.length || 0),
      note.createdAt,
      note.updatedAt,
      note.lastQuizAt || ""
    ])
  ];
  return rows.map((row) => row.map(escapeForCsv).join(",")).join("\n");
}

function renderSyncInputs() {
  els.syncEndpoint.value = state.settings.syncEndpoint || "";
  els.autoSync.checked = state.settings.autoSyncEnabled !== false;
  updateSyncStatus();
}

function readSyncInputs() {
  state.settings.syncEndpoint = els.syncEndpoint.value.trim();
  state.settings.autoSyncEnabled = els.autoSync.checked;
  persistSettings();
  updateSyncStatus();
  scheduleAutoSyncLoop();
}

function updateSyncStatus(message) {
  if (message) {
    els.syncStatus.textContent = message;
    return;
  }
  if (!state.settings.syncEndpoint) {
    els.syncStatus.textContent = "同期URL未設定";
    return;
  }
  const mode = state.settings.autoSyncEnabled ? "自動同期中" : "手動同期";
  els.syncStatus.textContent = state.settings.lastSyncAt
    ? `${mode}: ${formatNextTime(state.settings.lastSyncAt)}`
    : mode;
}

function hasSyncEndpoint() {
  return Boolean(state.settings.syncEndpoint);
}

function syncUrl(action) {
  const url = new URL(state.settings.syncEndpoint);
  url.searchParams.set("app", "knowledge-notes");
  url.searchParams.set("action", action);
  url.searchParams.set("_", String(Date.now()));
  return url.toString();
}

function normalizeCloudResponse(data) {
  if (!data || typeof data !== "object") return { notes: [], deletedNotes: {} };
  return data.payload && typeof data.payload === "object" ? data.payload : data;
}

async function fetchCloudPayload() {
  readSyncInputs();
  if (!hasSyncEndpoint()) throw new Error("Sync endpoint is empty");
  try {
    const response = await fetch(syncUrl("pull"), { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error(`Sync ${response.status}`);
    return normalizeCloudResponse(await response.json());
  } catch (error) {
    return fetchCloudPayloadJsonp();
  }
}

function fetchCloudPayloadJsonp() {
  return new Promise((resolve, reject) => {
    const callbackName = `knowledgeNotesSync${Date.now()}${Math.random().toString(16).slice(2)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      script.remove();
      delete window[callbackName];
    };
    window[callbackName] = (data) => {
      cleanup();
      resolve(normalizeCloudResponse(data));
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP sync failed"));
    };
    const url = new URL(syncUrl("pull"));
    url.searchParams.set("callback", callbackName);
    script.src = url.toString();
    document.head.append(script);
  });
}

async function postCloud(action, payload) {
  readSyncInputs();
  if (!hasSyncEndpoint()) throw new Error("Sync endpoint is empty");
  const body = JSON.stringify({
    app: "knowledge-notes",
    action,
    payload,
    clientUpdatedAt: nowIso()
  });
  try {
    const response = await fetch(state.settings.syncEndpoint, {
      method: "POST",
      body
    });
    if (!response.ok) throw new Error(`Sync ${response.status}`);
    return normalizeCloudResponse(await response.json());
  } catch (error) {
    await fetch(state.settings.syncEndpoint, {
      method: "POST",
      mode: "no-cors",
      body
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return fetchCloudPayloadJsonp();
  }
}

async function pullCloud(options = {}) {
  readSyncInputs();
  if (!hasSyncEndpoint()) {
    if (!options.quiet) showToast("同期URLを入力してください");
    return 0;
  }
  if (state.syncBusy) return 0;
  state.syncBusy = true;
  if (!options.quiet) updateSyncStatus("取得中...");
  try {
    const payload = await fetchCloudPayload();
    const changed = mergeRemotePayload(payload);
    state.settings.lastSyncAt = nowIso();
    persistSettings();
    updateSyncStatus(`取得しました: ${changed}件更新`);
    return changed;
  } catch {
    updateSyncStatus("取得できませんでした");
    return 0;
  } finally {
    state.syncBusy = false;
  }
}

async function pushCloud(options = {}) {
  readSyncInputs();
  if (!hasSyncEndpoint()) {
    if (!options.quiet) showToast("同期URLを入力してください");
    return;
  }
  if (state.syncBusy) return;
  state.syncBusy = true;
  if (!options.quiet) updateSyncStatus("送信中...");
  try {
    await postCloud("push", buildDataPayload());
    state.settings.lastSyncAt = nowIso();
    persistSettings();
    updateSyncStatus("送信しました");
  } catch {
    updateSyncStatus("送信できませんでした");
  } finally {
    state.syncBusy = false;
  }
}

async function syncCloud(options = {}) {
  readSyncInputs();
  if (!hasSyncEndpoint()) {
    if (!options.quiet) showToast("同期URLを入力してください");
    return;
  }
  if (state.syncBusy) return;
  state.syncBusy = true;
  if (!options.quiet) updateSyncStatus("同期中...");
  try {
    const payload = await postCloud("sync", buildDataPayload());
    const changed = mergeRemotePayload(payload);
    state.settings.lastSyncAt = nowIso();
    persistSettings();
    updateSyncStatus(`同期しました: ${changed}件更新`);
  } catch {
    updateSyncStatus("同期できませんでした");
  } finally {
    state.syncBusy = false;
  }
}

function queueAutoSync() {
  if (!hasSyncEndpoint() || !state.settings.autoSyncEnabled) return;
  clearTimeout(state.syncDebounceId);
  state.syncDebounceId = setTimeout(() => syncCloud({ quiet: true }), 1800);
}

function scheduleAutoSyncLoop() {
  clearInterval(state.syncIntervalId);
  state.syncIntervalId = null;
  if (!hasSyncEndpoint() || !state.settings.autoSyncEnabled) return;
  state.syncIntervalId = setInterval(() => {
    if (document.visibilityState === "visible") syncCloud({ quiet: true });
  }, AUTO_SYNC_INTERVAL_MS);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2400);
}

function handleUrlQuiz() {
  const params = new URLSearchParams(location.search);
  const id = params.get("quiz");
  if (id) {
    openQuiz(id);
    history.replaceState({}, "", location.pathname);
  }
}

function bindEvents() {
  els.form.addEventListener("submit", upsertNote);
  els.clear.addEventListener("click", resetForm);
  els.newNote.addEventListener("click", resetForm);
  els.imageInput.addEventListener("change", addImageFromInput);
  els.openDraw.addEventListener("click", openDrawingDialog);
  els.removeAllMedia.addEventListener("click", () => {
    state.formAttachments = [];
    renderAttachmentPreview();
  });
  els.search.addEventListener("input", renderNotes);
  els.tagFilter.addEventListener("change", renderNotes);
  els.sort.addEventListener("change", renderNotes);
  els.randomQuiz.addEventListener("click", () => openQuiz());
  els.revealAnswer.addEventListener("click", revealAnswer);
  els.editQuiz.addEventListener("click", editCurrentQuiz);
  els.reminderToggle.addEventListener("change", toggleReminder);
  els.interval.addEventListener("change", changeInterval);
  els.testNotification.addEventListener("click", testNotification);
  els.syncEndpoint.addEventListener("change", readSyncInputs);
  els.autoSync.addEventListener("change", readSyncInputs);
  els.syncNow.addEventListener("click", () => syncCloud());
  els.pullCloud.addEventListener("click", () => pullCloud());
  els.pushCloud.addEventListener("click", () => pushCloud());
  els.drawColor.addEventListener("input", () => {
    state.drawing.color = els.drawColor.value;
  });
  els.drawSize.addEventListener("input", () => {
    state.drawing.size = Number(els.drawSize.value);
  });
  els.drawingCanvas.addEventListener("pointerdown", beginDrawing);
  els.drawingCanvas.addEventListener("pointermove", continueDrawing);
  els.drawingCanvas.addEventListener("pointerup", endDrawing);
  els.drawingCanvas.addEventListener("pointercancel", endDrawing);
  els.drawingCanvas.addEventListener("pointerleave", endDrawing);
  els.undoDraw.addEventListener("click", undoDrawing);
  els.clearDraw.addEventListener("click", clearDrawing);
  els.saveDraw.addEventListener("click", saveDrawingAttachment);
  els.cancelDraw.addEventListener("click", closeDrawingDialog);
  els.closeDraw.addEventListener("click", closeDrawingDialog);
  window.addEventListener("resize", () => {
    if (els.drawingDialog.open) redrawDrawingCanvas();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") queueAutoSync();
  });
  els.exportButton.addEventListener("click", (event) => {
    if (event.shiftKey) {
      const blob = new Blob([exportCsv()], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `knowledge-notes-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    exportJson();
  });
  els.importInput.addEventListener("change", importJson);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });
  els.installButton.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    els.installButton.hidden = true;
  });
}

async function init() {
  loadState();
  bindEvents();
  renderAttachmentPreview();
  renderSyncInputs();
  renderNotes();
  updateReminderStatus();
  await registerServiceWorker();
  scheduleReminder();
  scheduleAutoSyncLoop();
  queueAutoSync();
  handleUrlQuiz();
}

init();
