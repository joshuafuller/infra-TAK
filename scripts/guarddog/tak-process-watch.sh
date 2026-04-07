#!/bin/bash

SERVER_IDENTIFIER=$(cat /opt/tak-guarddog/server_identifier 2>/dev/null || echo "$(hostname)")
ALERT_SENT_FILE="/var/lib/takguard/process_alert_sent"
FAIL_COUNT_FILE="/var/lib/takguard/process_fail_count"
LAST_RESTART_FILE="/var/lib/takguard/last_restart_time"
RESTART_LOCK="/var/lib/takguard/restart.lock"
MIN_UPTIME_SECS=900

# Don't run during first 15 minutes after boot (avoid restart loop on slow startup)
UPTIME_SECS=$(awk '{print int($1)}' /proc/uptime)
if [ "$UPTIME_SECS" -lt "$MIN_UPTIME_SECS" ]; then
  exit 0
fi

# TAK takes ~5 min to fully start; checking for missing processes during startup is invalid.
STARTUP_GRACE=600
_tak_mono=$(systemctl show takserver --property=ActiveEnterTimestampMonotonic --value 2>/dev/null || echo "")
if [ -n "$_tak_mono" ] && [ "$_tak_mono" != "0" ]; then
  _tak_age=$(( UPTIME_SECS - _tak_mono / 1000000 ))
  [ "$_tak_age" -ge 0 ] && [ "$_tak_age" -lt "$STARTUP_GRACE" ] && exit 0
fi

if ! systemctl is-active --quiet takserver; then
  rm -f "$FAIL_COUNT_FILE"
  exit 0
fi

if [ -f "$LAST_RESTART_FILE" ]; then
  LAST_RESTART=$(cat "$LAST_RESTART_FILE")
  CURRENT_TIME=$(date +%s)
  TIME_SINCE_RESTART=$((CURRENT_TIME - LAST_RESTART))
  if [ $TIME_SINCE_RESTART -lt 900 ]; then
    exit 0
  fi
fi

MISSING_PROCESSES=()

if ! pgrep -f "spring.profiles.active=messaging" > /dev/null; then
  MISSING_PROCESSES+=("messaging")
fi

if ! pgrep -f "spring.profiles.active=api" > /dev/null; then
  MISSING_PROCESSES+=("api")
fi

if ! pgrep -f "spring.profiles.active=config" > /dev/null; then
  MISSING_PROCESSES+=("config")
fi

if ! pgrep -f "takserver-pm.jar" > /dev/null; then
  MISSING_PROCESSES+=("plugins")
fi

if ! pgrep -f "takserver-retention.jar" > /dev/null; then
  MISSING_PROCESSES+=("retention")
fi

if [ ${#MISSING_PROCESSES[@]} -gt 0 ]; then
  if [ -f "$FAIL_COUNT_FILE" ]; then
    FAIL_COUNT=$(cat "$FAIL_COUNT_FILE")
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    FAIL_COUNT=1
  fi
  echo "$FAIL_COUNT" > "$FAIL_COUNT_FILE"
  
  if [ "$FAIL_COUNT" -ge 3 ]; then
    if [ -f "$RESTART_LOCK" ]; then
      exit 0
    fi
    
    if [ ! -f "$ALERT_SENT_FILE" ] || [ "$(find $ALERT_SENT_FILE -mmin +60 2>/dev/null)" ]; then
      touch "$ALERT_SENT_FILE"
      
      TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      MISSING_LIST=$(IFS=,; echo "${MISSING_PROCESSES[*]}")
      
      SUBJ="TAK Server Process Alert on $SERVER_IDENTIFIER"
      BODY="TAK Server processes are missing - RESTARTING.

Server: $SERVER_IDENTIFIER
Time (UTC): $TS

Service Status: Running (but incomplete)
Missing Processes: $MISSING_LIST
Consecutive failures: $FAIL_COUNT

Expected 5 processes:
- messaging (client connections)
- api (web interface)
- config (configuration)
- plugins (plugin manager)
- retention (data cleanup)

Action taken: Restarting TAK Server

Check logs after restart:
  tail -100 /opt/tak/logs/takserver-messaging.log
  tail -100 /opt/tak/logs/takserver-api.log
"

      [ -n "ALERT_EMAIL_PLACEHOLDER" ] && echo -e "$BODY" | /opt/tak-guarddog/send-alert-email.sh "$SUBJ" "ALERT_EMAIL_PLACEHOLDER"
      if [ -f /opt/tak-guarddog/sms_send.sh ]; then
        TMPF="/tmp/gd-sms-$$.txt"
        printf '%s' "$BODY" > "$TMPF"
        /opt/tak-guarddog/sms_send.sh "$SUBJ" "$TMPF" 2>/dev/null || true
        rm -f "$TMPF"
      fi
      mkdir -p /var/log/takguard

      # Daily restart cap — shared across all Guard Dog TAK scripts
      DAILY_COUNT_FILE="/var/lib/takguard/tak_restart_count_24h"
      DAILY_WINDOW_FILE="/var/lib/takguard/tak_restart_window"
      MAX_DAILY_RESTARTS=3
      _now=$(date +%s)
      _window_start=$(cat "$DAILY_WINDOW_FILE" 2>/dev/null || echo 0)
      if [ $((_now - _window_start)) -ge 86400 ]; then
        echo "$_now" > "$DAILY_WINDOW_FILE"
        echo 0 > "$DAILY_COUNT_FILE"
      fi
      _daily=$(cat "$DAILY_COUNT_FILE" 2>/dev/null || echo 0)
      if [ "$_daily" -ge "$MAX_DAILY_RESTARTS" ]; then
        echo "$(date): TAK Server missing processes: $MISSING_LIST — daily restart cap ($MAX_DAILY_RESTARTS) reached, skipping" >> /var/log/takguard/restarts.log
        exit 0
      fi

      echo "$(date): TAK Server missing processes: $MISSING_LIST ($FAIL_COUNT failures) - restarting" >> /var/log/takguard/restarts.log
      
      touch "$RESTART_LOCK"
      date +%s > "$LAST_RESTART_FILE"
      echo $((_daily + 1)) > "$DAILY_COUNT_FILE"

      # Clean restart: stop → kill orphan Java processes → clear Ignite cache → start
      systemctl stop takserver
      sleep 2
      pkill -9 -u tak 2>/dev/null || true
      sleep 1
      rm -rf /opt/tak/work
      systemctl start takserver

      sleep 30
      rm -f "$RESTART_LOCK"
      rm -f "$FAIL_COUNT_FILE"
    fi
  fi
else
  rm -f "$FAIL_COUNT_FILE"
  rm -f "$ALERT_SENT_FILE"
fi
