# syntax=docker/dockerfile:1

# Builder
FROM docker.io/library/node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build

WORKDIR /build

COPY . .

RUN apt-get update && \
    apt-get install -y \
        --no-install-recommends \ 
            python3 \
            build-essential \
            ca-certificates && \
    useradd -u 10005 dwebapi && \
    tail -n 1 /etc/passwd >/etc/passwd.scratch && \
    npm install -g npm@10

RUN ./bin/build.sh

FROM gcr.io/distroless/nodejs24-debian13@sha256:2e3b3a96d1d7286c3e4727f9c84b4dc32b6b33e7d7d4425c5a5c8186ad85fa93 AS runtime

LABEL org.opencontainers.image.source="https://github.com/ethlimo/dweb-proxy-api"

WORKDIR /app

# Copy node_modules until working fix with npm run build.
COPY --from=build --chown=10005:10005 /build/node_modules ./node_modules
COPY --from=build --chown=10005:10005 /build/package.json .
COPY --from=build --chown=10005:10005 /build/packages ./packages
COPY --from=build /etc/ssl /etc/ssl
COPY --from=build /etc/passwd.scratch /etc/passwd

USER dwebapi

EXPOSE 8080 9090 11000 12500

# Node options to use openssl CA certificates
ENV NODE_OPTIONS="--import=extensionless/register --use-openssl-ca"

CMD ["packages/dweb-api-server/dist/index.js"]

