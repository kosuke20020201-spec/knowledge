const APP_NAME = "knowledge-notes";
const STORE_SHEET_NAME = "knowledge_notes_store";
const CHUNK_SIZE = 45000;
const SPREADSHEET_ID = "";

function doGet(e) {
  const result = {
    ok: true,
    payload: readStore_()
  };
  return output_(result, e);
}

function doPost(e) {
  const request = parseRequest_(e);
  const action = request.action || "sync";
  const current = readStore_();
  let payload = current;

  if (action === "pull") {
    payload = current;
  } else if (action === "push" || action === "sync") {
    payload = mergePayloads_(current, request.payload || request);
    writeStore_(payload);
  }

  return output_({
    ok: true,
    action,
    payload
  }, e);
}

function parseRequest_(e) {
  const text = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  try {
    return JSON.parse(text);
  } catch (error) {
    return {};
  }
}

function output_(data, e) {
  const text = JSON.stringify(data);
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + text + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

function spreadsheet_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("Open this script from a Google Spreadsheet, or set SPREADSHEET_ID.");
  }
  return spreadsheet;
}

function storeSheet_() {
  const spreadsheet = spreadsheet_();
  let sheet = spreadsheet.getSheetByName(STORE_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(STORE_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([["app", "index", "chunk"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function emptyPayload_() {
  return {
    app: APP_NAME,
    version: 2,
    exportedAt: new Date().toISOString(),
    notes: [],
    deletedNotes: {},
    settings: {}
  };
}

function readStore_() {
  const sheet = storeSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return emptyPayload_();

  const rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues()
    .filter((row) => row[0] === APP_NAME)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  if (!rows.length) return emptyPayload_();

  try {
    return JSON.parse(rows.map((row) => row[2]).join(""));
  } catch (error) {
    return emptyPayload_();
  }
}

function writeStore_(payload) {
  const sheet = storeSheet_();
  const text = JSON.stringify(payload);
  const rows = [];
  for (let index = 0; index < text.length; index += CHUNK_SIZE) {
    rows.push([APP_NAME, rows.length, text.slice(index, index + CHUNK_SIZE)]);
  }

  sheet.clear();
  sheet.getRange(1, 1, 1, 3).setValues([["app", "index", "chunk"]]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  sheet.setFrozenRows(1);
}

function mergePayloads_(base, incoming) {
  const notes = {};
  const deletedNotes = Object.assign({}, base.deletedNotes || {});

  (base.notes || []).forEach((note) => {
    if (note && note.id) notes[note.id] = note;
  });

  Object.keys(incoming.deletedNotes || {}).forEach((id) => {
    if (time_(incoming.deletedNotes[id]) > time_(deletedNotes[id])) {
      deletedNotes[id] = incoming.deletedNotes[id];
    }
  });

  (incoming.notes || []).forEach((note) => {
    if (!note || !note.id) return;
    const deletedAt = time_(deletedNotes[note.id]);
    if (deletedAt >= time_(note.updatedAt)) return;
    if (!notes[note.id] || time_(note.updatedAt) > time_(notes[note.id].updatedAt)) {
      notes[note.id] = note;
    }
  });

  const mergedNotes = Object.keys(notes)
    .map((id) => notes[id])
    .filter((note) => time_(deletedNotes[note.id]) < time_(note.updatedAt))
    .sort((a, b) => time_(b.updatedAt) - time_(a.updatedAt));

  return {
    app: APP_NAME,
    version: 2,
    exportedAt: new Date().toISOString(),
    notes: mergedNotes,
    deletedNotes,
    settings: Object.assign({}, base.settings || {}, incoming.settings || {})
  };
}

function time_(value) {
  const time = value ? new Date(value).getTime() : 0;
  return isNaN(time) ? 0 : time;
}
