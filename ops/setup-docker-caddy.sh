#!/usr/bin/env bash
set -Eeuo pipefail

# NetScope: safe integration with the existing Darma Docker Caddy.
DOMAIN="test.usersmanager.ir"
APP_DIR="/opt/internet-speed"
APP="vpn-diagnostics"
CADDY="darma-general-caddy-1"
OVERRIDE="$APP_DIR/compose.override.yaml"

die() { echo "ERROR: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "Run with sudo"
command -v docker >/dev/null || die "Docker is missing"
[[ -f "$APP_DIR/compose.yaml" ]] || die "Missing $APP_DIR/compose.yaml"
docker inspect "$CADDY" >/dev/null 2>&1 || die "Caddy container not found"
[[ "$(docker inspect -f '{{.State.Running}}' "$CADDY")" == "true" ]] || die "Caddy not running"
curl -fsS --max-time 10 http://127.0.0.1:8097/api/health >/dev/null || die "NetScope not healthy on 8097"

echo "=== DNS ==="
getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u || true

CADDYFILE="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$CADDY")"
[[ -n "$CADDYFILE" && -f "$CADDYFILE" ]] || die "Cannot locate bind-mounted Caddyfile"
PROJECT="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$CADDY")"
[[ -n "$PROJECT" && "$PROJECT" != "<no value>" ]] || die "Caddy Compose project label missing"

NETWORK=""
NETWORK_COUNT=0
while IFS= read -r net; do
  [[ -n "$net" ]] || continue
  netproject="$(docker network inspect -f '{{index .Labels "com.docker.compose.project"}}' "$net" 2>/dev/null || true)"
  if [[ "$netproject" == "$PROJECT" ]]; then
    NETWORK="$net"
    NETWORK_COUNT=$((NETWORK_COUNT + 1))
  fi
done < <(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$CADDY")
[[ "$NETWORK_COUNT" -eq 1 ]] || die "Ambiguous Caddy network (found $NETWORK_COUNT). No changes made"
echo "Caddy network: $NETWORK"
echo "Caddy config: $CADDYFILE"

cd "$APP_DIR"
if [[ -e "$OVERRIDE" ]] && ! grep -Fq '# NetScope managed Docker Caddy network' "$OVERRIDE"; then
  die "Existing non-NetScope compose.override.yaml; refusing to overwrite"
fi
TMP="$(mktemp "$APP_DIR/.compose-caddy.XXXXXX")"
cat >"$TMP" <<EOF
# NetScope managed Docker Caddy network
services:
  vpn-diagnostics:
    networks:
      - default
      - caddy_shared
networks:
  caddy_shared:
    external: true
    name: $NETWORK
EOF
if [[ -e "$OVERRIDE" ]]; then cp -a "$OVERRIDE" "$OVERRIDE.bak.$(date +%Y%m%d-%H%M%S)"; fi
mv "$TMP" "$OVERRIDE"
docker compose config --quiet || die "Compose validation failed"
docker compose up -d --no-build "$APP" || die "Unable to attach NetScope to Caddy network"
docker exec "$CADDY" sh -c 'wget -qO- http://vpn-diagnostics:8097/api/health' \
  | grep -q '"ok":true' || die "Caddy cannot access NetScope on Docker network"

if grep -Eq '^[[:space:]]*test\.usersmanager\.ir[[:space:]]*\{' "$CADDYFILE"; then
  echo "Caddyfile already has a domain block; leaving it untouched"
else
  if grep -Fq "$DOMAIN" "$CADDYFILE"; then
    die "Domain appears elsewhere in Caddyfile; refusing duplicate"
  fi
  BACKUP="$CADDYFILE.netscope.$(date +%Y%m%d-%H%M%S).bak"
  cp -a "$CADDYFILE" "$BACKUP"
  cat >>"$CADDYFILE" <<'CADDY'

# NetScope mobile VPN/ISP speed diagnostics
test.usersmanager.ir {
    encode zstd gzip
    reverse_proxy vpn-diagnostics:8097
}
CADDY
  if ! docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    cp -a "$BACKUP" "$CADDYFILE"
    die "Caddy validation failed; restored backup"
  fi
  if ! docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    cp -a "$BACKUP" "$CADDYFILE"
    docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
    die "Caddy reload failed; restored backup"
  fi
  echo "Caddyfile updated. Backup: $BACKUP"
fi

echo "=== LOCAL BACKEND ==="
curl -fsS --max-time 10 http://127.0.0.1:8097/api/health
echo
echo "=== PUBLIC HTTPS ==="
curl -fsS --max-time 25 -w '\nHTTP %{http_code}\n' "https://$DOMAIN/api/health" || {
  echo "HTTPS not verified yet. Check DNS and Caddy logs:"
  echo "docker logs --tail=120 $CADDY"
}
