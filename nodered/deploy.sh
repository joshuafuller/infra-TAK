#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
CONTAINER="nodered"
NEW_FLOWS="$SCRIPT_DIR/flows.json"

cd "$REPO_DIR"

# Pull latest code
echo "==> git pull"
git pull

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

  // Read creatorUid from flow context
  var creatorUid = '';
  try {
    var ctx = JSON.parse(fs.readFileSync('/tmp/flows_context.json', 'utf8'));
    var ts = ctx.tak_settings || {};
    creatorUid = (ts.creatorUid || '').trim();
    if (!creatorUid) {
      var cfgs = ctx.arcgis_configs || [];
      for (var i = 0; i < cfgs.length; i++) {
        if (cfgs[i].creatorUid) { creatorUid = cfgs[i].creatorUid.trim(); break; }
      }
    }
  } catch(e) {}

  // Read existing flows
  var cur = [];
  try { cur = JSON.parse(fs.readFileSync('/tmp/flows_current.json', 'utf8')); } catch(e) {}

  // --- TLS config: Mission API (admin cert for 8443) ---
  var tlsIdx = upd.findIndex(function(n) { return n.id === 'tls_tak'; });
  var tlsCur = cur.find(function(n) { return n.id === 'tls_tak'; });

  if (tlsCur && (tlsCur.certname || tlsCur.cert)) {
    if (tlsIdx >= 0) upd[tlsIdx] = tlsCur;
    console.log('    TLS (API): preserved from running container');
  } else if (creatorUid) {
    if (tlsIdx >= 0) {
      upd[tlsIdx].certname = '/certs/admin.pem';
      upd[tlsIdx].keyname  = '/certs/admin.key';
      upd[tlsIdx].caname   = '';
      upd[tlsIdx].verifyservercert = false;
    }
    console.log('    TLS (API): auto-configured with admin cert');
  } else {
    console.log('    TLS (API): empty (first deploy — configure in Node-RED editor)');
  }

  // --- TLS config: per-feed stream certs (from configurator streamCertUser or preserved) ---
  var cfgs = [];
  try { cfgs = ctx.arcgis_configs || []; } catch(e) {}

  upd.forEach(function(n) {
    if (n.type === 'tls-config' && n.id.indexOf('tls_stream_') === 0) {
      var curTls = cur.find(function(c) { return c.id === n.id; });
      if (curTls && (curTls.cert || curTls.certname)) {
        var name = n.name;
        var cfgName = n._configName;
        var buildCert = n.cert;
        var buildKey  = n.key;
        Object.keys(curTls).forEach(function(k) { n[k] = curTls[k]; });
        n.name = name;
        n._configName = cfgName;
        if (!n.cert && n.certname && n.certname.indexOf('/certs/') === 0) {
          n.cert = n.certname; n.certname = '';
          n.key  = n.keyname;  n.keyname  = '';
          console.log('    TLS (' + n.name + '): migrated certname→cert (' + n.cert + ')');
        } else if (!n.cert && buildCert) {
          n.cert = buildCert; n.key = buildKey;
          n.certname = ''; n.keyname = '';
          console.log('    TLS (' + n.name + '): used build values (' + n.cert + ')');
        } else {
          console.log('    TLS (' + n.name + '): preserved (' + n.cert + ')');
        }
      } else {
        var matchCfg = cfgs.find(function(c) { return c.configName === n._configName; });
        var certUser = matchCfg ? (matchCfg.streamCertUser || '').trim() : '';
        if (certUser) {
          n.cert = '/certs/' + certUser + '.pem';
          n.key  = '/certs/' + certUser + '.key';
          n.certname = '';
          n.keyname  = '';
          n.verifyservercert = false;
          console.log('    TLS (' + n.name + '): auto-configured from configurator (' + certUser + ')');
        } else {
          console.log('    TLS (' + n.name + '): no streamCertUser in configurator — set in editor');
        }
      }
    }
  });

  // --- TCP out (preserve host from existing; keep per-feed ports + tls from build) ---
  var tcpCur = cur.find(function(n) { return n.type === 'tcp out' && n.host; });
  upd.forEach(function(n) {
    if (n.type === 'tcp out') {
      if (tcpCur) n.host = tcpCur.host;
      console.log('    TCP: ' + n.name + ' → ' + n.host + ':' + n.port + ' tls=' + n.tls);
    }
  });

  fs.writeFileSync('/tmp/flows_merged.json', JSON.stringify(upd, null, 2));
"

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
