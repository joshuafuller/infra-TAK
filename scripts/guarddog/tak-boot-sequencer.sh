#!/bin/bash
# Guard Dog Boot Sequencer
# ExecStartPre for takserver.service — waits for dependent services before TAK starts.
# Prevents CPU stampede from all services initializing simultaneously on boot.
#
# Order: PostgreSQL → Docker/Authentik → then TAK Server may start.
# Each wait has a timeout so TAK always starts eventually.

MAX_WAIT=180
INTERVAL=10

_log() {
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') boot-sequencer: $1"
  logger -t takguard-boot "$1" 2>/dev/null
}

# 1. Wait for PostgreSQL to accept connections
_log "Waiting for PostgreSQL..."
_t=0
while [ $_t -lt $MAX_WAIT ]; do
  if sudo -u postgres psql -c "SELECT 1" &>/dev/null; then
    _log "PostgreSQL ready (${_t}s)"
    break
  fi
  sleep $INTERVAL
  _t=$((_t + INTERVAL))
done
[ $_t -ge $MAX_WAIT ] && _log "PostgreSQL not ready after ${MAX_WAIT}s, proceeding anyway"

# 2. Wait for Authentik containers to be healthy (if installed)
AK_COMPOSE=""
for _d in /root/authentik "${HOME:-/root}/authentik"; do
  [ -f "$_d/docker-compose.yml" ] && AK_COMPOSE="$_d/docker-compose.yml" && break
done

if [ -n "$AK_COMPOSE" ]; then
  _log "Waiting for Authentik to be healthy..."
  _t=0
  while [ $_t -lt $MAX_WAIT ]; do
    _status=$(docker ps --filter name=authentik-server --format '{{.Status}}' 2>/dev/null || echo "")
    if echo "$_status" | grep -q "healthy"; then
      _log "Authentik healthy (${_t}s)"
      break
    fi
    sleep $INTERVAL
    _t=$((_t + INTERVAL))
  done
  [ $_t -ge $MAX_WAIT ] && _log "Authentik not healthy after ${MAX_WAIT}s, proceeding anyway"
else
  _log "Authentik not installed, skipping"
fi

_log "Boot sequencer complete — TAK Server may start"
exit 0
