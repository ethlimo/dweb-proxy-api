# syntax=docker/dockerfile:1

# Builder
FROM docker.io/library/node:24-bookworm-slim@sha256:03eae3ef7e88a9de535496fb488d67e02b9d96a063a8967bae657744ecd513f2 AS build

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

FROM gcr.io/distroless/nodejs24-debian13@sha256:482fabdb0f0353417ab878532bb3bf45df925e3741c285a68038fb138b714cba AS runtime

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