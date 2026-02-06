#!/usr/bin/env bash
set -e

CERT_PATH="./data/caddy/pki/authorities/local/root.crt"

case "$(uname -s)" in
    Linux*)
        printf "Detected Linux - using trust anchor\n\n"
        sudo trust anchor "${CERT_PATH}"
        ;;
    Darwin*)
        printf "Detected macOS - using security add-trusted-cert\n\n"
        sudo security add-trusted-cert -d -r trustRoot \
            -k /Library/Keychains/System.keychain "${CERT_PATH}"
        ;;
    *)
        printf "$(uname -s) Unsupported OS: %s\n\n" >&2
        exit 1
        ;;
esac

printf "CA certificate imported successfully\n\n"