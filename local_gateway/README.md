# Running a Local Gateway - Your dWeb Swiss Army Knife

### Overview

We've heard your feedback loud and clear! Now you can run a **complete** lightweight ENS gateway stack locally on your machine or even provide it as a service to your home or work network(s). This solution allows you to natively resolve ENS domains and dWebsite content without the need for third-party gateways.

This local stack has full feature parity with the public eth.limo service with the added benefits of trustless protocol interaction and complete customization. 

Say goodye to DNS hijacking, censorship, and hacks by running your own private gateway that puts you in full control. Choose your own RPC provider or use a VPN/Tor for additional privacy. Each storage protocol uses its own light client for content verfication, ensuring the integrity of the data you retrieve.

#### Features

| Feature | Description |
| ------- | ------------|
| ✅ ENS resolution | Resolve ENS domains to dWeb content | 
| ✅ IPFS & IPNS | Full IPFS gateway |
| ✅ Swarm | Full Swarm gateway |
| ✅ Arweave & ArNS | Full Arweave gateway |
| ✅ ENS enabled DNS-over-HTTPS (DoH) resolver | Extend ENS resolution to other applications |
| ✅ Origin isolation | Browser isolation enforced for all content |
| ✅ Secure HTTP headers by default | Safely enable all browser features |
| ✅ Per-site configuration | Configure settings on a per-site basis |
| ✅ Private | You control the network configuration. Leverage a VPN or Tor for additional privacy. |
| ✅ Full control | Customize every aspect of the gateway to suit your needs |
| ✅ Decentralized | Interact directly with protocols. No middlemen or third parties  |
| ✅ OS-level integration | Break out of the browser. All of your applications can now natively resolve ENS & dWeb content over HTTP |

### Requirements

**OS compatibility**

| OS | Architecture
| --- | --- |
| Linux | `amd64`, `arm64` |
| macOS | `arm64` |

**Container runtime**

1. `docker` or `podman`:
   - docker: https://docs.docker.com/get-docker/
   - podman: https://podman.io/getting-started/installation
2. `docker-compose` or `podman-compose`:
   - docker-compose: https://docs.docker.com/compose/install/
   - podman-compose: https://github.com/containers/podman-compose

### Installation

```bash
git clone https://github.com/ethlimo/dweb-proxy-api.git
cd dweb-proxy-api/local_gateway
./setup.sh
```

The setup script will deploy the gateway stack via one of the above container runtimes and prompt you to authorize the installation of a locally signed CA certificate. This certificate is necessary in order to provide HTTPS support which is required by all modern browsers for extended functionality and to avoid "unknown issuer" warnings when accessing content.

After running `setup.sh`, Caddy server (HTTP ingress) will automatically create a `./data` bind-mount directory for persistent certificate storage. If this directory is regenerated or removed, you will need to re-run the `setup.sh` script in order to reinstall the CA certificate. 

**Stopping the gateway**

```bash
./stop.sh
# or
docker-compose down
# or
podman-compose down
```

**Starting the gateway (after initial setup)**

```bash
./start.sh
# or
docker-compose up -d
# or
podman-compose up -d
```

**Checking gateway status**

```bash
docker ps
# or
podman ps
```

### Usage

Once the gateway has been started and the CA certificate added to your system's trust store, you can access any ENS domain via `*.eth.localhost`. For example, to resolve `ens.eth` or `app.ens.eth` simply navigate to `https://ens.eth.localhost` or `https://app.ens.eth.localhost` in your browser.

Note - the `.localhost` TLD is a local namespace supported by _most_ operating systems for wildcard DNS resolution. This query never leaves your local machine.

One of the added benefits of running a local gateway is the ability to extend ENS/dWeb resolution to other applications on your system. For instance, the `curl` command (or any other HTTP client) can also fetch content:

```bash
curl https://ens.eth.localhost
```

This is perfect for scrapers or agents that need to resolve ENS/dWeb content without sactificing trust or privacy by using third-party gateways.

### IPFS Features

