#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
CONTAINER="nodered"
NEW_FLOWS="$SCRIPT_DIR/flows.json"

cd "$REPO_DIR"

# Pull latest code (skip if called with --no-pull, e.g. from post-update auto-deploy)
if [ "${1:-}" != "--no-pull" ]; then
  echo "==> git pull"
  git pull
else
  echo "==> Skipping git pull (--no-pull)"
fi

# Rebuild flows.json using node inside the container
echo "==> Rebuilding flows.json"
docker cp "$SCRIPT_DIR/build-flows.js" "$CONTAINER:/tmp/build-flows.js"
docker cp "$SCRIPT_DIR/configurator.html" "$CONTAINER:/tmp/configurator.html"
# docker cp sets root ownership — make files writable by the node process so build-flows.js can inject templates
docker exec "$CONTAINER" chmod 666 /tmp/build-flows.js /tmp/configurator.html 2>/dev/null || true
if [ -f "$SCRIPT_DIR/icon-catalog.json" ]; then
  docker cp "$SCRIPT_DIR/icon-catalog.json" "$CONTAINER:/data/icon-catalog.json"
  echo "    Icon catalog: copied to /data/icon-catalog.json"
fi

# Copy static assets (IPAWS icons, etc.) to /data/public inside container
# Node-RED serves /data/public at the root URL via httpStatic (set in settings.js)
if [ -d "$SCRIPT_DIR/static" ]; then
  docker exec "$CONTAINER" mkdir -p /data/public
  docker cp "$SCRIPT_DIR/static/." "$CONTAINER:/data/public/"
  echo "    Static assets: copied nodered/static/ → /data/public/"
fi
docker exec "$CONTAINER" node /tmp/build-flows.js
docker cp "$CONTAINER:/tmp/flows.json" "$NEW_FLOWS"
docker cp "$CONTAINER:/tmp/template-functions.json" "/tmp/template-functions.json" 2>/dev/null || true

# Back up current flows + credentials from running container
echo "==> Backing up current config from container"
HAS_EXISTING=true
docker cp "$CONTAINER:/data/flows.json" "/tmp/flows_current.json" 2>/dev/null || HAS_EXISTING=false
# Preserve encrypted credentials file (TLS cert data lives here, not in flows.json)
docker cp "$CONTAINER:/data/flows_cred.json" "/tmp/flows_cred_backup.json" 2>/dev/null || true

# Configurator configs + TAK settings live in Node-RED context files (global + legacy flow tab).
# We re-apply these after replacing flows.json so a hot reload cannot persist an empty global state.
#
# IMPORTANT: Always use the Node-RED REST API as the primary source for global context.
# Older installs without contextStorage:localfilesystem only store context in memory — the
# file on disk may be absent or stale. The API always returns the live in-memory state.
echo "==> Backing up Node-RED context (Configurator / TAK settings)"
NR_CTX_GLOBAL="/tmp/nr_ctx_global.json"
NR_CTX_FLOW_CFG="/tmp/nr_ctx_flow_arcgis_cfg.json"
PERSISTENT_CTX_BACKUP="/opt/tak/nodered-ctx-backup.json"
rm -f "$NR_CTX_GLOBAL" "$NR_CTX_FLOW_CFG"
mkdir -p /opt/tak

