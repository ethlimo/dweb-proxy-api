import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  isAllowedCcipUrl,
  isPublicAddress,
} from "../../src/nameservice/ccip.js";
import { EnsService } from "../../src/nameservice/EnsService.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;

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
