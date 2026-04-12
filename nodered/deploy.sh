#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
CONTAINER="nodered"
NEW_FLOWS="$SCRIPT_DIR/flows.json"
TMP_CUR="/tmp/flows_current.json"
TMP_CTX="/tmp/flows_context.json"
TMP_MERGED="/tmp/flows_merged.json"

cd "$REPO_DIR"

# Pull latest code
echo "==> git pull"
git pull

# Rebuild flows.json from source
echo "==> Rebuilding flows.json"
node "$SCRIPT_DIR/build-flows.js"

# Extract current flows from running container (has TLS certs + TCP config)
echo "==> Backing up current flows from container"
HAS_EXISTING=true
docker cp "$CONTAINER:/data/flows.json" "$TMP_CUR" 2>/dev/null || HAS_EXISTING=false

# Try to read flow context to get creatorUid for TLS cert convention
echo "==> Reading flow context for TLS auto-config"
CREATOR_UID=""
FLOW_ID="flow_arcgis_cfg"
docker cp "$CONTAINER:/data/context/flow/${FLOW_ID}.json" "$TMP_CTX" 2>/dev/null || true
if [ -f "$TMP_CTX" ]; then
  CREATOR_UID=$(node -e "
    try {
      var ctx = JSON.parse(require('fs').readFileSync('$TMP_CTX', 'utf8'));
      var ts = ctx.tak_settings || {};
      // Check tak_settings.creatorUid first, then fall back to first config's creatorUid
      var uid = (ts.creatorUid || '').trim();
      if (!uid) {
        var cfgs = ctx.arcgis_configs || [];
        for (var i = 0; i < cfgs.length; i++) {
          if (cfgs[i].creatorUid) { uid = cfgs[i].creatorUid.trim(); break; }
        }
      }
      process.stdout.write(uid);
    } catch(e) { process.stdout.write(''); }
  " 2>/dev/null || true)
  rm -f "$TMP_CTX"
fi

# Merge: new flows.json + preserved TLS/TCP from existing + auto TLS from convention
echo "==> Merging settings into new flows"
node -e "
  var fs = require('fs');
  var upd = JSON.parse(fs.readFileSync('$NEW_FLOWS', 'utf8'));
  var creatorUid = '$CREATOR_UID';
  var hasExisting = $HAS_EXISTING;
  var cur = hasExisting ? JSON.parse(fs.readFileSync('$TMP_CUR', 'utf8')) : [];

  // --- TLS config ---
  var tlsIdx = upd.findIndex(function(n) { return n.id === 'tls_tak'; });
  var tlsCur = cur.find(function(n) { return n.id === 'tls_tak'; });

  if (tlsCur && (tlsCur.certname || tlsCur.cert)) {
    // Existing container has TLS configured — preserve it (user override)
    if (tlsIdx >= 0) upd[tlsIdx] = tlsCur;
    console.log('    TLS: preserved from running container');
  } else if (creatorUid) {
    // No existing TLS but we know creatorUid — apply convention
    if (tlsIdx >= 0) {
      upd[tlsIdx].certname = '/certs/' + creatorUid + '.pem';
      upd[tlsIdx].keyname  = '/certs/' + creatorUid + '.key';
      upd[tlsIdx].caname   = '';
      upd[tlsIdx].verifyservercert = false;
    }
    console.log('    TLS: auto-configured from creatorUid (' + creatorUid + ')');
  } else {
    console.log('    TLS: empty (first deploy — configure in Node-RED editor)');
  }

  // --- TCP out ---
  var tcpIdx = upd.findIndex(function(n) { return n.id === 'eng_tcp_out'; });
  var tcpCur = cur.find(function(n) { return n.id === 'eng_tcp_out'; });
  if (tcpCur && tcpCur.host) {
    // Preserve any user override for TCP host/port
    upd[tcpIdx].host = tcpCur.host;
    upd[tcpIdx].port = tcpCur.port;
    upd[tcpIdx].tls  = tcpCur.tls;
    console.log('    TCP: preserved (' + tcpCur.host + ':' + tcpCur.port + ')');
  } else {
    console.log('    TCP: using defaults (host.docker.internal:8089)');
  }

  fs.writeFileSync('$TMP_MERGED', JSON.stringify(upd, null, 2));
"

docker cp "$TMP_MERGED" "$CONTAINER:/data/flows.json"
docker restart "$CONTAINER"
rm -f "$TMP_CUR" "$TMP_MERGED"

echo ""
echo "==> Deploy complete."
echo "    Configurator configs survive restarts (flow context on Docker volume)."
echo "    Open Node-RED editor, verify, hit Deploy."
