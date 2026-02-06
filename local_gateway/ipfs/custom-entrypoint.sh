#!/bin/sh
set -e

CADDY_CA="/shared-ca/root.crt"
COMBINED_CA="/etc/ssl/custom/certs/ca-certificates-combined.crt"
SYSTEM_CA="/etc/ssl/certs/ca-certificates.crt"

echo "Waiting for Caddy CA to be exported..."
while [ ! -f "${CADDY_CA}" ]; do
    sleep 2
done

# Combine system CAs with Caddy's local CA
mkdir -p "$(dirname "${COMBINED_CA}")"
cat "${SYSTEM_CA}" "${CADDY_CA}" > "${COMBINED_CA}"
chmod 644 "${COMBINED_CA}"

echo "Created combined CA bundle at ${COMBINED_CA}"

exec /usr/local/bin/entrypoint.sh "${@}"