A full featured IPFS [gateway](https://github.com/ipfs/rainbow) is included with support for both IPFS and IPNS. 

You can fetch IPFS content using either the CID, IPNS record or an ENS domain that resolves to IPFS content:

| Example | Description |
| ------- | ------------|
| `https://{cid}.ipfs.localhost` | CID
| `https://{ipns_record}.ipns.localhost` | IPNS record |
| `https://ens-eth.ipns.localhost` | ENS domain resolving to IPFS (note that ENS domain labels must be flattened, i.e. `ens-eth` instead of `ens.eth`) |

### Arweave Features

An Arweave light client [gateway](https://github.com/vilenarios/wayfinder-router) is included with support for both Arweave txs and ArNS records:

| Example | Description |
| ------- | ------------|
| `https://{tx}.arweave.localhost` | Arweave transaction |
| `https://{sandbox_subdomain}.arweave.localhost/{tx}` | Sandbox format |

### Swarm Features

A Swarm light client [gateway](https://github.com/ethersphere/bee) is included with support for Swarm identifiers and ENS domains that resolve to Swarm content:

| Example | Description |
| ------- | ------------|
| `https://{swarm_cid}.swarm.localhost` | Swarm hash |


### DNS-over-HTTPS

Similar to the official eth.limo DoH resolver, this local implementation allows you to extend native ENS resolution to any application that supports DNS-over-HTTPS. 

Additionally, this DoH endpoint makes for a great "lookup" tool for ENS domains, quickly returning the deocded content hash record.

Example DoH query using `curl`:

```bash
$ curl 'https://dns.eth.localhost/dns-query?name=ens.eth'

{"Status":"0","TC":false,"Question":[{"name":"ens.eth","type":16}],"Answer":[{"name":"ens.eth","data":"dnslink=/ipfs/bafybeifnx3u22ngv4ygpnj32qkwzrpgizw4i7e3swp4v6am5piiih3ude4","type":16,"ttl":300}]}
```

Expanded documentation can be found [here](https://github.com/ethlimo/documentation/blob/master/dns-over-https/doh.md).

### Privacy & Security

While local resolution offers substantial privacy improvements over public options, there are still several key considerations to take into account:

1. **Network configuration**: By default, the gateway stack will establish outbound connections to all protocols via your default network interface. This includes everything from RPC calls, IPFS & Swarm peer connections, CCIP-read resolvers, Arweave trustless gateways, 3rd party content embeddings, CDNs, and much more. This means that your outbound public IP address will be visible to any entity you establish a connection with. In order to mitigate these concerns, it is advisable to ensure that all network traffic is routed through a trusted VPN or Tor.

2. **RPC provider**: ENS/GNS resolution requires reading from the Ethereum and Gnosis blockchains. By default, the local gateway stack uses the following default values for RPC providers:

   - Ethereum (mainnet): `https://ethereum.publicnode.com`
   - Gnosis: `https://rpc.gnosischain.com`

   These values can be changed by specifying the following environment variables either directly in the `docker-compose.yml` manifest or setting them explicitly in your shell prior to starting the gateway stack:

   - `ETH_RPC_ENDPOINT`
   - `GNO_RPC_ENDPOINT`

   For example, to use an RPC service of your choice:

   ```bash
   export ETH_RPC_ENDPOINT="https://<your-rpc-here>"
   export GNO_RPC_ENDPOINT="https://<your-rpc-here>"
   ```

   For maximum privacy we strongly recommend running your own full Ethereum/Gnosis node or using a trusted RPC provider that respects user privacy. 

3. **Malicious content**: 

   As with any type of web content you should exercise extreme caution when visiting any site that you're unfamilar with (even then please be smart). This is especially true for anything that asks you to connect a wallet. Never share your private keys or seed phrases with any site, ever, under any circumstances.

### Customization & Configuration

The HTTP ingress leverages Caddy Server, which offers a simple and powerful configuration format. All Caddy configurations live in `./caddy` and can be modified to suit your needs. Probably the most common modification would be to add custom headers or modify existing ones for a given site. 

For example, to modify or add custom headers for a specific site, edit `./caddy/snippets/headers.Caddyfile`:

```
	# Site-specific headers can be added here if needed
	# Example: enable COOP and COEP for WASM applications

	# COOP and COEP headers
	@WasmHeaders {
		expression {host}.contains("domain.eth")
	}

	header @WasmHeaders {
		Cross-Origin-Embedder-Policy "credentialless"
		Cross-Origin-Opener-Policy "same-origin"
	}
```

Save the file and then restart the gateway stack.