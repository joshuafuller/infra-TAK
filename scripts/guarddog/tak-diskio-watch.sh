#!/bin/bash
# Guard Dog Disk I/O Performance Monitor
# Runs a lightweight dd benchmark every 15 minutes, logs results to CSV,
# detects sustained degradation, and sends an email alert.
#
# Log: /var/lib/takguard/diskio_history.csv  (timestamp,mb_per_sec)
# Alert: fires when the last-hour average drops below WARN_MBPS or
#        falls to less than 30% of the 24-hour rolling average.

SERVER_IDENTIFIER=$(cat /opt/tak-guarddog/server_identifier 2>/dev/null || echo "$(hostname)")
HISTORY="/var/lib/takguard/diskio_history.csv"
ALERT_SENT_FILE="/var/lib/takguard/diskio_alert_sent"
WARN_MBPS=50
TEST_SIZE_MB=10
RETENTION_HOURS=72

mkdir -p /var/lib/takguard

# ── 1. Run benchmark (10 MB sync write — takes <1s on healthy disk) ──
RAW=$(dd if=/dev/zero of=/tmp/.gd_diskio_test bs=1M count=$TEST_SIZE_MB oflag=dsync 2>&1)
rm -f /tmp/.gd_diskio_test

SPEED=$(echo "$RAW" | grep -oP '[\d.]+ [KMGT]?B/s' | tail -1)
if [ -z "$SPEED" ]; then
  logger -t takguard-diskio "Benchmark failed — dd returned no speed"
  exit 0
fi

# Normalise to MB/s
MB_S=$(echo "$SPEED" | awk '{
  val = $1
  unit = $2
  if (unit == "kB/s" || unit == "KB/s") val = val / 1024
  else if (unit == "GB/s")              val = val * 1024
  else if (unit == "B/s")               val = val / 1048576
  printf "%.1f", val
}')

TS=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# ── 2. Append to history CSV ──
if [ ! -f "$HISTORY" ]; then
  echo "timestamp,mb_per_sec" > "$HISTORY"
fi
echo "$TS,$MB_S" >> "$HISTORY"

# ── 3. Trim old entries (keep RETENTION_HOURS) ──
CUTOFF=$(date -u -d "-${RETENTION_HOURS} hours" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || \
         date -u -v-${RETENTION_HOURS}H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "")
if [ -n "$CUTOFF" ]; then
  TMPF=$(mktemp)
  head -1 "$HISTORY" > "$TMPF"
  tail -n +2 "$HISTORY" | awk -F, -v cutoff="$CUTOFF" '$1 >= cutoff' >> "$TMPF"
  mv "$TMPF" "$HISTORY"
fi

# ── 4. Compute averages ──
NOW_EPOCH=$(date -u '+%s')
HOUR_AGO=$((NOW_EPOCH - 3600))
DAY_AGO=$((NOW_EPOCH - 86400))

AVG_1H=$(tail -n +2 "$HISTORY" | awk -F, -v ha="$HOUR_AGO" '
  {
    cmd = "date -u -d \"" $1 "\" +%s 2>/dev/null || date -u -j -f %Y-%m-%dT%H:%M:%SZ \"" $1 "\" +%s 2>/dev/null"
    cmd | getline ep; close(cmd)
    if (ep >= ha) { sum += $2; n++ }
  }
  END { if (n > 0) printf "%.1f", sum/n; else print "0" }')

AVG_24H=$(tail -n +2 "$HISTORY" | awk -F, -v da="$DAY_AGO" '
  {
    cmd = "date -u -d \"" $1 "\" +%s 2>/dev/null || date -u -j -f %Y-%m-%dT%H:%M:%SZ \"" $1 "\" +%s 2>/dev/null"
    cmd | getline ep; close(cmd)
    if (ep >= da) { sum += $2; n++ }
  }
  END { if (n > 0) printf "%.1f", sum/n; else print "0" }')

SAMPLES_24H=$(tail -n +2 "$HISTORY" | wc -l | tr -d ' ')

logger -t takguard-diskio "Benchmark: ${MB_S} MB/s | 1h avg: ${AVG_1H} MB/s | 24h avg: ${AVG_24H} MB/s (${SAMPLES_24H} samples)"

# ── 5. Decide if alert is needed ──
# Need at least 4 samples (1 hour of data) before alerting
[ "$SAMPLES_24H" -lt 4 ] && exit 0

NEED_ALERT=false
ALERT_REASON=""

if [ "$(echo "$AVG_1H < $WARN_MBPS" | bc -l 2>/dev/null)" = "1" ]; then
  NEED_ALERT=true
  ALERT_REASON="Last-hour average (${AVG_1H} MB/s) is below ${WARN_MBPS} MB/s threshold"
fi

if [ "$(echo "$AVG_24H > 0" | bc -l 2>/dev/null)" = "1" ]; then
  DROP_PCT=$(echo "scale=0; (1 - $AVG_1H / $AVG_24H) * 100" | bc -l 2>/dev/null || echo "0")
  if [ "${DROP_PCT%%.*}" -ge 70 ] 2>/dev/null; then
    NEED_ALERT=true
    ALERT_REASON="${ALERT_REASON:+$ALERT_REASON\n}Last-hour average dropped ${DROP_PCT}% from 24h average (${AVG_24H} MB/s → ${AVG_1H} MB/s)"
  fi
fi

# ── 6. Send alert (max once per 6 hours) ──
if $NEED_ALERT; then
  if [ ! -f "$ALERT_SENT_FILE" ] || [ "$(find "$ALERT_SENT_FILE" -mmin +360 2>/dev/null)" ]; then
    touch "$ALERT_SENT_FILE"

    RECENT=$(tail -n 8 "$HISTORY" | tail -n +1)
    SUBJ="⚠ Disk I/O Degradation on $SERVER_IDENTIFIER"
    BODY="Guard Dog detected degraded disk I/O performance.

Server: $SERVER_IDENTIFIER
Time (UTC): $TS

$(echo -e "$ALERT_REASON")

Current reading:   ${MB_S} MB/s
Last-hour average: ${AVG_1H} MB/s
24-hour average:   ${AVG_24H} MB/s
Samples (24h):     ${SAMPLES_24H}

Recent readings:
$RECENT

This usually indicates noisy-neighbor disk contention on shared VPS
hosting. If sustained, consider requesting a node migration from your
VPS provider.

— Guard Dog"

    [ -n "ALERT_EMAIL_PLACEHOLDER" ] && echo -e "$BODY" | /opt/tak-guarddog/send-alert-email.sh "$SUBJ" "ALERT_EMAIL_PLACEHOLDER"
    if [ -f /opt/tak-guarddog/sms_send.sh ]; then
      TMPF="/tmp/gd-sms-$$.txt"
      printf '%s' "$BODY" > "$TMPF"
      /opt/tak-guarddog/sms_send.sh "$SUBJ" "$TMPF" 2>/dev/null || true
      rm -f "$TMPF"
    fi
  fi
else
  rm -f "$ALERT_SENT_FILE"
fi

exit 0
