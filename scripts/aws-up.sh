#!/usr/bin/env bash
# Create (or update) the AWS server and deploy the game on it. Needs AWS credentials (aws configure).
#   scripts/aws-up.sh                         defaults: eu-west-3 (Paris), t3.small
#   scripts/aws-up.sh -var instance_type=t3.micro -var region=eu-central-1
set -euo pipefail
cd "$(dirname "$0")/.."
MYIP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
terraform -chdir=terraform init -input=false -upgrade >/dev/null
terraform -chdir=terraform apply -input=false -auto-approve -var "ssh_cidr=$MYIP/32" "$@"
scripts/deploy.sh --fresh
