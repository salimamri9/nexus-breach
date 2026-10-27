#!/usr/bin/env bash
# Push the game to the server and (re)start it.
#   scripts/deploy.sh            deploy to the Terraform server (keeps the running match)
#   scripts/deploy.sh --fresh    also wipe the saved match (clean start)
#   HOST=1.2.3.4 scripts/deploy.sh   deploy to any Ubuntu box prepared by terraform/cloud-init.yaml
set -euo pipefail
cd "$(dirname "$0")/.."
FRESH=0; [ "${1:-}" = "--fresh" ] && FRESH=1
HOST="${HOST:-$(terraform -chdir=terraform output -raw public_ip)}"
SSH=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$HOST")

# the admin password lives only on this PC and on the server
PWFILE="$HOME/.config/nexus-breach/admin_password"
if [ ! -s "$PWFILE" ]; then
  mkdir -p "$(dirname "$PWFILE")"
  (umask 077; head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$PWFILE")
fi

# a changed home IP is locked out of SSH: open the firewall for the current one
if [ -z "${HOST_OVERRIDE:-}" ] && ! ssh -o ConnectTimeout=6 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "ubuntu@$HOST" true 2>/dev/null; then scripts/ssh-allow.sh; fi
echo "→ waiting for $HOST to finish its first-boot setup…"
for i in $(seq 1 60); do
  "${SSH[@]}" 'test -f /var/lib/cloud/instance/nexus-ready && command -v node >/dev/null' 2>/dev/null && break
  [ "$i" = 60 ] && { echo "server not ready after 5 min"; exit 1; }
  sleep 5
done

echo "→ uploading the game"
rsync -az --delete -e "ssh -o StrictHostKeyChecking=accept-new" \
  --exclude node_modules --exclude data --exclude terraform --exclude art-src --exclude .git --exclude '*.log' \
  ./ "ubuntu@$HOST:/opt/nexus/"

echo "→ installing and restarting"
"${SSH[@]}" "set -e
  printf 'ADMIN_PASSWORD=%s\n' '$(cat "$PWFILE")' | sudo tee /etc/nexus.env >/dev/null
  cd /opt/nexus && npm ci --omit=dev --no-audit --no-fund --loglevel=error
  if [ $FRESH = 1 ]; then
    sudo systemctl stop nexus             # it saves the match on shutdown: stop first, then delete
    rm -f /var/lib/nexus/state.json
    sudo systemctl start nexus
  else
    sudo systemctl restart nexus
  fi"

# with a domain set up (scripts/https.sh), everything goes through https://domain
DOMAIN="$(cat "$HOME/.config/nexus-breach/domain" 2>/dev/null || true)"
BASE="${DOMAIN:+https://$DOMAIN}"; BASE="${BASE:-http://$HOST}"
for i in $(seq 1 20); do curl -fsS "$BASE/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$BASE/health" >/dev/null && echo "✓ live" || { echo "✗ $BASE/health not answering: ssh ubuntu@$HOST 'journalctl -u nexus -n 50'"; exit 1; }
cat <<EOF

  players   $BASE/
  projector $BASE/screen?join=$BASE/
  admin     $BASE/admin      password: $(cat "$PWFILE")   (saved in $PWFILE)
  logs      ssh ubuntu@$HOST 'journalctl -u nexus -f'
EOF
