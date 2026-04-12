#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
CONTAINER="nodered"
NEW_FLOWS="$SCRIPT_DIR/flows.json"
TMP_CUR="/tmp/flows_current.json"
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
docker cp "$CONTAINER:/data/flows.json" "$TMP_CUR" 2>/dev/null || {
  echo "    No existing flows found — deploying fresh (you'll need to configure TLS manually)"
  docker cp "$NEW_FLOWS" "$CONTAINER:/data/flows.json"
  docker restart "$CONTAINER"
  exit 0
}

# Merge: new flows.json + preserved TLS config + TCP out host/port
echo "==> Merging (preserving TLS config and TCP settings)"
node -e "
  var fs = require('fs');
  var cur = JSON.parse(fs.readFileSync('$TMP_CUR', 'utf8'));
  var upd = JSON.parse(fs.readFileSync('$NEW_FLOWS', 'utf8'));

  // Preserve TLS config node (certs, keys, CA)
  var tlsCur = cur.find(function(n) { return n.id === 'tls_tak'; });
  if (tlsCur) {
    var tlsIdx = upd.findIndex(function(n) { return n.id === 'tls_tak'; });
    if (tlsIdx >= 0) upd[tlsIdx] = tlsCur;
    else upd.push(tlsCur);
  }

  // Preserve TCP out host/port
  var tcpCur = cur.find(function(n) { return n.id === 'eng_tcp_out'; });
  if (tcpCur) {
    var tcpIdx = upd.findIndex(function(n) { return n.id === 'eng_tcp_out'; });
    if (tcpIdx >= 0) {
      upd[tcpIdx].host = tcpCur.host;
      upd[tcpIdx].port = tcpCur.port;
      upd[tcpIdx].tls  = tcpCur.tls;
    }
  }

  fs.writeFileSync('$TMP_MERGED', JSON.stringify(upd, null, 2));
  console.log('    Merged: TLS=' + (tlsCur ? 'preserved' : 'empty') + ', TCP=' + (tcpCur && tcpCur.host ? tcpCur.host + ':' + tcpCur.port : 'empty'));
"

docker cp "$TMP_MERGED" "$CONTAINER:/data/flows.json"
docker restart "$CONTAINER"

echo "==> Deployed. Open Node-RED editor, verify settings, hit Deploy."
echo "    Configurator configs (flow context) survive restarts — no need to re-save."
echo "    TLS and TCP settings were preserved from the previous deploy."
