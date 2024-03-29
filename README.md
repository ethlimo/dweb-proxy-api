# eth.limo dWeb Proxy API

NOTE - This documentation is a WIP.

Backend service API for use with reverse proxies to deploy an HTTP ENS gateway capable of resolving IPFS, IPNS, Arweave, Arweave Naming Service (ARNS), and Swarm content.

Upstream proxies can forward ENS hostnames for resolution and properly route them to the appropriate storage gateway path and destination via the following response headers:

IPFS example:
```
X-Content-Location: ${cid}.ipfs.dweb.link
X-Content-Path: /
X-Content-Storage-Type: ipfs-ns
```

### Configuration

| Environment Variable        | Default           | Purpose  |
| ------------- |:-------------:| -----:|
| `LISTEN_PORT`     | `8888` | Proxy API listener port. |
| `IPFS_SUBDOMAIN_SUPPORT`     | `"false"` | Return IPFS gateway destination in subdomain format, i.e. `${cid}.ipfs.dweb.link`. Otherwise results are returned as `ipfs.dweb.link/ipfs/${cid}`. |
| `IPFS_AUTH_KEY`     | `null` | Basic authentication for IPFS gateway backend, if required. |
| `ARWEAVE_TARGET`     | `"https://arweave.net"` | Arweave gateway FQDN. |
| `SWARM_TARGET`     | `"https://api.gateway.ethswarm.org"` | Swarm gateway FQDN. |
| `IPFS_TARGET` | `http://127.0.0.1:8080` | FQDN of IPFS gateway backend to use for requests. |
| `REDIS_URL`     | `"redis://127.0.0.1:6379"` | Redis server endpoint. |
| `CACHE_TTL`     | `"300"`      |   TTL to persist resolved records |
| `ASK_ENABLED` | `"false"`      |    Whether to spawn a special listener for responding to 
| `ASK_LISTEN_PORT` | `"9090"`      |    Ask listener port. |certificate issuance requests from Caddy server: `:9090/ask?domain=${name}.eth`. |
| `ETH_RPC_ENDPOINT` | `"http://192.168.1.7:8845"` | Primary RPC provider FQDN for ENS resolution. |
| `ETH_RPC_ENDPOINT_FAILOVER_PRIMARY` | `null` | Secondary failover RPC provider FQDN. |
| `DOMAINSAPI_ENDPOINT` | `null` | API endpoint for custom domain routing logic. Can be set to any endpoint that returns a `200` if you do not need this feature. |
| `LOG_LEVEL` | `"info"` | Set the logging level. |
| `DOMAIN_TLD` | `.limo` | When operating a gateway, set this to the parent domain or TLD used. |
| `DOMAIN_TLD_HOSTNAME` | `"eth"` | Subdomain to use with gateway (naming service dependent). For example, `ens.eth.limo`. Contingent upon the setting of `DOMAIN_TLD` for gateway operations. |
| `DNSQUERY_ENABLED` | `"true"` | Enable DNS over HTTPS (DoH) listener. |
| `DNSQUERY_LISTEN_PORT` | `"11000"` | Listener port for DoH. |
| `PURGE_CACHE_ON_START` | `"false"` | Indicates whether to purge the entire Redis cache upon server startup. |
| `PURGE_CACHE_COUNT` | `"20000"` | Number of keys to purge if `PURGE_CACHE_ON_START` is enabled. |
| `PURGE_CACHE_PATTERN` | `"*.${DOMAIN_TLD_HOSTNAME}"` | Key pattern to purge if `PURGE_CACHE_ON_START` is enabled. |

### Example

__Set environment variables__

__Start Redis__

```
podman run -p 127.0.0.1:6379:6379 docker.io/library/redis
```

__Start dWeb Proxy API__

```
npm install
npm run dev
```

__Make a request__

```shell
$ curl http://localhost:8888 -H 'Host: ens.eth' -sD - -o /dev/null

HTTP/1.1 200 OK
X-Powered-By: Express
X-Content-Location: k51qzi5uqu5dipklqpo2uq7advlajxx5wxob0mwyqbxb5zu4htblc4bjipy834.ipns.dweb.link
X-Content-Path: /
X-Content-Storage-Type: ipns-ns
Date: Fri, 29 Mar 2024 17:11:14 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked
```