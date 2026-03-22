#!/usr/bin/env bash
# Global fix: crashed MediaMTX web editor after update (ExecStartPre or editor crash).
# Run on every affected server: sudo ./scripts/fix-mediamtx-webeditor-now.sh
# Or one-liner from repo root: sudo bash scripts/fix-mediamtx-webeditor-now.sh
set -e

WEBEDITOR_DIR="/opt/mediamtx-webeditor"
OVERLAY_SCRIPT="${WEBEDITOR_DIR}/ensure_overlay.py"

# 1. Ensure overlay script never exits failure so the editor always gets to start
if [[ -d "$WEBEDITOR_DIR" ]]; then
  cat > "$OVERLAY_SCRIPT" << 'ENSURE_OVERLAY_EOF'
#!/usr/bin/env python3
"""Pre-start hook: ensure infra-TAK LDAP overlay is injected into the editor.

Runs as ExecStartPre so that upstream self-updates (Versions tab) don't
silently remove the overlay.  Idempotent — does nothing if already patched.
Never exits with failure so the main editor always gets to start.
"""
import os, re, sys

def main():
    EDITOR  = '/opt/mediamtx-webeditor/mediamtx_config_editor.py'
    OVERLAY = '/opt/mediamtx-webeditor/mediamtx_ldap_overlay.py'
    MARKER  = '# --- infra-TAK LDAP overlay ---'

    if not os.path.exists(EDITOR) or not os.path.exists(OVERLAY):
        return

    with open(EDITOR, 'r') as f:
        src = f.read()

    changed = False

    # 1. Port patch: ensure PORT env var override
    if 'port=5000' in src and 'os.environ.get("PORT"' not in src:
        src = src.replace('port=5000', 'port=int(os.environ.get("PORT", 5080))', 1)
        changed = True

    # 2. API port patch: 9997 -> 9898
    if '9997' in src:
        src = src.replace('9997', '9898')
        changed = True

    # 3. LDAP overlay import injection
    if MARKER not in src:
        inject = (
            "\n" + MARKER + "\n"
            "import os as _os\n"
            "if _os.environ.get('LDAP_ENABLED'):\n"
            "    import sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))\n"
            "    from mediamtx_ldap_overlay import apply_ldap_overlay\n"
            "    apply_ldap_overlay(app)\n"
            "# --- end LDAP overlay ---\n"
        )
        lines = src.splitlines(keepends=True)
        inserted = False
        for i, line in enumerate(lines):
            if 'app = Flask(' in line:
                lines.insert(i + 1, '\n' + inject)
                inserted = True
                break
        if not inserted:
            for i, line in enumerate(lines):
                if 'app.run(' in line:
                    lines.insert(i, '\n' + inject)
                    inserted = True
                    break
        if inserted:
            src = ''.join(lines)
            changed = True

    # 4. Fix duplicate endpoints (shared_stream_page, shared_hls_proxy) -> Flask AssertionError
    lines = src.splitlines(keepends=True)
    for def_pat, route_hints, endpoint_val in (
            (r'\bdef shared_stream_page\s*\(', ('/shared/',), 'shared_stream_page_core'),
            (r'\bdef shared_hls_proxy\s*\(', ('/shared-hls/', 'shared-hls', 'shared_hls'), 'shared_hls_proxy_core'),
            (r'\bdef api_share_links_list\s*\(', ('/api/share-links', 'share-links'), 'api_share_links_list_core'),
            (r'\bdef api_share_links_generate\s*\(', ('/api/share-links/generate', 'share-links/generate'), 'api_share_links_generate_core'),
            (r'\bdef api_share_links_revoke\s*\(', ('/api/share-links/revoke', 'share-links/revoke'), 'api_share_links_revoke_core'),
    ):
        for i in range(len(lines) - 1, -1, -1):
            if not re.search(def_pat, lines[i]):
                continue
            j = i - 1
            while j >= 0 and j >= i - 20:
                line = lines[j]
                if '@app.route' in line and 'endpoint=' not in line and any(h in line for h in route_hints):
                    if line.rstrip().endswith(')'):
                        lines[j] = line.rstrip()[:-1] + ", endpoint='" + endpoint_val + "')\n"
                    else:
                        lines[j] = line.rstrip().rstrip(')') + ", endpoint='" + endpoint_val + "')\n"
                    src = ''.join(lines)
                    changed = True
                    break
                j -= 1
            else:
                j = i - 1
                while j >= 0 and j >= i - 20:
                    if '@app.route' in lines[j] and 'endpoint=' not in lines[j]:
                        l = lines[j]
                        if l.rstrip().endswith(')'):
                            lines[j] = l.rstrip()[:-1] + ", endpoint='" + endpoint_val + "')\n"
                        else:
                            lines[j] = l.rstrip().rstrip(')') + ", endpoint='" + endpoint_val + "')\n"
                        src = ''.join(lines)
                        changed = True
                        break
                    j -= 1
            break

    if changed:
        with open(EDITOR, 'w') as f:
            f.write(src)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
ENSURE_OVERLAY_EOF
  chmod 755 "$OVERLAY_SCRIPT"
  echo "Updated ensure_overlay.py (fail-safe)."
fi

# 2. If the service exists, restart it so the editor comes up
if [[ -f /etc/systemd/system/mediamtx-webeditor.service ]] || systemctl cat mediamtx-webeditor &>/dev/null; then
  systemctl restart mediamtx-webeditor 2>/dev/null || true
  echo "Restarted mediamtx-webeditor."
  sleep 1
  if systemctl is-active --quiet mediamtx-webeditor; then
    echo "mediamtx-webeditor is running."
  else
    echo "Service still not up. Check: journalctl -u mediamtx-webeditor -n 80 --no-pager"
  fi
else
  echo "mediamtx-webeditor service not found; overlay script updated only."
fi
