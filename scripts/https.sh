#!/usr/bin/env bash
# Put the game behind HTTPS on your domain (free Let's Encrypt certificate, renews itself).
#   scripts/https.sh nexus.example.com [you@example.com]
# Run it once the domain's A record points at the server (terraform output public_ip).
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="${1:?usage: scripts/https.sh your.domain [email]}"
EMAIL="${2:-}"
HOST="${HOST:-$(terraform -chdir=terraform output -raw public_ip)}"

# ask public resolvers directly (the local cache may still hold an old "no such domain")
RESOLVED="$(command -v dig >/dev/null && dig +short +time=4 "$DOMAIN" A @1.1.1.1 | tail -1)"
[ -n "$RESOLVED" ] || RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
if [ "$RESOLVED" != "$HOST" ]; then
  echo "✗ $DOMAIN points to '${RESOLVED:-nothing}', not $HOST yet."
  echo "  Add an A record: $DOMAIN → $HOST (no proxy/CDN), wait a few minutes, run this again."
  exit 1
fi

# a changed home IP is locked out of SSH: open the firewall for the current one
if [ -z "${HOST_OVERRIDE:-}" ] && ! ssh -o ConnectTimeout=6 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "ubuntu@$HOST" true 2>/dev/null; then scripts/ssh-allow.sh; fi
REG="--register-unsafely-without-email"; [ -n "$EMAIL" ] && REG="-m $EMAIL"
ssh -o StrictHostKeyChecking=accept-new "ubuntu@$HOST" "set -e
  sudo apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  sudo sed -i 's/^\(\s*\)listen \[::\]:80 default_server;/&\n\1server_name $DOMAIN;/' /etc/nginx/sites-available/nexus
  sudo sed -i '/server_name/{n;/server_name/d}' /etc/nginx/sites-available/nexus
  sudo nginx -t -q && sudo systemctl reload nginx
  sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos $REG --redirect
  sudo systemctl reload nginx"

mkdir -p "$HOME/.config/nexus-breach" && echo "$DOMAIN" > "$HOME/.config/nexus-breach/domain"   # deploy.sh checks this address
curl -fsS "https://$DOMAIN/health" >/dev/null && echo "✓ https://$DOMAIN is live" || { echo "✗ https://$DOMAIN/health not answering"; exit 1; }
cat <<EOF

  players   https://$DOMAIN/
  projector https://$DOMAIN/screen?join=https://$DOMAIN/
  admin     https://$DOMAIN/admin
EOF
