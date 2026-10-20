#!/usr/bin/env bash
set -u
DOMAIN="test.usersmanager.ir"
UPSTREAM="http://127.0.0.1:8097"
CADDY="darma-general-caddy-1"

printf '\n=== DNS IPv4 / IPv6 ===\n'
getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u || true
getent ahostsv6 "$DOMAIN" | awk '{print $1}' | sort -u || true

printf '\n=== CONTAINER STATUS ===\n'
docker inspect -f 'state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' vpn-diagnostics 2>&1 || true
docker ps --format 'table {{.Names}}\t{{.Ports}}' --filter name=vpn-diagnostics

check() {
  name="$1"
  url="$2"
  printf '\n%s: %s\n' "$name" "$url"
  curl -4 -L -sS --connect-timeout 6 --max-time 18 -o /dev/null \
    -w 'http=%{http_code} peer=%{remote_ip} type=%{content_type} bytes=%{size_download} tls_verify=%{ssl_verify_result} time=%{time_total}s\n' "$url" 2>&1 || true
}
check 'LOCAL HOME' "$UPSTREAM/"
check 'LOCAL JAVASCRIPT' "$UPSTREAM/app.js"
check 'LOCAL CSS' "$UPSTREAM/style.css"
check 'PUBLIC HOME' "https://$DOMAIN/"
check 'PUBLIC JAVASCRIPT' "https://$DOMAIN/app.js"
check 'PUBLIC CSS' "https://$DOMAIN/style.css"
check 'PUBLIC API' "https://$DOMAIN/api/health"

printf '\n=== BYPASS PUBLIC DNS (local Caddy / valid TLS) ===\n'
curl --resolve "$DOMAIN:443:127.0.0.1" -sS -L --connect-timeout 6 --max-time 15 \
  -o /dev/null -w 'http=%{http_code} type=%{content_type} bytes=%{size_download} tls_verify=%{ssl_verify_result}\n' \
  "https://$DOMAIN/" 2>&1 || true

printf '\n=== CADDY DOMAIN ROUTE ===\n'
grep -n -A 5 -B 2 -F "$DOMAIN" /opt/darma-general/Caddyfile 2>/dev/null || true

printf '\n=== NETSCOPE LOGS ===\n'
docker logs --tail=35 vpn-diagnostics 2>&1 || true

printf '\n=== CADDY RECENT DOMAIN LOGS ===\n'
docker logs --since=10m "$CADDY" 2>&1 | grep -E 'test\.usersmanager\.ir|certificate|challenge|error' | tail -30 || true

echo
echo 'Diagnostic finished. No settings changed.'
