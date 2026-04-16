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
    name: 'Migrate flow->global',
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
    name: 'POST /arcgis-tak/arcgis/service',
    url: '/arcgis-tak/arcgis/service', method: 'post',
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
    name: 'POST /arcgis-tak/arcgis/layer',
    url: '/arcgis-tak/arcgis/layer', method: 'post',
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
    name: 'POST /arcgis-tak/arcgis/sample',
    url: '/arcgis-tak/arcgis/sample', method: 'post',
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
    name: 'POST /arcgis-tak/arcgis/distinct',
    url: '/arcgis-tak/arcgis/distinct', method: 'post',
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
    name: 'POST /arcgis-tak/config/save',
    url: '/arcgis-tak/config/save', method: 'post',
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
      "  if (config.sourceType === 'faa_tfr') return c.configName === config.configName && c.sourceType === 'faa_tfr';",
      "  return c.source && config.source && c.source.serviceUrl === config.source.serviceUrl",
      "      && c.source.layerId === config.source.layerId;",
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
    name: 'POST /arcgis-tak/config/save-all',
    url: '/arcgis-tak/config/save-all', method: 'post',
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
    name: 'GET /arcgis-tak/config/load',
    url: '/arcgis-tak/config/load', method: 'get',
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
    name: 'POST /arcgis-tak/tak-settings/save',
    url: '/arcgis-tak/tak-settings/save', method: 'post',
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
    name: 'GET /arcgis-tak/tak-settings/load',
    url: '/arcgis-tak/tak-settings/load', method: 'get',
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
    name: 'POST /arcgis-tak/tak/force-subscribe',
    url: '/arcgis-tak/tak/force-subscribe', method: 'post',
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
    cert: '/certs/admin.pem', key: '/certs/admin.key', ca: '',
    certname: '', keyname: '', caname: '',
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
  "node.warn(msg.topic + ' ArcGIS query where: ' + where);",
  "msg._config = cfg;",
  "return msg;"
].join('\n');

const FN_PARSE_COT = [
  "var features = (msg.payload && msg.payload.features) || [];",
  "var cfg = msg._config;",
  "msg._arcgisStatus = msg.statusCode || 200;",
  "if (features.length === 0) {",
  "  node.warn(cfg.configName + ': 0 features from ArcGIS (status ' + msg._arcgisStatus + ')');",
  "  msg._features = [];",
  "  msg._config = cfg;",
  "  return msg;",
  "}",
  "",
  "var dedupField = (cfg.mapping && cfg.mapping.dedupField) || null;",
  "var timeField  = (cfg.mapping && cfg.mapping.timeField)  || null;",
  "if (dedupField && timeField) {",
  "  var groups = {};",
  "  for (var di = 0; di < features.length; di++) {",
  "    var da = features[di].attributes || {};",
  "    var key = String(da[dedupField] || '');",
  "    if (!groups[key] || (Number(da[timeField] || 0) > Number((groups[key].attributes || {})[timeField] || 0))) {",
  "      groups[key] = features[di];",
  "    }",
  "  }",
  "  var before = features.length;",
  "  features = Object.keys(groups).map(function(k) { return groups[k]; });",
  "  if (features.length < before) {",
  "    node.warn(cfg.configName + ': dedup by ' + dedupField + ': ' + before + ' -> ' + features.length + ' features');",
  "  }",
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
  "function djb2(s) {",
  "  var h = 5381;",
  "  for (var c = 0; c < s.length; c++) { h = ((h << 5) + h) + s.charCodeAt(c); h = h & h; }",
  "  return String(h >>> 0);",
  "}",
  "",
  "var results = [];",
  "for (var i = 0; i < features.length; i++) {",
  "  var f = features[i];",
  "  var a = f.attributes || {};",
  "  var g = f.geometry;",
  "  if (!g) continue;",
  "  var _hash = djb2(JSON.stringify(f));",
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
  "    _hash: _hash,",
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
  "    var la = d.link[i]._attributes;",
  "    if (la.point) {",
  "      xml += '<link point=\"' + la.point + '\"/>';",
  "    } else if (la.url) {",
  "      xml += '<link url=\"' + la.url.replace(/&/g,'&amp;') + '\"';",
  "      if (la.remarks) xml += ' remarks=\"' + la.remarks.replace(/&/g,'&amp;').replace(/\"/g,'&quot;') + '\"';",
  "      if (la.relation) xml += ' relation=\"' + la.relation + '\"';",
  "      if (la.mime) xml += ' mime=\"' + la.mime + '\"';",
  "      xml += '/>';",
  "    }",
  "  }",
  "}",
  "",
  "if (d.height && d.height[0]) xml += '<height value=\"' + d.height[0]._attributes.value + '\"/>';",
  "if (d.status && d.status[0]) xml += '<status readiness=\"' + d.status[0]._attributes.readiness + '\"/>';",
  "if (d.precisionlocation && d.precisionlocation[0]) xml += '<precisionlocation altsrc=\"' + d.precisionlocation[0]._attributes.altsrc + '\"/>';",
  "if (d._geofence && d._geofence[0]) {",
  "  var gf = d._geofence[0]._attributes;",
  "  xml += '<_geofence elevationMonitored=\"' + gf.elevationMonitored + '\"'",
  "    + ' minElevation=\"' + gf.minElevation + '\"'",
  "    + ' monitor=\"' + gf.monitor + '\"'",
  "    + ' trigger=\"' + gf.trigger + '\"'",
  "    + ' tracking=\"' + gf.tracking + '\"'",
  "    + ' maxElevation=\"' + gf.maxElevation + '\"'",
  "    + ' boundingSphere=\"' + gf.boundingSphere + '\"/>';",
  "}",
  "",
  "if (msg._missionName) {",
  "  xml += '<marti><dest mission=\"' + msg._missionName + '\"/></marti>';",
  "}",
  "xml += '</detail></event>\\n';",
  "",
  "msg.payload = Buffer.from(xml, 'utf8');",
  "if (msg.payload.length > 5000) node.warn('CoT ' + a.uid + ': ' + msg.payload.length + ' bytes');",
  "return msg;"
].join('\n');

// ════════════════════════════════════════════════════════════════
//  Per-feed engine tab generator
// ════════════════════════════════════════════════════════════════

