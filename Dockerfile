# Builder
FROM docker.io/library/node:22-bullseye-slim@sha256:8efd3ed25d83b4328df873ed9853a5bd97ffce8eb3498785e45c3e7297571f0e as build

WORKDIR /build

COPY . .

RUN apt-get update && \
    apt-get install -y \
        --no-install-recommends \ 
            python3 \
            build-essential \
            ca-certificates && \
    useradd -u 10005 dwebapi && \
    tail -n 1 /etc/passwd >/etc/passwd.scratch

ENV SAFE_CHAIN_MINIMUM_PACKAGE_AGE_HOURS=48

RUN ./bin/build.sh

FROM gcr.io/distroless/nodejs22-debian12@sha256:3732180ba4a39101bd95b7105ef0c47526c197d6c29c6d48f7059a647a4064a5 as runtime

LABEL org.opencontainers.image.source https://github.com/ethlimo/dweb-proxy-api

WORKDIR /app

# Copy node_modules until working fix with npm run build.
COPY --from=build --chown=10005:10005 /build/node_modules ./node_modules
COPY --from=build --chown=10005:10005 /build/package.json .
COPY --from=build --chown=10005:10005 /build/packages ./packages
COPY --from=build /etc/ssl /etc/ssl
COPY --from=build /etc/passwd.scratch /etc/passwd

USER dwebapi

EXPOSE 8080 9090 11000

# Node options to use openssl CA certificates
ENV NODE_OPTIONS="--import=extensionless/register --use-openssl-ca"

CMD ["packages/dweb-api-server/dist/index.js"]
