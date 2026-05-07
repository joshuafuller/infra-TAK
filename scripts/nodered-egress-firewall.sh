#!/usr/bin/env bash
# nodered-egress-firewall.sh — opt-in egress allowlist for the Node-RED Docker container.
#
# Restricts outbound network from the `nodered` container to:
#   * TAK Server on the host (8443, 8089) via host.docker.internal
#   * DNS (53) — required for ArcGIS hostname resolution and any other lookups
#   * NTP (123) — clock sync
#   * Optional: explicit IP allowlist for ArcGIS / external services (see ALLOW_DESTS below)
#
# Anything else outbound is DROPPED.
#
# This is the single highest-leverage Node-RED hardening control: it neutralizes the
# 5-line cert-exfil scenario where a compromised flow reads /certs/admin.key (or any
# cert in the container) and POSTs it to an attacker-controlled host. With this active,
# even a fully compromised Node-RED runtime cannot ship the cert anywhere.
#
# WARNING: this is a strict variant. If your Node-RED flows call ArcGIS REST endpoints
# directly (which they do — that's what the ArcGIS Engine flow is for), you MUST add the
# ArcGIS hostnames/IPs to ALLOW_DESTS, OR use the Squid sidecar approach documented in
# docs/NODERED-EGRESS.md instead. iptables is layer-3 — it can't filter by hostname.
#
# Usage:
#   sudo bash nodered-egress-firewall.sh apply       # install rules
#   sudo bash nodered-egress-firewall.sh dryrun      # show rules without applying
#   sudo bash nodered-egress-firewall.sh status      # show currently-installed rules
#   sudo bash nodered-egress-firewall.sh remove      # remove rules (allows all egress again)
#
# Idempotent: re-running 'apply' is safe.

set -euo pipefail

CMD="${1:-status}"
CONTAINER_NAME="nodered"
CHAIN="DOCKER-USER"
COMMENT_TAG="nodered-egress"

# ----- ALLOW_DESTS configuration -----
# Hostnames or IPs the Node-RED container is allowed to reach OUTSIDE the host.
# These get resolved to IPs at apply-time. Re-run 'apply' if hostnames change IPs.
# Default: empty. Add your ArcGIS feature-service hostnames here. Examples:
#   ALLOW_DESTS=("services.arcgis.com" "services3.arcgis.com" "services1.arcgis.com")
ALLOW_DESTS=()

# ----- helpers -----
need_root() {
  if [ "$EUID" -ne 0 ]; then
    echo "ERROR: must run as root (sudo)" >&2
    exit 1
  fi
}

container_ip() {
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true
}

host_gateway_ip() {
  # Docker assigns the host-gateway alias; we extract the gateway from the bridge
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true
}

resolve_ips() {
  # $1 = hostname; emits one IPv4 per line
  getent ahosts "$1" 2>/dev/null | awk '/STREAM/ {print $1}' | sort -u
}

# Build the list of iptables commands we want present.
emit_rules() {
  local nr_ip="$1"
  local gw="$2"

  if [ -z "$nr_ip" ]; then
    echo "ERROR: container '$CONTAINER_NAME' has no IP — is it running?" >&2
    exit 1
  fi

  # ESTABLISHED/RELATED — allow return traffic on permitted connections
  echo "iptables -A $CHAIN -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN -m comment --comment $COMMENT_TAG"

  # Allow Node-RED -> host gateway (TAK Server is on the host on 8443 / 8089)
  if [ -n "$gw" ]; then
    echo "iptables -A $CHAIN -s $nr_ip -d $gw -p tcp -m multiport --dports 8443,8089 -j RETURN -m comment --comment $COMMENT_TAG"
  fi

  # Allow DNS (TCP+UDP)
  echo "iptables -A $CHAIN -s $nr_ip -p udp --dport 53 -j RETURN -m comment --comment $COMMENT_TAG"
  echo "iptables -A $CHAIN -s $nr_ip -p tcp --dport 53 -j RETURN -m comment --comment $COMMENT_TAG"

  # Allow NTP
  echo "iptables -A $CHAIN -s $nr_ip -p udp --dport 123 -j RETURN -m comment --comment $COMMENT_TAG"

  # Allow each ALLOW_DESTS hostname (resolved to IPs at apply time)
  for dest in "${ALLOW_DESTS[@]}"; do
    while IFS= read -r ip; do
      [ -z "$ip" ] && continue
      echo "iptables -A $CHAIN -s $nr_ip -d $ip -p tcp -m multiport --dports 80,443 -j RETURN -m comment --comment ${COMMENT_TAG}-${dest}"
    done < <(resolve_ips "$dest")
  done

  # Default DROP for everything else from Node-RED
  echo "iptables -A $CHAIN -s $nr_ip -j DROP -m comment --comment $COMMENT_TAG"
}

remove_rules() {
  iptables-save 2>/dev/null | grep "$CHAIN" | grep "$COMMENT_TAG" | sed -E 's/^-A /-D /' | while IFS= read -r rule; do
    # Convert each -A line back to a delete via -D and execute
    # shellcheck disable=SC2086
    iptables $rule 2>/dev/null || true
  done
}

case "$CMD" in
  apply)
    need_root
    nr_ip="$(container_ip)"
    gw="$(host_gateway_ip)"
    if [ -z "$nr_ip" ]; then
      echo "ERROR: Node-RED container is not running (no IP). Start it first." >&2
      exit 1
    fi
    echo "==> Removing any existing $COMMENT_TAG rules"
    remove_rules
    echo "==> Installing fresh rules (Node-RED IP: $nr_ip, host gateway: ${gw:-unknown})"
    while IFS= read -r cmd; do
      echo "    $cmd"
      eval "$cmd"
    done < <(emit_rules "$nr_ip" "$gw")
    echo "==> Done. Verify with: $0 status"
    echo
    echo "NOTE: the rules apply to the container's CURRENT IP. If you restart the"
    echo "      container or recreate it, the IP may change and you'll need to re-run apply."
    echo "      Consider scheduling: '@reboot $0 apply' in /etc/cron.d/."
    ;;
  dryrun)
    nr_ip="$(container_ip)"
    gw="$(host_gateway_ip)"
    if [ -z "$nr_ip" ]; then
      echo "ERROR: Node-RED container is not running (no IP). Start it first." >&2
      exit 1
    fi
    echo "Would install (against IP $nr_ip, gateway ${gw:-unknown}):"
    emit_rules "$nr_ip" "$gw"
    ;;
  status)
    echo "Currently-installed $COMMENT_TAG rules in $CHAIN:"
    iptables -L "$CHAIN" -n -v --line-numbers 2>/dev/null | grep "$COMMENT_TAG" || echo "  (none)"
    ;;
  remove)
    need_root
    echo "==> Removing $COMMENT_TAG rules"
    remove_rules
    echo "==> Done. Node-RED egress is now unrestricted."
    ;;
  *)
    echo "Usage: $0 {apply|dryrun|status|remove}" >&2
    exit 2
    ;;
esac
