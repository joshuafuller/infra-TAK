#!/bin/bash
# Guard Dog Boot Sequencer (Pre-Start)
# ExecStartPre for takserver.service.
#
# 1. Stops Docker containers (Authentik, TAK Portal, CloudTAK) so TAK Server
#    gets all CPU during its heavy 5-7 minute initialization.
# 2. Waits for PostgreSQL to accept connections.
# 3. Exits → TAK Server starts with full CPU.
#
# The companion tak-post-start.sh brings Docker services back up in order
# once TAK is listening on 8089.

MAX_WAIT=120
INTERVAL=5

_log() {
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') boot-sequencer: $1"
  logger -t takguard-boot "$1" 2>/dev/null
}

# ── 1. Stop Docker containers so TAK gets full CPU ──
_log "Stopping Docker containers to give TAK Server full CPU..."

for _d in /root/authentik "${HOME:-/root}/authentik"; do
  if [ -f "$_d/docker-compose.yml" ]; then
    cd "$_d" && docker compose stop -t 10 2>/dev/null && _log "Authentik containers stopped"
    break
  fi
done

docker stop tak-portal 2>/dev/null && _log "TAK Portal stopped"

for _d in /root/CloudTAK "${HOME:-/root}/CloudTAK"; do
  if [ -f "$_d/docker-compose.yml" ]; then
    cd "$_d" && docker compose stop -t 10 2>/dev/null && _log "CloudTAK stopped"
    break
  fi
done

# ── 2. Wait for PostgreSQL ──
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

_log "Pre-start complete — TAK Server may start with full CPU"
exit 0