# Try Node-RED REST API first (live in-memory context — works for both memory and filesystem storage)
NR_API_CTX=$(docker exec "$CONTAINER" curl -sf --max-time 8 http://localhost:1880/context/global 2>/dev/null || echo "")
if [ -n "$NR_API_CTX" ] && [ "$NR_API_CTX" != "{}" ] && [ "$NR_API_CTX" != "null" ]; then
  echo "$NR_API_CTX" > "$NR_CTX_GLOBAL"
  echo "    Context backup: REST API (live) — $(wc -c < "$NR_CTX_GLOBAL" | tr -d ' ') bytes"
else
  # Fall back to file copy (localfilesystem storage)
  docker cp "$CONTAINER:/data/context/global/global.json" "$NR_CTX_GLOBAL" 2>/dev/null || true
  if [ -f "$NR_CTX_GLOBAL" ]; then
    echo "    Context backup: file — $(wc -c < "$NR_CTX_GLOBAL" | tr -d ' ') bytes"
  else
    echo "    Context backup: none found from live container"
  fi
fi
docker cp "$CONTAINER:/data/context/flow/flow_arcgis_cfg.json" "$NR_CTX_FLOW_CFG" 2>/dev/null || true

# ── SAFETY GATE ──────────────────────────────────────────────────────────────
# Validate the backup has meaningful content: at least one config key as an
# actual TOP-LEVEL JSON key with non-empty content.
# grep alone is NOT sufficient — key names appear inside JS code strings
# stored in context by Node-RED function nodes (false positives).
# Use python3 to parse the JSON and check actual top-level key presence.
_ctx_is_valid() {
  local f="$1"
  [ -f "$f" ] || return 1
  local sz
  sz=$(wc -c < "$f" | tr -d ' ')
  [ "$sz" -gt 50 ] || return 1
  python3 - "$f" 2>/dev/null << 'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
# localfilesystem storage wraps everything under a 'default' key
if 'default' in d and isinstance(d['default'], dict):
    d = d['default']
keys = ['arcgis_configs','tak_settings','tc_configs','pp_config',
        'pulsepoint_config','ipaws_config','tfr_config','kml_configs']
for k in keys:
    v = d.get(k)
    if v is None:
        continue
    # Non-empty array/list
    if isinstance(v, list) and len(v) > 0:
        sys.exit(0)
    # Dict with at least one key
    if isinstance(v, dict) and v:
        sys.exit(0)
sys.exit(1)
PYEOF
}

# Show exactly which top-level config keys are in a file (for debug output)
_ctx_summary() {
  local f="$1"
  [ -f "$f" ] || { echo "(file missing)"; return; }
  python3 - "$f" 2>/dev/null << 'PYEOF' || echo "(parse error)"
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
# localfilesystem storage wraps everything under a 'default' key
if 'default' in d and isinstance(d['default'], dict):
    d = d['default']
keys = ['arcgis_configs','tak_settings','tc_configs','pp_config',
        'pulsepoint_config','ipaws_config','tfr_config','kml_configs']
parts = []
for k in keys:
    v = d.get(k)
    if v is None:
        continue
    if isinstance(v, list):
        parts.append(k + '(' + str(len(v)) + ')')
    elif isinstance(v, dict) and v:
        parts.append(k)
print(', '.join(parts) if parts else '(no config keys)')
PYEOF
}

echo "    Context keys (live):  $(_ctx_summary "$NR_CTX_GLOBAL")"
if _ctx_is_valid "$NR_CTX_GLOBAL"; then
  # Good live backup — also update the persistent snapshot for next time
  cp "$NR_CTX_GLOBAL" "$PERSISTENT_CTX_BACKUP"
  echo "    Persistent snapshot updated: $PERSISTENT_CTX_BACKUP"
elif _ctx_is_valid "$PERSISTENT_CTX_BACKUP"; then
  echo "    WARNING: live context has no saved configs — falling back to persistent snapshot"
  echo "    Snapshot keys: $(_ctx_summary "$PERSISTENT_CTX_BACKUP")"
  cp "$PERSISTENT_CTX_BACKUP" "$NR_CTX_GLOBAL"
else
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════════════╗"
  echo "  ║  DEPLOY ABORTED — could not back up Node-RED context            ║"
  echo "  ║                                                                  ║"
  echo "  ║  Neither the live container API nor the persistent snapshot      ║"
  echo "  ║  ($PERSISTENT_CTX_BACKUP)"
  echo "  ║  returned valid config data.                                     ║"
  echo "  ║                                                                  ║"
  echo "  ║  Proceeding would wipe all saved Configurator configs.           ║"
  echo "  ║  To override (e.g. intentional fresh install):                   ║"
  echo "  ║    bash nodered/deploy.sh --force-empty-context                  ║"
  echo "  ╚══════════════════════════════════════════════════════════════════╝"
  echo ""
  if [ "${1:-}" = "--force-empty-context" ]; then
    echo "    --force-empty-context passed — proceeding without context restore."
  else
    exit 1
  fi
fi
# ── END SAFETY GATE ──────────────────────────────────────────────────────────

# Run merge inside the container (node is available there)
docker cp "$NEW_FLOWS" "$CONTAINER:/tmp/flows_new.json"
if [ "$HAS_EXISTING" = true ]; then
  docker cp "/tmp/flows_current.json" "$CONTAINER:/tmp/flows_current.json"
fi

docker exec "$CONTAINER" node -e "
  var fs = require('fs');
  var upd = JSON.parse(fs.readFileSync('/tmp/flows_new.json', 'utf8'));

  // Read existing flows
  var cur = [];
  try { cur = JSON.parse(fs.readFileSync('/tmp/flows_current.json', 'utf8')); } catch(e) {}

  // Build lookup of new node IDs (infra-TAK managed nodes)
  var updIds = {};
  upd.forEach(function(n) { updIds[n.id] = true; });

  // Identify infra-TAK managed flow tabs (configurator + static engine tabs)
  var managedTabs = {};
  upd.forEach(function(n) { if (n.type === 'tab') managedTabs[n.id] = true; });

  // Preserve existing nodes NOT managed by infra-TAK:
  // - Dynamic engine tabs (flow_eng_* created by Configurator)
  // - User's own custom flows and nodes
  var preserved = [];
  cur.forEach(function(n) {
    if (updIds[n.id]) return; // will be replaced by new version
    var isInManagedTab = n.z && managedTabs[n.z];
    if (isInManagedTab) return; // old node in a tab we're replacing
    preserved.push(n);
  });

  // De-duplicate tabs with the same label (keep first occurrence, drop extras + their children)
  var seenLabels = {};
  upd.forEach(function(n) { if (n.type === 'tab' && n.label) seenLabels[n.label] = true; });
  var dupTabIds = {};
  preserved.forEach(function(n) {
    if (n.type === 'tab' && n.label) {
      if (seenLabels[n.label]) { dupTabIds[n.id] = n.label; }
      else { seenLabels[n.label] = true; }
    }
  });
  if (Object.keys(dupTabIds).length > 0) {
    preserved = preserved.filter(function(n) {
      if (dupTabIds[n.id]) return false;
      if (n.z && dupTabIds[n.z]) return false;
      return true;
    });
    Object.keys(dupTabIds).forEach(function(id) {
      console.log('    Dedup: removed extra tab \"' + dupTabIds[id] + '\" (' + id + ')');
    });
  }

  console.log('    Preserved ' + preserved.length + ' existing nodes (dynamic tabs + user flows)');

  // --- TLS config: preserve cert/key from running container if populated ---
  var tlsIdx = upd.findIndex(function(n) { return n.id === 'tls_tak'; });
  var tlsCur = cur.find(function(n) { return n.id === 'tls_tak'; });

  if (tlsCur && (tlsCur.cert || tlsCur.certname)) {
    if (tlsIdx >= 0) upd[tlsIdx] = tlsCur;
    console.log('    TLS (API): preserved from running container');
  } else {
    console.log('    TLS (API): using build-flows.js defaults');
  }

  // --- TCP out (preserve host from existing) ---
  var tcpCur = cur.find(function(n) { return n.type === 'tcp out' && n.host; });
  upd.forEach(function(n) {
    if (n.type === 'tcp out') {
      if (tcpCur) n.host = tcpCur.host;
      console.log('    TCP: ' + n.name + ' → ' + n.host + ':' + n.port + ' tls=' + n.tls);
    }
  });

  // --- Template function sync: update func code in dynamic engine tabs ---
  var funcTemplates = {};
  try {
    funcTemplates = JSON.parse(fs.readFileSync('/tmp/template-functions.json', 'utf8'));
  } catch(e) {
    upd.forEach(function(n) {
      if (n.type === 'function' && n._templateKey) {
        funcTemplates[n._templateKey] = n.func;
      }
    });
  }

  // Migration: detect engine tab types for old nodes without _templateKey
  var tabTypes = {};
  preserved.forEach(function(n) {
    if (!n.z) return;
    if (n.name === 'Filter & split TFRs' || n.name === 'TFR Reconcile (diff)' || n.name === 'Build TFR CoT') tabTypes[n.z] = 'tfr';
    if (n.name === 'Build ArcGIS query' || n.name === 'Parse & build CoT') tabTypes[n.z] = 'arcgis';
    if (n.name === 'Build KML URL' || n.name === 'KML to Feature JSON') tabTypes[n.z] = 'kml';
  });

  var nameToKey = {
    'Build ArcGIS query': { arcgis: 'arcgis.build_query' },
    'Parse & build CoT': { arcgis: 'arcgis.parse_cot' },
    'Reconcile (diff)': { arcgis: 'arcgis.reconcile', kml: 'arcgis.reconcile' },
    'Filter & split TFRs': { tfr: 'tfr.filter_split' },
    'Build TFR CoT': { tfr: 'tfr.build_cot' },
    'TFR Reconcile (diff)': { tfr: 'tfr.reconcile' },
    'Build KML URL': { kml: 'kml.build_url' },
    'KML to Feature JSON': { kml: 'kml.xml_to_features' },
    'Elevate to MISSION_OWNER': { arcgis: 'arcgis.fn_elevate', kml: 'kml.fn_elevate' },
    'Build subscribe URL': { arcgis: 'shared.build_sub', tfr: 'shared.build_sub', kml: 'shared.build_sub' },
    'Build mission GET URL': { arcgis: 'shared.build_m', tfr: 'shared.build_m', kml: 'shared.build_m' },
    'CoT JSON -> XML': { arcgis: 'shared.cot_to_xml', tfr: 'shared.cot_to_xml', kml: 'shared.cot_to_xml' },
    'Build PUT UIDs': { arcgis: 'shared.build_put', tfr: 'shared.build_put', kml: 'shared.build_put' },
    'Log API result': { arcgis: 'shared.log_action', tfr: 'shared.log_action', kml: 'shared.log_action' }
  };

  var nSync = 0;
  preserved.forEach(function(n) {
    if (n.type !== 'function') return;
    var key = n._templateKey;
    if (!key && n.name && nameToKey[n.name] && n.z) {
      var tt = tabTypes[n.z];
      if (tt && nameToKey[n.name][tt]) {
        key = nameToKey[n.name][tt];
        n._templateKey = key;
      }
    }
    if (key && funcTemplates[key]) {
      var tpl = funcTemplates[key];
      var newFunc = (typeof tpl === 'object' && tpl.func !== undefined) ? tpl.func : tpl;
      var newLibs = (typeof tpl === 'object' && tpl.libs !== undefined) ? tpl.libs : null;
      if (n.func !== newFunc) { n.func = newFunc; nSync++; }
      if (newLibs) n.libs = newLibs;
    }
  });
  console.log('    Synced ' + nSync + ' function nodes in dynamic engine tabs');

  // Merge: new infra-TAK nodes + preserved existing nodes
  var merged = upd.concat(preserved);
  fs.writeFileSync('/tmp/flows_merged.json', JSON.stringify(merged, null, 2));
  console.log('    Final: ' + merged.length + ' total nodes (' + upd.length + ' infra-TAK + ' + preserved.length + ' preserved)');
"

CERT_HOST_DIR="/opt/tak/certs/files"
# If tls_tak still has no cert paths but host has standard TAK admin files, wire /certs/... (expects volume mount host:files -> container:/certs)
if [ -f "$CERT_HOST_DIR/admin.pem" ] && [ -f "$CERT_HOST_DIR/admin.key" ]; then
  docker exec "$CONTAINER" node -e "
    var fs = require('fs');
    var p = '/tmp/flows_merged.json';
    var f = JSON.parse(fs.readFileSync(p, 'utf8'));
    var tls = f.find(function(n) { return n.id === 'tls_tak'; });
    if (tls && (!tls.cert || tls.cert === '')) {
      tls.cert = '/certs/admin.pem';
      tls.key = '/certs/admin.key';
      fs.writeFileSync(p, JSON.stringify(f, null, 2));
      console.log('    TLS: auto-filled /certs/admin.pem (host has admin certs)');
    }
  "
fi

# Fix permissions on any certs referenced by stream TLS configs
docker exec "$CONTAINER" node -e "
  var f = JSON.parse(require('fs').readFileSync('/tmp/flows_merged.json','utf8'));
  f.forEach(function(n) {
    if (n.type === 'tls-config' && n.cert) console.log(n.cert);
    if (n.type === 'tls-config' && n.key)  console.log(n.key);
  });
" | while read -r CPATH; do
  HOST_FILE="$CERT_HOST_DIR/$(basename "$CPATH")"
  if [ -f "$HOST_FILE" ]; then
    chmod 644 "$HOST_FILE"
    echo "    Certs: chmod 644 $HOST_FILE"
  fi
done

# ── Patch settings.js on the HOST before the stop/start cycle ────────────────
# settings.js lives at ~/node-red/settings.js on the host and is volume-mounted
# into the container.  We patch it here (no docker exec needed) so Node-RED reads
# contextStorage:localfilesystem on restart and picks up the global.json file copy.
echo "==> Ensuring contextStorage:localfilesystem in settings.js"
NR_SETTINGS_HOST="$HOME/node-red/settings.js"
if [ -f "$NR_SETTINGS_HOST" ]; then
  if ! grep -q 'contextStorage' "$NR_SETTINGS_HOST" 2>/dev/null; then
    echo "    $NR_SETTINGS_HOST: adding contextStorage (localfilesystem)"
    node -e "
      var fs = require('fs');
      var src = fs.readFileSync('$NR_SETTINGS_HOST', 'utf8');
      src = src.replace(/^};\\s*\$/m,
        ',\\n  contextStorage: {\\n    default: { module: \"localfilesystem\" }\\n  }\\n};');
      if (src.indexOf('contextStorage') === -1) {
        src = src.trimEnd() + '\\nmodule.exports = Object.assign(module.exports || {}, {\\n  contextStorage: { default: { module: \"localfilesystem\" } }\\n});\\n';
      }
      fs.writeFileSync('$NR_SETTINGS_HOST', src);
      console.log('    contextStorage written to $NR_SETTINGS_HOST');
    " 2>&1 | sed 's/^/    /' || true
  else
    echo "    settings.js: contextStorage already present ✓"
  fi