function makeEngineTab(feed) {
  const FID = 'flow_eng_' + feed.id;
  const P   = feed.id + '_';

  // Reconcile — stream ALL CoTs via TCP, PUT new UIDs, DELETE stale
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
    "var existing = {};",
    "try {",
    "  var mission = null;",
    "  if (mData && mData.data) {",
    "    mission = Array.isArray(mData.data) ? mData.data[0] : mData.data;",
    "  }",
    "  if (mission && mission.uids) {",
    "    for (var i=0;i<mission.uids.length;i++) {",
    "      var u = mission.uids[i];",
    "      var uid = (typeof u === 'string') ? u : (u.data || u.uid || u);",
    "      if (typeof uid === 'string') existing[uid] = true;",
    "    }",
    "  }",
    "  if (mission && mission.contents) {",
    "    for (var i=0;i<mission.contents.length;i++) {",
    "      var c = mission.contents[i];",
    "      if (c.data && c.data.uid) existing[c.data.uid] = true;",
    "    }",
    "  }",
    "} catch(e) { node.warn('Could not parse mission contents: ' + e.message); }",
    "",
    "var arcgis = {};",
    "for (var i=0;i<features.length;i++) arcgis[features[i].uid] = features[i];",
    "",
    "var host = String(tak.serverUrl || '').replace(/^https?:\\/\\//i, '').replace(/\\/$/, '');",
    "var baseUrl = 'https://' + host + ':' + (tak.missionApiPort || 8443)",
    "  + '/Marti/api/missions/' + encodeURIComponent(cfg.missionName);",
    "var creatorUidRaw = String((cfg && cfg.creatorUid) || (tak && tak.creatorUid) || 'nodered').trim();",
    "var creator = encodeURIComponent(creatorUidRaw);",
    "",
    "var cookie = msg._missionCookie || '';",
    "var bearer = msg._missionBearer || '';",
    "if (!cookie && msg.responseCookies && msg.responseCookies.JSESSIONID && msg.responseCookies.JSESSIONID.value) {",
    "  cookie = 'JSESSIONID=' + String(msg.responseCookies.JSESSIONID.value);",
    "}",
    "if (!cookie && msg.headers && msg.headers['set-cookie']) {",
    "  var sc = msg.headers['set-cookie'];",
    "  if (Array.isArray(sc) && sc.length) {",
    "    var a2 = String(sc[0]).match(/JSESSIONID=([^;]+)/);",
    "    if (a2 && a2[1]) cookie = 'JSESSIONID=' + a2[1];",
    "  } else if (typeof sc === 'string') {",
    "    var b = sc.match(/JSESSIONID=([^;]+)/);",
    "    if (b && b[1]) cookie = 'JSESSIONID=' + b[1];",
    "  }",
    "}",
    "",
    "var prevHashes = flow.get('_featureHashes') || {};",
    "var coldStart = (Object.keys(prevHashes).length === 0);",
    "var newHashes = {};",
    "var nStream = 0, nSkip = 0, nPut = 0, nDel = 0, nSeed = 0;",
    "var newUids = [];",
    "for (var uid in arcgis) {",
    "  var feat = arcgis[uid];",
    "  newHashes[uid] = feat._hash || '';",
    "  var changed = (prevHashes[uid] !== newHashes[uid]);",
    "  if (!existing[uid]) { nPut++; newUids.push(uid); }",
    "  if (coldStart && existing[uid]) {",
    "    nSeed++;",
    "  } else if (changed || !existing[uid]) {",
    "    nStream++;",
    "    node.send([",
    "      { payload: feat.cot, topic: topicCfg,",
    "        _missionName: cfg.missionName,",
    "        host: host,",
    "        port: Number(tak.streamingPort || tak.streamPort || 8089) },",
    "      null",
    "    ]);",
    "  } else { nSkip++; }",
    "}",
    "flow.set('_featureHashes', newHashes);",
    "if (coldStart) node.warn(topicCfg + ' cold start: seeded ' + nSeed + ' hashes without re-streaming');",
    "",
    "if (newUids.length > 0) {",
    "  node.send([",
    "    { topic: topicCfg, payload: {},",
    "      _missionCookie: cookie,",
    "      _missionBearer: bearer,",
    "      _putUrl: baseUrl + '/contents?creatorUid=' + creator,",
    "      _putUids: newUids },",
    "    null",
    "  ]);",
    "}",
    "",
    "if (!arcgisOk) {",
    "  node.warn(topicCfg + ': ArcGIS fetch failed (status ' + msg._arcgisStatus + ') - skipping deletes');",
    "} else {",
    "  for (var uid in existing) {",
    "    if (uid.indexOf(prefix) === 0 && !arcgis[uid]) {",
    "      nDel++;",
    "      node.send([null, {",
    "        method: 'DELETE',",
    "        url: baseUrl + '/contents?uid=' + encodeURIComponent(uid) + '&creatorUid=' + creator,",
    "        headers: { 'accept': '*/*' },",
    "        _missionCookie: cookie,",
    "        _missionBearer: bearer,",
    "        payload: '',",
    "        topic: topicCfg",
    "      }]);",
    "    }",
    "  }",
    "}",
    "",
    "node.warn(topicCfg + ' reconcile: ' + nStream + ' streamed, ' + nSkip + ' unchanged, ' + nPut + ' PUT, ' + nDel + ' DELETE, '",
    "  + Object.keys(arcgis).length + ' ArcGIS, ' + Object.keys(existing).length + ' in mission');",
    "return null;"
  ].join('\n');

  return [
    // ── Tab ──
    {
      id: FID, type: 'tab',
      label: feed.configName,
      disabled: false,
      info: 'DataSync engine for ' + feed.configName + '. Stream CoT via TCP, PUT UIDs to mission.'
    },

    // ── SA ident (identify TCP connection to TAK Server) ──
    {
      id: P + 'sa_inject', type: 'inject', z: FID,
      name: 'SA ident (startup)',
      props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
      repeat: '600', crontab: '',
      once: true, onceDelay: '10',
      topic: 'sa-ident', payload: '', payloadType: 'date',
      x: 180, y: 40, wires: [[P + 'sa_build']]
    },
    {
      id: P + 'sa_build', type: 'function', z: FID,
      name: 'Build SA ident CoT',
      func: [
        "var tak = global.get('tak_settings') || {};",
        "var configs = global.get('arcgis_configs') || [];",
        "var cfg = null;",
        "for (var i = 0; i < configs.length; i++) {",
        "  if (configs[i].configName === '" + feed.configName + "') { cfg = configs[i]; break; }",
        "}",
        "var creatorUid = '';",
        "if (cfg && cfg.creatorUid) creatorUid = String(cfg.creatorUid).trim();",
        "if (!creatorUid && tak.creatorUid) creatorUid = String(tak.creatorUid).trim();",
        "if (!creatorUid) { return null; }",
        "",
        "var now = new Date();",
        "var stale = new Date(now.getTime() + 120000);",
        "msg.payload = {",
        "  event: {",
        "    _attributes: {",
        "      version: '2.0', uid: creatorUid,",
        "      type: 'a-f-G-E-S', how: 'h-g-i-g-o',",
        "      time: now.toISOString(), start: now.toISOString(), stale: stale.toISOString()",
        "    },",
        "    point: { _attributes: { lat: '0', lon: '0', hae: '0', ce: '9999999', le: '9999999' } },",
        "    detail: {",
        "      contact: [{ _attributes: { callsign: creatorUid } }],",
        "      __group: [{ _attributes: { name: 'Purple', role: 'Team Member' } }]",
        "    }",
        "  }",
        "};",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 400, y: 40, wires: [[P + 'cot_to_xml']]
    },

    // ── Poll timer + config loader ──
    {
      id: P + 'inject', type: 'inject', z: FID,
      name: 'Poll timer (60s base)',
      props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
      repeat: '60', crontab: '',
      once: true, onceDelay: '30',
      topic: 'poll', payload: '', payloadType: 'date',
      x: 180, y: 120, wires: [[P + 'load']]
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
        "node.warn('Polling: " + feed.configName + "');",
        "return { payload: cfg, takSettings: tak, topic: '" + feed.configName + "' };"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 400, y: 120, wires: [[P + 'build_q']]
    },

    // ── ArcGIS query ──
    {
      id: P + 'build_q', type: 'function', z: FID,
      name: 'Build ArcGIS query',
      _templateKey: 'arcgis.build_query',
      func: FN_BUILD_QUERY,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 200, wires: [[P + 'http_ag']]
    },
    {
      id: P + 'http_ag', type: 'http request', z: FID,
      name: 'GET ArcGIS features',
      method: 'GET', ret: 'obj', paytoqs: 'ignore',
      url: '', tls: '', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 400, y: 200, wires: [[P + 'parse']]
    },

    // ── Parse & build CoT ──
    {
      id: P + 'parse', type: 'function', z: FID,
      name: 'Parse & build CoT',
      _templateKey: 'arcgis.parse_cot',
      func: FN_PARSE_COT,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 600, y: 200, wires: [[P + 'build_sub', P + 'build_m']]
    },

    // ── Subscribe ──
    {
      id: P + 'build_sub', type: 'function', z: FID,
      name: 'Build subscribe URL',
      _templateKey: 'shared.build_sub',
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
        "node.warn('Subscribing to ' + missionName + ' as ' + creatorUid);",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 300, wires: [[P + 'http_sub']]
    },
    {
      id: P + 'http_sub', type: 'http request', z: FID,
      name: 'Subscribe to mission',
      method: 'use', ret: 'txt', paytoqs: 'ignore',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 380, y: 300, wires: [[P + 'debug_sub']]
    },
    {
      id: P + 'debug_sub', type: 'debug', z: FID,
      name: 'Subscribe result',
      active: true, tosidebar: true, console: false, tostatus: true,
      complete: 'true', targetType: 'full',
      statusVal: 'topic', statusType: 'auto',
      x: 580, y: 300, wires: []
    },

    // ── GET mission + Reconcile ──
    {
      id: P + 'build_m', type: 'function', z: FID,
      name: 'Build mission GET URL',
      _templateKey: 'shared.build_m',
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
      x: 560, y: 320, wires: [[P + 'http_m']]
    },
    {
      id: P + 'http_m', type: 'http request', z: FID,
      name: 'GET mission',
      method: 'GET', ret: 'obj', paytoqs: 'ignore',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 740, y: 360, wires: [[P + 'reconcile']]
    },
    {
      id: P + 'reconcile', type: 'function', z: FID,
      name: 'Reconcile (diff)',
      _templateKey: 'arcgis.reconcile',
      func: FN_RECONCILE,
      outputs: 2, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 440,
      wires: [[P + 'cot_to_xml', P + 'delay_put'], [P + 'delay_del']]
    },

    // ── CoT -> XML -> Rate limiter -> TCP out (stream to TAK Server) ──
    {
      id: P + 'cot_to_xml', type: 'function', z: FID,
      name: 'CoT JSON -> XML',
      _templateKey: 'shared.cot_to_xml',
      func: FN_COT_TO_XML,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 520, wires: [[P + 'rate_stream']]
    },
    {
      id: P + 'rate_stream', type: 'delay', z: FID,
      name: 'Throttle (10/sec)', pauseType: 'rate',
      timeout: '1', timeoutUnits: 'seconds',
      rate: '10', nbRateUnits: '1', rateUnits: 'second',
      randomFirst: '1', randomLast: '5', randomUnits: 'seconds',
      drop: false, allowrate: false, outputs: 1,
      x: 400, y: 520, wires: [[P + 'tcp_out']]
    },
    {
      id: P + 'tcp_out', type: 'tcp out', z: FID,
      name: 'CoT -> TAK :8089',
      host: 'host.docker.internal', port: '8089', beserver: 'client',
      base64: false, end: false, tls: 'tls_tak',
      x: 600, y: 520, wires: []
    },
    {
      id: P + 'catch_stream', type: 'catch', z: FID,
      name: 'Stream errors',
      scope: [P + 'tcp_out'],
      uncaught: false,
      x: 180, y: 580, wires: [[P + 'debug_stream']]
    },
    {
      id: P + 'debug_stream', type: 'debug', z: FID,
      name: 'Stream error',
      active: true, tosidebar: true, console: false, tostatus: true,
      complete: 'true', targetType: 'full',
      statusVal: '', statusType: 'auto',
      x: 400, y: 580, wires: []
    },

    // ── Delay -> PUT new UIDs to mission ──
    {
      id: P + 'delay_put', type: 'delay', z: FID,
      name: 'Wait 30s for cache',
      pauseType: 'delay', timeout: '30', timeoutUnits: 'seconds',
      rate: '1', nbRateUnits: '1', rateUnits: 'second',
      randomFirst: '1', randomLast: '5', randomUnits: 'seconds',
      drop: false, allowrate: false, outputs: 1,
      x: 400, y: 440, wires: [[P + 'build_put']]
    },
    {
      id: P + 'build_put', type: 'function', z: FID,
      name: 'Build PUT UIDs',
      _templateKey: 'shared.build_put',
      func: [
        "var uids = msg._putUids || [];",
        "if (!msg._putUrl || uids.length === 0) return null;",
        "msg.method = 'PUT';",
        "msg.url = msg._putUrl;",
        "msg.headers = { 'accept': '*/*', 'Content-Type': 'application/json' };",
        "if (msg._missionCookie) msg.headers.Cookie = msg._missionCookie;",
        "if (msg._missionBearer) msg.headers.Authorization = 'Bearer ' + msg._missionBearer;",
        "msg.payload = { uids: uids };",
        "node.warn(msg.topic + ' PUT -> ' + uids.length + ' UIDs -> ' + msg.url);",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 600, y: 440, wires: [[P + 'http_action']]
    },

    // ── Mission API (PUT/DELETE) ──
    {
      id: P + 'http_action', type: 'http request', z: FID,
      name: 'Mission API (PUT/DELETE)',
      method: 'use', ret: 'txt', paytoqs: 'body',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 800, y: 440, wires: [[P + 'log_action']]
    },
    {
      id: P + 'delay_del', type: 'delay', z: FID,
      name: '', pauseType: 'delay', timeout: '1', timeoutUnits: 'seconds',
      rate: '1', nbRateUnits: '1', rateUnits: 'second',
      randomFirst: '1', randomLast: '5', randomUnits: 'seconds',
      drop: false, allowrate: false, outputs: 1,
      x: 600, y: 490, wires: [[P + 'http_action']]
    },
    {
      id: P + 'log_action', type: 'function', z: FID,
      name: 'Log API result',
      _templateKey: 'shared.log_action',
      func: [
        "var code = msg.statusCode || '?';",
        "var method = msg.method || '?';",
        "var feed = msg.topic || 'unknown';",
        "var ok = (code >= 200 && code < 300);",
        "var label = feed + ' ' + method + ' -> ' + code + (ok ? ' OK' : ' FAIL');",
        "if (!ok) {",
        "  var body = (typeof msg.payload === 'string') ? msg.payload.substring(0, 200) : '';",
        "  node.warn(label + (body ? ' - ' + body : ''));",
        "} else {",
        "  node.warn(label);",
        "}",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 960, y: 440, wires: [[]]
    }
  ];
}

// ════════════════════════════════════════════════════════════════
//  Per-feed TFR engine tab generator
// ════════════════════════════════════════════════════════════════

const FN_TFR_FILTER_SPLIT = [
  "var tfrs = msg.payload || [];",
  "var cfg = msg._config;",
  "var states = cfg.tfrStates || [];",
  "",
  "// Build set of enabled type strings from config",
  "var typeMap = {",
  "  hazards: 'HAZARDS', security: 'SECURITY', vip: 'VIP',",
  "  spaceOps: 'SPACE OPERATIONS', airShows: 'AIR SHOWS/SPORTS',",
  "  uas: 'UAS PUBLIC GATHERING', special: 'SPECIAL'",
  "};",
  "var enabledTypes = [];",
  "var tt = cfg.tfrTypes || {};",
  "for (var k in typeMap) {",
  "  if (tt[k] !== false) enabledTypes.push(typeMap[k]);",
  "}",
  "",
  "// Haversine distance in nautical miles",
  "function distNM(lat1, lon1, lat2, lon2) {",
  "  var R = 3440.065; // earth radius NM",
  "  var dLat = (lat2 - lat1) * Math.PI / 180;",
  "  var dLon = (lon2 - lon1) * Math.PI / 180;",
  "  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +",
  "    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *",
  "    Math.sin(dLon/2) * Math.sin(dLon/2);",
  "  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));",
  "}",
  "",
  "var rad = cfg.tfrRadius;",
  "var filtered = [];",
  "for (var i = 0; i < tfrs.length; i++) {",
  "  var t = tfrs[i];",
  "  // State filter",
  "  if (states.length > 0 && states.indexOf(t.state) < 0) continue;",
  "  // Type filter",
  "  if (enabledTypes.indexOf(t.type) < 0) continue;",
  "  var nid = t.notam_id.replace(/\\//g, '_');",
  "  filtered.push({",
  "    url: 'https://tfr.faa.gov/download/detail_' + nid + '.xml',",
  "    notamId: nid, state: t.state, type: t.type,",
  "    lat: t.lat, lon: t.lon",
  "  });",
  "}",
  "",
  "// Radius filter (applied after state+type since API gives lat/lon in description only)",
  "// The API doesn't provide lat/lon directly, so radius is applied in the CoT builder",
  "// after parsing the XML. Store the radius config for downstream use.",
  "",
  "node.warn(cfg.configName + ': ' + filtered.length + ' TFRs after filter (from ' + tfrs.length + ', types: ' + enabledTypes.length + ')');",
  "flow.set('_tfrUids', []);",
  "flow.set('_tfrCount', filtered.length);",
  "flow.set('_tfrDone', 0);",
  "",
  "var msgs = [];",
  "for (var i = 0; i < filtered.length; i++) {",
  "  msgs.push({ url: filtered[i].url, method: 'GET',",
  "    _tfrMeta: filtered[i], _config: cfg, takSettings: msg.takSettings,",
  "    topic: cfg.configName });",
  "}",
  "return [msgs];"
].join('\n');

const FN_TFR_PARSE_BUILD_COT = [
  "var xml = msg.payload;",
  "var cfg = msg._config;",
  "",
  "function hexArgb(hex, a) {",
  "  var r = parseInt(hex.substr(1,2),16);",
  "  var g = parseInt(hex.substr(3,2),16);",
  "  var b = parseInt(hex.substr(5,2),16);",
  "  var ai = Math.round((a !== undefined ? a : 1) * 255);",
  "  return ((ai << 24) | (r << 16) | (g << 8) | b);",
  "}",
  "",
  "var sColor = (cfg.style && cfg.style.strokeColor) || '#FF6600';",
  "var fColor = (cfg.style && cfg.style.fillColor) || '#FF6600';",
  "var rawAlpha = cfg.style && cfg.style.fillAlpha;",
  "var fa = (typeof rawAlpha === 'number') ? rawAlpha / 100 : 0.25;",
  "var strokeArgb = hexArgb(sColor, 1);",
  "var fillArgb = hexArgb(fColor, fa);",
  "",
  "function distNM(lat1, lon1, lat2, lon2) {",
  "  var R = 3440.065;",
  "  var dLat = (lat2 - lat1) * Math.PI / 180;",
  "  var dLon = (lon2 - lon1) * Math.PI / 180;",
  "  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +",
  "    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *",
  "    Math.sin(dLon/2) * Math.sin(dLon/2);",
  "  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));",
  "}",
  "",
  "try {",
  "  var xnotam = xml['XNOTAM-Update'];",
  "  if (!xnotam || !xnotam.Group) throw new Error('Invalid XNOTAM');",
  "  var tfr_dict = xnotam.Group[0].Add[0].Not[0];",
  "  var tfr_info = tfr_dict.TfrNot[0].TFRAreaGroup;",
  "  var meta = msg._tfrMeta || {};",
  "  // Prefer list API notam_id (e.g. 6/4160 -> 6_4160). XML txtLocalName / hardcoded FDC series often mismatches FAA site.",
  "  var tfrId = meta.notamId || '';",
  "  if (!tfrId && tfr_dict.NotUid && tfr_dict.NotUid[0].txtLocalName) {",
  "    tfrId = String(tfr_dict.NotUid[0].txtLocalName[0]).replace(/\\//g, '_');",
  "  }",
  "  var remarks = (tfr_dict.txtDescrTraditional && tfr_dict.txtDescrTraditional[0]) || '';",
  "  var detailPageUrl = 'https://tfr.faa.gov/save_pages/detail_' + tfrId + '.html';",
  "  var detailViewerUrl = 'https://tfr.faa.gov/tfr3/?page=detail_' + tfrId;",
  "",
  "  var now = new Date();",
  "  var staleMs = ((cfg.tfrPollInterval || 15) * 60000) + 120000;",
  "  var stale = new Date(now.getTime() + staleMs);",
  "",
  "  function parseDMS(s) {",
  "    s = String(s).trim();",
  "    var m = s.match(/^(\\d{2,3})(\\d{2})(\\d{2}(?:\\.\\d+)?)([NSEW])$/);",
  "    if (m) {",
  "      var deg = parseInt(m[1]) + parseInt(m[2])/60 + parseFloat(m[3])/3600;",
  "      if (m[4] === 'S' || m[4] === 'W') deg = -deg;",
  "      return deg;",
  "    }",
  "    var n = parseFloat(s.replace(/[NSEW]/g, ''));",
  "    if (s.indexOf('S') >= 0 || s.indexOf('W') >= 0) n = -n;",
  "    return n;",
  "  }",
  "",
  "  function circleToRing(cLat, cLon, radiusNM, nPts) {",
  "    var ring = [];",
  "    var rLat = (radiusNM / 60) * (Math.PI / 180);",
  "    var rLon = rLat / Math.cos(cLat * Math.PI / 180);",
  "    for (var k = 0; k < nPts; k++) {",
  "      var angle = (2 * Math.PI * k) / nPts;",
  "      var lat = cLat + (radiusNM / 60) * Math.cos(angle);",
  "      var lon = cLon + (radiusNM / 60 / Math.cos(cLat * Math.PI / 180)) * Math.sin(angle);",
  "      ring.push({ lat: lat, lon: lon });",
  "    }",
  "    ring.push(ring[0]);",
  "    return ring;",
  "  }",
  "",
  "  for (var i = 0; i < tfr_info.length; i++) {",
  "    var isShape = !!tfr_info[i].aseShapes;",
  "    var isCircle = !isShape && tfr_info[i].aseCircle;",
  "    if (!isShape && !isCircle) continue;",
  "",
  "    var labelArea = '';",
  "    if (i >= 1 && tfr_info[i].aseTFRArea && tfr_info[i].aseTFRArea[0].txtName) {",
  "      labelArea = tfr_info[i].aseTFRArea[0].txtName[0];",
  "    }",
  "    var idLabel = 'tfr-' + String(tfrId).replace(/_/g, '-');",
  "    var baseCallsign = (idLabel + (labelArea ? ' ' + labelArea : '')).trim();",
  "    var callsign = baseCallsign;",
  "    var lm = cfg.tfrLabelMode || 'faa_sequence';",
  "    if (lm === 'notam_first_line' && remarks) {",
  "      var lines = remarks.split(/\\r?\\n/);",
  "      var firstLn = '';",
  "      for (var li = 0; li < lines.length; li++) { if (lines[li] && String(lines[li]).trim()) { firstLn = String(lines[li]).trim(); break; } }",
  "      if (firstLn) callsign = firstLn.length > 96 ? firstLn.substring(0, 93) + '...' : firstLn;",
  "    } else if (lm === 'notam_short' && remarks) {",
  "      var one = String(remarks).replace(/\\s+/g, ' ').trim();",
  "      if (one.length > 64) one = one.substring(0, 61) + '...';",
  "      callsign = one;",
  "    } else if (lm === 'area_name' && labelArea) {",
  "      callsign = String(labelArea).trim();",
  "    }",
  "    callsign = String(callsign).replace(/[\\x00-\\x1f\\x7f]/g, '').replace(/\"/g, \"'\").trim();",
  "    if (!callsign) callsign = baseCallsign;",
  "    var uid = (cfg.uidPrefix || 'tfr-') + tfrId + (labelArea ? '_' + labelArea.replace(/[^a-zA-Z0-9]/g,'_') : '');",
  "",
  "    var lat, lon, links = [];",
  "",
  "    if (isCircle) {",
  "      var circ = tfr_info[i].aseCircle[0];",
  "      lat = parseDMS(String(circ.geoLatCen[0]));",
  "      lon = parseDMS(String(circ.geoLongCen[0]));",
  "      var radVal = parseFloat(circ.valRadiusArc[0]) || 0;",
  "      var radUnit = String(circ.uomRadiusArc ? circ.uomRadiusArc[0] : 'NM').toUpperCase();",
  "      if (radUnit === 'KM') radVal *= 0.539957;",
  "      else if (radUnit === 'M') radVal *= 0.000539957;",
  "      var ring = circleToRing(lat, lon, radVal, 36);",
  "      for (var j = 0; j < ring.length; j++) {",
  "        links.push({ _attributes: { point: ring[j].lat + ',' + ring[j].lon } });",
  "      }",
  "    } else {",
  "      var firstAvx = tfr_info[i].aseShapes[0].Abd[0].Avx[0];",
  "      lat = parseDMS(String(firstAvx.geoLat[0]));",
  "      lon = parseDMS(String(firstAvx.geoLong[0]));",
  "      var linkPoints = tfr_info[i].abdMergedArea[0].Avx;",
  "      for (var j = 0; j < linkPoints.length; j++) {",
  "        var ptLat = parseDMS(String(linkPoints[j].geoLat[0]));",
  "        var ptLon = parseDMS(String(linkPoints[j].geoLong[0]));",
  "        links.push({ _attributes: { point: ptLat + ',' + ptLon } });",
  "      }",
  "    }",
  "",
  "    var rad = cfg.tfrRadius;",
  "    if (rad && rad.lat != null && rad.lon != null && rad.radiusNM) {",
  "      var d = distNM(rad.lat, rad.lon, lat, lon);",
  "      if (d > rad.radiusNM) { continue; }",
  "    }",
  "",
  "    var heightFt = 0;",
  "    if (tfr_info[i].aseTFRArea && tfr_info[i].aseTFRArea[0].valDistVerUpper) {",
  "      heightFt = parseFloat(tfr_info[i].aseTFRArea[0].valDistVerUpper[0]) || 0;",
  "    }",
  "    var heightM = heightFt * 0.3048;",
  "",
  "    // Add FAA detail page as Associated Link (like tfr2cot)",
  "    links.push({ _attributes: {",
  "      url: detailUrl, relation: 'r-u', mime: 'text/html',",
  "      remarks: 'FAA TFR Detail: ' + callsign",
  "    } });",
  "",
  "    // Build rich remarks: NOTAM text + effective dates + FAA link",
  "    var richRemarks = remarks;",
  "    if (tfr_info[i].aseTFRArea && tfr_info[i].aseTFRArea[0]) {",
  "      var area = tfr_info[i].aseTFRArea[0];",
  "      if (area.dateEffective && area.dateEffective[0]) richRemarks += '\\nEffective: ' + area.dateEffective[0];",
  "      if (area.dateExpire && area.dateExpire[0]) richRemarks += '\\nExpires: ' + area.dateExpire[0];",
  "      if (area.valDistVerLower) richRemarks += '\\nFloor: ' + (area.valDistVerLower[0] || '0') + ' ft';",
  "      if (area.valDistVerUpper) richRemarks += '\\nCeiling: ' + (area.valDistVerUpper[0] || '0') + ' ft';",
  "    }",
  "    richRemarks += '\\n' + detailPageUrl + '\\n' + detailViewerUrl;",
  "",
  "    var detail = {",
  "      contact: [{ _attributes: { callsign: callsign } }],",
  "      remarks: richRemarks,",
  "      strokeColor: [{ _attributes: { value: String(strokeArgb) } }],",
  "      strokeWeight: [{ _attributes: { value: '2.0' } }],",
  "      fillColor: [{ _attributes: { value: String(fillArgb) } }],",
  "      labels_on: [{ _attributes: { value: (cfg.tfrLabelsOn !== false) ? 'true' : 'false' } }],",
  "      status: [{ _attributes: { readiness: 'true' } }],",
  "      link: links",
  "    };",
  "",
  "    if (cfg.tfr3D && heightM > 0) {",
  "      detail.height = [{ _attributes: { value: String(heightM) } }];",
  "      detail._geofence = [{ _attributes: {",
  "        elevationMonitored: 'true', minElevation: '0.0',",
  "        monitor: 'All', trigger: 'Both', tracking: 'false',",
  "        maxElevation: String(heightM), boundingSphere: '96000.0'",
  "      } }];",
  "    }",
  "",
  "    var uids = flow.get('_tfrUids') || [];",
  "    uids.push(uid);",
  "    flow.set('_tfrUids', uids);",
  "",
  "    node.send({",
  "      payload: { event: {",
  "        _attributes: { version: '2.0', uid: uid, type: 'u-d-f', how: 'h-e',",
  "          time: now.toISOString(), start: now.toISOString(), stale: stale.toISOString() },",
  "        point: { _attributes: { lat: String(lat), lon: String(lon), hae: '9999999.0', ce: '9999999.0', le: '9999999.0' } },",
  "        detail: detail",
  "      } },",
  "      topic: cfg.configName, _missionName: cfg.missionName",
  "    });",
  "  }",
  "} catch(e) { node.warn(cfg.configName + ' TFR parse error: ' + e.message); }",
  "",
  "var done = (flow.get('_tfrDone') || 0) + 1;",
  "flow.set('_tfrDone', done);",
  "node.warn(cfg.configName + ': TFR ' + done + '/' + flow.get('_tfrCount') + ' parsed');",
  "return null;"
].join('\n');

const FN_TFR_RECONCILE = [
  "var mData = msg.payload;",
  "var cfg = msg._config;",
  "var tak = msg.takSettings;",
  "var topicCfg = cfg.configName || 'unnamed';",
  "msg.topic = topicCfg;",
  "var prefix = cfg.uidPrefix || 'tfr-';",
  "",
  "var tfrUids = flow.get('_tfrUids') || [];",
  "if (tfrUids.length === 0) {",
  "  node.warn(topicCfg + ' reconcile: skipping — poll has not produced TFR data yet');",
  "  return null;",
  "}",
  "var tfrMap = {};",
  "for (var i = 0; i < tfrUids.length; i++) tfrMap[tfrUids[i]] = true;",
  "",
  "var existing = {};",
  "try {",
  "  var mission = null;",
  "  if (mData && mData.data) {",
  "    mission = Array.isArray(mData.data) ? mData.data[0] : mData.data;",
  "  }",
  "  if (mission && mission.uids) {",
  "    for (var i=0;i<mission.uids.length;i++) {",
  "      var u = mission.uids[i];",
  "      var uid = (typeof u === 'string') ? u : (u.data || u.uid || u);",
  "      if (typeof uid === 'string') existing[uid] = true;",
  "    }",
  "  }",
  "  if (mission && mission.contents) {",
  "    for (var i=0;i<mission.contents.length;i++) {",
  "      var c = mission.contents[i];",
  "      if (c.data && c.data.uid) existing[c.data.uid] = true;",
  "    }",
  "  }",
  "} catch(e) { node.warn('Could not parse mission: ' + e.message); }",
  "",
  "var host = String(tak.serverUrl || '').replace(/^https?:\\/\\//i, '').replace(/\\/$/, '');",
  "var baseUrl = 'https://' + host + ':' + (tak.missionApiPort || 8443)",
  "  + '/Marti/api/missions/' + encodeURIComponent(cfg.missionName);",
  "var creator = encodeURIComponent(String((cfg && cfg.creatorUid) || (tak && tak.creatorUid) || 'nodered').trim());",
  "",
  "var cookie = msg._missionCookie || '';",
  "var bearer = msg._missionBearer || '';",
  "if (!cookie && msg.responseCookies && msg.responseCookies.JSESSIONID && msg.responseCookies.JSESSIONID.value) {",
  "  cookie = 'JSESSIONID=' + String(msg.responseCookies.JSESSIONID.value);",
  "}",
  "if (!cookie && msg.headers && msg.headers['set-cookie']) {",
  "  var sc = msg.headers['set-cookie'];",
  "  if (Array.isArray(sc) && sc.length) {",
  "    var a2 = String(sc[0]).match(/JSESSIONID=([^;]+)/);",
  "    if (a2 && a2[1]) cookie = 'JSESSIONID=' + a2[1];",
  "  } else if (typeof sc === 'string') {",
  "    var b = sc.match(/JSESSIONID=([^;]+)/);",
  "    if (b && b[1]) cookie = 'JSESSIONID=' + b[1];",
  "  }",
  "}",
  "",
  "var nPut = 0, nDel = 0;",
  "var newUids = [];",
  "for (var uid in tfrMap) {",
  "  if (!existing[uid]) { nPut++; newUids.push(uid); }",
  "}",
  "if (newUids.length > 0) {",
  "  node.send([{",
  "    topic: topicCfg, payload: {},",
  "    _missionCookie: cookie, _missionBearer: bearer,",
  "    _putUrl: baseUrl + '/contents?creatorUid=' + creator,",
  "    _putUids: newUids",
  "  }, null]);",
  "}",
  "for (var uid in existing) {",
  "  if (uid.indexOf(prefix) === 0 && !tfrMap[uid]) {",
  "    nDel++;",
  "    node.send([null, {",
  "      method: 'DELETE',",
  "      url: baseUrl + '/contents?uid=' + encodeURIComponent(uid) + '&creatorUid=' + creator,",
  "      headers: { 'accept': '*/*' },",
  "      _missionCookie: cookie, _missionBearer: bearer,",
  "      payload: '', topic: topicCfg",
  "    }]);",
  "  }",
  "}",
  "node.warn(topicCfg + ' reconcile: ' + nPut + ' PUT, ' + nDel + ' DELETE, '",
  "  + tfrUids.length + ' TFR, ' + Object.keys(existing).length + ' in mission');",
  "// _tfrUids is reset only at the start of each poll (Filter & split), not here —",
  "// clearing here caused the next timer reconcile to DELETE everything.",
  "return null;"
].join('\n');

function makeTfrEngineTab(feed) {
  const FID = 'flow_eng_' + feed.id;
  const P   = feed.id + '_';

  // Subscribe URL build (shared with ArcGIS)
  const FN_SUB = [
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
    "node.warn('Subscribing to ' + missionName + ' as ' + creatorUid);",
    "return msg;"
  ].join('\n');

  // Mission GET URL build (shared with ArcGIS)
  const FN_GET_MISSION = [
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
  ].join('\n');

  return [
    // Tab
    {
      id: FID, type: 'tab',
      label: feed.configName,
      disabled: false,
      info: 'FAA TFR engine for ' + feed.configName + '. Fetch TFRs, build 3D CoT, stream via TCP, sync to mission.'
    },

    // SA ident
    {
      id: P + 'sa_inject', type: 'inject', z: FID,
      name: 'SA ident (startup)',
      props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
      repeat: '600', crontab: '',
      once: true, onceDelay: '10',
      topic: 'sa-ident', payload: '', payloadType: 'date',
      x: 180, y: 40, wires: [[P + 'sa_build']]
    },
    {
      id: P + 'sa_build', type: 'function', z: FID,
      name: 'Build SA ident CoT',
      func: [
        "var tak = global.get('tak_settings') || {};",
        "var configs = global.get('arcgis_configs') || [];",
        "var cfg = null;",
        "for (var i = 0; i < configs.length; i++) {",
        "  if (configs[i].configName === '" + feed.configName + "') { cfg = configs[i]; break; }",
        "}",
        "var creatorUid = '';",
        "if (cfg && cfg.creatorUid) creatorUid = String(cfg.creatorUid).trim();",
        "if (!creatorUid && tak.creatorUid) creatorUid = String(tak.creatorUid).trim();",
        "if (!creatorUid) { return null; }",
        "var now = new Date();",
        "var stale = new Date(now.getTime() + 120000);",
        "msg.payload = {",
        "  event: {",
        "    _attributes: {",
        "      version: '2.0', uid: creatorUid,",
        "      type: 'a-f-G-E-S', how: 'h-g-i-g-o',",
        "      time: now.toISOString(), start: now.toISOString(), stale: stale.toISOString()",
        "    },",
        "    point: { _attributes: { lat: '0', lon: '0', hae: '0', ce: '9999999', le: '9999999' } },",
        "    detail: {",
        "      contact: [{ _attributes: { callsign: creatorUid } }],",
        "      __group: [{ _attributes: { name: 'Purple', role: 'Team Member' } }]",
        "    }",
        "  }",
        "};",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 400, y: 40, wires: [[P + 'cot_to_xml']]
    },

    // Poll timer + config loader
    {
      id: P + 'inject', type: 'inject', z: FID,
      name: 'Poll timer (60s base)',
      props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
      repeat: '60', crontab: '',
      once: true, onceDelay: '30',
      topic: 'poll', payload: '', payloadType: 'date',
      x: 180, y: 120, wires: [[P + 'load']]
    },
    {
      id: P + 'load', type: 'function', z: FID,
      name: 'Load TFR ' + feed.configName,
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
        "var intervalMs = ((cfg.tfrPollInterval || 15) * 60000);",
        "if (now - lastPoll < intervalMs) return null;",
        "flow.set('_lastPoll', now);",
        "node.warn('Polling: " + feed.configName + "');",
        "msg.url = 'https://tfr.faa.gov/tfrapi/exportTfrList';",
        "msg._config = cfg;",
        "msg.takSettings = tak;",
        "msg.topic = '" + feed.configName + "';",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 400, y: 120, wires: [[P + 'http_list']]
    },

    // Fetch TFR list
    {
      id: P + 'http_list', type: 'http request', z: FID,
      name: 'GET TFR list',
      method: 'GET', ret: 'obj', paytoqs: 'ignore',
      url: '', tls: '', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 600, y: 120, wires: [[P + 'filter']]
    },

    // Filter by state & split
    {
      id: P + 'filter', type: 'function', z: FID,
      name: 'Filter & split TFRs',
      _templateKey: 'tfr.filter_split',
      func: FN_TFR_FILTER_SPLIT,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 220,
      wires: [[P + 'http_xml']]
    },

    // Per-TFR XML fetch
    {
      id: P + 'http_xml', type: 'http request', z: FID,
      name: 'GET TFR XML',
      method: 'use', ret: 'txt', paytoqs: 'ignore',
      url: '', tls: '', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 400, y: 220, wires: [[P + 'xml_parse']]
    },

    // XML -> JSON
    {
      id: P + 'xml_parse', type: 'xml', z: FID,
      name: 'Parse XNOTAM',
      property: 'payload', attr: '', chr: '',
      x: 580, y: 220, wires: [[P + 'build_cot']]
    },

    // Parse XNOTAM & build CoT
    {
      id: P + 'build_cot', type: 'function', z: FID,
      name: 'Build TFR CoT',
      _templateKey: 'tfr.build_cot',
      func: FN_TFR_PARSE_BUILD_COT,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 740, y: 220, wires: [[P + 'cot_to_xml']]
    },

    // CoT -> XML -> Throttle -> TCP out (same as ArcGIS)
    {
      id: P + 'cot_to_xml', type: 'function', z: FID,
      name: 'CoT JSON -> XML',
      _templateKey: 'shared.cot_to_xml',
      func: FN_COT_TO_XML,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 320, wires: [[P + 'rate_stream']]
    },
    {
      id: P + 'rate_stream', type: 'delay', z: FID,
      name: 'Throttle (10/sec)', pauseType: 'rate',
      timeout: '1', timeoutUnits: 'seconds',
      rate: '10', nbRateUnits: '1', rateUnits: 'second',
      randomFirst: '1', randomLast: '5', randomUnits: 'seconds',
      drop: false, allowrate: false, outputs: 1,
      x: 400, y: 320, wires: [[P + 'tcp_out']]
    },
    {
      id: P + 'tcp_out', type: 'tcp out', z: FID,
      name: 'CoT -> TAK :8089',
      host: 'host.docker.internal', port: '8089', beserver: 'client',
      base64: false, end: false, tls: 'tls_tak',
      x: 600, y: 320, wires: []
    },
    {
      id: P + 'catch_stream', type: 'catch', z: FID,
      name: 'Stream errors',
      scope: [P + 'tcp_out'],
      uncaught: false,
      x: 180, y: 380, wires: [[P + 'debug_stream']]
    },
    {
      id: P + 'debug_stream', type: 'debug', z: FID,
      name: 'Stream error',
      active: true, tosidebar: true, console: false, tostatus: true,
      complete: 'true', targetType: 'full',
      statusVal: '', statusType: 'auto',
      x: 400, y: 380, wires: []
    },

    // Reconcile path: independent timer -> load config -> subscribe -> GET mission -> reconcile -> PUT/DELETE
    {
      id: P + 'recon_inject', type: 'inject', z: FID,
      name: 'Reconcile timer (90s)',
      props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }],
      repeat: '60', crontab: '',
      once: true, onceDelay: '90',
      topic: 'reconcile', payload: '', payloadType: 'date',
      x: 180, y: 460, wires: [[P + 'recon_load']]
    },
    {
      id: P + 'recon_load', type: 'function', z: FID,
      name: 'Load config for reconcile',
      func: [
        "var configs = global.get('arcgis_configs') || [];",
        "var tak = global.get('tak_settings') || {};",
        "var cfg = null;",
        "for (var i = 0; i < configs.length; i++) {",
        "  if (configs[i].configName === '" + feed.configName + "') { cfg = configs[i]; break; }",
        "}",
        "if (!cfg) { node.warn('" + feed.configName + " reconcile: no config in global arcgis_configs'); return null; }",
        "if (!tak.serverUrl) { node.warn('" + feed.configName + " reconcile: no TAK serverUrl'); return null; }",
        "msg._config = cfg;",
        "msg.takSettings = tak;",
        "msg.topic = '" + feed.configName + "';",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      // Fan-out like ArcGIS parse: subscribe AND mission GET in parallel. If FN_SUB skips
      // (mission already in _subscribed), GET mission still runs — otherwise reconcile never fires.
      x: 400, y: 460, wires: [[P + 'build_sub', P + 'build_m']]
    },
    {
      id: P + 'build_sub', type: 'function', z: FID,
      name: 'Build subscribe URL',
      _templateKey: 'shared.build_sub',
      func: FN_SUB,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 400, y: 460, wires: [[P + 'http_sub']]
    },
    {
      id: P + 'http_sub', type: 'http request', z: FID,
      name: 'Subscribe to mission',
      method: 'use', ret: 'txt', paytoqs: 'ignore',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 600, y: 460, wires: [[P + 'debug_sub']]
    },
    {
      id: P + 'debug_sub', type: 'debug', z: FID,
      name: 'Subscribe result ' + feed.configName,
      active: true, tosidebar: true, console: false, tostatus: true,
      complete: 'true', targetType: 'full',
      statusVal: 'topic', statusType: 'auto',
      x: 800, y: 460, wires: [[]]
    },

    {
      id: P + 'build_m', type: 'function', z: FID,
      name: 'Build mission GET URL',
      _templateKey: 'shared.build_m',
      func: FN_GET_MISSION,
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 540, wires: [[P + 'http_m']]
    },
    {
      id: P + 'http_m', type: 'http request', z: FID,
      name: 'GET mission',
      method: 'GET', ret: 'obj', paytoqs: 'ignore',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 400, y: 540, wires: [[P + 'reconcile']]
    },
    {
      id: P + 'reconcile', type: 'function', z: FID,
      name: 'TFR Reconcile (diff)',
      _templateKey: 'tfr.reconcile',
      func: FN_TFR_RECONCILE,
      outputs: 2, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 580, y: 540,
      wires: [[P + 'delay_put'], [P + 'delay_del']]
    },

    // PUT new UIDs
    {
      id: P + 'delay_put', type: 'delay', z: FID,
      name: 'Wait 30s for cache',
      pauseType: 'delay', timeout: '30', timeoutUnits: 'seconds',
      rate: '1', nbRateUnits: '1', rateUnits: 'second',
      randomFirst: '1', randomLast: '5', randomUnits: 'seconds',
      drop: false, allowrate: false, outputs: 1,
      x: 780, y: 540, wires: [[P + 'build_put']]
    },
    {
      id: P + 'build_put', type: 'function', z: FID,
      name: 'Build PUT UIDs',
      _templateKey: 'shared.build_put',
      func: [
        "var uids = msg._putUids || [];",
        "if (!msg._putUrl || uids.length === 0) return null;",
        "msg.method = 'PUT';",
        "msg.url = msg._putUrl;",
        "msg.headers = { 'accept': '*/*', 'Content-Type': 'application/json' };",
        "if (msg._missionCookie) msg.headers.Cookie = msg._missionCookie;",
        "if (msg._missionBearer) msg.headers.Authorization = 'Bearer ' + msg._missionBearer;",
        "msg.payload = { uids: uids };",
        "node.warn(msg.topic + ' PUT -> ' + uids.length + ' UIDs -> ' + msg.url);",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 180, y: 620, wires: [[P + 'http_action']]
    },
    {
      id: P + 'http_action', type: 'http request', z: FID,
      name: 'Mission API (PUT/DELETE)',
      method: 'use', ret: 'txt', paytoqs: 'body',
      url: '', tls: 'tls_tak', persist: false, proxy: '',
      insecureHTTPParser: false, authType: '',
      senderr: false, headers: [],
      x: 420, y: 620, wires: [[P + 'log_action']]
    },
    {
      id: P + 'delay_del', type: 'delay', z: FID,
      name: '', pauseType: 'delay', timeout: '1', timeoutUnits: 'seconds',
      rate: '1', nbRateUnits: '1', rateUnits: 'second',
      randomFirst: '1', randomLast: '5', randomUnits: 'seconds',
      drop: false, allowrate: false, outputs: 1,
      x: 420, y: 670, wires: [[P + 'http_action']]
    },
    {
      id: P + 'log_action', type: 'function', z: FID,
      name: 'Log API result',
      _templateKey: 'shared.log_action',
      func: [
        "var code = msg.statusCode || '?';",
        "var method = msg.method || '?';",
        "var feed = msg.topic || 'unknown';",
        "var ok = (code >= 200 && code < 300);",
        "var label = feed + ' ' + method + ' -> ' + code + (ok ? ' OK' : ' FAIL');",
        "if (!ok) {",
        "  var body = (typeof msg.payload === 'string') ? msg.payload.substring(0, 200) : '';",
        "  node.warn(label + (body ? ' - ' + body : ''));",
        "} else {",
        "  node.warn(label);",
        "}",
        "return msg;"
      ].join('\n'),
      outputs: 1, timeout: '', noerr: 0,
      initialize: '', finalize: '', libs: [],
      x: 640, y: 620, wires: [[]]
    }
  ];
}

// ════════════════════════════════════════════════════════════════
//  Engine tab templates (embedded in configurator.html for dynamic creation)
// ════════════════════════════════════════════════════════════════

const templateFeed = { id: '__FEED_ID__', configName: '__CONFIG_NAME__' };
const templateNodes = makeEngineTab(templateFeed);
const engineTabTemplate = JSON.stringify(templateNodes);

const tfrTemplateNodes = makeTfrEngineTab(templateFeed);
const tfrEngineTabTemplate = JSON.stringify(tfrTemplateNodes);

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

// Inject engine tab templates into configurator.html (skip if read-only, e.g. inside Docker)
try {
  const htmlPath = path.join(__dirname, 'configurator.html');
  let htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // ArcGIS template
  const startMarker = '/* __ENGINE_TAB_TEMPLATE_START__ */';
  const endMarker   = '/* __ENGINE_TAB_TEMPLATE_END__ */';
  const b64 = Buffer.from(engineTabTemplate, 'utf8').toString('base64');
  const templateBlock = startMarker + '\n'
    + 'var ENGINE_TAB_TEMPLATE = decodeURIComponent(escape(atob("' + b64 + '")));\n'
    + endMarker;
  if (htmlContent.includes(startMarker)) {
    const re = new RegExp(
      startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '[\\s\\S]*?'
      + endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    htmlContent = htmlContent.replace(re, templateBlock);
  } else {
    htmlContent = htmlContent.replace(
      '</script>\n</body>',
      '\n' + templateBlock + '\n</script>\n</body>'
    );
  }

  // TFR template
  const tfrStart = '/* __TFR_ENGINE_TAB_TEMPLATE_START__ */';
  const tfrEnd   = '/* __TFR_ENGINE_TAB_TEMPLATE_END__ */';
  const tfrB64 = Buffer.from(tfrEngineTabTemplate, 'utf8').toString('base64');
  const tfrBlock = tfrStart + '\n'
    + 'var TFR_ENGINE_TAB_TEMPLATE = decodeURIComponent(escape(atob("' + tfrB64 + '")));\n'
    + tfrEnd;
  if (htmlContent.includes(tfrStart)) {
    const re2 = new RegExp(
      tfrStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + '[\\s\\S]*?'
      + tfrEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    htmlContent = htmlContent.replace(re2, tfrBlock);
  } else {
    htmlContent = htmlContent.replace(
      endMarker,
      endMarker + '\n' + tfrBlock
    );
  }

  fs.writeFileSync(htmlPath, htmlContent);
  console.log('Engine tab templates injected into configurator.html (ArcGIS + TFR)');
} catch(e) {
  console.log('Skipped configurator.html template injection (' + e.code + ')');
}
