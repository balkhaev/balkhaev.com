#!/usr/bin/env bash
# Sets up SSH to the production server in a GitHub Actions job.
# Needs SSH_PRIVATE_KEY, optional SSH_KNOWN_HOSTS.
set -eu
if [ -z "${SSH_PRIVATE_KEY:-}" ]; then
  echo "::error::Add the DEPLOY_SSH_KEY secret to the production environment"
  exit 1
fi
install -m 700 -d ~/.ssh
printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/id_deploy
chmod 600 ~/.ssh/id_deploy
printf 'Host 49.13.216.63\n  User root\n  IdentityFile ~/.ssh/id_deploy\n  IdentitiesOnly yes\n' > ~/.ssh/config
if [ -n "${SSH_KNOWN_HOSTS:-}" ]; then
  printf '%s\n' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
else
  ssh-keyscan -T 15 49.13.216.63 > ~/.ssh/known_hosts
fi
