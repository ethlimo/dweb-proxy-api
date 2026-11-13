import { describe, it } from "mocha";
import { expect } from "chai";
import { parseRecord } from "../../src/resolver/index.js";
import { recordToProxyRecord } from "../../src/resolver/utils.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;
const request = { trace_id: "TEST_TRACE_ID" };

const config = (subdomainSupport: boolean) =>
  ({
    getConfigEnsSocialsEndpoint: () => ({}),
    getConfigIpfsBackend: () => ({
      getBackend: () => "http://gateway.example:8080",
      getSubdomainSupport: () => subdomainSupport,
    }),
    getConfigArweaveBackend: () => ({
      getBackend: () => "https://arweave.net",
    }),
    getConfigSwarmBackend: () => ({
      getBackend: () => "https://swarm.example",
    }),
    getConfigTonBackend: () => ({ getBackend: () => "http://adnl:8080" }),
  }) as any;

describe("ipns dnslink values", () => {
  it("accepts a normal dnslink domain", async () => {
    const record = await parseRecord(
      request,
      logger,
      "ipns://en.wikipedia-on-ipfs.org",
      "wiki.eth",
    );
    expect(record).to.deep.include({
      codec: "ipns-ns",
      DoHContentIdentifier: "en.wikipedia-on-ipfs.org",
    });
  });

  for (const value of [
    "localhost:5001/",
    "internal-host/",
    "user@example.org",
    "example.org/../x",
    "example.org?x=1",
    "example.org#x",
    "exa mple.org",
  ]) {
    it(`rejects ${JSON.stringify(value)}`, async () => {
      const record = await parseRecord(
        request,
        logger,
        "ipns://" + value,
        "test.eth",
      );
      expect(record).to.equal(null);
    });
  }
});

describe("recordToProxyRecord ipfs subdomain host", () => {
  it("keeps the gateway host for a normal dnslink", async () => {
    const ret: any = await recordToProxyRecord(request, config(true), logger, {
      _tag: "Record",
      codec: "ipns-ns",
      DoHContentIdentifier: "en.wikipedia-on-ipfs.org",
      ensName: "wiki.eth",
    });
    expect(new URL(ret.XContentLocation).host).to.equal(
      "en-wikipedia--on--ipfs-org.ipns.gateway.example:8080",
    );
  });

  it("throws instead of pointing at another host", async () => {
    let caught: unknown = null;
    try {
      await recordToProxyRecord(request, config(true), logger, {
        _tag: "Record",
        codec: "ipns-ns",
        DoHContentIdentifier: "localhost:5001/",
        ensName: "test.eth",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(Error);
  });
});
