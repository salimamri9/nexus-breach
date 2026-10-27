#!/usr/bin/env bash
# Let this PC's current public IP through the server's SSH firewall (home IPs change).
set -euo pipefail
cd "$(dirname "$0")/.."
MYIP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
terraform -chdir=terraform apply -input=false -auto-approve -var "ssh_cidr=$MYIP/32" -target=aws_security_group.nexus >/dev/null
echo "SSH allowed from $MYIP"
