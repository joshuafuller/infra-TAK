#!/usr/bin/env node
const fs   = require('fs');
const path = require('path');

const html    = fs.readFileSync(path.join(__dirname, 'configurator.html'), 'utf8');
const CFG_TAB = 'flow_arcgis_cfg';

// ╔══════════════════════════════════════════════════════════════╗
// ║  FEEDS — one engine tab per entry.  To add a new ArcGIS    ║
// ║  integration: add a row here and redeploy.                  ║
// ╚══════════════════════════════════════════════════════════════╝
const FEEDS = [
  { id: 'air_intel',    configName: 'CA AIR INTEL' },
  { id: 'pwr_outages',  configName: 'POWER-OUTAGES' }
];

// ════════════════════════════════════════════════════════════════
//  Configurator tab — shared UI + persistence (global context)
// ════════════════════════════════════════════════════════════════

const configFlows = [
  {
    id: CFG_TAB, type: 'tab',
    label: 'ArcGIS Configurator',
    disabled: false,
    info: 'Shared UI, proxy APIs, config & TAK settings persistence. Configs stored in global context so per-feed engine tabs can read them.'
  },

  // ── Migration: flow → global context (one-time at startup) ──
  {
    id: 'migrate_inject', type: 'inject', z: CFG_TAB,
    name: 'Startup migration',
    props: [{ p: 'payload' }],
    repeat: '', crontab: '',
    once: true, onceDelay: '2',
    topic: '', payload: '', payloadType: 'date',
    x: 180, y: 40, wires: [['migrate_fn']]
  },
  {
    id: 'migrate_fn', type: 'function', z: CFG_TAB,
    name: 'Migrate flow→global',
    func: [
      "var cfgs = flow.get('arcgis_configs');",
      "var tak  = flow.get('tak_settings');",
      "if (cfgs && cfgs.length > 0 && !(global.get('arcgis_configs') || []).length) {",
      "  global.set('arcgis_configs', cfgs);",
      "  node.warn('Migrated ' + cfgs.length + ' configs to global context');",
      "}",
      "if (tak && Object.keys(tak).length > 0 && !Object.keys(global.get('tak_settings') || {}).length) {",
      "  global.set('tak_settings', tak);",
      "  node.warn('Migrated TAK settings to global context');",
      "}",
      "return null;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 400, y: 40, wires: [[]]
  },

  // ── Configurator UI ──
  {
    id: 'c_ui', type: 'comment', z: CFG_TAB,
    name: '── Configurator UI (/configurator) ──',
    info: '', x: 240, y: 80, wires: []
  },
  {
    id: 'hi_ui', type: 'http in', z: CFG_TAB,
    name: 'GET /configurator',
    url: '/configurator', method: 'get',
    upload: false, swaggerDoc: '',
    x: 170, y: 120, wires: [['t_ui']]
  },
  {
    id: 't_ui', type: 'template', z: CFG_TAB,
    name: 'Configurator HTML',
    field: 'payload', fieldType: 'msg',
    format: 'html', syntax: 'plain',
    template: html,
    output: 'str',
    x: 390, y: 120, wires: [['ho_ui']]
  },
  {
    id: 'ho_ui', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '200',
    headers: { 'content-type': 'text/html', 'cache-control': 'no-cache, no-store, must-revalidate' },
    x: 590, y: 120, wires: []
  },

  // ── ArcGIS Proxy APIs ──
  {
    id: 'c_api', type: 'comment', z: CFG_TAB,
    name: '── ArcGIS Proxy APIs ──',
    info: '', x: 240, y: 200, wires: []
  },
  {
    id: 'hi_svc', type: 'http in', z: CFG_TAB,
    name: 'POST /api/arcgis/service',
    url: '/api/arcgis/service', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 240, wires: [['fn_svc']]
  },
  {
    id: 'fn_svc', type: 'function', z: CFG_TAB,
    name: 'Build service URL',
    func: "const base = msg.payload.url.replace(/\\/+$/, '');\nmsg.url = base + '?f=json';\nreturn msg;",
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 240, wires: [['hr_svc']]
  },
  {
    id: 'hr_svc', type: 'http request', z: CFG_TAB,
    name: 'GET service info',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: '', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 620, y: 240, wires: [['fn_svc_parse']]
  },
  {
    id: 'fn_svc_parse', type: 'function', z: CFG_TAB,
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
    x: 810, y: 240, wires: [['ho_svc']]
  },
  {
    id: 'ho_svc', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 1000, y: 240, wires: []
  },

  {
    id: 'hi_lyr', type: 'http in', z: CFG_TAB,
    name: 'POST /api/arcgis/layer',
    url: '/api/arcgis/layer', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 340, wires: [['fn_lyr']]
  },
  {
    id: 'fn_lyr', type: 'function', z: CFG_TAB,
    name: 'Build layer URL',
    func: "const base = msg.payload.url.replace(/\\/+$/, '');\nmsg.url = base + '/' + msg.payload.layerId + '?f=json';\nreturn msg;",
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 340, wires: [['hr_lyr']]
  },
  {
    id: 'hr_lyr', type: 'http request', z: CFG_TAB,
    name: 'GET layer info',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: '', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 620, y: 340, wires: [['fn_lyr_parse']]
  },
  {
    id: 'fn_lyr_parse', type: 'function', z: CFG_TAB,
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
    x: 810, y: 340, wires: [['ho_lyr']]
  },
  {
    id: 'ho_lyr', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 1000, y: 340, wires: []
  },

  {
    id: 'hi_smp', type: 'http in', z: CFG_TAB,
    name: 'POST /api/arcgis/sample',
    url: '/api/arcgis/sample', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 440, wires: [['fn_smp']]
  },
  {
    id: 'fn_smp', type: 'function', z: CFG_TAB,
    name: 'Build sample query URL',
    func: [
      "const base = msg.payload.url.replace(/\\/+$/, '');",
      "const lid  = msg.payload.layerId;",
      "msg.url = base + '/' + lid + '/query?where=1%3D1&outFields=*&resultRecordCount=50&f=json';",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 440, wires: [['hr_smp']]
  },
  {
    id: 'hr_smp', type: 'http request', z: CFG_TAB,
    name: 'GET sample features',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: '', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 620, y: 440, wires: [['fn_smp_parse']]
  },
  {
    id: 'fn_smp_parse', type: 'function', z: CFG_TAB,
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
    x: 810, y: 440, wires: [['ho_smp']]
  },
  {
    id: 'ho_smp', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 1000, y: 440, wires: []
  },

  {
    id: 'hi_dist', type: 'http in', z: CFG_TAB,
    name: 'POST /api/arcgis/distinct',
    url: '/api/arcgis/distinct', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 540, wires: [['fn_dist']]
  },
  {
    id: 'fn_dist', type: 'function', z: CFG_TAB,
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
    x: 430, y: 540, wires: [['hr_dist']]
  },
  {
    id: 'hr_dist', type: 'http request', z: CFG_TAB,
    name: 'GET distinct values',
    method: 'GET', ret: 'obj', paytoqs: 'ignore',
    url: '', tls: '', persist: false, proxy: '',
    insecureHTTPParser: false, authType: '',
    senderr: false, headers: [],
    x: 620, y: 540, wires: [['fn_dist_parse']]
  },
  {
    id: 'fn_dist_parse', type: 'function', z: CFG_TAB,
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
    x: 810, y: 540, wires: [['ho_dist']]
  },
  {
    id: 'ho_dist', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 1000, y: 540, wires: []
  },

  // ── Config persistence (global context) ──
  {
    id: 'c_save', type: 'comment', z: CFG_TAB,
    name: '── Config Save ──',
    info: '', x: 240, y: 620, wires: []
  },
  {
    id: 'hi_save', type: 'http in', z: CFG_TAB,
    name: 'POST /api/config/save',
    url: '/api/config/save', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 660, wires: [['fn_save']]
  },
  {
    id: 'fn_save', type: 'function', z: CFG_TAB,
    name: 'Save to global context',
    func: [
      "var config  = msg.payload;",
      "var configs = global.get('arcgis_configs') || [];",
      "var idx = configs.findIndex(function(c) {",
      "  return c.source.serviceUrl === config.source.serviceUrl",
      "      && c.source.layerId    === config.source.layerId;",
      "});",
      "if (idx >= 0) { configs[idx] = config; }",
      "else           { configs.push(config); }",
      "global.set('arcgis_configs', configs);",
      "var certUser = (config.streamCertUser || '').trim();",
      "if (certUser) {",
      "  try {",
      "    var fs = require('fs');",
      "    var pem = '/certs/' + certUser + '.pem';",
      "    var key = '/certs/' + certUser + '.key';",
      "    if (fs.existsSync(pem)) fs.chmodSync(pem, 0o644);",
      "    if (fs.existsSync(key)) fs.chmodSync(key, 0o644);",
      "    node.warn('Cert permissions fixed for ' + certUser);",
      "  } catch(e) { node.warn('chmod failed: ' + e.message); }",
      "}",
      "msg.payload = { ok: true, configCount: configs.length };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 660, wires: [['ho_save']]
  },
  {
    id: 'ho_save', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 640, y: 660, wires: []
  },
  {
    id: 'hi_saveall', type: 'http in', z: CFG_TAB,
    name: 'POST /api/config/save-all',
    url: '/api/config/save-all', method: 'post',
    upload: false, swaggerDoc: '',
    x: 200, y: 700, wires: [['fn_saveall']]
  },
  {
    id: 'fn_saveall', type: 'function', z: CFG_TAB,
    name: 'Replace all configs',
    func: [
      "global.set('arcgis_configs', msg.payload.configs || []);",
      "msg.payload = { ok: true };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 700, wires: [['ho_saveall']]
  },
  {
    id: 'ho_saveall', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 640, y: 700, wires: []
  },
  {
    id: 'hi_load', type: 'http in', z: CFG_TAB,
    name: 'GET /api/config/load',
    url: '/api/config/load', method: 'get',
    upload: false, swaggerDoc: '',
    x: 200, y: 740, wires: [['fn_load']]
  },
  {
    id: 'fn_load', type: 'function', z: CFG_TAB,
    name: 'Load from global context',
    func: [
      "var configs = global.get('arcgis_configs') || [];",
      "msg.payload = { configs: configs };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 430, y: 740, wires: [['ho_load']]
  },
  {
    id: 'ho_load', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 640, y: 740, wires: []
  },

  // ── TAK Settings persistence (global context) ──
  {
    id: 'c_tak', type: 'comment', z: CFG_TAB,
    name: '── TAK Settings ──',
    info: '', x: 240, y: 820, wires: []
  },
  {
    id: 'hi_tak_save', type: 'http in', z: CFG_TAB,
    name: 'POST /api/tak-settings/save',
    url: '/api/tak-settings/save', method: 'post',
    upload: false, swaggerDoc: '',
    x: 220, y: 860, wires: [['fn_tak_save']]
  },
  {
    id: 'fn_tak_save', type: 'function', z: CFG_TAB,
    name: 'Save TAK settings',
    func: [
      "global.set('tak_settings', msg.payload);",
      "msg.payload = { ok: true };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 450, y: 860, wires: [['ho_tak_save']]
  },
  {
    id: 'ho_tak_save', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 640, y: 860, wires: []
  },
  {
    id: 'hi_tak_load', type: 'http in', z: CFG_TAB,
    name: 'GET /api/tak-settings/load',
    url: '/api/tak-settings/load', method: 'get',
    upload: false, swaggerDoc: '',
    x: 220, y: 900, wires: [['fn_tak_load']]
  },
  {
    id: 'fn_tak_load', type: 'function', z: CFG_TAB,
    name: 'Load TAK settings',
    func: [
      "msg.payload = { settings: global.get('tak_settings') || {} };",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 450, y: 900, wires: [['ho_tak_load']]
  },
  {
    id: 'ho_tak_load', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 640, y: 900, wires: []
  },

  // ── Force re-subscribe ──
  {
    id: 'hi_force_sub', type: 'http in', z: CFG_TAB,
    name: 'POST /api/tak/force-subscribe',
    url: '/api/tak/force-subscribe', method: 'post',
    upload: false, swaggerDoc: '',
    x: 220, y: 960, wires: [['fn_force_sub']]
  },
  {
    id: 'fn_force_sub', type: 'function', z: CFG_TAB,
    name: 'Clear mission subscribe cache',
    func: [
      "var sub = global.get('_subscribed') || {};",
      "var mn = (msg.payload && msg.payload.missionName) ? String(msg.payload.missionName).trim() : '';",
      "if (mn) {",
      "  delete sub[mn];",
      "  global.set('_subscribed', sub);",
      "  msg.payload = { ok: true, cleared: mn };",
      "} else {",
      "  global.set('_subscribed', {});",
      "  msg.payload = { ok: true, cleared: 'all' };",
      "}",
      "node.warn('force-subscribe: next poll will PUT /subscription for ' + (mn || 'all missions'));",
      "return msg;"
    ].join('\n'),
    outputs: 1, timeout: '', noerr: 0,
    initialize: '', finalize: '', libs: [],
    x: 480, y: 960, wires: [['ho_force_sub']]
  },
  {
    id: 'ho_force_sub', type: 'http response', z: CFG_TAB,
    name: '', statusCode: '', headers: {},
    x: 720, y: 960, wires: []
  }
];

// ════════════════════════════════════════════════════════════════
//  TLS configs — global nodes, shared by all engine tabs
// ════════════════════════════════════════════════════════════════

const tlsNodes = [
  {
    id: 'tls_tak', type: 'tls-config',
    name: 'TAK Mission API TLS',
    cert: '', key: '', ca: '',
    certname: '/certs/admin.pem', keyname: '/certs/admin.key', caname: '',
    servername: '', verifyservercert: false
  }
];

// ════════════════════════════════════════════════════════════════
//  Shared function code strings (used by all engine tabs)
// ════════════════════════════════════════════════════════════════

const FN_TTL = [
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
  "}"
].join('\n');

const FN_BUILD_QUERY = [
  FN_TTL,
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
  "  + '&outFields=*&returnGeometry=true&outSR=4326&f=json';",
  "node.status({text: 'Query: ' + where.substring(0, 50)});",
  "msg._config = cfg;",
  "return msg;"
].join('\n');

const FN_PARSE_COT = [
  "var features = (msg.payload && msg.payload.features) || [];",
  "var cfg = msg._config;",
  "msg._arcgisStatus = msg.statusCode || 200;",
  "if (features.length === 0) {",
  "  node.status({fill: 'yellow', shape: 'ring', text: '0 features (status ' + msg._arcgisStatus + ')'});",
  "  msg._features = [];",
  "  msg._config = cfg;",
  "  return msg;",
  "}",
  "",
  FN_TTL,
  "",
  "function hexArgb(hex, a) {",
  "  var r = parseInt(hex.substr(1,2),16);",
  "  var g = parseInt(hex.substr(3,2),16);",
  "  var b = parseInt(hex.substr(5,2),16);",
  "  var ai = Math.round((a !== undefined ? a : 1) * 255);",
  "  return ((ai << 24) | (r << 16) | (g << 8) | b);",
  "}",
  "",
  "var sColor = cfg.style.strokeColor || cfg.style.color || '#FF0000';",
  "var fColor = cfg.style.fillColor || cfg.style.color || '#FF0000';",
  "var strokeArgb = hexArgb(sColor, 1);",
  "var rawAlpha = cfg.style.fillAlpha;",
  "var fillAlphaFloat;",
  "if (typeof rawAlpha === 'number') fillAlphaFloat = rawAlpha / 100;",
  "else if (typeof rawAlpha === 'string' && /^[0-9a-fA-F]{1,2}$/.test(rawAlpha)) fillAlphaFloat = parseInt(rawAlpha, 16) / 255;",
  "else fillAlphaFloat = 0.33;",
  "var fillArgb = hexArgb(fColor, fillAlphaFloat);",
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
  "  function fmtVal(v) {",
  "    if (v == null) return '';",
  "    var n = Number(v);",
  "    if (!isNaN(n) && n > 1e12) {",
  "      var d = new Date(n);",
  "      var utc = d.getTime() + (d.getTimezoneOffset() * 60000);",
  "      var pst = new Date(utc - 28800000);",
  "      var mo = ('0'+(pst.getMonth()+1)).slice(-2);",
  "      var da = ('0'+pst.getDate()).slice(-2);",
  "      var yr = pst.getFullYear();",
  "      var hr = ('0'+pst.getHours()).slice(-2);",
  "      var mi = ('0'+pst.getMinutes()).slice(-2);",
  "      return mo+'/'+da+'/'+yr+' '+hr+':'+mi+' PST';",
  "    }",
  "    if (!isNaN(n) && String(v).indexOf('.') !== -1) return String(Math.round(n));",
  "    return String(v);",
  "  }",
  "  var remarks = '';",
  "  if (cfg.remarksFields && cfg.remarksFields.length) {",
  "    var rp = [];",
  "    for (var k=0;k<cfg.remarksFields.length;k++) {",
  "      var fn = cfg.remarksFields[k];",
  "      rp.push(fn + ': ' + fmtVal(a[fn]));",
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
  "  if (isPoly && g.rings && g.rings[0]) {",
  "    var links = [];",
  "    var ring2 = g.rings[0];",
  "    var MAX_VERTS = 200;",
  "    if (ring2.length > MAX_VERTS) {",
  "      var step = ring2.length / MAX_VERTS;",
  "      var simplified = [];",
  "      for (var s = 0; s < MAX_VERTS; s++) simplified.push(ring2[Math.floor(s * step)]);",
  "      if (ring2[ring2.length-1]) simplified.push(ring2[ring2.length-1]);",
  "      ring2 = simplified;",
  "    }",
  "    for (var j=0;j<ring2.length;j++) links.push({ _attributes: { point: ring2[j][1]+','+ring2[j][0] } });",
  "    detail.link = links;",
  "  }",
  "",
  "  results.push({",
  "    uid: uid,",
  "    callsign: callsign,",
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
  "node.status({text: results.length + ' CoT from ' + features.length + ' features'});",
  "msg._features = results;",
  "msg._config = cfg;",
  "return msg;"
].join('\n');

const FN_COT_TO_XML = [
  "var e = msg.payload && msg.payload.event;",
  "if (!e || !e._attributes) return null;",
  "var a = e._attributes;",
  "var p = e.point._attributes;",
  "var d = e.detail || {};",
  "",
  "var xml = '<event version=\"' + a.version + '\" uid=\"' + a.uid + '\" type=\"' + a.type + '\"'",
  "  + ' how=\"' + a.how + '\" time=\"' + a.time + '\" start=\"' + a.start + '\" stale=\"' + a.stale + '\">'",
  "  + '<point lat=\"' + p.lat + '\" lon=\"' + p.lon + '\" hae=\"' + p.hae + '\" ce=\"' + p.ce + '\" le=\"' + p.le + '\"/>'",
  "  + '<detail>';",
  "",
  "if (d.contact && d.contact[0]) xml += '<contact callsign=\"' + d.contact[0]._attributes.callsign + '\"/>';",
  "if (d.remarks != null) xml += '<remarks>' + String(d.remarks).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</remarks>';",
  "if (d.strokeColor && d.strokeColor[0]) xml += '<strokeColor value=\"' + d.strokeColor[0]._attributes.value + '\"/>';",
  "if (d.strokeWeight && d.strokeWeight[0]) xml += '<strokeWeight value=\"' + d.strokeWeight[0]._attributes.value + '\"/>';",
  "if (d.fillColor && d.fillColor[0]) xml += '<fillColor value=\"' + d.fillColor[0]._attributes.value + '\"/>';",
  "if (d.labels_on && d.labels_on[0]) xml += '<labels_on value=\"' + d.labels_on[0]._attributes.value + '\"/>';",
  "",
  "if (d.link && d.link.length) {",
  "  for (var i = 0; i < d.link.length; i++) {",
  "    xml += '<link point=\"' + d.link[i]._attributes.point + '\"/>';",
  "  }",
  "}",
  "",
  "xml += '</detail>';",
  "if (msg._missionName) {",
  "  xml += '<Marti><dest mission=\"' + msg._missionName + '\"/></Marti>';",
  "}",
  "xml += '</event>\\n';",
  "",
  "msg.payload = Buffer.from(xml, 'utf8');",
  "node.status({text: a.uid.substring(0, 30) + ' ' + msg.payload.length + 'B'});",
  "return msg;"
].join('\n');

// ════════════════════════════════════════════════════════════════
//  Per-feed engine tab generator
// ════════════════════════════════════════════════════════════════

function makeEngineTab(feed) {
  const FID = 'flow_eng_' + feed.id;
  const P   = feed.id + '_';

  // Reconcile — upload CoT XML via Enterprise Sync, add hashes to mission
  const FN_RECONCILE = [
    "var features = msg._features || [];",
    "var mData = msg.payload;",
    "var cfg = msg._config;",
    "var tak = msg.takSettings;",
    "var topicCfg = cfg.configName || 'unnamed';",
    "msg.topic = topicCfg;",
    "var prefix = cfg.uidPrefix || 'arcgis';",
    "var arcgisOk = !msg._arcgisStatus || msg._arcgisStatus === 200;",
    "",
    "var existingByName = {};",
    "try {",
    "  var mission = null;",
    "  if (mData && mData.data) {",
    "    mission = Array.isArray(mData.data) ? mData.data[0] : mData.data;",
    "  }",
    "  if (mission && mission.contents) {",
    "    for (var i = 0; i < mission.contents.length; i++) {",
    "      var c = mission.contents[i];",
    "      if (c.data && c.data.name) {",
    "        existingByName[c.data.name] = c.data.hash;",
    "      }",
    "    }",
    "  }",
    "  if (mission && mission.uids) {",
    "    for (var i = 0; i < mission.uids.length; i++) {",
    "      var u = mission.uids[i];",
    "      var uid = (typeof u === 'string') ? u : (u.data || u.uid || u);",
    "      if (typeof uid === 'string') existingByName[uid] = '_uid_' + uid;",
    "    }",
    "  }",
    "} catch(e) { node.warn('Could not parse mission contents: ' + e.message); }",
    "",
    "var arcgisFiles = {};",
    "for (var i = 0; i < features.length; i++) {",
    "  var fn = (features[i].callsign || features[i].uid) + '.cot';",
    "  features[i]._fname = fn;",
    "  arcgisFiles[fn] = features[i];",
    "}",
    "",
    "var host = String(tak.serverUrl || '').replace(/^https?:\\/\\//i, '').replace(/\\/$/, '');",
    "var baseUrl = 'https://' + host + ':' + (tak.missionApiPort || 8443);",
    "var missionUrl = baseUrl + '/Marti/api/missions/' + encodeURIComponent(cfg.missionName);",
    "var uploadUrl = baseUrl + '/Marti/sync/missionupload';",
    "var creatorUidRaw = String((cfg && cfg.creatorUid) || (tak && tak.creatorUid) || 'nodered').trim();",
    "var creator = encodeURIComponent(creatorUidRaw);",
    "",
    "var nUpload = 0, nSkip = 0, nDel = 0;",
    "for (var fname in arcgisFiles) {",
    "  if (!existingByName[fname] && !existingByName[arcgisFiles[fname].uid]) {",
    "    nUpload++;",
    "    node.send([",
    "      { payload: arcgisFiles[fname].cot,",
    "        _filename: arcgisFiles[fname]._fname,",
    "        _uploadUrl: uploadUrl,",
    "        _missionUrl: missionUrl + '/contents?creatorUid=' + creator,",
    "        _creatorUid: creatorUidRaw,",
    "        topic: topicCfg },",
    "      null, null",
    "    ]);",
    "  } else { nSkip++; }",
    "}",
    "",
    "if (!arcgisOk) {",
    "  node.send([null, null, {payload: topicCfg + ': ArcGIS failed — skipping deletes', topic: topicCfg}]);",
    "} else {",
    "  for (var name in existingByName) {",
    "    var matchesPrefix = name.indexOf(prefix) === 0;",
    "    if (!matchesPrefix) continue;",
    "    if (arcgisFiles[name]) continue;",
    "    if (arcgisFiles[name.replace(/\\.cot$/, '')]) continue;",
    "    var val = existingByName[name];",
    "    nDel++;",
    "    if (val.indexOf('_uid_') === 0) {",
    "      var uidVal = val.substring(5);",
    "      node.send([null, {",
    "        method: 'DELETE',",
    "        url: missionUrl + '/contents?uid=' + encodeURIComponent(uidVal) + '&creatorUid=' + creator,",
    "        headers: { 'accept': '*/*' },",
    "        payload: '', topic: topicCfg",
    "      }, null]);",
    "    } else {",
    "      node.send([null, {",
    "        method: 'DELETE',",
    "        url: missionUrl + '/contents?hash=' + encodeURIComponent(val) + '&creatorUid=' + creator,",
    "        headers: { 'accept': '*/*' },",
    "        payload: '', topic: topicCfg",
    "      }, null]);",
    "    }",
    "  }",
    "}",
    "",
    "var summary = topicCfg + ': ' + nUpload + ' upload, ' + nSkip + ' exist, ' + nDel + ' delete';",
    "node.status({text: nUpload + ' up, ' + nSkip + ' ok, ' + nDel + ' del'});",
    "node.send([null, null, {payload: summary, topic: topicCfg}]);",
    "return null;"
  ].join('\n');

  return [
    // ── Tab ──
    {
      id: FID, type: 'tab',
      label: feed.configName,
      disabled: false,
      info: 'DataSync engine for ' + feed.configName + '. Pure Mission API — no TCP broadcast.'
    },

    // ── Poll timer + config loader ──
    {
      id: P + 'inject', type: 'inject', z: FID,
      name: 'Poll timer (60s base)',
      props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
      repeat: '60', crontab: '',
      once: true, onceDelay: '30',
      topic: 'poll', payload: '', payloadType: 'date',
      x: 180, y: 80, wires: [[P + 'load']]
    },
    {
      id: P + 'load', type: 'function', z: FID,
      name: 'Load ' + feed.configName,
      func: [
        "var configs = global.get('arcgis_configs') || [];",
        "var tak = global.get('tak_settings') || {};",
        "var cfg = null;",
        "for (var i = 0; i < configs.length; i++) {",
        "  if (configs[i].configName === '" + feed.configName + "') { cfg = configs[i]; break; }",
        "}",
        "if (!cfg) { return null; }",
        "if (!tak.serverUrl) { node.warn('" + feed.configName + ": No TAK Server URL'); return null; }",
        "var lastPoll = flow.get('_lastPoll') || 0;",
        "var now = Date.now();",
        "var intervalMs = ((cfg.pollInterval || 5) * 60000);",
        "if (now - lastPoll < intervalMs) return null;",
        "flow.set('_lastPoll', now);",
        "node.status({text: 'Polling @ ' + new Date().toLocaleTimeString()});",
        "return { payload: cfg, takSettings: tak, topic: '" + feed.configName + "' };"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 400, y: 80, wires: [[P + 'build_q']]
    },

    // ── ArcGIS query ──
    {
      id: P + 'build_q', type: 'function', z: FID,
      name: 'Build ArcGIS query',
      func: FN_BUILD_QUERY,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 160, wires: [[P + 'http_ag']]
    },
    {
      id: P + 'http_ag', type: 'http request', z: FID,
      name: 'GET ArcGIS features',
      method: 'GET', ret: 'obj', paytoqs: 'ignore',
      url: '', tls: '', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 400, y: 160, wires: [[P + 'parse']]
    },

    // ── Parse & build CoT ──
    {
      id: P + 'parse', type: 'function', z: FID,
      name: 'Parse & build CoT',
      func: FN_PARSE_COT,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 600, y: 160, wires: [[P + 'build_sub', P + 'build_m']]
    },

    // ── Subscribe ──
    {
      id: P + 'build_sub', type: 'function', z: FID,
      name: 'Build subscribe URL',
      func: [
        "var tak = msg.takSettings;",
        "var cfg = msg._config;",
        "var missionName = cfg.missionName;",
        "var subscribed = global.get('_subscribed') || {};",
        "if (subscribed[missionName]) return null;",
        "subscribed[missionName] = Date.now();",
        "global.set('_subscribed', subscribed);",
        "var host = String(tak.serverUrl || '').replace(/^https?:\\/\\//i, '').replace(/\\/$/, '');",
        "var creatorUid = String((cfg && cfg.creatorUid) || (tak && tak.creatorUid) || 'nodered').trim();",
        "msg.url = 'https://' + host + ':' + (tak.missionApiPort || 8443)",
        "  + '/Marti/api/missions/' + encodeURIComponent(missionName)",
        "  + '/subscription?uid=' + encodeURIComponent(creatorUid);",
        "msg.method = 'PUT';",
        "msg.headers = { 'accept': '*/*', 'Content-Type': 'application/json' };",
        "if (tak && tak.missionBearerToken) {",
        "  msg.headers.Authorization = 'Bearer ' + String(tak.missionBearerToken).trim();",
        "}",
        "msg.payload = '';",
        "node.status({text: 'Subscribing as ' + creatorUid});",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 240, wires: [[P + 'http_sub']]
    },
    {
      id: P + 'http_sub', type: 'http request', z: FID,
      name: 'Subscribe to mission',
      method: 'use', ret: 'txt', paytoqs: 'body',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 380, y: 240, wires: [[]]
    },

    // ── GET mission + Reconcile ──
    {
      id: P + 'build_m', type: 'function', z: FID,
      name: 'Build mission GET URL',
      func: [
        "var tak = msg.takSettings;",
        "var cfg = msg._config;",
        "var host = String(tak.serverUrl || '').replace(/^https?:\\/\\//i, '').replace(/\\/$/, '');",
        "msg.url = 'https://' + host + ':' + (tak.missionApiPort || 8443)",
        "  + '/Marti/api/missions/' + encodeURIComponent(cfg.missionName);",
        "msg.headers = { 'accept': '*/*' };",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 560, y: 280, wires: [[P + 'http_m']]
    },
    {
      id: P + 'http_m', type: 'http request', z: FID,
      name: 'GET mission',
      method: 'GET', ret: 'obj', paytoqs: 'ignore',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 740, y: 320, wires: [[P + 'reconcile']]
    },
    {
      id: P + 'reconcile', type: 'function', z: FID,
      name: 'Reconcile (diff)',
      func: FN_RECONCILE,
      outputs: 3, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 400,
      wires: [[P + 'cot_to_xml'], [P + 'delay_del'], [P + 'debug_status']]
    },

    // ── Upload path: CoT → XML → multipart → POST upload → PUT hash ──
    {
      id: P + 'cot_to_xml', type: 'function', z: FID,
      name: 'CoT JSON → XML',
      func: FN_COT_TO_XML,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 400, y: 400, wires: [[P + 'build_upload']]
    },
    {
      id: P + 'build_upload', type: 'function', z: FID,
      name: 'Build multipart upload',
      func: [
        "var xml = (Buffer.isBuffer(msg.payload)) ? msg.payload.toString('utf8') : String(msg.payload);",
        "var hash = crypto.createHash('sha256').update(xml).digest('hex');",
        "var fname = msg._filename || 'upload.cot';",
        "var creator = msg._creatorUid || 'admin';",
        "var boundary = '----NRBoundary' + Date.now();",
        "var body = '--' + boundary + '\\r\\n'",
        "  + 'Content-Disposition: form-data; name=\"assetfile\"; filename=\"' + fname + '\"\\r\\n'",
        "  + 'Content-Type: application/xml\\r\\n\\r\\n'",
        "  + xml + '\\r\\n--' + boundary + '--\\r\\n';",
        "msg.payload = Buffer.from(body);",
        "msg.headers = { 'Content-Type': 'multipart/form-data; boundary=' + boundary };",
        "msg.url = msg._uploadUrl + '?hash=' + hash",
        "  + '&filename=' + encodeURIComponent(fname)",
        "  + '&creatorUid=' + encodeURIComponent(creator);",
        "msg.method = 'POST';",
        "msg._hash = hash;",
        "node.status({text: 'Uploading ' + fname.substring(0, 30)});",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '',
      libs: [{ var: 'crypto', module: 'crypto' }],
      x: 600, y: 400, wires: [[P + 'http_upload']]
    },
    {
      id: P + 'http_upload', type: 'http request', z: FID,
      name: 'POST Enterprise Sync',
      method: 'use', ret: 'txt', paytoqs: 'body',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 800, y: 400, wires: [[P + 'build_put_hash']]
    },
    {
      id: P + 'build_put_hash', type: 'function', z: FID,
      name: 'Build PUT hash',
      func: [
        "var hash = msg._hash;",
        "if (!hash || !msg._missionUrl) return null;",
        "var ok = msg.statusCode >= 200 && msg.statusCode < 300;",
        "if (!ok) {",
        "  node.status({text: 'Upload failed: ' + msg.statusCode});",
        "  return null;",
        "}",
        "msg.method = 'PUT';",
        "msg.url = msg._missionUrl;",
        "msg.headers = { 'accept': '*/*', 'Content-Type': 'application/json' };",
        "msg.payload = { hashes: [hash] };",
        "node.status({text: 'PUT hash ' + hash.substring(0, 12)});",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 960, y: 400, wires: [[P + 'http_action']]
    },

    // ── Mission API (PUT hash / DELETE) ──
    {
      id: P + 'http_action', type: 'http request', z: FID,
      name: 'Mission API (PUT/DELETE)',
      method: 'use', ret: 'txt', paytoqs: 'body',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 400, y: 480, wires: [[P + 'log_action']]
    },
    {
      id: P + 'delay_del', type: 'delay', z: FID,
      name: '', pauseType: 'rate',
      timeout: '1', timeoutUnits: 'seconds',
      rate: '5', nbRateUnits: '1', rateUnits: 'second',
      randomFirst: '1', randomLast: '5', randomUnits: 'seconds',
      drop: false, allowrate: false, outputs: 1,
      x: 180, y: 480, wires: [[P + 'http_action']]
    },
    {
      id: P + 'log_action', type: 'function', z: FID,
      name: 'Log API result',
      func: [
        "var code = msg.statusCode || '?';",
        "var method = msg.method || '?';",
        "var feed = msg.topic || 'unknown';",
        "var ok = (code >= 200 && code < 300);",
        "var label = feed + ' ' + method + ' → ' + code + (ok ? ' ✓' : ' ✗');",
        "if (!ok) {",
        "  var body = (typeof msg.payload === 'string') ? msg.payload.substring(0, 200) : '';",
        "  label += (body ? ' — ' + body : '');",
        "}",
        "node.status({text: method + ' → ' + code + (ok ? ' ✓' : ' ✗')});",
        "return [null, {payload: label, topic: feed}];"
      ].join('\n'),
      outputs: 2, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 600, y: 480, wires: [[], [P + 'debug_status']]
    },

    // ── Per-tab filterable debug node ──
    {
      id: P + 'debug_status', type: 'debug', z: FID,
      name: feed.configName + ' Status',
      active: true, tosidebar: true, console: false, tostatus: true,
      complete: 'payload', targetType: 'msg',
      statusVal: 'payload', statusType: 'auto',
      x: 800, y: 480, wires: []
    }
  ];
}

// ════════════════════════════════════════════════════════════════
//  Assembly
// ════════════════════════════════════════════════════════════════

const allFlows = [
  ...configFlows,
  ...tlsNodes,
  ...FEEDS.flatMap(f => makeEngineTab(f))
];

const out = path.join(__dirname, 'flows.json');
fs.writeFileSync(out, JSON.stringify(allFlows, null, 2));
console.log('flows.json generated  (' + allFlows.length + ' nodes, ' + FEEDS.length + ' engine tabs)  →  ' + out);
