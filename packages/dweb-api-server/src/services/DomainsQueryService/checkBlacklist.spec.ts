import { describe, it } from "mocha";
import { expect } from "chai";
import { namehash } from "ethers";
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
    ["a unicode hyphen", "my‐site.eth", BLOCKED],
    ["an en dash", "my–site.eth", BLOCKED],
    ["capital letters under a subdomain", "app.MY-SITE.eth", `app.${BLOCKED}`],
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
