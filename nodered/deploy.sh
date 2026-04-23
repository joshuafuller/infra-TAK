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
# Validate the backup has meaningful content (at least one known config key).
# If it is empty, fall back to the persistent host-side snapshot from the last
# successful deploy.  If neither exists, ABORT — never wipe configs silently.
_ctx_is_valid() {
  local f="$1"
  [ -f "$f" ] || return 1
  local sz
  sz=$(wc -c < "$f" | tr -d ' ')
  [ "$sz" -gt 50 ] || return 1
  # Must contain at least one real config key
  grep -qE '"(arcgis_configs|tak_settings|tfr_configs|tc_configs|pp_config|pulsepoint_config|ipaws_config)"' "$f" || return 1
  return 0
}

if _ctx_is_valid "$NR_CTX_GLOBAL"; then
  # Good live backup — also update the persistent snapshot for next time
  cp "$NR_CTX_GLOBAL" "$PERSISTENT_CTX_BACKUP"
  echo "    Persistent snapshot updated: $PERSISTENT_CTX_BACKUP"
elif _ctx_is_valid "$PERSISTENT_CTX_BACKUP"; then
  echo "    WARNING: live context backup empty/invalid — falling back to persistent snapshot"
  echo "    Snapshot: $PERSISTENT_CTX_BACKUP ($(wc -c < "$PERSISTENT_CTX_BACKUP" | tr -d ' ') bytes)"
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

# Copy merged flows to host, then stop Node-RED before writing /data/flows.json.
# Writing flows.json while NR is running can hot-reload; the migration inject may run before
# global context is loaded from disk and empty state can be persisted — wiping Configurator saves.
echo "==> Installing merged flows (stop → write → restore context → start)"
docker cp "$CONTAINER:/tmp/flows_merged.json" "/tmp/flows_merged.json"
docker stop -t 30 "$CONTAINER"
docker cp "/tmp/flows_merged.json" "$CONTAINER:/data/flows.json"
# Restore credentials file so TLS cert data survives the deploy
if [ -f "/tmp/flows_cred_backup.json" ]; then
  docker cp "/tmp/flows_cred_backup.json" "$CONTAINER:/data/flows_cred.json"
  echo "    Credentials: restored"
fi
if [ -f "$NR_CTX_GLOBAL" ]; then
  # Ensure the context directory exists inside the container (may be missing on fresh volumes)
  docker exec "$CONTAINER" mkdir -p /data/context/global 2>/dev/null || true
  docker cp "$NR_CTX_GLOBAL" "$CONTAINER:/data/context/global/global.json"
  echo "    Context: restored global (arcgis_configs / tak_settings)"
fi
if [ -f "$NR_CTX_FLOW_CFG" ]; then
  docker exec "$CONTAINER" mkdir -p /data/context/flow 2>/dev/null || true
  docker cp "$NR_CTX_FLOW_CFG" "$CONTAINER:/data/context/flow/flow_arcgis_cfg.json"
  echo "    Context: restored flow tab (legacy migration source)"
fi
rm -f /tmp/flows_current.json /tmp/flows_cred_backup.json /tmp/flows_merged.json "$NR_CTX_GLOBAL" "$NR_CTX_FLOW_CFG"

# Ensure contextStorage:localfilesystem is in settings.js so Node-RED actually reads
# global.json from disk on startup.  Without this, an older install (memory-only context)
# will boot with empty in-memory state and wipe all Configurator configs.
NR_SETTINGS=""
for _p in /data/settings.js /usr/src/node-red/settings.js; do
  if docker exec "$CONTAINER" test -f "$_p" 2>/dev/null; then
    NR_SETTINGS="$_p"
    break
  fi
done
if [ -n "$NR_SETTINGS" ]; then
  HAS_CTX=$(docker exec "$CONTAINER" grep -c 'contextStorage' "$NR_SETTINGS" 2>/dev/null || echo 0)
  if [ "$HAS_CTX" = "0" ]; then
    echo "    settings.js: adding contextStorage (localfilesystem) — required for config persistence"
    docker exec "$CONTAINER" sed -i 's/^};$/,\n  contextStorage: {\n    default: { module: "localfilesystem" }\n  }\n};/' "$NR_SETTINGS"
  else
    echo "    settings.js: contextStorage already present ✓"
  fi
else
  echo "    settings.js: not found in container — skipping contextStorage check"
fi

docker start "$CONTAINER"
docker exec "$CONTAINER" sh -c "rm -f /tmp/flows_*.json /tmp/build-flows.js /tmp/configurator.html" 2>/dev/null || true

echo ""
echo "==> Deploy complete."
echo "    Configurator configs persist in Node-RED global context on the Docker volume (restored on each deploy)."
echo "    Open Node-RED editor, verify, hit Deploy."
