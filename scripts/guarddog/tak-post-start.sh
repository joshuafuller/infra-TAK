#!/bin/bash
# Guard Dog Post-Start Orchestrator
# Runs as a separate systemd oneshot after takserver.service.
#
# Waits for TAK Server to be fully listening on 8089, then starts
# Docker services one at a time in order:
#   1. Authentik (LDAP + SSO)
#   2. TAK Portal
#   3. CloudTAK
#
# Each service is given time to stabilize before the next one starts.
# Companion to tak-boot-sequencer.sh which stops these before TAK starts.

MAX_WAIT_TAK=900
MAX_WAIT_AK=300
INTERVAL=10

_log() {
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') post-start: $1"
  logger -t takguard-boot "$1" 2>/dev/null
}

# ── 1. Wait for TAK Server to be listening on 8089 ──
_log "Waiting for TAK Server port 8089..."
_t=0
while [ $_t -lt $MAX_WAIT_TAK ]; do
  if nc -z 127.0.0.1 8089 2>/dev/null; then
    _log "TAK Server 8089 ready (${_t}s)"
    break
  fi
  sleep $INTERVAL
  _t=$((_t + INTERVAL))
done
if [ $_t -ge $MAX_WAIT_TAK ]; then
  _log "TAK Server 8089 not ready after ${MAX_WAIT_TAK}s — starting remaining services anyway"
fi

# ── 2. Start Authentik ──
AK_DIR=""
for _d in /root/authentik "${HOME:-/root}/authentik"; do
  [ -f "$_d/docker-compose.yml" ] && AK_DIR="$_d" && break
done

if [ -n "$AK_DIR" ]; then
  _log "Starting Authentik..."
  cd "$AK_DIR" && docker compose up -d 2>/dev/null
  _t=0
  while [ $_t -lt $MAX_WAIT_AK ]; do
    _status=$(docker ps --filter name=authentik-server --format '{{.Status}}' 2>/dev/null || echo "")
    if echo "$_status" | grep -q "healthy"; then
      _log "Authentik healthy (${_t}s)"
      break
    fi
    sleep $INTERVAL
    _t=$((_t + INTERVAL))
  done
  [ $_t -ge $MAX_WAIT_AK ] && _log "Authentik not healthy after ${MAX_WAIT_AK}s, continuing"
else
  _log "Authentik not installed, skipping"
fi

# ── 3. Start TAK Portal ──
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q '^tak-portal$'; then
  _log "Starting TAK Portal..."
  docker start tak-portal 2>/dev/null
  sleep 10
  _log "TAK Portal started"
else
  _log "TAK Portal not found, skipping"
fi

# ── 4. Start CloudTAK ──
CT_DIR=""
for _d in /root/CloudTAK "${HOME:-/root}/CloudTAK"; do
  [ -f "$_d/docker-compose.yml" ] && CT_DIR="$_d" && break
done

if [ -n "$CT_DIR" ]; then
  _log "Starting CloudTAK..."
  cd "$CT_DIR" && docker compose up -d 2>/dev/null
  sleep 10
  _log "CloudTAK started"
else
  _log "CloudTAK not installed, skipping"
fi

_log "Boot sequence complete — all services started"
exit 0
