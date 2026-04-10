#!/usr/bin/env node
const fs   = require('fs');
const path = require('path');

const html    = fs.readFileSync(path.join(__dirname, 'configurator.html'), 'utf8');
const FLOW_ID = 'flow_arcgis_cfg';

const flows = [

  // ── Flow tab ──
  {
    id: FLOW_ID, type: 'tab',
    label: 'ArcGIS Configurator',
    disabled: false,
    info: 'Guided ArcGIS Feature Service → TAK CoT configuration tool.\nOpen /configurator in your browser after deploying.'
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
    headers: { 'content-type': 'text/html' },
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
      "msg.url = base + '/' + lid + '/query?where=1%3D1&outFields=*&resultRecordCount=5&f=json';",
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
      "  msg.payload = { features: (msg.payload.features || []).slice(0, 5) };",
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
  }
];

const out = path.join(__dirname, 'flows.json');
fs.writeFileSync(out, JSON.stringify(flows, null, 2));
console.log('flows.json generated  (' + flows.length + ' nodes)  →  ' + out);
