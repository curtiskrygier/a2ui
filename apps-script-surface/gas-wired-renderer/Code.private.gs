/**
 * A2UI Gem Renderer
 *
 * Four modes:
 *   GET  ?p=BASE64       — decode base64 payload, render atoms (small schemas, shareable URL)
 *   POST ?p=JSON         — read raw JSON from form field (large schemas, no URL limit)
 *   GET  ?slide=<id>     — render Toulouse Airspace Command Deck slide with live METAR
 *   GET  (no params)     — serve the helper UI for pasting / encoding JSON
 */

// Current named-page slug being rendered — used by module_map to stamp &from= on ?p= child URLs
var _CURRENT_NAV_SLUG = '';

function _ga4PageView(nav, p) {
  try {
    var clientId = Utilities.getUuid();
    var pageTitle = nav || (p ? 'payload' : 'home');
    var payload = JSON.stringify({
      client_id: clientId,
      events: [{
        name: 'page_view',
        params: {
          page_title: pageTitle,
          page_location: ScriptApp.getService().getUrl() + (nav ? '?nav=' + nav : ''),
          engagement_time_msec: '1'
        }
      }]
    });
    UrlFetchApp.fetch(
      'https://www.google-analytics.com/mp/collect?measurement_id=G-QH5DF4GSM3&api_secret=bSfhIsTpSuSS6BbOYQpU5g',
      { method: 'post', contentType: 'application/json', payload: payload, muteHttpExceptions: true }
    );
  } catch(e) {}
}

function doGet(e) {
  var p        = e && e.parameter && e.parameter.p;
  var slide    = e && e.parameter && e.parameter.slide;
  var deck     = e && e.parameter && e.parameter.deck;
  var debug    = e && e.parameter && e.parameter.debug;
  var makeDeck = e && e.parameter && e.parameter.makeDeck;
  var nav      = e && e.parameter && e.parameter.nav;
  var from     = e && e.parameter && e.parameter.from;
  _ga4PageView(nav, p);
  if (debug)   return _debugPage(debug);
  if (makeDeck !== undefined) return _makeDeckPage();
  if (deck)    return _renderDeckSlide(deck, slide || '');
  if (slide !== undefined) return _renderAirspaceSlide(slide);
  if (e && e.parameter && e.parameter.mode === 'builder') {
    return HtmlService.createHtmlOutputFromFile('PageBuilder')
      .setTitle('A2UI Page Builder')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (e && e.parameter && e.parameter.mode === 'screenshot' && p) {
    return _renderScreenshotPage(p);
  }
  if (nav === 'brevet-2026') return _renderBrevetPage();
  if (nav === 'nist-ai-rmf') return _renderNistAirmfPage();
  if (nav) return _renderNamedPage(nav, from || '');
  if (p) return _renderFromParam(p, from || '');
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('A2UI — Page Generator')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var raw = e.parameter && e.parameter.p;
  if (!raw && e.postData) raw = e.postData.contents;
  if (!raw) return doGet(e);
  try {
    var payload = JSON.parse(raw);
    return _renderFromPayload(payload);
  } catch (err) {
    // Fallback: treat as base64
    return _renderFromParam(raw);
  }
}

function _renderFromParam(encoded, from) {
  try {
    // Normalise to web-safe base64 in case client sent standard base64 (+ and /)
    encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_');
    // Restore stripped padding
    var padded = encoded;
    while (padded.length % 4 !== 0) padded += '=';
    var bytes = Utilities.base64DecodeWebSafe(padded);
    var json;
    // Detect gzip magic bytes (0x1f 0x8b) — new compressed URLs
    if (bytes.length >= 2 && bytes[0] === 31 && (bytes[1] & 0xFF) === 139) {
      json = Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip')).getDataAsString();
    } else {
      json = Utilities.newBlob(bytes).getDataAsString();
    }
    var payload;
    try {
      payload = JSON.parse(json);
    } catch(e) {
      // Repair common truncation: outer array missing closing ]
      if (json.charAt(0) === '[') {
        payload = JSON.parse(json + ']');
      } else {
        throw e;
      }
    }
    return _renderFromPayload(payload, from || '');
  } catch (err) {
    return _errorPage(err.message);
  }
}

// ─── A2UI Actions dispatcher ──────────────────────────────────────────────────

function a2uiAction(type, payload) {
  var result;
  try {
    switch (type) {
      case 'gas:sheet_append':       result = _actionSheetAppend(payload);       break;
      case 'gas:sheet_batch_append': result = _actionSheetBatchAppend(payload);  break;
      case 'gas:sheet_query':        result = _actionSheetQuery(payload);        break;
      case 'gas:sheet_upsert':       result = _actionSheetUpsert(payload);       break;
      case 'gas:sheet_delete_row':   result = _actionSheetDeleteRow(payload);    break;
      case 'gas:sheet_aggregate':    result = _actionSheetAggregate(payload);    break;
      case 'gas:firestore_query':    result = _actionFirestoreQuery(payload);    break;
      case 'gas:firestore_set':      result = _actionFirestoreSet(payload);      break;
      case 'gas:firestore_delete':   result = _actionFirestoreDelete(payload);   break;
      case 'gas:adsb_query':         result = _actionAdsbQuery(payload);         break;
      case 'gas:email_send':         result = _actionEmailSend(payload);         break;
      case 'gas:calendar_event':     result = _actionCalendarEvent(payload);     break;
      case 'gas:api_post':           result = _actionApiPost(payload);           break;
      case 'gas:script_run':         result = _actionScriptRun(payload);         break;
      case 'gas:sheet_info':         result = _actionSheetInfo(payload);         break;
      default: result = { ok: false, error: 'Unknown action type: ' + type };
    }
  } catch (e) {
    result = { ok: false, error: e.message || String(e) };
  }
  return result || { ok: false, error: 'Action returned no response: ' + type };
}

// ─── Identity ─────────────────────────────────────────────────────────────────
// Cached per request — Session calls are slow in GAS.

var _cachedUserEmail = null;
function _getActiveUserEmail() {
  if (_cachedUserEmail !== null) return _cachedUserEmail;
  try { _cachedUserEmail = Session.getActiveUser().getEmail() || ''; }
  catch(e) { _cachedUserEmail = ''; }
  return _cachedUserEmail;
}

// ─── Template resolution ──────────────────────────────────────────────────────
// Tokens: {{now}}, {{today}}, {{datetime}}, {{app.*}}, {{app.user.email}}

function _resolveTemplateTokens(value, appConfig) {
  if (typeof value !== 'string') return value;
  var app     = appConfig || {};
  var storage = app.storage || {};
  var now     = new Date();
  var isoDate     = now.toISOString().slice(0, 10);
  var isoDateTime = now.toISOString().slice(0, 19).replace('T', ' ');
  var result  = value
    .replace(/\{\{now\}\}/g,      isoDate)
    .replace(/\{\{today\}\}/g,    isoDate)
    .replace(/\{\{datetime\}\}/g, isoDateTime)
    .replace(/\{\{app\.id\}\}/g,                 String(app.id              || ''))
    .replace(/\{\{app\.storage\.sheet\}\}/g,      String(storage.sheet      || ''))
    .replace(/\{\{app\.storage\.folder_id\}\}/g,  String(storage.folder_id  || ''))
    .replace(/\{\{app\.storage\.type\}\}/g,       String(storage.type       || ''));
  // Resolve user tokens lazily — Session/People API call only when needed
  if (result.indexOf('{{app.user') !== -1) {
    result = result.replace(/\{\{app\.user\.email\}\}/g, _getActiveUserEmail());
    if (result.indexOf('{{app.user.name}}') !== -1) {
      result = result.replace(/\{\{app\.user\.name\}\}/g, _getActiveUserName());
    }
  }
  return result;
}

function _resolveCollect(collect, appConfig) {
  var out  = {};
  var keys = Object.keys(collect || {});
  for (var i = 0; i < keys.length; i++) {
    out[keys[i]] = _resolveTemplateTokens(collect[keys[i]], appConfig);
  }
  return out;
}

// ─── Where filter ─────────────────────────────────────────────────────────────
// Supports equality: { col: "value" }
// Operator: { col: { gt|lt|gte|lte|eq|ne|contains: value } }

function _applyWhere(rows, where) {
  if (!where) return rows;
  var keys = Object.keys(where);
  return rows.filter(function(r) {
    return keys.every(function(k) {
      var col  = k.toLowerCase().replace(/\s+/g, '_');
      var cell = r[col] !== undefined ? r[col] : '';
      var cond = where[k];
      if (cond !== null && typeof cond === 'object') {
        var num  = Number(cell);
        var condKeys = Object.keys(cond);
        return condKeys.every(function(op) {
          var v = cond[op];
          switch (op) {
            case 'gt':       return num > Number(v);
            case 'lt':       return num < Number(v);
            case 'gte':      return num >= Number(v);
            case 'lte':      return num <= Number(v);
            case 'ne':       return String(cell) !== String(v);
            case 'eq':       return String(cell) === String(v);
            case 'contains': return String(cell).toLowerCase().indexOf(String(v).toLowerCase()) !== -1;
            default:         return true;
          }
        });
      }
      return String(cell) === String(cond);
    });
  });
}

// ─── Isolation ────────────────────────────────────────────────────────────────
// When app.data.isolation === 'by_user', auto-scope reads and writes to the
// active user's email via a hidden 'a2ui_owner' column.

var ISOLATION_COL      = 'a2ui_owner';
var ISOLATION_TEAM_COL = 'a2ui_team';

function _getIsolationEmail(appConfig) {
  var isolation = (appConfig && appConfig.data && appConfig.data.isolation) || 'none';
  if (isolation !== 'by_user') return null;
  return _getActiveUserEmail();
}

function _getIsolationTeam(appConfig) {
  var isolation = (appConfig && appConfig.data && appConfig.data.isolation) || 'none';
  if (isolation !== 'by_team') return null;
  var email = _getActiveUserEmail();
  var at = email.indexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}

// ─── User display name ────────────────────────────────────────────────────────
// Returns display name from People API if available; falls back to email prefix.

function _getActiveUserName() {
  var email = _getActiveUserEmail();
  if (!email) return '';
  try {
    var resp = UrlFetchApp.fetch(
      'https://people.googleapis.com/v1/people/me?personFields=names',
      { headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
    );
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      var names = (data.names || []);
      if (names.length) return names[0].displayName || email.split('@')[0];
    }
  } catch(e) {}
  return email.split('@')[0];
}

// ─── Renderer config ──────────────────────────────────────────────────────────
// Script Properties set once by the renderer owner (not per-payload):
//   FIRESTORE_PROJECT_ID — GCP project ID for Firestore backend

function _getRendererConfig() {
  try {
    var props = PropertiesService.getScriptProperties().getProperties();
    return {
      firestoreProjectId: props['FIRESTORE_PROJECT_ID'] || null
    };
  } catch(e) { return { firestoreProjectId: null }; }
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

function _firestoreRequest(method, path, body) {
  var cfg = _getRendererConfig();
  if (!cfg.firestoreProjectId) throw new Error(
    'Firestore not configured. Set FIRESTORE_PROJECT_ID in Script Properties.'
  );
  var url = 'https://firestore.googleapis.com/v1/projects/' + cfg.firestoreProjectId +
            '/databases/(default)/documents' + path;
  var opts = {
    method: method,
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    contentType: 'application/json',
    muteHttpExceptions: true
  };
  if (body) opts.payload = JSON.stringify(body);
  return UrlFetchApp.fetch(url, opts);
}

function _toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean')          return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (val instanceof Date)               return { timestampValue: val.toISOString() };
  if (typeof val === 'object' && !Array.isArray(val)) {
    return { mapValue: { fields: _toFirestoreFields(val) } };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(_toFirestoreValue) } };
  }
  return { stringValue: String(val) };
}

