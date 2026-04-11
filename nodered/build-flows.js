#!/usr/bin/env node
const fs   = require('fs');
const path = require('path');

const html    = fs.readFileSync(path.join(__dirname, 'configurator.html'), 'utf8');
const FLOW_ID = 'flow_arcgis_cfg';

const flows = [

  // ── Flow tab ──
  {
    id: FLOW_ID, type: 'tab',
    label: 'ArcGIS → TAK',
    disabled: false,
    info: 'Top: Configurator (/configurator). Bottom: sync engine (TLS + poll). Same tab so saved configs & TAK settings share one flow context.'
  },

  // ════════════════════════════════════════════════
  //  Configurator UI  (GET /configurator → HTML)
  // ════════════════════════════════════════════════
  {
    id: 'c_ui', type: 'comment', z: FLOW_ID,
    name: '── Configurator UI (/configurator) ──',
    info: '', x: 240, y: 40, wires: []
  },
  {
    id: 'hi_ui', type: 'http in', z: FLOW_ID,
    name: 'GET /configurator',
    url: '/configurator', method: 'get',
    upload: false, swaggerDoc: '',
    x: 170, y: 80, wires: [['t_ui']]
  },
  {
    id: 't_ui', type: 'template', z: FLOW_ID,
    name: 'Configurator HTML',
    field: 'payload', fieldType: 'msg',
    format: 'html', syntax: 'plain',
    template: html,
    output: 'str',
    x: 390, y: 80, wires: [['ho_ui']]
  },
  {
    id: 'ho_ui', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '200',
    headers: { 'content-type': 'text/html', 'cache-control': 'no-cache, no-store, must-revalidate' },
    x: 590, y: 80, wires: []
  },

  // ════════════════════════════════════════════════
  //  ArcGIS Proxy APIs  (browser → Node-RED → ArcGIS)
  // ════════════════════════════════════════════════
  {
    id: 'c_api', type: 'comment', z: FLOW_ID,
    name: '── ArcGIS Proxy APIs ──',
    info: '', x: 240, y: 160, wires: []
  },

  // POST /api/arcgis/service  →  fetch service metadata
  {
    id: 'hi_svc', type: 'http in', z: FLOW_ID,
    name: 'POST /api/arcgis/service',
    url: '/api/arcgis/service', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 200, wires: [['fn_svc']]
  },
  {
    id: 'fn_svc', type: 'function', z: FLOW_ID,
    name: 'Build service URL',
    func: [
      "const base = msg.payload.url.replace(/\\/+$/, '');",
      "msg.url = base + '?f=json';",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 200, wires: [['hr_svc']]
  },
  {
    id: 'hr_svc', type: 'http request', z: FLOW_ID,
    name: 'GET service info',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: '', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 620, y: 200, wires: [['fn_svc_parse']]
  },
  {
    id: 'fn_svc_parse', type: 'function', z: FLOW_ID,
    name: 'Parse service',
    func: [
      "if (msg.payload.error) {",
      "  msg.payload = { error: msg.payload.error.message || 'ArcGIS error' };",
      "} else {",
      "  msg.payload = {",
      "    layers: (msg.payload.layers || []).map(function(l) {",
      "      return { id: l.id, name: l.name, geometryType: l.geometryType || null };",
      "    })",
      "  };",
      "}",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 810, y: 200, wires: [['ho_svc']]
  },
  {
    id: 'ho_svc', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '', headers: {},
    x: 1000, y: 200, wires: []
  },

  // POST /api/arcgis/layer  →  fetch layer fields & geometry
  {
    id: 'hi_lyr', type: 'http in', z: FLOW_ID,
    name: 'POST /api/arcgis/layer',
    url: '/api/arcgis/layer', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 300, wires: [['fn_lyr']]
  },
  {
    id: 'fn_lyr', type: 'function', z: FLOW_ID,
    name: 'Build layer URL',
    func: [
      "const base = msg.payload.url.replace(/\\/+$/, '');",
      "msg.url = base + '/' + msg.payload.layerId + '?f=json';",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 300, wires: [['hr_lyr']]
  },
  {
    id: 'hr_lyr', type: 'http request', z: FLOW_ID,
    name: 'GET layer info',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: '', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 620, y: 300, wires: [['fn_lyr_parse']]
  },
  {
    id: 'fn_lyr_parse', type: 'function', z: FLOW_ID,
    name: 'Parse layer',
    func: [
      "if (msg.payload.error) {",
      "  msg.payload = { error: msg.payload.error.message || 'ArcGIS error' };",
      "} else {",
      "  msg.payload = {",
      "    name: msg.payload.name,",
      "    geometryType: msg.payload.geometryType,",
      "    fields: (msg.payload.fields || []).map(function(f) {",
      "      return { name: f.name, type: f.type, alias: f.alias || f.name };",
      "    })",
      "  };",
      "}",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 810, y: 300, wires: [['ho_lyr']]
  },
  {
    id: 'ho_lyr', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '', headers: {},
    x: 1000, y: 300, wires: []
  },

  // POST /api/arcgis/sample  →  fetch 5 sample features
  {
    id: 'hi_smp', type: 'http in', z: FLOW_ID,
    name: 'POST /api/arcgis/sample',
    url: '/api/arcgis/sample', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 400, wires: [['fn_smp']]
  },
  {
    id: 'fn_smp', type: 'function', z: FLOW_ID,
    name: 'Build sample query URL',
    func: [
      "const base = msg.payload.url.replace(/\\/+$/, '');",
      "const lid  = msg.payload.layerId;",
      "msg.url = base + '/' + lid + '/query?where=1%3D1&outFields=*&resultRecordCount=50&f=json';",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 400, wires: [['hr_smp']]
  },
  {
    id: 'hr_smp', type: 'http request', z: FLOW_ID,
    name: 'GET sample features',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: '', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 620, y: 400, wires: [['fn_smp_parse']]
  },
  {
    id: 'fn_smp_parse', type: 'function', z: FLOW_ID,
    name: 'Parse sample',
    func: [
      "if (msg.payload.error) {",
      "  msg.payload = { error: msg.payload.error.message || 'ArcGIS error' };",
      "} else {",
      "  msg.payload = { features: (msg.payload.features || []).slice(0, 50) };",
      "}",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 810, y: 400, wires: [['ho_smp']]
  },
  {
    id: 'ho_smp', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '', headers: {},
    x: 1000, y: 400, wires: []
  },

  // POST /api/arcgis/distinct  →  fetch distinct values for a field
  {
    id: 'hi_dist', type: 'http in', z: FLOW_ID,
    name: 'POST /api/arcgis/distinct',
    url: '/api/arcgis/distinct', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 500, wires: [['fn_dist']]
  },
  {
    id: 'fn_dist', type: 'function', z: FLOW_ID,
    name: 'Build distinct query URL',
    func: [
      "const base  = msg.payload.url.replace(/\\/+$/, '');",
      "const lid   = msg.payload.layerId;",
      "const field = encodeURIComponent(msg.payload.field);",
      "msg.url = base + '/' + lid + '/query'",
      "  + '?where=1%3D1'",
      "  + '&outFields=' + field",
      "  + '&returnDistinctValues=true'",
      "  + '&orderByFields=' + field",
      "  + '&resultRecordCount=500'",
      "  + '&f=json';",
      "msg._field = msg.payload.field;",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 500, wires: [['hr_dist']]
  },
  {
    id: 'hr_dist', type: 'http request', z: FLOW_ID,
    name: 'GET distinct values',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: '', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 620, y: 500, wires: [['fn_dist_parse']]
  },
  {
    id: 'fn_dist_parse', type: 'function', z: FLOW_ID,
    name: 'Parse distinct',
    func: [
      "if (msg.payload.error) {",
      "  msg.payload = { error: msg.payload.error.message || 'ArcGIS error' };",
      "} else {",
      "  var field = msg._field;",
      "  var vals = (msg.payload.features || []).map(function(f) {",
      "    return f.attributes[field];",
      "  });",
      "  msg.payload = { values: vals };",
      "}",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 810, y: 500, wires: [['ho_dist']]
  },
  {
    id: 'ho_dist', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '', headers: {},
    x: 1000, y: 500, wires: []
  },

  // ════════════════════════════════════════════════
  //  Config persistence
  // ════════════════════════════════════════════════
  {
    id: 'c_save', type: 'comment', z: FLOW_ID,
    name: '── Config Save ──',
    info: '', x: 240, y: 580, wires: []
  },
  {
    id: 'hi_save', type: 'http in', z: FLOW_ID,
    name: 'POST /api/config/save',
    url: '/api/config/save', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 620, wires: [['fn_save']]
  },
  {
    id: 'fn_save', type: 'function', z: FLOW_ID,
    name: 'Save to flow context',
    func: [
      "var config  = msg.payload;",
      "var configs = flow.get('arcgis_configs') || [];",
      "var idx = configs.findIndex(function(c) {",
      "  return c.source.serviceUrl === config.source.serviceUrl",
      "      && c.source.layerId    === config.source.layerId;",
      "});",
      "if (idx >= 0) { configs[idx] = config; }",
      "else           { configs.push(config); }",
      "flow.set('arcgis_configs', configs);",
      "msg.payload = { ok: true, configCount: configs.length };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 620, wires: [['ho_save']]
  },
  {
    id: 'ho_save', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '', headers: {},
    x: 640, y: 620, wires: []
  },

  // POST /api/config/save-all  →  replace all configs (used by delete)
  {
    id: 'hi_saveall', type: 'http in', z: FLOW_ID,
    name: 'POST /api/config/save-all',
    url: '/api/config/save-all', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 660, wires: [['fn_saveall']]
  },
  {
    id: 'fn_saveall', type: 'function', z: FLOW_ID,
    name: 'Replace all configs',
    func: [
      "flow.set('arcgis_configs', msg.payload.configs || []);",
      "msg.payload = { ok: true };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 660, wires: [['ho_saveall']]
  },
  {
    id: 'ho_saveall', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '', headers: {},
    x: 640, y: 660, wires: []
  },

  // GET /api/config/load  →  return saved configs
  {
    id: 'hi_load', type: 'http in', z: FLOW_ID,
    name: 'GET /api/config/load',
    url: '/api/config/load', method: 'get',
    upload: false, swaggerDoc: '',
    x: 200, y: 700, wires: [['fn_load']]
  },
  {
    id: 'fn_load', type: 'function', z: FLOW_ID,
    name: 'Load from flow context',
    func: [
      "var configs = flow.get('arcgis_configs') || [];",
      "msg.payload = { configs: configs };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 700, wires: [['ho_load']]
  },
  {
    id: 'ho_load', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '', headers: {},
    x: 640, y: 700, wires: []
  },

  // ════════════════════════════════════════════════
  //  TAK Server settings persistence
  // ════════════════════════════════════════════════
  {
    id: 'c_tak', type: 'comment', z: FLOW_ID,
    name: '── TAK Settings ──',
    info: '', x: 240, y: 780, wires: []
  },
  {
    id: 'hi_tak_save', type: 'http in', z: FLOW_ID,
    name: 'POST /api/tak-settings/save',
    url: '/api/tak-settings/save', method: 'post',
    upload: false, swaggerDoc: '',
    x: 220, y: 820, wires: [['fn_tak_save']]
  },
  {
    id: 'fn_tak_save', type: 'function', z: FLOW_ID,
    name: 'Save TAK settings',
    func: [
      "flow.set('tak_settings', msg.payload);",
      "msg.payload = { ok: true };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 450, y: 820, wires: [['ho_tak_save']]
  },
  {
    id: 'ho_tak_save', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '', headers: {},
    x: 640, y: 820, wires: []
  },
  {
    id: 'hi_tak_load', type: 'http in', z: FLOW_ID,
    name: 'GET /api/tak-settings/load',
    url: '/api/tak-settings/load', method: 'get',
    upload: false, swaggerDoc: '',
    x: 220, y: 860, wires: [['fn_tak_load']]
  },
  {
    id: 'fn_tak_load', type: 'function', z: FLOW_ID,
    name: 'Load TAK settings',
    func: [
      "msg.payload = { settings: flow.get('tak_settings') || {} };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 450, y: 860, wires: [['ho_tak_load']]
  },
  {
    id: 'ho_tak_load', type: 'http response', z: FLOW_ID,
    name: '', statusCode: '', headers: {},
    x: 640, y: 860, wires: []
  }
];

// ╔══════════════════════════════════════════════════════════════╗
// ║  ENGINE — same tab as configurator (shared flow context)      ║
// ║  Y positions offset below configurator nodes (no overlap)   ║
// ╚══════════════════════════════════════════════════════════════╝

const EY = 920;

const engineFlows = [

  // ── TLS config placeholder (user uploads certs in editor) ──
  {
    id: 'tls_tak', type: 'tls-config',
    name: 'TAK Server TLS',
    cert: '', key: '', ca: '',
    certname: '', keyname: '', caname: '',
    servername: '', verifyservercert: false
  },

  // ════════════════════════════════════════════════
  //  Row 1 — Timer & config loader
  // ════════════════════════════════════════════════
  {
    id: 'eng_c1', type: 'comment', z: FLOW_ID,
    name: '── ArcGIS → TAK Sync Engine ──',
    info: '', x: 260, y: 40 + EY, wires: []
  },
  {
    id: 'eng_inject', type: 'inject', z: FLOW_ID,
    name: 'Poll timer (5 min)',
    props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
    repeat: '300', crontab: '',
    once: true, onceDelay: '30',
    topic: 'poll', payload: '', payloadType: 'date',
    x: 180, y: 80 + EY, wires: [['eng_load']]
  },
  {
    id: 'eng_load', type: 'function', z: FLOW_ID,
    name: 'Load configs',
    func: [
      "var configs = flow.get('arcgis_configs') || [];",
      "var tak = flow.get('tak_settings') || {};",
      "if (configs.length === 0) { node.warn('No ArcGIS configs — open /configurator'); return null; }",
      "if (!tak.serverUrl) { node.warn('No TAK Server URL — open /configurator → TAK Settings'); return null; }",
      "var out = [];",
      "for (var i = 0; i < configs.length; i++) {",
      "  if (!configs[i].missionName) { node.warn('Config \"' + (configs[i].configName || 'unnamed') + '\" has no mission name — skipping'); continue; }",
      "  var cn = (configs[i].configName && String(configs[i].configName).trim()) ? String(configs[i].configName).trim() : ('config-' + (i + 1));",
      "  out.push({ payload: configs[i], takSettings: tak, topic: cn });",
      "}",
      "if (out.length === 0) return null;",
      "return [out];"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 400, y: 80 + EY, wires: [['eng_build_q']]
  },

  // ════════════════════════════════════════════════
  //  Row 2 — Query ArcGIS
  // ════════════════════════════════════════════════
  {
    id: 'eng_c2', type: 'comment', z: FLOW_ID,
    name: '── Query ArcGIS features ──',
    info: '', x: 260, y: 140 + EY, wires: []
  },
  {
    id: 'eng_build_q', type: 'function', z: FLOW_ID,
    name: 'Build ArcGIS query',
    func: [
      "function ttlMs(c) {",
      "  var u = c.ttlUnit || 'hours';",
      "  var v;",
      "  if (c.ttlValue != null && c.ttlValue !== '') v = Number(c.ttlValue);",
      "  else if (c.ttlHours != null && c.ttlHours !== '') { v = Number(c.ttlHours); u = 'hours'; }",
      "  else return 0;",
      "  if (!(v > 0) || v !== v) return 0;",
      "  if (u === 'minutes') return v * 60 * 1000;",
      "  if (u === 'days') return v * 24 * 3600000;",
      "  return v * 3600000;",
      "}",
      "var cfg = msg.payload;",
      "msg.topic = (cfg.configName && String(cfg.configName).trim()) ? String(cfg.configName).trim() : 'unnamed';",
      "var base = cfg.source.serviceUrl.replace(/\\/+$/, '');",
      "var lid = cfg.source.layerId;",
      "var parts = [];",
      "if (cfg.source.where) parts.push(cfg.source.where);",
      "if (cfg.mapping.timeField && ttlMs(cfg) > 0) {",
      "  var cutoffMs = Date.now() - ttlMs(cfg);",
      "  var cd = new Date(cutoffMs);",
      "  var y = cd.getUTCFullYear();",
      "  var mo = ('0' + (cd.getUTCMonth() + 1)).slice(-2);",
      "  var da = ('0' + cd.getUTCDate()).slice(-2);",
      "  parts.push(cfg.mapping.timeField + \" >= DATE '\" + y + '-' + mo + '-' + da + \"'\");",
      "}",
      "var where = parts.length > 0 ? parts.join(' AND ') : '1=1';",
      "msg.url = base + '/' + lid + '/query'",
      "  + '?where=' + encodeURIComponent(where)",
      "  + '&outFields=*&returnGeometry=true&f=json';",
      "node.warn('ArcGIS query where: ' + where);",
      "msg._config = cfg;",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 180, y: 180 + EY, wires: [['eng_http_ag']]
  },
  {
    id: 'eng_http_ag', type: 'http request', z: FLOW_ID,
    name: 'GET ArcGIS features',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: '', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 400, y: 180 + EY, wires: [['eng_parse']]
  },

  // ════════════════════════════════════════════════
  //  Row 3 — Parse features & build CoT JSON
  // ════════════════════════════════════════════════
  {
    id: 'eng_parse', type: 'function', z: FLOW_ID,
    name: 'Parse & build CoT',
    func: [
      "var features = (msg.payload && msg.payload.features) || [];",
      "var cfg = msg._config;",
      "if (features.length === 0) { node.warn(cfg.configName + ': 0 features from ArcGIS'); return null; }",
      "",
      "function ttlMs(c) {",
      "  var u = c.ttlUnit || 'hours';",
      "  var v;",
      "  if (c.ttlValue != null && c.ttlValue !== '') v = Number(c.ttlValue);",
      "  else if (c.ttlHours != null && c.ttlHours !== '') { v = Number(c.ttlHours); u = 'hours'; }",
      "  else return 0;",
      "  if (!(v > 0) || v !== v) return 0;",
      "  if (u === 'minutes') return v * 60 * 1000;",
      "  if (u === 'days') return v * 24 * 3600000;",
      "  return v * 3600000;",
      "}",
      "",
      "function hexArgb(hex, a) {",
      "  var r = parseInt(hex.substr(1,2),16);",
      "  var g = parseInt(hex.substr(3,2),16);",
      "  var b = parseInt(hex.substr(5,2),16);",
      "  var ai = Math.round((a !== undefined ? a : 1) * 255);",
      "  return ((ai << 24) | (r << 16) | (g << 8) | b);",
      "}",
      "",
      "var strokeArgb = hexArgb(cfg.style.color || '#FF0000', 1);",
      "var fillArgb   = hexArgb(cfg.style.color || '#FF0000', parseFloat(cfg.style.fillAlpha || '0.3'));",
      "var now = new Date();",
      "var tm = ttlMs(cfg);",
      "var staleMs = tm > 0 ? tm : 3600000;",
      "var stale = new Date(now.getTime() + staleMs);",
      "var isPoly = cfg.source.geometryType !== 'esriGeometryPoint';",
      "var cotType = isPoly ? 'u-d-f' : 'a-u-G';",
      "",
      "var results = [];",
      "for (var i = 0; i < features.length; i++) {",
      "  var f = features[i];",
      "  var a = f.attributes || {};",
      "  var g = f.geometry;",
      "  if (!g) continue;",
      "",
      "  var idVal = a[cfg.mapping.idField] || ('f' + i);",
      "  var uid = (cfg.uidPrefix || 'arcgis') + '-' + String(idVal).replace(/[^a-zA-Z0-9_.-]/g, '_');",
      "",
      "  var lat, lon;",
      "  if (isPoly && g.rings && g.rings[0]) {",
      "    var ring = g.rings[0]; var sx=0,sy=0;",
      "    for (var j=0;j<ring.length;j++) { sx+=ring[j][0]; sy+=ring[j][1]; }",
      "    lon = sx/ring.length; lat = sy/ring.length;",
      "  } else { lat = g.y || 0; lon = g.x || 0; }",
      "",
      "  var callsign = uid;",
      "  if (cfg.style.labelField && a[cfg.style.labelField] != null) callsign = String(a[cfg.style.labelField]);",
      "",
      "  var remarks = '';",
      "  if (cfg.remarksFields && cfg.remarksFields.length) {",
      "    var rp = [];",
      "    for (var k=0;k<cfg.remarksFields.length;k++) {",
      "      var fn = cfg.remarksFields[k];",
      "      rp.push(fn + ': ' + (a[fn] != null ? String(a[fn]) : ''));",
      "    }",
      "    remarks = rp.join(' | ');",
      "  }",
      "",
      "  var detail = {",
      "    contact: [{ _attributes: { callsign: callsign } }],",
      "    remarks: remarks,",
      "    strokeColor: [{ _attributes: { value: String(strokeArgb) } }],",
      "    strokeWeight: [{ _attributes: { value: String(cfg.style.strokeWeight || 3) + '.0' } }],",
      "    fillColor: [{ _attributes: { value: String(fillArgb) } }],",
      "    labels_on: [{ _attributes: { value: cfg.style.labelsOn ? 'true' : 'false' } }]",
      "  };",
      "",
      "  if (cfg.missionName) {",
      "    detail.Marti = { dest: { _attributes: { mission: cfg.missionName } } };",
      "  }",
      "",
      "  if (isPoly && g.rings && g.rings[0]) {",
      "    var links = [];",
      "    var ring = g.rings[0];",
      "    for (var j=0;j<ring.length;j++) links.push({ _attributes: { point: ring[j][1]+','+ring[j][0] } });",
      "    detail.link = links;",
      "  }",
      "",
      "  results.push({",
      "    uid: uid,",
      "    cot: {",
      "      event: {",
      "        _attributes: {",
      "          version: '2.0', uid: uid, type: cotType,",
      "          how: 'h-e',",
      "          time: now.toISOString(),",
      "          start: now.toISOString(),",
      "          stale: stale.toISOString()",
      "        },",
      "        point: { _attributes: { lat: String(lat), lon: String(lon), hae: '9999999.0', ce: '9999999.0', le: '9999999.0' } },",
      "        detail: detail",
      "      }",
      "    }",
      "  });",
      "}",
      "",
      "node.warn(cfg.configName + ': ' + results.length + ' CoT events built from ' + features.length + ' features');",
      "msg._features = results;",
      "msg._config = cfg;",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 600, y: 180 + EY, wires: [['eng_build_sub']]
  },

  // ════════════════════════════════════════════════
  //  Row 4 — Get mission contents & reconcile
  // ════════════════════════════════════════════════
  {
    id: 'eng_c3', type: 'comment', z: FLOW_ID,
    name: '── Reconcile with TAK Mission ──',
    info: '', x: 260, y: 260 + EY, wires: []
  },
  {
    id: 'eng_build_sub', type: 'function', z: FLOW_ID,
    name: 'Build subscribe URL',
    func: [
      "var tak = msg.takSettings;",
      "var cfg = msg._config;",
      "var host = String(tak.serverUrl || '').replace(/^https?:\\/\\//i, '').replace(/\\/$/, '');",
      "var creatorUid = String((cfg && cfg.creatorUid) || (tak && tak.creatorUid) || 'nodered').trim();",
      "msg.url = 'https://' + host + ':' + (tak.missionApiPort || 8443)",
      "  + '/Marti/api/missions/' + encodeURIComponent(cfg.missionName)",
      "  + '/subscription?uid=' + encodeURIComponent(creatorUid);",
      "msg.method = 'PUT';",
      "msg.headers = { 'accept': '*/*', 'Content-Type': 'application/json' };",
      "if (tak && tak.missionBearerToken) {",
      "  msg.headers.Authorization = 'Bearer ' + String(tak.missionBearerToken).trim();",
      "}",
      "msg.payload = '';",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 180, y: 300 + EY, wires: [['eng_http_sub']]
  },
  {
    id: 'eng_http_sub', type: 'http request', z: FLOW_ID,
    name: 'Subscribe to mission',
    method: 'use', ret: 'txt', paytoqs: 'ignore',
    url: '', tls: 'tls_tak', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 380, y: 300 + EY, wires: [['eng_debug_sub', 'eng_add_mission_simple']]
  },
  {
    id: 'eng_add_mission_simple', type: 'function', z: FLOW_ID,
    name: 'Emit CoT + DataSync add (no dedupe)',
    func: [
      "var features = msg._features || [];",
      "var cfg = msg._config || {};",
      "var tak = msg.takSettings || {};",
      "var topicCfg = (cfg && cfg.configName && String(cfg.configName).trim()) ? String(cfg.configName).trim() : 'unnamed';",
      "var host = String(tak.serverUrl || '').replace(/^https?:\\/\\//i, '').replace(/\\/$/, '');",
      "var streamPort = Number(tak.streamingPort || tak.streamPort || tak.takPort || 8089);",
      "var baseUrl = 'https://' + host + ':' + (tak.missionApiPort || 8443)",
      "  + '/Marti/api/missions/' + encodeURIComponent(cfg.missionName);",
      "var creatorUidRaw = String((cfg && cfg.creatorUid) || (tak && tak.creatorUid) || 'nodered').trim();",
      "var creator = encodeURIComponent(creatorUidRaw);",
      "var cookie = '';",
      "if (msg.responseCookies && msg.responseCookies.JSESSIONID && msg.responseCookies.JSESSIONID.value) {",
      "  cookie = 'JSESSIONID=' + String(msg.responseCookies.JSESSIONID.value);",
      "}",
      "if (!cookie && msg.headers && msg.headers['set-cookie']) {",
      "  var sc = msg.headers['set-cookie'];",
      "  if (Array.isArray(sc) && sc.length) {",
      "    var m = String(sc[0]).match(/JSESSIONID=([^;]+)/);",
      "    if (m && m[1]) cookie = 'JSESSIONID=' + m[1];",
      "  } else if (typeof sc === 'string') {",
      "    var n = sc.match(/JSESSIONID=([^;]+)/);",
      "    if (n && n[1]) cookie = 'JSESSIONID=' + n[1];",
      "  }",
      "}",
      "var nPut = 0;",
      "for (var i = 0; i < features.length; i++) {",
      "  var f = features[i];",
      "  nPut++;",
      "  var putMsg = {",
      "    method: 'PUT',",
      "    url: baseUrl + '/contents?creatorUid=' + creator,",
      "    headers: { 'accept': '*/*', 'Content-Type': 'application/json' },",
      "    payload: JSON.stringify({ uids: [f.uid] }),",
      "    topic: topicCfg",
      "  };",
      "  if (cookie) putMsg.headers.Cookie = cookie;",
      "  node.send([",
      "    { payload: f.cot, topic: topicCfg, host: host, port: streamPort },",
      "    putMsg",
      "  ]);",
      "}",
      "node.warn(topicCfg + ' add-only: streamed ' + features.length + ', PUT ' + nPut);",
      "return null;"
    ].join('\\n'),
    outputs: 2, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 650, y: 300 + EY, wires: [['eng_debug_cot', 'eng_tak'], ['eng_http_action']]
  },
  {
    id: 'eng_build_m', type: 'function', z: FLOW_ID,
    name: 'Build mission GET URL',
    func: [
      "var tak = msg.takSettings;",
      "var cfg = msg._config;",
      "var host = String(tak.serverUrl || '').replace(/^https?:\\/\\//i, '').replace(/\\/$/, '');",
      "function getJsid(m) {",
      "  if (m && m.responseCookies && m.responseCookies.JSESSIONID && m.responseCookies.JSESSIONID.value) {",
      "    return String(m.responseCookies.JSESSIONID.value);",
      "  }",
      "  var sc = m && m.headers && m.headers['set-cookie'];",
      "  if (Array.isArray(sc) && sc.length) {",
      "    var x = String(sc[0]).match(/JSESSIONID=([^;]+)/);",
      "    if (x && x[1]) return x[1];",
      "  }",
      "  if (typeof sc === 'string') {",
      "    var y = sc.match(/JSESSIONID=([^;]+)/);",
      "    if (y && y[1]) return y[1];",
      "  }",
      "  return '';",
      "}",
      "function getBearer(m, tk) {",
      "  if (tk && tk.missionBearerToken) return String(tk.missionBearerToken).trim();",
      "  if (m && m._missionBearer) return String(m._missionBearer).trim();",
      "  if (m && m.headers) {",
      "    var h = m.headers.authorization || m.headers.Authorization || '';",
      "    if (typeof h === 'string') {",
      "      var hm = h.match(/^Bearer\\s+(.+)$/i);",
      "      if (hm && hm[1]) return hm[1];",
      "    }",
      "  }",
      "  var p = m && m.payload;",
      "  if (typeof p === 'string') {",
      "    try { p = JSON.parse(p); } catch(e) { p = null; }",
      "  }",
      "  if (p && typeof p === 'object') {",
      "    if (typeof p.token === 'string') return p.token;",
      "    if (typeof p.accessToken === 'string') return p.accessToken;",
      "    if (p.data && typeof p.data.token === 'string') return p.data.token;",
      "  }",
      "  return '';",
      "}",
      "msg.url = 'https://' + host + ':' + (tak.missionApiPort || 8443)",
      "  + '/Marti/api/missions/' + encodeURIComponent(cfg.missionName);",
      "var jsid = getJsid(msg);",
      "if (jsid) msg._missionCookie = 'JSESSIONID=' + jsid;",
      "var bearer = getBearer(msg, tak);",
      "if (bearer) msg._missionBearer = bearer;",
      "msg.headers = { 'accept': '*/*' };",
      "if (msg._missionCookie) msg.headers.Cookie = msg._missionCookie;",
      "if (msg._missionBearer) msg.headers.Authorization = 'Bearer ' + msg._missionBearer;",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 560, y: 300 + EY, wires: [['eng_http_m']]
  },
  {
    id: 'eng_http_m', type: 'http request', z: FLOW_ID,
    name: 'GET mission',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: 'tls_tak', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 740, y: 300 + EY, wires: [['eng_reconcile']]
  },
  {
    id: 'eng_reconcile', type: 'function', z: FLOW_ID,
    name: 'Reconcile (diff)',
    func: [
      "var features = msg._features || [];",
      "var mData = msg.payload;",
      "var cfg = msg._config;",
      "var tak = msg.takSettings;",
      "var topicCfg = (cfg && cfg.configName && String(cfg.configName).trim()) ? String(cfg.configName).trim() : 'unnamed';",
      "msg.topic = topicCfg;",
      "var prefix = cfg.uidPrefix || 'arcgis';",
      "",
      "// Extract existing UIDs from mission response",
      "var existing = {};",
      "try {",
      "  var mission = null;",
      "  if (mData && mData.data) {",
      "    mission = Array.isArray(mData.data) ? mData.data[0] : mData.data;",
      "  }",
      "  if (mission) {",
      "    if (mission.uids) {",
      "      for (var i=0;i<mission.uids.length;i++) {",
      "        var u = mission.uids[i];",
      "        var uid = (typeof u === 'string') ? u : (u.data || u.uid || u);",
      "        if (typeof uid === 'string') existing[uid] = true;",
      "      }",
      "    }",
      "    if (mission.contents) {",
      "      for (var i=0;i<mission.contents.length;i++) {",
      "        var c = mission.contents[i];",
      "        if (c.data && c.data.uid) existing[c.data.uid] = true;",
      "      }",
      "    }",
      "  }",
      "} catch(e) { node.warn('Could not parse mission contents (new mission?): ' + e.message); }",
      "",
      "var arcgis = {};",
      "for (var i=0;i<features.length;i++) arcgis[features[i].uid] = features[i];",
      "",
      "var host = String(tak.serverUrl || '').replace(/^https?:\\/\\//i, '').replace(/\\/$/, '');",
      "var baseUrl = 'https://' + host + ':' + (tak.missionApiPort || 8443)",
      "  + '/Marti/api/missions/' + encodeURIComponent(cfg.missionName);",
      "// Per-config creatorUid (Portal integration user); legacy: tak_settings.creatorUid; default nodered",
      "var creatorUidRaw = String((cfg && cfg.creatorUid) || (tak && tak.creatorUid) || 'nodered').trim();",
      "var creator = encodeURIComponent(creatorUidRaw);",
      "",
      "var nPut = 0, nDel = 0;",
      "var cookie = msg._missionCookie || '';",
      "var bearer = msg._missionBearer || '';",
      "if (!cookie && msg.responseCookies && msg.responseCookies.JSESSIONID && msg.responseCookies.JSESSIONID.value) {",
      "  cookie = 'JSESSIONID=' + String(msg.responseCookies.JSESSIONID.value);",
      "}",
      "if (!cookie && msg.headers && msg.headers['set-cookie']) {",
      "  var sc = msg.headers['set-cookie'];",
      "  if (Array.isArray(sc) && sc.length) {",
      "    var a = String(sc[0]).match(/JSESSIONID=([^;]+)/);",
      "    if (a && a[1]) cookie = 'JSESSIONID=' + a[1];",
      "  } else if (typeof sc === 'string') {",
      "    var b = sc.match(/JSESSIONID=([^;]+)/);",
      "    if (b && b[1]) cookie = 'JSESSIONID=' + b[1];",
      "  }",
      "}",
      "",
      "// New features → CoT out (port 0) with metadata for PUT after send",
      "for (var uid in arcgis) {",
      "  if (!existing[uid]) {",
      "    nPut++;",
      "    node.send([",
      "      { payload: arcgis[uid].cot, topic: topicCfg,",
      "        host: host,",
      "        port: Number(tak.streamingPort || tak.streamPort || tak.takPort || 8089),",
      "        _missionCookie: cookie,",
      "        _missionBearer: bearer,",
      "        _putUrl: baseUrl + '/contents?creatorUid=' + creator,",
      "        _putUid: uid },",
      "      null",
      "    ]);",
      "  }",
      "}",
      "",
      "// Stale UIDs → DELETE (port 1)",
      "for (var uid in existing) {",
      "  if (uid.indexOf(prefix) === 0 && !arcgis[uid]) {",
      "    nDel++;",
      "    node.send([null, {",
      "      method: 'DELETE',",
      "      url: baseUrl + '/contents?uid=' + encodeURIComponent(uid) + '&creatorUid=' + creator,",
      "      headers: { 'accept': '*/*' },",
      "      _missionCookie: cookie,",
      "      _missionBearer: bearer,",
      "      payload: '',",
      "      topic: topicCfg",
      "    }]);",
      "  }",
      "}",
      "",
      "node.warn(cfg.configName + ' reconcile: ' + nPut + ' PUT, ' + nDel + ' DELETE, '",
      "  + Object.keys(arcgis).length + ' ArcGIS, ' + Object.keys(existing).length + ' in mission');",
      "return null;"
    ].join('\n'),
    outputs: 2, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 600, y: 300 + EY, wires: [['eng_debug_cot', 'eng_tak', 'eng_delay_put'], ['eng_delay_del']]
  },

  // ════════════════════════════════════════════════
  //  Row 5 — Outputs
  // ════════════════════════════════════════════════
  {
    id: 'eng_c4', type: 'comment', z: FLOW_ID,
    name: '── CoT output → wire TAK node + tcp out here ──',
    info: '', x: 280, y: 380 + EY, wires: []
  },
  {
    id: 'eng_debug_cot', type: 'debug', z: FLOW_ID,
    name: 'CoT JSON',
    active: true, tosidebar: true, console: false, tostatus: true,
    complete: 'payload',
    targetType: 'msg',     statusVal: 'payload.event._attributes.uid', statusType: 'auto',
    x: 200, y: 420 + EY, wires: []
  },
  {
    id: 'eng_tak', type: 'tak', z: FLOW_ID,
    name: 'CoT encode',
    x: 200, y: 460 + EY, wires: [['eng_tcp_out']]
  },
  {
    id: 'eng_tcp_out', type: 'tcp out', z: FLOW_ID,
    name: 'CoT stream to TAK',
    host: '', port: '', beserver: 'client',
    base64: false, end: false, tls: 'tls_tak',
    x: 410, y: 460 + EY, wires: []
  },
  {
    id: 'eng_status_stream', type: 'status', z: FLOW_ID,
    name: 'Stream status',
    scope: ['eng_tcp_out'],
    x: 410, y: 500 + EY, wires: [['eng_debug_stream']]
  },
  {
    id: 'eng_catch_stream', type: 'catch', z: FLOW_ID,
    name: 'Stream errors',
    scope: ['eng_tcp_out', 'eng_tak'],
    uncaught: false,
    x: 180, y: 540 + EY, wires: [['eng_debug_stream']]
  },
  {
    id: 'eng_debug_stream', type: 'debug', z: FLOW_ID,
    name: 'TAK stream status/error',
    active: true, tosidebar: true, console: false, tostatus: true,
    complete: 'true', targetType: 'full',
    statusVal: '', statusType: 'auto',
    x: 640, y: 500 + EY, wires: []
  },
  {
    id: 'eng_debug_sub', type: 'debug', z: FLOW_ID,
    name: 'Mission subscribe result',
    active: true, tosidebar: true, console: false, tostatus: false,
    complete: 'true', targetType: 'full',
    statusVal: '', statusType: 'auto',
    x: 620, y: 260 + EY, wires: []
  },
  {
    id: 'eng_delay_put', type: 'delay', z: FLOW_ID,
    name: 'Wait 5s for CoT', pauseType: 'delay', timeout: '5', timeoutUnits: 'seconds',
    rate: '1', nbRateUnits: '1', rateUnits: 'second',
    randomFirst: '1', randomLast: '5', randomUnits: 'seconds',
    drop: false, allowrate: false, outputs: 1,
    x: 200, y: 500 + EY, wires: [['eng_build_put']]
  },
  {
    id: 'eng_build_put', type: 'function', z: FLOW_ID,
    name: 'Build PUT (after delay)',
    func: [
      "if (!msg._putUrl || !msg._putUid) return null;",
      "msg.method = 'PUT';",
      "msg.url = msg._putUrl;",
      "msg.headers = { 'accept': '*/*', 'Content-Type': 'application/json' };",
      "if (msg._missionCookie) msg.headers.Cookie = msg._missionCookie;",
      "if (msg._missionBearer) msg.headers.Authorization = 'Bearer ' + msg._missionBearer;",
      "msg.payload = JSON.stringify({ uids: [msg._putUid] });",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 400, y: 500 + EY, wires: [['eng_http_action']]
  },
  {
    id: 'eng_delay_del', type: 'delay', z: FLOW_ID,
    name: '', pauseType: 'delay', timeout: '1', timeoutUnits: 'seconds',
    rate: '1', nbRateUnits: '1', rateUnits: 'second',
    randomFirst: '1', randomLast: '5', randomUnits: 'seconds',
    drop: false, allowrate: false, outputs: 1,
    x: 280, y: 540 + EY, wires: [['eng_http_action']]
  },
  {
    id: 'eng_http_action', type: 'http request', z: FLOW_ID,
    name: 'Mission API (PUT/DELETE)',
    method: 'use', ret: 'txt', paytoqs: 'ignore',
    url: '', tls: 'tls_tak', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 460, y: 420 + EY, wires: [['eng_debug_action']]
  },
  {
    id: 'eng_debug_action', type: 'debug', z: FLOW_ID,
    name: 'Mission API result',
    active: true, tosidebar: true, console: false, tostatus: true,
    complete: 'true', targetType: 'full',
    statusVal: '', statusType: 'auto',
    x: 680, y: 420 + EY, wires: []
  }
];

// Merge all flows
const allFlows = flows.concat(engineFlows);
const out = path.join(__dirname, 'flows.json');
fs.writeFileSync(out, JSON.stringify(allFlows, null, 2));
console.log('flows.json generated  (' + allFlows.length + ' nodes)  →  ' + out);
