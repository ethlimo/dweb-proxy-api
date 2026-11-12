import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { FetchRequest, JsonRpcProvider } from "ethers";
import {
  createCcipGetUrl,
  isAllowedCcipUrl,
  isPublicAddress,
  publicOnlyLookup,
  restrictCcipRead,
} from "../../src/nameservice/ccip.js";
import { EnsService } from "../../src/nameservice/EnsService.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;

// local test servers are on 127.0.0.1 over http, so allow that explicitly
const testOptions = (timeoutMs = 500, maxResponseBytes = 1024) => ({
  timeoutMs,
  maxResponseBytes,
  isAllowedAddress: () => true,
  allowHttp: true,
});

const gateway = (handler: http.RequestListener) =>
  new Promise<{ url: string; close: () => void }>((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      }),
    );
  });

// sends a byte every 100ms and never finishes
const dripGateway = () =>
  gateway((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    const timer = setInterval(() => res.write(" "), 100);
    res.on("close", () => clearInterval(timer));
  });

const fetchWith = async (url: string, options: any) => {
  const request = new FetchRequest(url);
  request.getUrlFunc = createCcipGetUrl(options);
  request.timeout = options.timeoutMs;
  request.allowGzip = false;
  try {
    return { response: await request.send(), error: null as any };
  } catch (error) {
    return { response: null, error: error as any };
  }
};

describe("CCIP-read gateway requests", () => {
  it("checks the address the socket connects to (DNS rebinding)", async () => {
    const lookupResult = (address: string, family = 4) =>
      new Promise<{ err: any; address: any }>((resolve) => {
        const lookup = publicOnlyLookup((_host, cb) =>
          cb(null, [{ address, family }]),
        );
        lookup("gateway.example", {}, (err, addr) =>
          resolve({ err, address: addr }),
        );
      });

    expect((await lookupResult("127.0.0.1")).err).to.be.instanceOf(Error);
    expect((await lookupResult("169.254.169.254")).err).to.be.instanceOf(Error);
    expect((await lookupResult("fd00::1", 6)).err).to.be.instanceOf(Error);
    const ok = await lookupResult("1.1.1.1");
    expect(ok.err).to.equal(null);
    expect(ok.address).to.equal("1.1.1.1");
  });

  it("refuses private ip literals and plain http with the default options", async () => {
    const getUrl = createCcipGetUrl({ timeoutMs: 500, maxResponseBytes: 1024 });
    for (const url of [
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "http://1.1.1.1/x",
    ]) {
      let caught: any = null;
      try {
        await getUrl(new FetchRequest(url));
      } catch (e) {
        caught = e;
      }
      expect(caught, url).to.not.equal(null);
    }
  });

  it("uses the checked lookup for the actual connection", async () => {
    // the name resolves to loopback when the socket connects
    const getUrl = createCcipGetUrl({
      timeoutMs: 1000,
      maxResponseBytes: 1024,
      lookupAll: (_host, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]),
    });
    let caught: any = null;
    try {
      await getUrl(new FetchRequest("https://gateway.test/x"));
    } catch (e) {
      caught = e;
    }
    expect(String(caught?.message)).to.contain("not public");
  });

  it("stops a gateway that keeps the response open", async () => {
    const drip = await dripGateway();
    try {
      const started = Date.now();
      const { error } = await fetchWith(drip.url, testOptions(500));
      expect(error?.code).to.equal("TIMEOUT");
      expect(Date.now() - started).to.be.lessThan(1500);
    } finally {
      drip.close();
    }
  });

  it("stops reading a response that is too large", async () => {
    const big = await gateway((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: "0x" + "00".repeat(4096) }));
    });
    try {
      const { error } = await fetchWith(big.url, testOptions(2000, 1024));
      expect(error?.code).to.equal("BUFFER_OVERRUN");
    } finally {
      big.close();
    }
  });

  it("moves on to the next gateway when one times out", async () => {
    const drip = await dripGateway();
    const good = await gateway((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"data":"0x1234"}');
    });
    try {
      const provider = new JsonRpcProvider("http://127.0.0.1:1", 1, {
        staticNetwork: true,
      });
      restrictCcipRead(provider, logger, testOptions(300));
      const started = Date.now();
      const result = await (provider.ccipReadFetch as any)(
        { to: "0x0000000000000000000000000000000000000001" },
        "0xabcd",
        [`${drip.url}/{sender}/{data}`, `${good.url}/{sender}/{data}`],
      );
      expect(result).to.equal("0x1234");
      expect(Date.now() - started).to.be.lessThan(1500);
    } finally {
      drip.close();
      good.close();
    }
  });
});

describe("CCIP-read url restrictions", () => {
  it("treats private, loopback and link-local addresses as non public", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:7f00:1",
    ]) {
      expect(isPublicAddress(ip), ip).to.equal(false);
    }
    expect(isPublicAddress("1.1.1.1")).to.equal(true);
    expect(isPublicAddress("2606:4700:4700::1111")).to.equal(true);
  });

  it("only allows https urls pointing at public addresses", async () => {
    expect(await isAllowedCcipUrl("https://1.1.1.1/{sender}/{data}")).to.equal(
      true,
    );
    for (const url of [
      "http://1.1.1.1/{sender}/{data}",
      "https://127.0.0.1/{sender}/{data}",
      "https://[::1]/x",
      "https://localhost/x",
      "https://169.254.169.254/x",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(await isAllowedCcipUrl(url), url).to.equal(false);
    }
  });
});

describe("EnsService CCIP-read", () => {
  let server: http.Server;
  let port: number;
  let hits = 0;

  before((done) => {
    server = http.createServer((_req, res) => {
      hits++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"data":"0x"}');
    });
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      done();
    });
  });

  after(() => {
    server.close();
  });

  it("does not send gateway requests to a local address", async () => {
    const config: any = {
      getConfigEthereumBackend: () => ({
        getBackend: () => "http://127.0.0.1:1",
        getChainId: () => 1,
      }),
    };
    const ens = new EnsService(config, {} as any, logger);
    const tx = { to: "0x0000000000000000000000000000000000000001" };

    hits = 0;
    const get = await ens.provider.ccipReadFetch(tx as any, "0x1234", [
      `http://127.0.0.1:${port}/{sender}/{data}.json`,
    ]);
    const post = await ens.provider.ccipReadFetch(tx as any, "0x1234", [
      `http://127.0.0.1:${port}/gateway`,
    ]);

    expect(hits).to.equal(0);
    expect(get).to.equal(null);
    expect(post).to.equal(null);
  });
});
