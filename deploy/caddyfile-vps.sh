#!/usr/bin/env bash
# Writes the server's Caddyfile to stdout: `caddyfile-vps.sh Caddyfile > Caddyfile.vps`, run by
# .github/workflows/deploy.yml. It is the shipped one, with two changes. It trusts the visitor
# address only from the tunnel's fixed address (deploy/compose.vps.yaml; docs/deployment.md, "TLS",
# case b). It lets Cloudflare's visitor location headers (CF-IPCountry, CF-Region, CF-IPCity) go to
# both upstreams. deploy/compose.vps.yaml publishes no ingress port, so the tunnel is the intended
# only way in. The backend ignores these headers unless SERMO_TRUST_LOCATION_HEADERS=true
# (docs/deployment.md, "Sign-in location and log retention").
set -euo pipefail

location='header_up -CF-\(IPCountry\|Region\|IPCity\)'
vps=$(sed "/^\tauto_https off\$/a\\
\tservers {\\
\t\ttrusted_proxies static 172.30.40.10/32\\
\t\tclient_ip_headers Cf-Connecting-IP\\
\t}
/^\t\t\t${location}\$/d" "$1")
if ! grep -q 'client_ip_headers Cf-Connecting-IP' <<< "$vps"; then
  echo "caddyfile-vps.sh: no line \"auto_https off\" in $1 to add the servers block after" >&2
  exit 1
fi
if grep -q "$location" <<< "$vps"; then
  echo "caddyfile-vps.sh: a location header line in $1 is not in the expected form" >&2
  exit 1
fi
printf '%s\n' "$vps"
