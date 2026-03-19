#!/bin/bash
# Send Guard Dog alert via infra-TAK console (Email Relay). Usage: echo -e "$BODY" | send-alert-email.sh "Subject" "to@example.com"
# Replaces direct "mail" so all alerts use the same relay as the test email.
SUBJ="${1:-Guard Dog Alert}"
TO="${2:-}"
[ -z "$TO" ] && exit 0
CONSOLE_PORT="${CONSOLE_PORT:-5001}"
cat | python3 -c "
import json, sys
subj, to = sys.argv[1], sys.argv[2]
body = sys.stdin.read()
print(json.dumps({'subject': subj, 'body': body, 'to': to}))
" "$SUBJ" "$TO" 2>/dev/null | curl -s -X POST "http://127.0.0.1:${CONSOLE_PORT}/api/guarddog/send-alert-email" \
  -H "Content-Type: application/json" \
  -d @- \
  --connect-timeout 5 --max-time 15 >/dev/null 2>&1