function _toFirestoreFields(obj) {
  var fields = {};
  Object.keys(obj).forEach(function(k) { fields[k] = _toFirestoreValue(obj[k]); });
  return fields;
}

function _fromFirestoreValue(v) {
  if (!v) return null;
  if ('nullValue'      in v) return null;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('integerValue'   in v) return parseInt(v.integerValue, 10);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('stringValue'    in v) return v.stringValue;
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(_fromFirestoreValue);
  if ('mapValue'       in v) return _fromFirestoreDoc({ fields: v.mapValue.fields });
  return null;
}

function _fromFirestoreDoc(doc) {
  var out = { _id: (doc.name || '').split('/').pop() };
  Object.keys(doc.fields || {}).forEach(function(k) { out[k] = _fromFirestoreValue(doc.fields[k]); });
  return out;
}

function _firestoreWhereFilter(where) {
  // Converts A2UI where spec to Firestore structuredQuery filter
  var keys = Object.keys(where || {});
  if (!keys.length) return null;

  var opMap = { gt: 'GREATER_THAN', lt: 'LESS_THAN', gte: 'GREATER_THAN_OR_EQUAL',
                lte: 'LESS_THAN_OR_EQUAL', eq: 'EQUAL', ne: 'NOT_EQUAL' };

  var filters = [];
  keys.forEach(function(field) {
    var cond = where[field];
    if (typeof cond === 'object' && cond !== null) {
      Object.keys(cond).forEach(function(op) {
        if (op === 'contains') {
          // Firestore doesn't support LIKE — skip (warn only)
          console.warn('[A2UI] Firestore does not support contains filter on field: ' + field);
          return;
        }
        filters.push({ fieldFilter: {
          field: { fieldPath: field },
          op: opMap[op] || 'EQUAL',
          value: _toFirestoreValue(cond[op])
        }});
      });
    } else {
      filters.push({ fieldFilter: {
        field: { fieldPath: field }, op: 'EQUAL', value: _toFirestoreValue(cond)
      }});
    }
  });

  if (!filters.length) return null;
  return filters.length === 1
    ? filters[0]
    : { compositeFilter: { op: 'AND', filters: filters } };
}

// ─── Firestore actions ────────────────────────────────────────────────────────

function _actionFirestoreQuery(payload) {
  var cfg        = payload.config || {};
  var collection = cfg.collection || (payload.appConfig && payload.appConfig.storage && payload.appConfig.storage.collection) || 'a2ui_data';
  var where      = cfg.where      ? JSON.parse(JSON.stringify(cfg.where)) : {};
  var orderBy    = cfg.order_by   || null;
  var limit      = cfg.limit      ? parseInt(cfg.limit)  : null;
  var offset     = cfg.offset     ? parseInt(cfg.offset) : null;
  var select     = cfg.select     || null; // array of field names to return

  // Isolation
  var ownerEmail = _getIsolationEmail(payload.appConfig);
  if (ownerEmail !== null) where[ISOLATION_COL] = ownerEmail;
  var teamDomain = _getIsolationTeam(payload.appConfig);
  if (teamDomain !== null) where[ISOLATION_TEAM_COL] = teamDomain;

  var query = { from: [{ collectionId: collection }] };
  var filter = _firestoreWhereFilter(where);
  if (filter) query.where = filter;

  // order_by: string "col" or [{column:"col",dir:"desc"}, ...]
  if (orderBy) {
    var orders = Array.isArray(orderBy)
      ? orderBy
      : [{ column: orderBy, dir: 'asc' }];
    query.orderBy = orders.map(function(o) {
      var col = typeof o === 'string' ? o : (o.column || o);
      var dir = (typeof o === 'object' && o.dir === 'desc') ? 'DESCENDING' : 'ASCENDING';
      return { field: { fieldPath: col }, direction: dir };
    });
  }

  if (limit  !== null) query.limit  = limit;
  if (offset !== null) query.offset = offset;

  var resp = _firestoreRequest('post', '/' + collection + ':runQuery', { structuredQuery: query });
  var code = resp.getResponseCode();
  if (code !== 200) return { ok: false, error: 'Firestore query failed: HTTP ' + code + ' ' + resp.getContentText() };

  var results = JSON.parse(resp.getContentText());
  var rows = results
    .filter(function(r) { return r.document; })
    .map(function(r) { return _fromFirestoreDoc(r.document); });

  // Client-side select projection
  if (select && Array.isArray(select) && select.length) {
    rows = rows.map(function(row) {
      var out = {};
      select.forEach(function(f) { if (f in row) out[f] = row[f]; });
      return out;
    });
  }

  return { ok: true, data: rows };
}

function _actionFirestoreSet(payload) {
  var cfg        = payload.config || {};
  var collection = cfg.collection || (payload.appConfig && payload.appConfig.storage && payload.appConfig.storage.collection) || 'a2ui_data';
  var docId      = _resolveTemplateTokens(cfg.doc_id || '', payload.appConfig) || null;
  var data       = _resolveCollect(payload.data, payload.appConfig);

  // Stamp identity
  var ownerEmail = _getIsolationEmail(payload.appConfig);
  if (ownerEmail !== null) data[ISOLATION_COL] = ownerEmail;
  var teamDomain = _getIsolationTeam(payload.appConfig);
  if (teamDomain !== null) data[ISOLATION_TEAM_COL] = teamDomain;

  var fields = _toFirestoreFields(data);
  var path   = docId ? '/' + collection + '/' + docId : '/' + collection;
  var method = docId ? 'patch' : 'post';
  var resp   = _firestoreRequest(method, path, { fields: fields });
  var code   = resp.getResponseCode();
  if (code !== 200) return { ok: false, error: 'Firestore set failed: HTTP ' + code };

  var doc = JSON.parse(resp.getContentText());
  return { ok: true, data: { doc_id: (doc.name || '').split('/').pop() } };
}

function _actionFirestoreDelete(payload) {
  var cfg        = payload.config || {};
  var collection = cfg.collection || (payload.appConfig && payload.appConfig.storage && payload.appConfig.storage.collection) || 'a2ui_data';
  var docId      = _resolveTemplateTokens(cfg.doc_id || '', payload.appConfig);
  if (!docId) return { ok: false, error: 'firestore_delete: doc_id is required' };

  var resp = _firestoreRequest('delete', '/' + collection + '/' + docId, null);
  var code = resp.getResponseCode();
  return code === 200 ? { ok: true, data: {} } : { ok: false, error: 'Firestore delete failed: HTTP ' + code };
}

// ─── Batch sheet append ───────────────────────────────────────────────────────