else
  echo "    WARNING: settings.js not found at $NR_SETTINGS_HOST"
  echo "    API-based restore (post-startup) will ensure configs survive regardless."
fi

# Copy merged flows to host, then stop Node-RED before writing /data/flows.json.
# Writing flows.json while NR is running can hot-reload; the migration inject may run before
# global context is loaded from disk and empty state can be persisted — wiping Configurator saves.
echo "==> Installing merged flows (stop → write → restore context → start)"
docker cp "$CONTAINER:/tmp/flows_merged.json" "/tmp/flows_merged.json"

# Pre-create context dirs while the container is still running (docker exec fails on stopped containers)
docker exec "$CONTAINER" mkdir -p /data/context/global /data/context/flow 2>/dev/null || true

docker stop -t 30 "$CONTAINER"
docker cp "/tmp/flows_merged.json" "$CONTAINER:/data/flows.json"
# Restore credentials file so TLS cert data survives the deploy
if [ -f "/tmp/flows_cred_backup.json" ]; then
  docker cp "/tmp/flows_cred_backup.json" "$CONTAINER:/data/flows_cred.json"
  echo "    Credentials: restored"
fi
# Write the context file so Node-RED reads it on startup (requires contextStorage:localfilesystem)
if [ -f "$NR_CTX_GLOBAL" ]; then
  docker cp "$NR_CTX_GLOBAL" "$CONTAINER:/data/context/global/global.json"
  echo "    Context file: written to /data/context/global/global.json"
