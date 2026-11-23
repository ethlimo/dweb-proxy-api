import { describe, it, after } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Interface } from "ethers";
import { EnsService } from "../../src/nameservice/EnsService.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;
const request = { trace_id: "test" };
const servers: http.Server[] = [];

const universalResolver = new Interface(["error ResolverNotFound(bytes name)"]);

type Answer = "http503" | "jsonRpcError" | "resolverNotFound";

// Fake node that answers every eth_call the same way
const fakeRpc = (answer: Answer): Promise<string> =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        if (answer === "http503" && list.some((r) => r.method === "eth_call")) {
          res.writeHead(503);
          res.end();
          return;
        }
        const reply = (r: any) => {
          if (r.method !== "eth_call") {
            return { jsonrpc: "2.0", id: r.id, result: "0x1" };
          }
          if (answer === "jsonRpcError") {
            // what a node sends when it's rate limiting, no revert data
            return {
              jsonrpc: "2.0",
              id: r.id,
              error: { code: -32005, message: "limit exceeded" },
            };
          }
          return {
            jsonrpc: "2.0",
            id: r.id,
            error: {
              code: 3,
              message: "execution reverted",
              data: universalResolver.encodeErrorResult("ResolverNotFound", [
                "0x",
              ]),
            },
          };
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            Array.isArray(parsed) ? list.map(reply) : reply(parsed),
          ),
        );
      });
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    );
  });

const ensService = (url: string) =>
  new EnsService(
    {
      getConfigEthereumBackend: () => ({
        getBackend: () => url,
        getChainId: () => 1,
      }),
      getConfigEthereumFailover: () => ({
        getStallTimeout: () => 200,
        getProviderStallTimeout: () => 2000,
        getQuorum: () => 1,
        getPrimaryFailoverBackend: () => null,
        getSecondaryFailoverBackend: () => null,
      }),
    } as any,
    {} as any,
    logger,
  );

const contentHashError = async (ens: EnsService) => {
  try {
    await ens.getContentHash(request, "vitalik.eth");
  } catch (e) {
    return e;
  }
  return null;
};

describe("EnsService resolver lookup", function () {
  after(() => {
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  });

  it("returns null when the Universal Resolver finds no resolver", async function () {
    const ens = ensService(await fakeRpc("resolverNotFound"));

    expect(await ens.getContentHash(request, "vitalik.eth")).to.equal(null);
  });

  it("throws when the RPC returns an HTTP error", async function () {
    const ens = ensService(await fakeRpc("http503"));

    expect(await contentHashError(ens)).to.not.equal(null);
  });

  it("throws on a JSON-RPC error without revert data", async function () {
    const ens = ensService(await fakeRpc("jsonRpcError"));

    expect(await contentHashError(ens)).to.not.equal(null);
  });
});
