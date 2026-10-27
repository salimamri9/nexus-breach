#!/usr/bin/env bash
# Delete the server, its address and firewall (stops all AWS charges for the game). The match is lost.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -p "Delete the Nexus Breach server on AWS? Type 'delete': " ok
[ "$ok" = delete ] || { echo "cancelled"; exit 1; }
terraform -chdir=terraform destroy -auto-approve -var "ssh_cidr=0.0.0.0/32"