fi
if [ -f "$NR_CTX_FLOW_CFG" ]; then
  docker cp "$NR_CTX_FLOW_CFG" "$CONTAINER:/data/context/flow/flow_arcgis_cfg.json"
  echo "    Context file: restored flow tab (legacy)"
fi
rm -f /tmp/flows_current.json /tmp/flows_cred_backup.json /tmp/flows_merged.json

docker start "$CONTAINER"
docker exec "$CONTAINER" sh -c "rm -f /tmp/flows_*.json /tmp/build-flows.js /tmp/configurator.html" 2>/dev/null || true

# ── Post-startup API context restore (belt-and-suspenders) ────────────────────
# Push the backed-up context via the new /config/deploy-restore Node-RED endpoint.
# This works regardless of contextStorage backend — sets values directly in live memory.
# Combined with the file copy above (localfilesystem) this is a double guarantee.
echo "==> Waiting for Node-RED to be ready..."
NR_READY=false
for _i in $(seq 1 30); do
  if docker exec "$CONTAINER" curl -sf --max-time 3 http://localhost:1880/context/global > /dev/null 2>&1; then
    NR_READY=true
    echo "    Node-RED ready (${_i}s)"
    break
  fi
  sleep 1
done

if [ "$NR_READY" = "true" ] && [ -f "$NR_CTX_GLOBAL" ]; then
  echo "==> Pushing context via REST API (/config/deploy-restore)..."
  # Copy the host backup to a temp path the container owns (Node-RED never writes here).
  # Then use -d @path inside the container — avoids all stdin/bash redirection issues.
  docker cp "$NR_CTX_GLOBAL" "$CONTAINER:/tmp/ctx_deploy_restore.json"
  _RESTORE_RESP=$(docker exec "$CONTAINER" curl -sf --max-time 15 \
    -X POST http://localhost:1880/config/deploy-restore \
    -H 'Content-Type: application/json' \
    -d @/tmp/ctx_deploy_restore.json 2>/dev/null || echo "")
  docker exec "$CONTAINER" rm -f /tmp/ctx_deploy_restore.json 2>/dev/null || true
  if echo "$_RESTORE_RESP" | grep -q '"ok":true'; then
    _KEYS=$(echo "$_RESTORE_RESP" | grep -o '"restored":\[[^]]*\]' || echo "")
    echo "    Context restored via API ✓  $_KEYS"
  else
    echo "    WARNING: API restore returned: $_RESTORE_RESP"
    echo "    Context may still be loaded from the file written above — check the UI."
  fi
elif [ "$NR_READY" = "false" ]; then
  echo "    WARNING: Node-RED did not become ready within 30s — skipping API restore"
  echo "    Config file was already written to /data/context/global/global.json"
fi
# Always clean up host temp files
rm -f "$NR_CTX_GLOBAL" "$NR_CTX_FLOW_CFG"

echo ""
echo "==> Deploy complete."
echo "    Configurator configs persist in Node-RED global context on the Docker volume (restored on each deploy)."
echo "    Open Node-RED editor, verify, hit Deploy."
