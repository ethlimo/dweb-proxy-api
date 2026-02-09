#!/usr/bin/env bash
set -e

CERT_PATH="./data/caddy/pki/authorities/local/root.crt"

if command -v docker &>/dev/null && docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v podman &>/dev/null && podman compose version &>/dev/null; then
    COMPOSE_CMD="podman compose"
elif command -v podman-compose &>/dev/null; then
    COMPOSE_CMD="podman-compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
else
    printf "Error: No compose command found. Install docker compose or podman-compose.\n" >&2
    exit 1
fi

printf "Starting local dWeb gateway (using %s)...\n\n" "${COMPOSE_CMD}"
${COMPOSE_CMD} up -d

printf "Waiting for CA certificate to be generated...\n"
timeout=30
while [ ! -f "${CERT_PATH}" ] && [ ${timeout} -gt 0 ]; do
    sleep 1
    ((timeout--))
done

if [ ! -f "${CERT_PATH}" ]; then
    printf "Timeout waiting for CA certificate\n" >&2
    exit 1
fi

printf "Importing local CA certificate...\n"
./certificates/trust_ca.sh

printf "Setup complete!\n\n"
printf "Local dWeb gateway is now running at https://localhost\n"
printf "\nTo stop the local dWeb gateway, run:\n %s down\n\n" "${COMPOSE_CMD}"