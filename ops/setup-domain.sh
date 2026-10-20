#!/usr/bin/env bash
set -Eeuo pipefail
DOMAIN="test.usersmanager.ir"
UPSTREAM="127.0.0.1:8097"

if [[ ${EUID} -ne 0 ]]; then echo 'Run with sudo.' >&2; exit 1; fi
if ! curl -fsS --max-time 8 "http://${UPSTREAM}/api/health" >/dev/null; then
  echo "Backend not healthy on ${UPSTREAM}." >&2; exit 2
fi

echo "DNS for ${DOMAIN}:"
getent ahosts "$DOMAIN" | awk '{print $1}' | sort -u || true
if ! getent ahosts "$DOMAIN" >/dev/null; then
  echo 'DNS is not resolving yet. Create an A record for test.usersmanager.ir pointing to this server; disable CDN proxy.' >&2
  exit 3
fi

nginx_active=false; caddy_active=false
systemctl is-active --quiet nginx && nginx_active=true
systemctl is-active --quiet caddy && caddy_active=true
if [[ $nginx_active == true && $caddy_active == true ]]; then
  echo 'Both nginx and caddy active; refusing to change an ambiguous proxy setup.' >&2; exit 4
fi

if [[ $nginx_active == true ]]; then
  command -v nginx >/dev/null || { echo 'nginx command missing.' >&2; exit 5; }
  command -v certbot >/dev/null || {
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
  }
  site="/etc/nginx/sites-available/internet-speed-test-usersmanager.conf"
  link="/etc/nginx/sites-enabled/internet-speed-test-usersmanager.conf"
  mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
  if [[ ! -e "$site" ]]; then
    if nginx -T 2>&1 | grep -Fq "server_name ${DOMAIN}"; then
      echo "Another nginx configuration already serves ${DOMAIN}; exiting without changes." >&2; exit 6
    fi
    cat >"$site" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name test.usersmanager.ir;
    client_max_body_size 16m;
    location / {
        proxy_pass http://127.0.0.1:8097;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
NGINX
  fi
  ln -sfn "$site" "$link"
  if ! nginx -t; then
    rm -f "$link"
    echo 'nginx config invalid; site link removed.' >&2; exit 7
  fi
  systemctl reload nginx
  if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
    echo 'Nginx HTTP routing created, but HTTPS certificate issuance failed. Check DNS and inbound TCP 80/443, then rerun.' >&2
    exit 8
  fi
elif [[ $caddy_active == true ]]; then
  cfg="/etc/caddy/Caddyfile"
  if [[ ! -f "$cfg" ]]; then
    echo 'Caddyfile not at /etc/caddy/Caddyfile; refusing to guess.' >&2; exit 9
  fi
  if ! grep -Fq "${DOMAIN} {" "$cfg"; then
    if grep -R -F -l "${DOMAIN}" /etc/caddy >/dev/null 2>&1; then
      echo "Another Caddy config references ${DOMAIN}; refusing to add duplicate." >&2; exit 10
    fi
    backup="${cfg}.internet-speed.$(date +%Y%m%d-%H%M%S).bak"
    cp -a "$cfg" "$backup"
    cat >>"$cfg" <<'CADDY'

test.usersmanager.ir {
    reverse_proxy 127.0.0.1:8097
}
CADDY
    if ! caddy validate --config "$cfg"; then
      cp -a "$backup" "$cfg"
      echo "Caddy validation failed; restored ${backup}." >&2; exit 11
    fi
  fi
  systemctl reload caddy
else
  echo 'No host nginx/caddy service found. Proxy may run in Docker. Nothing changed.' >&2
  ss -lntp '( sport = :80 or sport = :443 )' || true
  docker ps --format 'table {{.Names}}\t{{.Ports}}' 2>/dev/null || true
  exit 12
fi

echo "Domain configured: https://${DOMAIN}"
echo 'Checking public HTTPS:'
curl -fsS --max-time 15 -o /dev/null -w 'HTTP %{http_code}\n' "https://${DOMAIN}/api/health" || {
  echo 'Public HTTPS is not verified yet; check DNS, firewall 80/443, and certificate logs.' >&2
}
