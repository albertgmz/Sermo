#!/usr/bin/env bash
# Writes the server's Caddyfile to stdout: `caddyfile-vps.sh Caddyfile > Caddyfile.vps`, run by
# .github/workflows/deploy.yml. It is the shipped one, with two changes. It trusts the visitor
# address only from the tunnel's fixed address (deploy/compose.vps.yaml; docs/deployment.md, "TLS",
# case b). It lets Cloudflare's visitor location headers go to both upstreams: the tunnel is the
# only way in, and the backend reads them only with SERMO_TRUST_LOCATION_HEADERS=true
# (docs/deployment.md, "Sign-in location and log retention").
set -euo pipefail

vps=$(sed '/^\tauto_https off$/a\
\tservers {\
\t\ttrusted_proxies static 172.30.40.10/32\
\t\tclient_ip_headers Cf-Connecting-IP\
\t}
/^\t\t\theader_up -CF-/d' "$1")
grep -q 'client_ip_headers Cf-Connecting-IP' <<< "$vps"
if grep -q 'header_up -CF-' <<< "$vps"; then exit 1; fi
printf '%s\n' "$vps"
