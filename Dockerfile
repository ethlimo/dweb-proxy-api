# Builder
FROM node:20-bullseye-slim as build

WORKDIR /build

COPY . .

WORKDIR /build

RUN apt-get update && \
    apt-get install -y \
        --no-install-recommends \ 
          python3 \
    build-essential \
    ca-certificates && \
    useradd -u 10005 dwebapi && \
    tail -n 1 /etc/passwd >/etc/passwd.scratch && \
    npm install && \
    npm run build

FROM gcr.io/distroless/nodejs20-debian12 as runtime

LABEL org.opencontainers.image.source https://github.com/ethlimo/dweb-proxy-api

WORKDIR /app

# Copy node_modules until working fix with npm run build.
COPY --from=build --chown=10005:10005 /build/node_modules ./node_modules
COPY --from=build --chown=10005:10005 /build/package.json .
COPY --from=build --chown=10005:10005 /build/tsconfig.json .
COPY --from=build --chown=10005:10005 /build/dist ./dist
COPY --from=build /etc/ssl /etc/ssl
COPY --from=build /etc/passwd.scratch /etc/passwd

USER dwebapi

# Node options to use openssl CA certificates
ENV NODE_OPTIONS="--import=extensionless/register --use-openssl-ca"

CMD ["dist/index.js"]