import { describe, it, after } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { EnsService } from "../../src/nameservice/EnsService.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;
const servers: http.Server[] = [];

type FakeRpc = { url: string; calls: () => number };

// Fake JSON-RPC node. eth_call answers after `delayMs` with 32 bytes of
// `tag`, or with an HTTP error / a JSON-RPC revert when asked to.
const fakeRpc = (
  delayMs: number,
  tag: string,
  fail?: "http500" | "revert",
): Promise<FakeRpc> =>
  new Promise((resolve) => {
    let calls = 0;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const isCall = list.some((r: any) => r.method === "eth_call");
        if (isCall) calls++;
        const answer = (r: any) =>
          r.method === "eth_call" && fail === "revert"
            ? {
                jsonrpc: "2.0",
                id: r.id,
                error: { code: 3, message: "execution reverted", data: "0x" },
              }
            : {
                jsonrpc: "2.0",
                id: r.id,
                result:
                  r.method === "eth_chainId"
                    ? "0x1"
                    : r.method === "eth_blockNumber"
                      ? "0x10"
                      : "0x" + tag.repeat(32),
              };
        setTimeout(
          () => {
            if (isCall && fail === "http500") {
              res.writeHead(500);
              res.end();
              return;
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify(
                Array.isArray(parsed) ? list.map(answer) : answer(parsed),
              ),
            );
          },
          isCall ? delayMs : 0,
        );
      });
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        calls: () => calls,
      }),
    );
  });

// an address nothing listens on
const deadRpc = async () => {
  const server = http.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await new Promise((resolve) => server.close(resolve));
  return url;
};

const ensService = (
  urls: string[],
  opts: { request: number; stall: number; quorum?: number },
) =>
  new EnsService(
    {
      getConfigEthereumBackend: () => ({
        getBackend: () => urls[0],
        getChainId: () => 1,
      }),
      getConfigEthereumFailover: () => ({
        getStallTimeout: () => opts.stall,
        getProviderStallTimeout: () => opts.request,
        getQuorum: () => opts.quorum ?? 1,
        getPrimaryFailoverBackend: () => urls[1] ?? null,
        getSecondaryFailoverBackend: () => urls[2] ?? null,
      }),
    } as any,
    {} as any,
    logger,
  );

// ethers caches identical calls for a short time, pass different data to
// make sure a request is really sent
const call = (ens: EnsService, data = "0x") =>
  ens.provider.call({
    to: "0x0000000000000000000000000000000000000001",
    data,
  });

const callError = async (ens: EnsService) => {
  try {
    await call(ens);
  } catch (e) {
    return e as any;
  }
  return null;
};

const backupResult = "0x" + "bb".repeat(32);

describe("EnsService RPC timeouts and failover", function () {
  after(() => {
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  });

  it("gives up on a request after the configured timeout", async function () {
    const primary = await fakeRpc(1500, "aa");
    const ens = ensService([primary.url], { request: 300, stall: 200 });

    const started = Date.now();
    expect(await callError(ens)).to.not.equal(null);
    expect(Date.now() - started).to.be.lessThan(1200);
  });

  it("uses the failover endpoint when the primary hangs", async function () {
    const primary = await fakeRpc(5000, "aa");
    const backup = await fakeRpc(0, "bb");
    const ens = ensService([primary.url, backup.url], {
      request: 500,
      stall: 200,
    });

    const started = Date.now();
    expect(await call(ens)).to.equal(backupResult);
    expect(Date.now() - started).to.be.lessThan(1500);
  });

  it("doesn't wait for a hanging primary again on the next request", async function () {
    const primary = await fakeRpc(5000, "aa");
    const backup = await fakeRpc(0, "bb");
    const ens = ensService([primary.url, backup.url], {
      request: 500,
      stall: 200,
    });

    expect(await call(ens)).to.equal(backupResult);
    const started = Date.now();
    expect(await call(ens, "0x01")).to.equal(backupResult);
    expect(Date.now() - started).to.be.lessThan(300);
    expect(primary.calls()).to.equal(1);
  });

  it("uses the failover endpoint when the primary returns an HTTP error", async function () {
    const primary = await fakeRpc(0, "aa", "http500");
    const backup = await fakeRpc(0, "bb");
    const ens = ensService([primary.url, backup.url], {
      request: 7000,
      stall: 200,
    });

    expect(await call(ens)).to.equal(backupResult);
  });

  it("uses the failover endpoint when the primary is down", async function () {
    const backup = await fakeRpc(0, "bb");
    const ens = ensService([await deadRpc(), backup.url], {
      request: 7000,
      stall: 200,
    });

    expect(await call(ens)).to.equal(backupResult);
  });

  it("doesn't fail over on a JSON-RPC error, that's a real answer", async function () {
    const primary = await fakeRpc(0, "aa", "revert");
    const backup = await fakeRpc(0, "bb");
    const ens = ensService([primary.url, backup.url], {
      request: 7000,
      stall: 200,
    });

    const error = await callError(ens);
    expect(error?.code).to.equal("CALL_EXCEPTION");
    expect(backup.calls()).to.equal(0);
  });

  it("still compares answers when quorum is 2", async function () {
    const primary = await fakeRpc(0, "aa");
    const backup = await fakeRpc(0, "bb");
    const ens = ensService([primary.url, backup.url], {
      request: 7000,
      stall: 200,
      quorum: 2,
    });

    const error = await callError(ens);
    expect(error?.shortMessage ?? error?.message).to.contain("quorum not met");
  });
});
