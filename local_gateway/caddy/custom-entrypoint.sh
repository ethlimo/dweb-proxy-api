#!/bin/sh
set -e

CA_SOURCE="/data/caddy/pki/authorities/local/root.crt"
CA_DEST="/shared-ca/root.crt"

(
	while [ ! -f "${CA_SOURCE}" ]; do
		sleep 2
	done

	chmod -R 755 /data/caddy

	cp "${CA_SOURCE}" "${CA_DEST}"
	chmod 644 "${CA_DEST}"
	echo "Exported CA cert to ${CA_DEST}"
) &

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