function _actionSheetBatchAppend(payload) {
  var cfg       = payload.config || {};
  var sheetName = cfg.sheet  || 'A2UI_Data';
  var rows      = payload.data || [];  // array of collect objects
  if (!Array.isArray(rows) || !rows.length) return { ok: true, data: { inserted_rows: 0 } };

  var ownerEmail = _getIsolationEmail(payload.appConfig);
  var teamDomain = _getIsolationTeam(payload.appConfig);

  var resolved = rows.map(function(r) {
    var d = _resolveCollect(r, payload.appConfig);
    if (ownerEmail !== null) d[ISOLATION_COL]      = ownerEmail;
    if (teamDomain !== null) d[ISOLATION_TEAM_COL] = teamDomain;
    return d;
  });

  var sheet = _getOrCreateSheet_(sheetName);
  if (sheet.getLastRow() === 0) { sheet.appendRow(Object.keys(resolved[0])); }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  var matrix = resolved.map(function(d) {
    return headers.map(function(h) { return d[h] !== undefined ? d[h] : ''; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, headers.length).setValues(matrix);
  return { ok: true, data: { inserted_rows: matrix.length } };
}

// ─── Sheet helpers ────────────────────────────────────────────────────────────

function _sheetIdKey_(name) {
  return 'a2ui_sid_' + name.replace(/[^a-zA-Z0-9]/g, '_');
}

function _getOrCreateSheet_(name) {
  var props  = PropertiesService.getScriptProperties();
  var key    = _sheetIdKey_(name);
  var fileId = props.getProperty(key);
  if (fileId) {
    try { return SpreadsheetApp.openById(fileId).getSheets()[0]; } catch(e) { props.deleteProperty(key); }
  }
  var files = DriveApp.getFilesByName(name);
  while (files.hasNext()) {
    var f = files.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) {
      props.setProperty(key, f.getId());
      return SpreadsheetApp.open(f).getSheets()[0];
    }
  }
  var ss = SpreadsheetApp.create(name);
  props.setProperty(key, ss.getId());
  return ss.getSheets()[0];
}

function _findSheet_(name) {
  if (!name) return null;
  var props  = PropertiesService.getScriptProperties();
  var key    = _sheetIdKey_(name);
  var fileId = props.getProperty(key);
  if (fileId) {
    try { return SpreadsheetApp.openById(fileId).getSheets()[0]; } catch(e) { props.deleteProperty(key); }
  }
  var files = DriveApp.getFilesByName(name);
  while (files.hasNext()) {
    var f = files.next();
    if (f.getMimeType() === MimeType.GOOGLE_SHEETS) {
      props.setProperty(key, f.getId());
      return SpreadsheetApp.open(f).getSheets()[0];
    }
  }
  return null;
}

// ─── Action implementations ───────────────────────────────────────────────────

function _actionSheetAppend(payload) {
  var cfg       = payload.config || {};
  var sheetName = cfg.sheet || 'A2UI_Data';
  var data      = _resolveCollect(payload.data, payload.appConfig);

  var ownerEmail = _getIsolationEmail(payload.appConfig);
  if (ownerEmail !== null) data[ISOLATION_COL] = ownerEmail;
  var teamDomain = _getIsolationTeam(payload.appConfig);
  if (teamDomain !== null) data[ISOLATION_TEAM_COL] = teamDomain;

  var sheet = _getOrCreateSheet_(sheetName);
  if (sheet.getLastRow() === 0) { sheet.appendRow(Object.keys(data)); }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function(h) { return data[h] !== undefined ? data[h] : ''; });
  sheet.appendRow(row);
  return { ok: true, data: { insertedRow: sheet.getLastRow() } };
}

function _actionSheetQuery(payload) {
  var cfg       = payload.config || {};
  var sheetName = cfg.sheet    || 'A2UI_Data';
  var where     = cfg.where    ? JSON.parse(JSON.stringify(cfg.where)) : {};
  var orderBy   = cfg.order_by || null;
  var limit     = cfg.limit    ? parseInt(cfg.limit)  : null;
  var offset    = cfg.offset   ? parseInt(cfg.offset) : 0;
  var select    = cfg.select   || null;

  // Resolve template tokens in where values (e.g. {{today}}, {{app.user.email}})
  Object.keys(where).forEach(function(k) {
    var v = where[k];
    if (typeof v === 'string') {
      where[k] = _resolveTemplateTokens(v, payload.appConfig);
    } else if (v !== null && typeof v === 'object') {
      Object.keys(v).forEach(function(op) {
        if (typeof v[op] === 'string') v[op] = _resolveTemplateTokens(v[op], payload.appConfig);
      });
    }
  });

  // Isolation
  var ownerEmail = _getIsolationEmail(payload.appConfig);
  if (ownerEmail !== null) where[ISOLATION_COL] = ownerEmail;
  var teamDomain = _getIsolationTeam(payload.appConfig);
  if (teamDomain !== null) where[ISOLATION_TEAM_COL] = teamDomain;

  var sheet = _findSheet_(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, data: [], total: 0 };

  var values  = sheet.getDataRange().getValues();
  var headers = values[0].map(function(h) { return String(h).toLowerCase().replace(/\s+/g, '_'); });

  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) { row[headers[j]] = values[i][j]; }
    rows.push(row);
  }

  rows = _applyWhere(rows, Object.keys(where).length ? where : null);

  // order_by: "col" (asc) | [{column:"col",dir:"desc"}, ...]
  if (orderBy) {
    var orders = Array.isArray(orderBy)
      ? orderBy
      : [{ column: orderBy, dir: 'asc' }];
    rows.sort(function(a, b) {
      for (var oi = 0; oi < orders.length; oi++) {
        var o   = orders[oi];
        var key = (typeof o === 'string' ? o : (o.column || o)).toLowerCase().replace(/\s+/g, '_');
        var dir = (typeof o === 'object' && o.dir === 'desc') ? -1 : 1;
        var av  = a[key], bv = b[key];
        if (av < bv) return -1 * dir;
        if (av > bv) return  1 * dir;
      }
      return 0;
    });
  }

  var total = rows.length;
  if (offset) rows = rows.slice(offset);
  if (limit !== null) rows = rows.slice(0, limit);

  // select projection — strip internal isolation columns from output
  var hiddenCols = [ISOLATION_COL, ISOLATION_TEAM_COL];
  var tz = Session.getScriptTimeZone();
  rows = rows.map(function(row) {
    var out = {};
    var cols = (select && select.length) ? select : Object.keys(row);
    cols.forEach(function(c) {
      if (hiddenCols.indexOf(c) === -1 && c in row) {
        var v = row[c];
        out[c] = (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss') : v;
      }
    });
    return out;
  });

  return { ok: true, data: rows, total: total };
}

function _actionSheetUpsert(payload) {
  var cfg       = payload.config || {};
  var sheetName = cfg.sheet      || 'A2UI_Data';
  var keyCol    = cfg.key_column || '';
  var keyVal    = String(_resolveTemplateTokens(cfg.key_value || '', payload.appConfig));
  var data      = _resolveCollect(payload.data, payload.appConfig);

  var ownerEmail = _getIsolationEmail(payload.appConfig);
  if (ownerEmail !== null) data[ISOLATION_COL] = ownerEmail;

  var sheet = _getOrCreateSheet_(sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(Object.keys(data));
    sheet.appendRow(Object.keys(data).map(function(k) { return data[k] !== undefined ? data[k] : ''; }));
    return { ok: true, data: { upserted_row: 2, was_insert: true } };
  }

  var headers    = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var keyColNorm = keyCol.toLowerCase().replace(/\s+/g, '_');
  var keyColIdx  = -1;
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c]).toLowerCase().replace(/\s+/g, '_') === keyColNorm) { keyColIdx = c; break; }
  }

  var matchRow = -1;
  if (keyColIdx >= 0 && keyVal) {
    var allData = sheet.getDataRange().getValues();
    for (var r = 1; r < allData.length; r++) {
      if (String(allData[r][keyColIdx]) === keyVal) { matchRow = r + 1; break; }
    }
  }

  if (matchRow >= 0) {
    var rowValues = headers.map(function(h) {
      var k = String(h);
      return data[k] !== undefined ? data[k] : sheet.getRange(matchRow, headers.indexOf(h) + 1).getValue();
    });
    sheet.getRange(matchRow, 1, 1, headers.length).setValues([rowValues]);
    return { ok: true, data: { upserted_row: matchRow, was_insert: false } };
  } else {
    sheet.appendRow(headers.map(function(h) { return data[String(h)] !== undefined ? data[String(h)] : ''; }));
    return { ok: true, data: { upserted_row: sheet.getLastRow(), was_insert: true } };
  }
}

function _actionSheetDeleteRow(payload) {
  var cfg       = payload.config || {};
  var sheetName = cfg.sheet       || 'A2UI_Data';
  var keyCol    = cfg.key_column  || '';
  var keyVal    = String(_resolveTemplateTokens(cfg.key_value || '', payload.appConfig));

  var sheet = _findSheet_(sheetName);
  if (!sheet) return { ok: false, error: 'Sheet not found: ' + sheetName };

  var headers    = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var keyColNorm = keyCol.toLowerCase().replace(/\s+/g, '_');
  var keyColIdx  = -1;
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c]).toLowerCase().replace(/\s+/g, '_') === keyColNorm) { keyColIdx = c; break; }
  }
  if (keyColIdx < 0) return { ok: false, error: 'key_column not found: ' + keyCol };

  var allData = sheet.getDataRange().getValues();
  var deleted = 0;
  // Walk backwards so row indices stay valid as rows are deleted
  for (var r = allData.length - 1; r >= 1; r--) {
    if (String(allData[r][keyColIdx]) === keyVal) {
      // by_user isolation: only delete own rows
      var ownerEmail = _getIsolationEmail(payload.appConfig);
      if (ownerEmail !== null) {
        var ownerIdx = headers.map(function(h) { return String(h); }).indexOf(ISOLATION_COL);
        if (ownerIdx >= 0 && String(allData[r][ownerIdx]) !== ownerEmail) continue;
      }
      sheet.deleteRow(r + 1);
      deleted++;
      if (!cfg.delete_all) break; // default: delete first match only
    }
  }
  return { ok: true, data: { deleted_rows: deleted } };
}

function _actionSheetInfo(payload) {
  var cfg       = payload.config || {};
  var sheetName = cfg.sheet || (payload.appConfig && payload.appConfig.storage && payload.appConfig.storage.sheet) || 'A2UI_Data';
  var props     = PropertiesService.getScriptProperties();
  var key       = _sheetIdKey_(sheetName);
  var fileId    = props.getProperty(key);
  if (!fileId) {
    // Try to find it via Drive so we can cache the ID
    var files = DriveApp.getFilesByName(sheetName);
    while (files.hasNext()) {
      var f = files.next();
      if (f.getMimeType() === MimeType.GOOGLE_SHEETS) { fileId = f.getId(); props.setProperty(key, fileId); break; }
    }
  }
  if (!fileId) return { ok: false, error: 'Sheet not found: ' + sheetName };
  return { ok: true, data: {
    name:    sheetName,
    file_id: fileId,
    url:     'https://docs.google.com/spreadsheets/d/' + fileId + '/edit'
  }};
}

function _actionSheetAggregate(payload) {
  var cfg       = payload.config || {};
  var sheetName = cfg.sheet         || 'A2UI_Data';
  var groupBy   = cfg.group_by      || null;
  var aggs      = cfg.aggregations  || [];
  var where     = cfg.where         || null;

  var sheet = _findSheet_(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, data: [] };

  var values  = sheet.getDataRange().getValues();
  var headers = values[0].map(function(h) { return String(h).toLowerCase().replace(/\s+/g, '_'); });

  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) { row[headers[j]] = values[i][j]; }
    rows.push(row);
  }

  // by_user isolation
  var ownerEmail = _getIsolationEmail(payload.appConfig);
  if (ownerEmail !== null) {
    var isoWhere = {}; isoWhere[ISOLATION_COL] = ownerEmail;
    rows = _applyWhere(rows, isoWhere);
  }

  rows = _applyWhere(rows, where);

  // Group
  var groups = {};
  var groupKeys = [];
  rows.forEach(function(r) {
    var key = groupBy ? String(r[groupBy.toLowerCase().replace(/\s+/g, '_')] || '') : '__all__';
    if (!groups[key]) { groups[key] = []; groupKeys.push(key); }
    groups[key].push(r);
  });

  var result = groupKeys.map(function(key) {
    var grpRows = groups[key];
    var out = {};
    if (groupBy) out[groupBy.toLowerCase().replace(/\s+/g, '_')] = key;
    aggs.forEach(function(agg) {
      var col  = agg.column ? agg.column.toLowerCase().replace(/\s+/g, '_') : null;
      var alias = agg.as || (agg.fn + (col ? '_' + col : ''));
      switch (agg.fn) {
        case 'count': out[alias] = grpRows.length; break;
        case 'sum':   out[alias] = grpRows.reduce(function(s, r) { return s + (Number(r[col]) || 0); }, 0); break;
        case 'avg':   out[alias] = grpRows.length ? grpRows.reduce(function(s,r){return s+(Number(r[col])||0);},0) / grpRows.length : 0; break;
        case 'min':   out[alias] = grpRows.reduce(function(m, r) { var v=Number(r[col])||0; return v<m?v:m; }, Infinity); break;
        case 'max':   out[alias] = grpRows.reduce(function(m, r) { var v=Number(r[col])||0; return v>m?v:m; }, -Infinity); break;
      }
    });
    return out;
  });

  return { ok: true, data: result };
}

