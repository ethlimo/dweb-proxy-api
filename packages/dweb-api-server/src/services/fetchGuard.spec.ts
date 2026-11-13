import { describe, it, after } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  createPublicClient,
  encodeErrorResult,
  http as httpTransport,
  parseAbi,
} from "viem";
import { onlyFetchFrom } from "./fetchGuard.js";

const servers: http.Server[] = [];
const listen = (handler: http.RequestListener) =>
  new Promise<{ url: string; hits: () => number }>((resolve) => {
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits++;
      handler(req, res);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        hits: () => hits,
      }),
    );
  });

const resolverAddress = "0x0000000000000000000000000000000000001234";

// RPC whose eth_call reverts with OffchainLookup pointing at `gatewayUrl`,
// like a resolver contract set up by the name owner would
const offchainLookupRpc = (gatewayUrl: string) =>
  listen((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { id, method } = JSON.parse(body);
      res.writeHead(200, { "content-type": "application/json" });
      if (method === "eth_call") {
        const data = encodeErrorResult({
          abi: parseAbi([
            "error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)",
          ]),
          errorName: "OffchainLookup",
          args: [
            resolverAddress,
            [`${gatewayUrl}/{sender}/{data}.json`],
            "0x",
            "0x12345678",
            "0x",
          ],
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: 3, message: "execution reverted", data },
          }),
        );
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x64" }));
    });
  });

// same client setup as createCustomClient in @web3-name-sdk/core
const sdkLikeClient = (rpcUrl: string) =>
  createPublicClient({
    chain: {
      id: 100,
      name: "",
      nativeCurrency: { decimals: 18, name: "", symbol: "" },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: httpTransport(),
  });

const readContenthash = (rpcUrl: string) =>
  sdkLikeClient(rpcUrl)
    .readContract({
      address: resolverAddress,
      abi: parseAbi(["function contenthash(bytes32) view returns (bytes)"]),
      functionName: "contenthash",
      args: [`0x${"00".repeat(32)}`],
    })
    .catch(() => null);

describe("onlyFetchFrom", function () {
  after(() => {
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  });

  it("viem follows CCIP-read urls from the contract by default", async function () {
    const gateway = await listen((_req, res) => res.end("{}"));
    const rpc = await offchainLookupRpc(gateway.url);

    await readContenthash(rpc.url);

    expect(gateway.hits()).to.equal(1);
  });

  it("blocks requests to anything but the allowed endpoints", async function () {
    const gateway = await listen((_req, res) => res.end("{}"));
    const rpc = await offchainLookupRpc(gateway.url);

    await onlyFetchFrom([rpc.url], () => readContenthash(rpc.url));

    expect(rpc.hits()).to.be.greaterThan(0);
    expect(gateway.hits()).to.equal(0);
  });

  it("doesn't affect fetch outside of the callback", async function () {
    const other = await listen((_req, res) => res.end("ok"));
    const rpc = await listen((_req, res) => res.end("{}"));

    await onlyFetchFrom([rpc.url], async () => {});
    const response = await fetch(other.url);

    expect(await response.text()).to.equal("ok");
  });
});
