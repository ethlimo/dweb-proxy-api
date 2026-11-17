import { describe, it } from "mocha";
import { expect } from "chai";
import { ensNormalize, namehash } from "ethers";
import { PassthroughCacheService } from "dweb-api-cache/passthrough";
import {
  DomainQueryService,
  TestDomainQuerySuperagentService,
} from "./index.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;
const request = { trace_id: "TEST_TRACE_ID" };

const config = {
  getDomainQueryConfig: () => ({
    getDomainsApiEndpoint: () => "http://domains.invalid",
    getMaxHops: () => 5,
    getTimeoutMs: () => 5000,
  }),
} as any;

const BLOCKED = "my-site.eth";

const createService = () => {
  const domainsApi = new TestDomainQuerySuperagentService();
  domainsApi.setBlacklist(BLOCKED, true);
  return new DomainQueryService(
    logger,
    domainsApi,
    new PassthroughCacheService(),
    config,
  );
};

describe("DomainQueryService.checkBlacklist", () => {
  it("only looks a plain lowercase name up once per suffix", async () => {
    const domainsApi = new TestDomainQuerySuperagentService();
    const asked: string[] = [];
    const query = domainsApi.query;
    domainsApi.query = async (domain: string) => {
      asked.push(domain);
      return query(domain);
    };
    const service = new DomainQueryService(
      logger,
      domainsApi,
      new PassthroughCacheService(),
      config,
    );

    await service.checkBlacklist(request, "app.some-site.eth");

    expect(asked).to.deep.equal(["app.some-site.eth", "some-site.eth", "eth"]);
  });

  it("leaves plain lowercase names alone, like ENS does", () => {
    // checkBlacklist skips normalization for these, so make sure ENS really
    // never rewrites them
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-.";
    // fixed seed, so a failure can be reproduced
    let seed = 12345;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let i = 0; i < 2000; i++) {
      let name = "";
      const length = 1 + next(24);
      for (let j = 0; j < length; j++) {
        name += alphabet[next(alphabet.length)];
      }
      let normalized = name;
      try {
        normalized = ensNormalize(name);
      } catch {
        // rejected by ENS, e.g. an empty label
      }
      expect(normalized).to.equal(name);
    }
  });

  it("blocks a listed name", async () => {
    expect(await createService().checkBlacklist(request, BLOCKED)).to.equal(
      true,
    );
  });

  it("blocks subdomains of a listed name", async () => {
    expect(
      await createService().checkBlacklist(request, `app.${BLOCKED}`),
    ).to.equal(true);
  });

  // ENS maps the name on the left to the one on the right before hashing,
  // so the resolver returns the blocked record for each of them.
  const sameAfterNormalization = [
    ["capital letters", "My-Site.eth", BLOCKED],
    ["a unicode hyphen", "my\u2010site.eth", BLOCKED],
    ["an en dash", "my\u2013site.eth", BLOCKED],
    ["capital letters under a subdomain", "app.MY-SITE.eth", `app.${BLOCKED}`],
    // the form a DoH question for a DNSLink record arrives in
    ["a _dnslink prefix", "_dnslink.My-Site.eth", `_dnslink.${BLOCKED}`],
  ];

  for (const [label, name, normalized] of sameAfterNormalization) {
    it(`blocks a listed name written with ${label}`, async () => {
      expect(namehash(name)).to.equal(namehash(normalized));
      expect(await createService().checkBlacklist(request, name)).to.equal(
        true,
      );
    });
  }

  it("doesn't block other names", async () => {
    const service = createService();
    expect(await service.checkBlacklist(request, "mysite.eth")).to.equal(false);
    expect(await service.checkBlacklist(request, "my-site.gno")).to.equal(
      false,
    );
  });

  it("still checks names that ENS can't normalize", async () => {
    const service = createService();
    // not valid ENS names, they must not make the check throw
    expect(await service.checkBlacklist(request, "bad name!.eth")).to.equal(
      false,
    );
    expect(
      await service.checkBlacklist(request, `bad name!.${BLOCKED}`),
    ).to.equal(true);
  });
});