function _actionEmailSend(payload) {
  var cfg = payload.config || {};
  var to      = String(_resolveTemplateTokens(cfg.to || '', payload.appConfig));
  var subject = String(_resolveTemplateTokens(cfg.subject || '', payload.appConfig));
  var body    = String(_resolveTemplateTokens(cfg.body || '', payload.appConfig));
  var isHtml  = !!cfg.is_html;
  var cc      = cfg.cc ? String(_resolveTemplateTokens(cfg.cc, payload.appConfig)) : '';
  if (!to) return { ok: false, error: 'email_send: to is required' };
  var opts = {};
  if (cc) opts.cc = cc;
  if (isHtml) opts.htmlBody = body;
  GmailApp.sendEmail(to, subject, isHtml ? '' : body, opts);
  return { ok: true, data: {} };
}

function _actionCalendarEvent(payload) {
  var cfg   = payload.config || {};
  var title = String(_resolveTemplateTokens(cfg.title || 'Event', payload.appConfig));
  var start = new Date(_resolveTemplateTokens(cfg.start || '', payload.appConfig));
  var end   = new Date(_resolveTemplateTokens(cfg.end   || '', payload.appConfig));
  var calId = cfg.calendar_id || 'primary';
  var cal   = calId === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(calId);
  if (!cal) return { ok: false, error: 'calendar_event: calendar not found: ' + calId };
  var opts = {};
  if (cfg.description) opts.description = String(_resolveTemplateTokens(cfg.description, payload.appConfig));
  if (cfg.attendees)   opts.guests      = String(_resolveTemplateTokens(cfg.attendees,   payload.appConfig));
  var event = cal.createEvent(title, start, end, opts);
  return { ok: true, data: { event_id: event.getId() } };
}

function _actionApiPost(payload) {
  var cfg  = payload.config || {};
  var url  = String(_resolveTemplateTokens(cfg.url || '', payload.appConfig));
  if (!url) return { ok: false, error: 'api_post: url is required' };
  var body    = _resolveCollect(cfg.collect || {}, payload.appConfig);
  var headers = cfg.headers || {};
  var ct      = cfg.content_type || 'application/json';
  headers['Content-Type'] = ct;
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', headers: headers,
    payload: ct === 'application/json' ? JSON.stringify(body) : body,
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var data = {};
  try { data = JSON.parse(resp.getContentText()); } catch(e) { data = { raw: resp.getContentText() }; }
  return { ok: code >= 200 && code < 300, data: { result: data, status_code: code } };
}

function _actionScriptRun(payload) {
  var cfg = payload.config || {};
  var fn  = cfg.fn;
  if (!fn || typeof this[fn] !== 'function') {
    return { ok: false, error: 'script_run: function not found: ' + fn };
  }
  var args = (cfg.args || []).map(function(a) { return _resolveTemplateTokens(a, payload.appConfig); });
  var result = this[fn].apply(null, args);
  return { ok: true, data: { result: result } };
}

