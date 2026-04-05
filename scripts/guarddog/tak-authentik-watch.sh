#!/bin/bash
# Guard Dog: Authentik container health. On 3 consecutive failures: alert and restart containers.

SERVER_IDENTIFIER=$(cat /opt/tak-guarddog/server_identifier 2>/dev/null || echo "$(hostname)")
STATE_DIR="/var/lib/takguard"
FAIL_FILE="$STATE_DIR/authentik.failcount"
COOLDOWN_FILE="$STATE_DIR/authentik_last_restart"
MAX_FAILS=3
COOLDOWN_SECS=900

mkdir -p "$STATE_DIR"

# Don't run during first 15 minutes after boot (avoid restarting during startup)
UPTIME_SECS=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
[ "$UPTIME_SECS" -lt 900 ] && exit 0

AK_DIR="${HOME:-/root}/authentik"
[ ! -f "$AK_DIR/docker-compose.yml" ] && exit 0

# Health: liveness endpoint if present, else root (redirects OK). Double attempt with pause
# reduces restarts on transient 500/503 during worker/DB blips (one timer tick).
ak_http_ok() {
  local url code
  for url in \
    "http://127.0.0.1:9090/-/health/live/" \
    "http://127.0.0.1:9090/"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$url" 2>/dev/null || echo "000")
    case "$code" in
      200|204|301|302) return 0 ;;
    esac
  done
  AK_LAST_CODE="$code"
  return 1
}

CODE="000"
if ak_http_ok; then
  echo 0 > "$FAIL_FILE"
  exit 0
fi
sleep 3
if ak_http_ok; then
  echo 0 > "$FAIL_FILE"
  exit 0
fi
CODE="${AK_LAST_CODE:-$CODE}"

# Failure
FAILS=$(( $(cat "$FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$FAILS" > "$FAIL_FILE"

if [ "$FAILS" -lt "$MAX_FAILS" ]; then
  exit 0
fi

# Cooldown: don't restart more than once per COOLDOWN_SECS
if [ -f "$COOLDOWN_FILE" ]; then
  LAST=$(cat "$COOLDOWN_FILE")
  NOW=$(date +%s)
  if [ $(( NOW - LAST )) -lt $COOLDOWN_SECS ]; then
    exit 0
  fi
fi

TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
mkdir -p /var/log/takguard
echo "$TS | restart | Authentik unhealthy (HTTP $CODE) — restarting containers" >> /var/log/takguard/restarts.log

SUBJ="Guard Dog: Authentik restarted on $SERVER_IDENTIFIER"
BODY="Authentik failed health check (HTTP $CODE) for $FAILS consecutive checks.

Server: $SERVER_IDENTIFIER
Time (UTC): $TS
Action: Restarting Authentik containers (docker compose restart).

Check /var/log/takguard/restarts.log for history.
"
[ -n "ALERT_EMAIL_PLACEHOLDER" ] && echo -e "$BODY" | /opt/tak-guarddog/send-alert-email.sh "$SUBJ" "ALERT_EMAIL_PLACEHOLDER"
if [ -f /opt/tak-guarddog/sms_send.sh ]; then
  TMPF="/tmp/gd-sms-$$.txt"
  printf '%s' "$BODY" > "$TMPF"
  /opt/tak-guarddog/sms_send.sh "$SUBJ" "$TMPF" 2>/dev/null || true
  rm -f "$TMPF"
fi

cd "$AK_DIR" && docker compose restart 2>&1
echo 0 > "$FAIL_FILE"
date +%s > "$COOLDOWN_FILE"
