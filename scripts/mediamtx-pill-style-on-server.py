#!/usr/bin/env python3
"""Run on the MediaMTX server to upgrade Mode/Status from color-only to pill style.
Usage: sudo python3 mediamtx-pill-style-on-server.py
"""
import sys

path = "/opt/mediamtx-webeditor/mediamtx_config_editor.py"

try:
    with open(path) as f:
        c = f.read()
except Exception as e:
    print("Read failed:", e, file=sys.stderr)
    sys.exit(1)

# Format on server: <span style="color: ' + modeColor + '; font-weight: bold;">
old_mode = "style=\"color: ' + modeColor + '; font-weight: bold;\""
new_mode = "style=\"background: ' + modeColor + '; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold;\""
old_status = "style=\"color: ' + statusColor + '; font-weight: bold;\""
new_status = "style=\"background: ' + statusColor + '; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold;\""

if old_mode not in c:
    if "padding: 4px 10px" in c and "modeColor" in c:
        print("Already patched (pill style present).")
    else:
        print("Pattern not found. File may use different format. First 200 chars of line with modeColor:", file=sys.stderr)
        for line in c.splitlines():
            if "modeColor" in line and "style" in line:
                print(repr(line[:200]), file=sys.stderr)
                break
    sys.exit(0 if "padding: 4px 10px" in c else 1)

c = c.replace(old_mode, new_mode, 1).replace(old_status, new_status, 1)

try:
    with open(path, "w") as f:
        f.write(c)
except Exception as e:
    print("Write failed:", e, file=sys.stderr)
    sys.exit(1)

print("Patched. Run: sudo systemctl restart mediamtx-webeditor")
print("Then hard-refresh the External Sources tab (Ctrl+Shift+R) or open in incognito.")