function _actionAdsbQuery(payload) {
  var config = payload.config || {};
  var lamin = config.lamin !== undefined ? config.lamin : 43.0;
  var lomin = config.lomin !== undefined ? config.lomin : 1.0;
  var lamax = config.lamax !== undefined ? config.lamax : 44.5;
  var lomax = config.lomax !== undefined ? config.lomax : 2.5;
  try {
    var url = 'https://opensky-network.org/api/states/all' +
      '?lamin=' + lamin + '&lomin=' + lomin + '&lamax=' + lamax + '&lomax=' + lomax;
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return { ok: false, error: 'OpenSky HTTP ' + resp.getResponseCode() };
    var json  = JSON.parse(resp.getContentText());
    var flights = (json.states || [])
      .filter(function(s) { return s[5] !== null && s[6] !== null && !s[8]; })
      .map(function(s) {
        return {
          callsign: ((s[1] || s[0] || 'UNKN').trim()) || s[0],
          lat:    s[6],
          lon:    s[5],
          alt_ft: s[7]  ? Math.round(s[7]  * 3.28084) : 0,
          spd_kt: s[9]  ? Math.round(s[9]  * 1.944)   : 0,
          hdg:    s[10] || 0,
          squawk: s[14] || '0000'
        };
      });
    return { ok: true, data: flights };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ─── Wired surface ────────────────────────────────────────────────────────────

var _WIRED_ATOM_ALIASES = {
  'text_input': 'form_input',
  'data_table': 'data_table_sortable'
};

function _resolveInitialRows(wireExpr, statePrimitives) {
  if (!wireExpr || !wireExpr.startsWith('#')) return null;
  var dot    = wireExpr.indexOf('.');
  var nodeId = wireExpr.slice(1, dot);
  for (var i = 0; i < statePrimitives.length; i++) {
    var p = statePrimitives[i];
    if (p.id !== nodeId) continue;
    if (p.primitive === 'ArrayFilter' && p.props && Array.isArray(p.props.source)) return p.props.source;
    if (p.primitive === 'ValueStore'  && p.props && Array.isArray(p.props.initialValue)) return p.props.initialValue;
  }
  return null;
}

function _renderWiredSurface(payload) {
  var title      = payload.title || 'A2UI Wired Surface';
  var theme      = payload.theme || 'light';
  var layout     = payload.layout || [];
  var primitives = payload.state_primitives || [];
  var content    = '';

  layout.forEach(function(el) {
    var props = el.props || {};
    var block = {};
    Object.keys(props).forEach(function(k) { block[k] = props[k]; });
    var rawType     = el.atom || el.type;
    block.type      = _WIRED_ATOM_ALIASES[rawType] || rawType;
    block.component = el.component;

    if (Array.isArray(block.columns)) {
      block.columns = block.columns.map(function(c) {
        if (typeof c === 'string') {
          return { key: c, label: c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ') };
        }
        return c;
      });
    }

    if (el.wire && el.wire.rows && !block.rows) {
      var initRows = _resolveInitialRows(el.wire.rows, primitives);
      if (initRows) block.rows = initRows;
    }

    var atomHtml = renderAtoms([block], { theme: theme });

    if (el.id) {
      var stepAttr  = (el.step !== undefined) ? ' data-a2ui-step="' + el.step + '"' : '';
      var hidden    = (el.step !== undefined && el.step !== 0) ? ' style="display:none"' : '';
      var colsAttr  = block.columns
        ? ' data-a2ui-columns="' + JSON.stringify(block.columns).replace(/"/g, '&quot;') + '"'
        : '';
      var emptyAttr = block.emptyMessage
        ? ' data-a2ui-empty="' + String(block.emptyMessage).replace(/"/g, '&quot;') + '"'
        : '';
      content += '<div id="a2ui-' + el.id + '"' + stepAttr + hidden + colsAttr + emptyAttr + '>' + atomHtml + '</div>';
    } else {
      content += atomHtml;
    }
  });

  content += include('A2UIState');

  var tmpl        = HtmlService.createTemplateFromFile('AtomPage');
  tmpl.title      = title;
  tmpl.content    = content;
  tmpl.theme      = theme;
  tmpl.sidebar    = false;
  tmpl.schemaJson = JSON.stringify(payload).replace(/<\//g, '<\\/');
  tmpl.navSlug    = '';
  tmpl.fromSlug   = '';
  tmpl.webAppUrl  = _getWebAppUrl();
  return tmpl.evaluate()
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─────────────────────────────────────────────────────────────────────────────

function _renderFromPayload(payload, from) {
  try {
    if (!Array.isArray(payload) && payload.type === 'a2ui_wired_surface') {
      return _renderWiredSurface(payload);
    }
    var blocks  = Array.isArray(payload) ? payload : (payload.blocks || []);
    var title   = (Array.isArray(payload) ? '' : payload.title) || 'A2UI Page';
    var theme   = (Array.isArray(payload) ? 'light' : payload.theme) || 'light';

    // Register hub + cascade-save module pages into ScriptProperties.
    // hub_slug (explicit field) takes precedence over title-derived slug for stable back-nav.
    var hasModuleMap = blocks.some(function(b) { return b.type === 'module_map'; });
    if (hasModuleMap && !from) {
      var autoSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '');
      var hubSlug  = (!Array.isArray(payload) && payload.hub_slug)
        ? payload.hub_slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
        : autoSlug;
      if (hubSlug) {
        try {
          var props   = PropertiesService.getScriptProperties();
          var hubEnc  = Utilities.base64EncodeWebSafe(
            Utilities.gzip(Utilities.newBlob(JSON.stringify(payload), 'application/json')).getBytes()
          ).replace(/=+$/, '');
          var hubMeta = JSON.stringify({ title: title, encoded: hubEnc, saved: new Date().toISOString() });
          // Always overwrite when hub_slug is explicit; first-visit-only for title-derived slugs
          if (hubMeta.length <= 9000 && (payload.hub_slug || !props.getProperty('nav:' + hubSlug))) {
            props.setProperty('nav:' + hubSlug, hubMeta);
          }
          _CURRENT_NAV_SLUG = hubSlug;
          // Cascade-save module pages so ?nav=<module.id> resolves even when modules used url fields
          blocks.forEach(function(b) {
            if (b.type !== 'module_map') return;
            (b.modules || []).forEach(function(m) {
              if (!m.page || !m.page.length || !m.id) return;
              try {
                var modPayload = { title: m.title || m.id, theme: theme, hub_slug: hubSlug, blocks: m.page };
                var modEnc     = Utilities.base64EncodeWebSafe(
                  Utilities.gzip(Utilities.newBlob(JSON.stringify(modPayload), 'application/json')).getBytes()
                ).replace(/=+$/, '');
                var modMeta    = JSON.stringify({ title: m.title || m.id, encoded: modEnc, saved: new Date().toISOString() });
                if (modMeta.length <= 9000) props.setProperty('nav:' + m.id, modMeta);
              } catch(me) {}
            });
          });
        } catch(e) {}
      }
    }

    var content = renderAtoms(blocks, { theme: theme });

    // Use fullscreen template for fullscreen airspace atoms, multi_surface, or any playbook containing one
    var needsFullscreen = blocks.some(function(b) {
      if (b.type === 'airspace_command_deck' && b.height === 'fullscreen') return true;
      if (b.type === 'multi_surface') return true;
      if (b.type === 'geo_europe_airspace') return true;
      if (b.type === 'geo_iso_takeoff') return true;
      if (b.type === 'geo_iso_rocket_launch') return true;
      if (b.type === 'geo_iso_heli_hover') return true;
      if (b.type === 'geo_iso_fleet') return true;
      if (b.type === 'playbook') {
        var allSlides = (b.slides || []);
        return allSlides.some(function(s) {
          return (s.blocks || []).some(function(sb) {
            return sb.type === 'airspace_command_deck' && sb.height === 'fullscreen';
          });
        });
      }
      return false;
    });

    if (needsFullscreen) {
      return _renderFullscreenHtml(title, content);
    }

    var tmpl        = HtmlService.createTemplateFromFile('AtomPage');
    tmpl.title      = title;
    tmpl.content    = content;
    tmpl.theme      = theme;
    tmpl.sidebar    = false;
    tmpl.schemaJson = JSON.stringify(payload).replace(/<\//g, '<\\/');
    tmpl.navSlug    = '';
    tmpl.fromSlug   = from || '';
    tmpl.webAppUrl  = _getWebAppUrl();
    return tmpl.evaluate()
      .setTitle(title)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return _errorPage(err.message);
  }
}

/**
 * Render the AirspaceFullscreen HTML template without spawning a nested worker.
 * In gas-fakes, HtmlTemplate.evaluate() spawns a second Worker thread inside the
 * already-running page Worker (each loads all .gs files fresh). Replacing with direct
 * string injection eliminates the nested spawn and is safe because AirspaceFullscreen.html
 * only has two scriptlets: <?= title ?> (escaped) and <?!= content ?> (raw).
 */
function _renderFullscreenHtml(title, content) {
  var html = HtmlService.createHtmlOutputFromFile('AirspaceFullscreen').getContent();
  var safe = (title || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  html = html.replace('<?= title ?>', safe).replace('<?!= content ?>', content || '');
  return HtmlService.createHtmlOutput(html)
    .setTitle(title || '')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _debugPage(target) {
  var lines = [];

  function probe(label, url, parse) {
    var t = Date.now();
    try {
      var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      var ms = Date.now() - t;
      var code = r.getResponseCode();
      var body = r.getContentText().trim();
      var ok = code >= 200 && code < 300;
      var preview = body.slice(0, 120).replace(/\n/g, ' ');
      lines.push((ok ? '✓' : '✗') + ' ' + label + ' — HTTP ' + code + ' (' + ms + 'ms)');
      if (ok && parse) {
        try { lines.push('  → ' + parse(body)); } catch(e) { lines.push('  parse err: ' + e.message); }
      } else if (!ok) {
        lines.push('  ' + preview);
      }
    } catch(e) {
      lines.push('✗ ' + label + ' — FAILED: ' + e.message.slice(0, 100));
    }
  }

  // ── ADS-B candidates ──────────────────────────────────────────────────────
  lines.push('=== ADS-B SOURCES ===');
  probe('adsb.lol (radius)',
    'https://api.adsb.lol/v2/lat/43.629/lon/1.363/dist/40',
    function(b) { var d=JSON.parse(b); return (d.ac||[]).length + ' aircraft'; });
  probe('airplanes.live (radius)',
    'https://api.airplanes.live/v2/lat/43.629/lon/1.363/dist/40',
    function(b) { var d=JSON.parse(b); return (d.ac||[]).length + ' aircraft'; });
  probe('opensky-network.org (bbox)',
    'https://opensky-network.org/api/states/all?lamin=43.1&lomin=0.7&lamax=44.2&lomax=2.0',
    function(b) { var d=JSON.parse(b); return (d.states||[]).length + ' states'; });
  probe('fr24 (via public feed)',
    'https://data-live.flightradar24.com/zones/fcgi/feed.js?bounds=44.2,43.1,0.7,2.0&faa=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=0&maxage=14400&gliders=0&stats=0',
    function(b) { var d=JSON.parse(b); return Object.keys(d).filter(function(k){return Array.isArray(d[k]);}).length + ' flights'; });

  lines.push('');

  // ── METAR candidates ──────────────────────────────────────────────────────
  lines.push('=== METAR SOURCES ===');
  probe('aviationweather.gov (api)',
    'https://aviationweather.gov/api/data/metar?ids=LFBO&format=raw&hours=1',
    function(b) { return b.split('\n')[0].trim().slice(0,80); });
  probe('aviationweather.gov (cgi)',
    'https://aviationweather.gov/cgi-bin/data/metar.php?ids=LFBO&hours=1&order=id,-obs&sep=true',
    function(b) { return b.trim().slice(0,80); });
  probe('NOAA tgftp (text file)',
    'https://tgftp.nws.noaa.gov/data/observations/metar/stations/LFBO.TXT',
    function(b) { return b.trim().split('\n').pop().trim().slice(0,80); });
  probe('vatsim metar',
    'https://metar.vatsim.net/metar.php?id=LFBO',
    function(b) { return b.trim().slice(0,80); });

  var escaped = lines.join('\n')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>body{background:#050810;color:#00f2ff;font-family:"Courier New",monospace;' +
    'padding:40px;font-size:0.8rem;line-height:1.9;margin:0;}' +
    'h2{color:#00ff41;margin-bottom:20px;font-size:1rem;letter-spacing:0.1em;}' +
    'pre{white-space:pre-wrap;word-break:break-all;}' +
    'footer{opacity:0.35;font-size:0.65rem;margin-top:24px;display:block;}</style>' +
    '</head><body><h2>A2UI — API CONNECTIVITY PROBE</h2>' +
    '<pre>' + escaped + '</pre>' +
    '<footer>checkmark = reachable from GAS   x = blocked/failed</footer>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('A2UI Debug');
}

function _errorPage(msg) {
  return HtmlService.createHtmlOutput(
    '<body style="font-family:monospace;padding:40px;background:#0a0f1e;color:#ef4444">' +
    '<h2>Render error</h2><pre>' + msg + '</pre>' +
    '<p><a href="' + ScriptApp.getService().getUrl() + '" style="color:#60a5fa">← Back to generator</a></p>' +
    '</body>'
  ).setTitle('Render error');
}

// ── Screenshot / LinkedIn card page ──────────────────────────────────────────

function _renderScreenshotPage(encoded) {
  try {
    var padded = encoded;
    while (padded.length % 4 !== 0) padded += '=';
    var bytes = Utilities.base64DecodeWebSafe(padded);
    var json;
    if (bytes.length >= 2 && bytes[0] === 31 && (bytes[1] & 0xFF) === 139) {
      json = Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip')).getDataAsString();
    } else {
      json = Utilities.newBlob(bytes).getDataAsString();
    }
    var payload = JSON.parse(json);
    var blocks  = Array.isArray(payload) ? payload : (payload.blocks || []);
    var content = renderAtoms(blocks, { theme: 'light' });
    var tmpl = HtmlService.createTemplateFromFile('LinkedInPage');
    tmpl.content = content;
    return tmpl.evaluate()
      .setTitle('LinkedIn Card')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return _errorPage(err.message);
  }
}

// ── Named page nav system ─────────────────────────────────────────────────────

function _getWebAppUrl() {
  try { return ScriptApp.getService().getUrl(); } catch(e) { return ''; }
}

// Save a page under a slug. Accepts the same gzip+base64 encoded string
// that callGemini() returns as `encoded`. Callable from PageBuilder via google.script.run.
function a2uiNavSave(slug, title, encoded) {
  if (!slug || !encoded) return { error: 'slug and encoded are required' };
  slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  var props = PropertiesService.getScriptProperties();
  var meta  = JSON.stringify({ title: title || slug, encoded: encoded, saved: new Date().toISOString() });
  if (meta.length > 9000) return { error: 'Page payload too large to store (' + meta.length + ' chars). Try fewer atoms.' };
  props.setProperty('nav:' + slug, meta);
  return { url: _getWebAppUrl() + '?nav=' + slug, slug: slug };
}

// List all saved named pages. Callable from PageBuilder.
function a2uiNavList() {
  var props = PropertiesService.getScriptProperties();
  var all   = props.getProperties();
  return Object.keys(all)
    .filter(function(k) { return k.indexOf('nav:') === 0; })
    .map(function(k) {
      try {
        var m = JSON.parse(all[k]);
        return { slug: k.slice(4), title: m.title, saved: m.saved };
      } catch(e) { return { slug: k.slice(4), title: k.slice(4), saved: '' }; }
    })
    .sort(function(a, b) { return b.saved.localeCompare(a.saved); });
}

// Delete a named page.
function a2uiNavDelete(slug) {
  PropertiesService.getScriptProperties().deleteProperty('nav:' + slug);
  return true;
}

// Serve a named page, with optional from-slug for the back button.
function _renderNamedPage(slug, from) {
  _CURRENT_NAV_SLUG = slug; // allows module_map to stamp &from=<slug> on child ?p= URLs
  var props = PropertiesService.getScriptProperties();
  var raw   = props.getProperty('nav:' + slug);
  if (!raw) return _errorPage('Page not found: "' + slug + '". Save it first via the Page Builder.');
  try {
    var meta    = JSON.parse(raw);
    var decoded = _renderFromParam(meta.encoded);
    // _renderFromParam returns an HtmlOutput — we need to re-render with nav context
    // Re-decode to get the payload JSON and render properly with nav vars
    var enc     = meta.encoded;
    var padded  = enc;
    while (padded.length % 4 !== 0) padded += '=';
    var bytes   = Utilities.base64DecodeWebSafe(padded);
    var json    = (bytes.length >= 2 && bytes[0] === 31 && (bytes[1] & 0xFF) === 139)
      ? Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip')).getDataAsString()
      : Utilities.newBlob(bytes).getDataAsString();
    var payload = JSON.parse(json);
    var blocks  = Array.isArray(payload) ? payload : (payload.blocks || []);
    var title   = meta.title || payload.title || slug;
    var theme   = (Array.isArray(payload) ? 'light' : payload.theme) || 'light';
    var content = renderAtoms(blocks, { theme: theme });
    var webAppUrl = _getWebAppUrl();

    var tmpl        = HtmlService.createTemplateFromFile('AtomPage');
    tmpl.title      = title;
    tmpl.content    = content;
    tmpl.theme      = theme;
    tmpl.sidebar    = false;
    tmpl.schemaJson = JSON.stringify(payload).replace(/<\//g, '<\\/');
    tmpl.navSlug    = slug;
    tmpl.fromSlug   = from || '';
    tmpl.webAppUrl  = webAppUrl;
    return tmpl.evaluate()
      .setTitle(title)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch(err) {
    return _errorPage('Failed to render "' + slug + '": ' + err.message);
  }
}

/** Called by AtomPage.html to include partial files. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Export the renderer script to the deployer's Drive under "a2ui apps script exports",
 * shared with anyone-with-link so users can open it and File > Make a copy.
 * Returns { url, name } on success or { error } on failure.
 */
function exportScript() {
  try {
    var folderName = 'a2ui apps script exports';
    var copyName   = 'A2UI Schema Renderer';

    // Get or create the exports folder
    var fi = DriveApp.getFoldersByName(folderName);
    var folder = fi.hasNext() ? fi.next() : DriveApp.createFolder(folderName);

    // Reuse existing copy if already exported (avoid duplicates)
    var existing = folder.getFilesByName(copyName);
    var copy = existing.hasNext() ? existing.next() : DriveApp.getFileById(ScriptApp.getScriptId()).makeCopy(copyName, folder);

    // Share with anyone who has the link (view only — they can File > Make a copy)
    copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return { url: copy.getUrl(), name: copyName };
  } catch (e) {
    return { error: e.toString() };
  }
}

// ── Toulouse Airspace Command Deck ────────────────────────────────────────────

/**
 * Generic surface fetch callable from the client via google.script.run.fetchDataSource().
 * This is the GAS surface transport layer for all data_source / adsb_feed / metar_feed atoms.
 * On other surfaces (browser fetch, Python requests) this function would not exist —
 * the atom's client-side JS would call the appropriate transport directly.
 */
function fetchDataSource(url, format, path) {
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var text = resp.getContentText();
    var data = format === 'json' ? JSON.parse(text) : text.trim();
    if (path) path.split('.').forEach(function(k) { if (data && k) data = data[k]; });
    return data;
  } catch (err) { return null; }
}

/** Kept for backward compatibility — thin wrapper around _parseMETAR + fetchDataSource. */
function fetchMETAR() {
  var raw = fetchDataSource(
    'https://aviationweather.gov/api/data/metar?ids=LFBO&format=raw&hours=1',
    'text', ''
  );
  return raw ? _parseMETAR(raw.split('\n')[0]) : { wind: '—', temp: '—', qnh: '—', raw: '' };
}

/** Renders one slide from the Toulouse Airspace playbook with live METAR interpolation. */
function _renderAirspaceSlide(slideId) {
  var playbook = _getToulousePlaybook();
  var slide    = null;
  for (var i = 0; i < playbook.length; i++) {
    if (!slideId || playbook[i].id === slideId) { slide = playbook[i]; break; }
  }
  if (!slide) slide = playbook[0];

  var wx   = fetchMETAR();
  var tags = {
    '{{weather.wind}}':     wx.wind,
    '{{weather.temp}}':     wx.temp,
    '{{weather.pressure}}': wx.qnh,
    '{{weather.raw}}':      wx.raw
  };

  function interp(val) {
    if (typeof val !== 'string') return val;
    for (var tag in tags) val = val.split(tag).join(tags[tag]);
    return val;
  }

  var block = { type: 'airspace_command_deck' };
  var skip  = { id: 1, label: 1, template: 1, data: 1 };
  for (var key in slide) {
    if (skip[key]) continue;
    var v = slide[key];
    if (typeof v === 'string') v = interp(v);
    else if (Array.isArray(v)) v = v.map(function(x) { return interp(x); });
    block[key] = v;
  }

  var baseUrl = ScriptApp.getService().getUrl();
  var nav = '<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
    'display:flex;gap:8px;z-index:999;flex-wrap:wrap;justify-content:center;' +
    'background:rgba(0,0,0,0.8);border:1px solid rgba(0,242,255,0.18);' +
    'border-radius:10px;padding:8px 14px;backdrop-filter:blur(12px);">';
  for (var si = 0; si < playbook.length; si++) {
    var s   = playbook[si];
    var act = s.id === slide.id;
    nav += '<a href="' + baseUrl + '?slide=' + s.id + '" ' +
      'style="font-family:\'Courier New\',monospace;font-size:0.75rem;' +
      'padding:6px 14px;border-radius:6px;text-decoration:none;white-space:nowrap;' +
      'background:' + (act ? 'rgba(0,242,255,0.18)' : 'transparent') + ';' +
      'border:1px solid ' + (act ? 'rgba(0,242,255,0.5)' : 'rgba(255,255,255,0.1)') + ';' +
      'color:' + (act ? '#00f2ff' : 'rgba(255,255,255,0.5)') + ';' +
      'transition:all 0.15s;">' +
      _esc(s.label || s.id) + '</a>';
  }
  nav += '</div>';

  block.height         = 'fullscreen';
  block.data_source    = 'adsb';
  block.weather_source = 'metar_lfbo';

  // Data atoms first — they run server-side fetches and set up client refresh.
  // Visual atom subscribes to the named feeds via window.A2UI_CALLBACKS.
  var blocks = [
    { type: 'adsb_feed',   name: 'adsb',      refresh: 15 },
    { type: 'metar_feed',  name: 'metar_lfbo', station: 'LFBO', refresh: 60 },
    block
  ];
  var slideTitle = slide.chyron_title || 'Toulouse Airspace';
  var content    = renderAtoms(blocks, { theme: 'dark' }) + nav;
  return _renderFullscreenHtml(slideTitle, content);
}

/**
 * Renders a slide from a base64-encoded playbook passed in the URL.
 * URL format: ?deck=BASE64&slide=SLIDE_ID
 * Nav links embed the same BASE64 so the deck is fully self-contained.
 */
function _renderDeckSlide(deckEncoded, slideId) {
  var playbook;
  try {
    var bytes = Utilities.base64Decode(deckEncoded, Utilities.Charset.UTF_8);
    playbook  = JSON.parse(Utilities.newBlob(bytes).getDataAsString());
  } catch(e) { return _errorPage('Invalid deck encoding: ' + e.message); }

  var slide = null;
  for (var i = 0; i < playbook.length; i++) {
    if (!slideId || playbook[i].id === slideId) { slide = playbook[i]; break; }
  }
  if (!slide) slide = playbook[0];

  var wx   = fetchMETAR();
  var tags = {
    '{{weather.wind}}':     wx.wind,
    '{{weather.temp}}':     wx.temp,
    '{{weather.pressure}}': wx.qnh,
    '{{weather.raw}}':      wx.raw
  };
  function interp(val) {
    if (typeof val !== 'string') return val;
    for (var tag in tags) val = val.split(tag).join(tags[tag]);
    return val;
  }

  var block = { type: 'airspace_command_deck', height: 'fullscreen',
                data_source: 'adsb', weather_source: 'metar_lfbo' };
  var skip  = { id: 1, label: 1, template: 1 };
  for (var key in slide) {
    if (skip[key]) continue;
    var v = slide[key];
    if (typeof v === 'string') v = interp(v);
    else if (Array.isArray(v)) v = v.map(function(x) { return interp(x); });
    block[key] = v;
  }

  var baseUrl = ScriptApp.getService().getUrl();
  var nav = '<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
    'display:flex;gap:8px;z-index:999;flex-wrap:wrap;justify-content:center;' +
    'background:rgba(0,0,0,0.8);border:1px solid rgba(0,242,255,0.18);' +
    'border-radius:10px;padding:8px 14px;backdrop-filter:blur(12px);">';
  for (var si = 0; si < playbook.length; si++) {
    var s   = playbook[si];
    var act = s.id === slide.id;
    nav += '<a href="' + baseUrl + '?deck=' + deckEncoded + '&slide=' + s.id + '" ' +
      'style="font-family:\'Courier New\',monospace;font-size:0.75rem;' +
      'padding:6px 14px;border-radius:6px;text-decoration:none;white-space:nowrap;' +
      'background:' + (act ? 'rgba(0,242,255,0.18)' : 'transparent') + ';' +
      'border:1px solid ' + (act ? 'rgba(0,242,255,0.5)' : 'rgba(255,255,255,0.1)') + ';' +
      'color:' + (act ? '#00f2ff' : 'rgba(255,255,255,0.5)') + ';' +
      'transition:all 0.15s;">' + _esc(s.label || s.id) + '</a>';
  }
  nav += '</div>';

  var blocks  = [
    { type: 'adsb_feed',  name: 'adsb',       refresh: 15 },
    { type: 'metar_feed', name: 'metar_lfbo',  station: 'LFBO', refresh: 60 },
    block
  ];
  var content    = renderAtoms(blocks, { theme: 'dark' }) + nav;
  var deckTitle  = slide.chyron_title || slide.label || 'Airspace';
  return _renderFullscreenHtml(deckTitle, content);
}

/** ?makeDeck — encodes the Toulouse playbook and returns the shareable ?deck= URL. */
function _makeDeckPage() {
  var playbook = _getToulousePlaybook();
  var encoded  = Utilities.base64EncodeWebSafe(
    Utilities.newBlob(JSON.stringify(playbook)).getBytes()
  );
  var base     = ScriptApp.getService().getUrl();
  var url      = base + '?deck=' + encoded;
  var lines    = ['Shareable deck URL (open any slide by appending &slide=ID):', '', url, ''];
  playbook.forEach(function(s) {
    lines.push(s.id + ':');
    lines.push('  ' + url + '&slide=' + s.id);
    lines.push('');
  });
  var escaped = lines.join('\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>body{background:#050810;color:#00f2ff;font-family:"Courier New",monospace;' +
    'padding:40px;font-size:0.8rem;line-height:1.8;margin:0;}' +
    'h2{color:#00ff41;margin-bottom:20px;}pre{white-space:pre-wrap;word-break:break-all;}</style>' +
    '</head><body><h2>A2UI — DECK ENCODER</h2><pre>' + escaped + '</pre></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Deck URL');
}

/** Inline compiled playbook — source of truth is toulouse_airspace.yaml */
function _getToulousePlaybook() {
  return [
    {
      id: 'calibration', label: '📡 Sweep Calibration', template: 'airspace_command_deck',
      show_slate: true,
      slate_title: '📡 TLS Sector 32L/R Sweep Calibration',
      slate_description: 'Booting transponder tracking matrix and aligning primary S-Band receivers...'
    },
    {
      id: 'clean_deck', label: '✈️ Live Traffic', template: 'airspace_command_deck',
      zoom: 35, chyron_title: 'LFBO TMA — LIVE TRAFFIC',
      chyron_subtitle: 'Runway 32L/R Active • {{weather.wind}} • QNH {{weather.pressure}}',
      ticker_text: '✈️ TOULOUSE BLAGNAC APPROACH CONTROL • RUNWAY 32L/R ACTIVE • SURFACE WIND: {{weather.wind}} • TEMP: {{weather.temp}} • QNH: {{weather.pressure}} • RAW METAR: {{weather.raw}} •',
      ticker_speed: 45
    },
    {
      id: 'supervisor_deck', label: '📡 Sector Control', template: 'airspace_command_deck',
      zoom: 35, panel_type: 'supervisor', panel_title: '📡 Tactical Supervisor HUD',
      chyron_title: 'LFBO TMA APPROACH CONTROL',
      chyron_subtitle: 'Active Approach Vectors Runway 32L/R',
      ticker_text: '📍 LFBO Terminal Information • RUNWAY 32L/R ACTIVE • SURFACE WIND: {{weather.wind}} • TEMP: {{weather.temp}} • QNH: {{weather.pressure}} • RAW METAR: {{weather.raw}} •',
      ticker_speed: 50
    },
    {
      id: 'locked_target', label: '🎯 Target Lock AFR6129', template: 'airspace_command_deck',
      zoom: 22, panel_type: 'target', panel_title: '🎯 Active Target Profiler',
      lockedCallsign: 'AFR6129',
      chyron_title: 'TARGET ACQUIRED: AFR6129',
      chyron_subtitle: 'Tracking Descent Profile and Instrument Glide Slope Runway 32L',
      ticker_text: '📍 LFBO Terminal Information • RUNWAY 32L/R ACTIVE • SURFACE WIND: {{weather.wind}} • TEMP: {{weather.temp}} • QNH: {{weather.pressure}} • RAW METAR: {{weather.raw}} •',
      ticker_speed: 50
    },
    {
      id: 'corridor_map', label: '🗺️ Airway Map', template: 'airspace_command_deck',
      zoom: 35, panel_type: 'supervisor', panel_title: '📡 Supervisor Live Console',
      chyron_title: 'LFBO TMA AIRWAY NETWORKS',
      chyron_subtitle: 'Standard Terminal Arrival Paths & Intercept Vectors Map',
      ticker_text: '📍 LFBO Terminal Information • RUNWAY 32L/R ACTIVE • SURFACE WIND: {{weather.wind}} • TEMP: {{weather.temp}} • QNH: {{weather.pressure}} • RAW METAR: {{weather.raw}} •',
      ticker_speed: 50
    },
    {
      id: 'separation_poll', label: '🗳️ Separation Poll', template: 'airspace_command_deck',
      zoom: 35, panel_type: 'supervisor', panel_title: '📡 Supervisor Live Console',
      chyron_title: 'TMA CONFLICT RESOLUTION',
      chyron_subtitle: 'Select separation maneuvers and runway vector allocation',
      ticker_text: '📍 LFBO Terminal Information • RUNWAY 32L/R ACTIVE • SURFACE WIND: {{weather.wind}} • TEMP: {{weather.temp}} • QNH: {{weather.pressure}} • RAW METAR: {{weather.raw}} •',
      ticker_speed: 50,
      poll_question: 'TMA Direction: Resolve separation conflict? 🗳️',
      poll_options: [
        'Establish parallel simultaneous visual arrivals Runway 32L/R',
        'Vector RYR109B to enter holding pattern at TOU VOR',
        'Instruct EZY4218 to reduce speed to minimum 180kt'
      ],
      poll_values: [12, 8, 4]
    }
  ];
}

// ── A2UI Page Builder — Vertex AI Gemini endpoint ────────────────────────────

// Rejects Gemini output that contains module_map entries with url fields but no page arrays.
// Throwing here causes google.script.run to call withFailureHandler with an actionable message.
function validateGeminiLMSOutput(pageJson) {
  var blocks = Array.isArray(pageJson) ? pageJson : (pageJson.blocks || []);
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== 'module_map') continue;
    var modules = blocks[i].modules || [];
    for (var j = 0; j < modules.length; j++) {
      var m = modules[j];
      if (m.url && !m.page) {
        throw new Error(
          'LMS output rejected: module "' + (m.title || m.id || j) + '" has url: "' + m.url + '" with no inline page blocks. ' +
          'Add "every module must use a page array of atoms, not a url field" to your prompt and regenerate.'
        );
      }
    }
  }
}

var _GEMINI_PROJECT  = 'weighty-arcadia-196219';
var _GEMINI_LOCATION = 'us-central1';
var _GEMINI_MODEL    = 'gemini-2.5-pro';

var _BUILDER_SYSTEM_PROMPT_BASE = `You are the A2UI Page Builder. You output ONLY a valid JSON payload — no prose, no markdown fences, no explanation.

## Output format

{
  "title": "Page title",
  "theme": "light" | "dark",
  "blocks": [ ...atom blocks... ]
}

## Theme

Choose theme based on content feel — not always light:
- "dark" for technical demos, visualisations, dashboards, aviation/space topics, anything with a cinematic or dramatic tone
- "light" for documentation, learning modules, reference pages, editorial content

## Atom schema

Every block must have a "type" field exactly matching one of the type names listed below. All text fields support **bold**, *italic*, and [link](url) markdown.

`;

// Full system prompt is built at call time: base + live atom schema snapshot
function _buildSystemPrompt() {
  return _BUILDER_SYSTEM_PROMPT_BASE + _ATOM_SCHEMA_SNAPSHOT +
    '\n\n## Rules\n\n' +
    '1. Output ONLY the JSON object. No ```json fences. No preamble. No commentary.\n' +
    '2. The JSON must parse cleanly — no trailing commas, no comments inside the JSON.\n' +
    '3. SCAN the full schema before writing any block. Use the most specialised atom available — never reach for heading/body when a richer atom fits:\n' +
    '   • code / commands → code (language + content)\n' +
    '   • numbered how-to → steps\n' +
    '   • metrics / stats → animated_counter or stat_card\n' +
    '   • model comparison → llm_comparison_table + model_card\n' +
    '   • chronological → timeline\n' +
    '   • feature grid → bento_grid or feature_grid\n' +
    '   • pros/cons → pros_cons_list\n' +
    '   • recall / quiz → quiz_question or flip_card\n' +
    '   • gamified → xp_bar + achievement_badge\n' +
    '   • CLI output → terminal_block\n' +
    '   • hero moment → typewriter_text\n' +
    '   • aviation / aircraft data → stat_card, animated_counter, steps, timeline (use dark theme)\n' +
    '   • course / LMS / learning app → see rule 8 below\n' +
    '4. Every page must use at least 4 specialised atoms. A page of only heading/body/subheading blocks is a failure.\n' +
    '5. PAGE SHAPE IS CONTENT-DRIVEN — there is no fixed template. A dashboard leads with animated_counter. A comparison leads with llm_comparison_table. A narrative leads with typewriter_text. A quiz leads with quiz_question. A technical reference leads with code blocks and terminal_block. Match the opening atom to what the content IS, not to a generic learning-module arc.\n' +
    '6. Each page should feel distinct from every other page. Vary tone, theme, structure, and atom selection based on the subject matter.\n' +
    '7. Never invent atom types not listed in the schema above.\n' +
    '8. COURSE / LMS PAGES — apply ALL of these rules whenever the request is for a course, learning app, training module, or multi-section educational experience:\n' +
    '   a. ALWAYS place progress_store as the FIRST block (course_id: a short kebab-case id like "gen-ai-pro").\n' +
    '   b. CRITICAL NAVIGATION RULE (violations are caught by a validator and will reject your output): EVERY module in module_map MUST have a "page" field (array of atom blocks). NEVER output a "url" key pointing to "?nav=..." — this causes 404 Page Not Found errors at runtime.\n' +
    '      ❌ ANTI-PATTERN — NEVER DO THIS (will be rejected):\n' +
    '      {"type":"module_map","modules":[{"id":"mod1","title":"Module 1","url":"?nav=gen-ai-mod1"}]}\n' +
    '      ✓ CORRECT: use "page": [...atom blocks...] as shown in rule 8c. The page array is server-encoded at render time — no manual saves required.\n' +
    '   b2. ALWAYS add a root-level "hub_slug" field to the hub page JSON equal to the course_id used in progress_store (e.g., "hub_slug": "gen-ai-hub"). This makes back-navigation deterministic regardless of the page title.\n' +
    '   c. CONCRETE EXAMPLE of correct module_map with page blocks (your output must follow this exact structure):\n' +
    '      {"type":"module_map","title":"Course Modules","modules":[{"id":"mod1","title":"Introduction","icon":"🧠","description":"Core concepts","duration":"20 min","lessons":3,"page":[{"type":"progress_store","course_id":"my-course"},{"type":"nav_bar","sticky":true,"links":[{"nav_slug":"my-course-hub","label":"← Hub","icon":"🏠"}]},{"type":"annotation_highlight","text":"Key concept here...","notes":[{"term":"concept","explanation":"What it means","color":"#6366f1"}]},{"type":"knowledge_check","question":"What is X?","options":["Wrong","Correct","Wrong","Wrong"],"correct":1,"explanation":"Because Y."},{"type":"nav_link","nav_slug":"my-course-hub","label":"← Back to Hub","style":"ghost"}]},{"id":"mod2","title":"Module 2","icon":"⚙️","description":"Next topic","duration":"25 min","lessons":4,"required":["mod1"],"page":[{"type":"progress_store","course_id":"my-course"},{"type":"nav_bar","sticky":true,"links":[{"nav_slug":"my-course-hub","label":"← Hub","icon":"🏠"}]},{"type":"dark_hero","headline":"Module 2 Coming Soon","subheadline":"Complete Module 1 first."},{"type":"nav_link","nav_slug":"my-course-hub","label":"← Back to Hub","style":"ghost"}]}]}\n' +
    '   d. Hub nav_slug used in module page: nav_bar and nav_link must be the slug you tell the user to save the hub as (derive from the course title, e.g. "gen-ai-hub", "python-hub", "sales-hub").\n' +
    '   e. The first module must be fully built with real educational content. Subsequent modules can be stubs (dark_hero "Coming soon" + nav_link back) unless the prompt asks for full content.\n' +
    '   f. Hub page block order: progress_store → [optional: learning_path_selector] → module_map → badge_showcase → certification_card (requires: <final-module-id>).\n' +
    '   g. badge_showcase: one badge per module, required_id matches the module id in module_map.\n' +
    '   h. certification_card: requires the final module id.\n' +
    '   i. Dark theme for all LMS pages.';
}

function callGemini(userPrompt, options) {
  options = options || {};
  var selectedAtoms   = options.selectedAtoms   || [];
  var workspaceContext = options.workspaceContext || null;

  // Enhance the prompt with atom requirements and live workspace data
  var enhancedPrompt = userPrompt;
  if (selectedAtoms.length > 0) {
    enhancedPrompt += '\n\nREQUIRED ATOMS: You MUST include ALL of these atom types somewhere in the page: ' +
      selectedAtoms.join(', ') + '. Build the content and structure around them — do not omit any.';
  }
  if (workspaceContext) {
    enhancedPrompt += '\n\nLIVE WORKSPACE CONTEXT — use this real data to personalise the page:\n' +
      JSON.stringify(workspaceContext);
  }

  var endpoint = 'https://' + _GEMINI_LOCATION + '-aiplatform.googleapis.com/v1/projects/' +
    _GEMINI_PROJECT + '/locations/' + _GEMINI_LOCATION +
    '/publishers/google/models/' + _GEMINI_MODEL + ':generateContent';

  var payload = {
    systemInstruction: { parts: [{ text: _buildSystemPrompt() }] },
    contents: [{ role: 'user', parts: [{ text: enhancedPrompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 16384 }
  };

  var response = UrlFetchApp.fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    var err = response.getContentText();
    try { err = JSON.parse(err).error.message; } catch(e) {}
    throw new Error('Vertex AI ' + code + ': ' + err.substring(0, 300));
  }

  var result = JSON.parse(response.getContentText());
  var text = result.candidates[0].content.parts[0].text.trim();

  // Strip any accidental markdown fences
  text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  // Parse and validate — throws if Gemini returned malformed JSON or violated LMS rules
  var pageJson = JSON.parse(text);
  validateGeminiLMSOutput(pageJson);

  var pageTitle = (Array.isArray(pageJson) ? '' : pageJson.title) || '';

  // Extract token usage from Vertex AI response (2.5 has separate thoughtsTokenCount)
  var usage = result.usageMetadata || {};
  var tokens = {
    prompt:   usage.promptTokenCount     || 0,
    thinking: usage.thoughtsTokenCount   || 0,
    output:   usage.candidatesTokenCount || 0,
    total:    usage.totalTokenCount      || 0,
    model:    _GEMINI_MODEL
  };

  // Inject ai_build_trace block at the bottom of the generated page
  var blocks = Array.isArray(pageJson) ? pageJson : (pageJson.blocks || []);
  blocks.push({
    type:            'ai_build_trace',
    model:           tokens.model,
    prompt_tokens:   tokens.prompt,
    thinking_tokens: tokens.thinking,
    output_tokens:   tokens.output,
    total_tokens:    tokens.total
  });
  if (!Array.isArray(pageJson)) pageJson.blocks = blocks;

  // Gzip-compress then base64-encode — keeps URLs short even for large pages
  var jsonStr    = JSON.stringify(pageJson);
  var compressed = Utilities.gzip(Utilities.newBlob(jsonStr, 'application/json'));
  var encoded    = Utilities.base64EncodeWebSafe(compressed.getBytes()).replace(/=+$/, '');
  var url        = ScriptApp.getService().getUrl() + '?p=' + encoded;

  // Log this generation — non-fatal
  try {
    _logPage({
      prompt:      userPrompt,
      title:       pageTitle,
      url:         url,
      model:       tokens.model,
      prompt_tok:  tokens.prompt,
      thinking_tok: tokens.thinking,
      output_tok:  tokens.output,
      total_tok:   tokens.total
    });
  } catch(logErr) {}

  return { url: url, tokens: tokens, title: pageTitle, encoded: encoded };
}

// ── Page log (Google Sheets) ──────────────────────────────────────────────────

function _getOrCreateLogSheet() {
  var name = 'A2UI Builder Log';
  var files = DriveApp.getFilesByName(name);
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(name);
    var sheet = ss.getActiveSheet();
    sheet.setName('Log');
    sheet.appendRow(['timestamp','prompt','title','url','model',
                     'prompt_tok','thinking_tok','output_tok','total_tok']);
    sheet.setFrozenRows(1);
  }
  return ss.getSheets()[0];
}

function _logPage(entry) {
  var sheet = _getOrCreateLogSheet();
  sheet.appendRow([
    new Date().toISOString(),
    (entry.prompt || '').substring(0, 500),
    entry.title       || '',
    entry.url         || '',
    entry.model       || '',
    entry.prompt_tok  || 0,
    entry.thinking_tok || 0,
    entry.output_tok  || 0,
    entry.total_tok   || 0
  ]);
}

function getPageLog() {
  try {
    var files = DriveApp.getFilesByName('A2UI Builder Log');
    if (!files.hasNext()) return [];
    var ss    = SpreadsheetApp.open(files.next());
    var sheet = ss.getSheets()[0];
    var data  = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
    var rows = data.slice(1).reverse().slice(0, 20);
    return rows.map(function(r) {
      return {
        ts:      r[0] ? String(r[0]).substring(0, 19).replace('T',' ') : '',
        prompt:  String(r[1] || '').substring(0, 120),
        title:   String(r[2] || ''),
        url:     String(r[3] || ''),
        model:   String(r[4] || ''),
        total:   Number(r[8] || 0)
      };
    });
  } catch(e) { return []; }
}

// ── Workspace context ─────────────────────────────────────────────────────────

function getWorkspaceContext() {
  var ctx = { userEmail: '', userName: '', calendar: [], gmailUnread: 0 };
  try { ctx.userEmail = Session.getActiveUser().getEmail(); } catch(e) {}
  try { ctx.userName  = ctx.userEmail.split('@')[0]; } catch(e) {}
  try {
    var now     = new Date();
    var weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    var events  = CalendarApp.getDefaultCalendar().getEvents(now, weekEnd);
    ctx.calendar = events.slice(0, 8).map(function(ev) {
      return {
        title:    ev.getTitle(),
        start:    ev.getStartTime().toISOString(),
        end:      ev.getEndTime().toISOString(),
        location: ev.getLocation() || ''
      };
    });
  } catch(e) {}
  try { ctx.gmailUnread = GmailApp.getInboxUnreadCount(); } catch(e) {}
  return ctx;
}

// ── URL inspector / decoder ───────────────────────────────────────────────────

function encodePayload(jsonStr) {
  try {
    var obj = JSON.parse(jsonStr);
    var clean = JSON.stringify(obj);
    var enc = Utilities.base64EncodeWebSafe(
      Utilities.gzip(Utilities.newBlob(clean, 'application/json')).getBytes()
    ).replace(/=+$/, '');
    var url = _getWebAppUrl() + '?p=' + enc;
    return { url: url, encoded: enc };
  } catch(e) {
    return { error: e.message };
  }
}

function a2uiNavInspect(slug) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw   = props.getProperty('nav:' + slug);
    if (!raw) return { error: 'Not found: ' + slug };
    var payload = decodePageUrl(raw);
    return payload;
  } catch(e) {
    return { error: e.message };
  }
}

function a2uiNavRename(oldSlug, newSlug) {
  try {
    newSlug = newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!newSlug) return { error: 'Invalid slug' };
    var props = PropertiesService.getScriptProperties();
    var raw   = props.getProperty('nav:' + oldSlug);
    if (!raw) return { error: 'Not found: ' + oldSlug };
    if (props.getProperty('nav:' + newSlug)) return { error: 'Slug already exists: ' + newSlug };
    props.setProperty('nav:' + newSlug, raw);
    props.deleteProperty('nav:' + oldSlug);
    var url = _getWebAppUrl() + '?nav=' + newSlug;
    return { ok: true, slug: newSlug, url: url };
  } catch(e) {
    return { error: e.message };
  }
}

function decodePageUrl(encoded) {
  try {
    // Accept full URL or just the p= value
    var val = encoded.trim();
    var m   = val.match(/[?&]p=([^&]+)/);
    if (m) val = m[1];
    var padded = val;
    while (padded.length % 4 !== 0) padded += '=';
    var bytes = Utilities.base64DecodeWebSafe(padded);
    var json;
    if (bytes.length >= 2 && bytes[0] === 31 && (bytes[1] & 0xFF) === 139) {
      json = Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip')).getDataAsString();
    } else {
      json = Utilities.newBlob(bytes).getDataAsString();
    }
    var obj = JSON.parse(json);
    return { json: obj, raw: json };
  } catch(e) {
    return { error: e.message };
  }
}

// ── LMS Progress Store ────────────────────────────────────────────────────────
// Server-side read/write for progress_store atom.
// Each course gets its own Sheet named "A2UI Progress: <courseId>".
// Rows: [email, progress_json, updated_at]

function a2uiProgressRead(courseId) {
  try {
    var email = Session.getActiveUser().getEmail();
    var sheet = _lmsGetSheet_(courseId);
    var data  = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === email) {
        return JSON.parse(data[i][1] || '{}');
      }
    }
    return {};
  } catch(e) { return {}; }
}

function a2uiProgressWrite(courseId, progressData) {
  try {
    var email = Session.getActiveUser().getEmail();
    var sheet = _lmsGetSheet_(courseId);
    var data  = sheet.getDataRange().getValues();
    var json  = JSON.stringify(progressData);
    var now   = new Date().toISOString();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === email) {
        sheet.getRange(i + 1, 2, 1, 2).setValues([[json, now]]);
        return true;
      }
    }
    sheet.appendRow([email, json, now]);
    return true;
  } catch(e) { return false; }
}

function _lmsGetSheet_(courseId) {
  var name  = 'A2UI Progress: ' + courseId;
  var files = DriveApp.searchFiles(
    'title = "' + name.replace(/"/g, '\\"') + '" and ' +
    'mimeType = "application/vnd.google-apps.spreadsheet" and trashed = false'
  );
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next()).getActiveSheet();
  }
  var ss    = SpreadsheetApp.create(name);
  var sheet = ss.getActiveSheet();
  sheet.appendRow(['email', 'progress_json', 'updated_at']);
  sheet.setFrozenRows(1);
  return sheet;
}

// Read the full cohort progress for a course (instructor view).
// Returns array of {email, progress, updated_at}.
function a2uiCohortRead(courseId) {
  try {
    var sheet = _lmsGetSheet_(courseId);
    var data  = sheet.getDataRange().getValues();
    var rows  = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      var prog = {};
      try { prog = JSON.parse(data[i][1] || '{}'); } catch(e) {}
      rows.push({ email: data[i][0], progress: prog, updated_at: data[i][2] });
    }
    return rows;
  } catch(e) { return []; }
}

// Run this once in the GAS editor to authorize Drive + Sheets scopes
function authorizeScopes() {
  DriveApp.getRootFolder();
  SpreadsheetApp.getActiveSpreadsheet();
}

