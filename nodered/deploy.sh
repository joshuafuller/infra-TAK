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
docker exec "$CONTAINER" node /tmp/build-flows.js
docker cp "$CONTAINER:/tmp/flows.json" "$NEW_FLOWS"

# Back up current flows + credentials from running container
echo "==> Backing up current config from container"
HAS_EXISTING=true
docker cp "$CONTAINER:/data/flows.json" "/tmp/flows_current.json" 2>/dev/null || HAS_EXISTING=false
# Preserve encrypted credentials file (TLS cert data lives here, not in flows.json)
docker cp "$CONTAINER:/data/flows_cred.json" "/tmp/flows_cred_backup.json" 2>/dev/null || true

# Read context to get creatorUid for TLS cert convention (global first, flow fallback)
echo "==> Reading flow context for TLS auto-config"
HAS_CONTEXT=false
docker cp "$CONTAINER:/data/context/global/global.json" "/tmp/flows_context.json" 2>/dev/null && HAS_CONTEXT=true || \
  docker cp "$CONTAINER:/data/context/flow/flow_arcgis_cfg.json" "/tmp/flows_context.json" 2>/dev/null && HAS_CONTEXT=true || true

# Run merge inside the container (node is available there)
docker cp "$NEW_FLOWS" "$CONTAINER:/tmp/flows_new.json"
if [ "$HAS_EXISTING" = true ]; then
  docker cp "/tmp/flows_current.json" "$CONTAINER:/tmp/flows_current.json"
fi
if [ "$HAS_CONTEXT" = true ]; then
  docker cp "/tmp/flows_context.json" "$CONTAINER:/tmp/flows_context.json"
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
  upd.forEach(function(n) {
    if (n.type === 'function' && n._templateKey) {
      funcTemplates[n._templateKey] = n.func;
    }
  });

  // Migration: detect engine tab types for old nodes without _templateKey
  var tabTypes = {};
  preserved.forEach(function(n) {
    if (!n.z) return;
    if (n.name === 'Filter & split TFRs' || n.name === 'TFR Reconcile (diff)' || n.name === 'Build TFR CoT') tabTypes[n.z] = 'tfr';
    if (n.name === 'Build ArcGIS query' || n.name === 'Parse & build CoT') tabTypes[n.z] = 'arcgis';
  });

  var nameToKey = {
    'Build ArcGIS query': { arcgis: 'arcgis.build_query' },
    'Parse & build CoT': { arcgis: 'arcgis.parse_cot' },
    'Reconcile (diff)': { arcgis: 'arcgis.reconcile' },
    'Filter & split TFRs': { tfr: 'tfr.filter_split' },
    'Build TFR CoT': { tfr: 'tfr.build_cot' },
    'TFR Reconcile (diff)': { tfr: 'tfr.reconcile' },
    'Build subscribe URL': { arcgis: 'shared.build_sub', tfr: 'shared.build_sub' },
    'Build mission GET URL': { arcgis: 'shared.build_m', tfr: 'shared.build_m' },
    'CoT JSON -> XML': { arcgis: 'shared.cot_to_xml', tfr: 'shared.cot_to_xml' },
    'Build PUT UIDs': { arcgis: 'shared.build_put', tfr: 'shared.build_put' },
    'Log API result': { arcgis: 'shared.log_action', tfr: 'shared.log_action' }
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
    if (key && funcTemplates[key] && n.func !== funcTemplates[key]) {
      n.func = funcTemplates[key];
      nSync++;
    }
  });
  console.log('    Synced ' + nSync + ' function nodes in dynamic engine tabs');

  // Merge: new infra-TAK nodes + preserved existing nodes
  var merged = upd.concat(preserved);
  fs.writeFileSync('/tmp/flows_merged.json', JSON.stringify(merged, null, 2));
  console.log('    Final: ' + merged.length + ' total nodes (' + upd.length + ' infra-TAK + ' + preserved.length + ' preserved)');
"

# Fix permissions on any certs referenced by stream TLS configs
CERT_HOST_DIR="/opt/tak/certs/files"
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

# Move merged flows into place inside the container
docker exec "$CONTAINER" cp /tmp/flows_merged.json /data/flows.json
# Restore credentials file so TLS cert data survives the deploy
if [ -f "/tmp/flows_cred_backup.json" ]; then
  docker cp "/tmp/flows_cred_backup.json" "$CONTAINER:/data/flows_cred.json"
  echo "    Credentials: restored"
fi
docker exec "$CONTAINER" sh -c "rm -f /tmp/flows_*.json /tmp/build-flows.js /tmp/configurator.html" 2>/dev/null || true
rm -f /tmp/flows_current.json /tmp/flows_context.json /tmp/flows_cred_backup.json
docker restart "$CONTAINER"

echo ""
echo "==> Deploy complete."
echo "    Configurator configs survive restarts (flow context on Docker volume)."
echo "    Open Node-RED editor, verify, hit Deploy."
