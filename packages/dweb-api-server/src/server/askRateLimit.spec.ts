import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import EventEmitter from "events";
import RedisMock from "ioredis-mock";
import { createRequest, createResponse } from "node-mocks-http";
import { AbstractRedisClient, TestRedisClient } from "dweb-api-cache";
import { Server } from "./index.js";
import { registeredName } from "./askRateLimit.js";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager.js";
import { TestConfigurationService } from "../configuration/index.js";
import { TestResolverService } from "../test/TestResolverService.js";

const env = EnvironmentConfiguration.Development;
const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

// The test redis client answers every incr with the same number, so the
// rate limit needs a client that actually counts.
class CountingRedisClient extends AbstractRedisClient {}

describe("registeredName", function () {
  it("is the second level name under the tld", function () {
    expect(registeredName("attacker.eth")).to.equal("attacker.eth");
    expect(registeredName("www.attacker.eth")).to.equal("attacker.eth");
    expect(registeredName("a.b.c.attacker.eth")).to.equal("attacker.eth");
    expect(registeredName("app.name.gno")).to.equal("name.gno");
  });

  it("is the third level name for basenames", function () {
    expect(registeredName("someone.base.eth")).to.equal("someone.base.eth");
    expect(registeredName("x.y.someone.base.eth")).to.equal("someone.base.eth");
  });
});

describe("/ask rate limit per registered name", function () {
  let server: Server;
  let configuration: TestConfigurationService;

  beforeEach(async function () {
    const services = await createApplicationConfigurationBindingsManager();
    configuration = (await services.configuration.getBinding(
      env,
    )) as TestConfigurationService;
    configuration.set((c) => {
      c.ask.rate.enabled = true;
      c.ask.rate.limit = 10;
      c.ask.rate.period = 900;
      c.ask.rate.name_limit = 20;
    });

    const redis = (await services.redisClient.getBinding(
      env,
    )) as TestRedisClient;
    // ioredis-mock instances share one keyspace, start every test empty
    const store = new RedisMock();
    await store.flushall();
    redis.setProxy(new CountingRedisClient(store, configuration));

    // both names have a wildcard resolver: every name below them resolves
    const ens = (await services.ensService.getBinding(
      env,
    )) as TestResolverService;
    ens.getContentHash = async (_request, name) =>
      /(^|\.)(attacker|other)\.eth$/.test(name)
        ? { _tag: "DecodedCodecString", codec: `ipfs://${CID}` }
        : null;

    server = new Server(
      configuration,
      await services.logger.getBinding(env),
      await services.domainQuery.getBinding(env),
      await services.ensResolver.getBinding(env),
      await services.arweaveResolver.getBinding(env),
      await services.dnsQuery.getBinding(env),
      await services.domainRateLimit.getBinding(env),
      await services.hostnameSubstitution.getBinding(env),
      null,
    );
  });

  const ask = (domain: string) =>
    new Promise<number>((resolve) => {
      const res = createResponse({ eventEmitter: EventEmitter });
      res.on("end", () => resolve(res.statusCode));
      server.caddy(
        createRequest({ method: "GET", url: "/ask", query: { domain } }),
        res,
      );
    });

  const statuses = async (domains: string[]) => {
    const seen: number[] = [];
    for (const domain of domains) {
      seen.push(await ask(domain));
    }
    return seen;
  };

  const subdomains = (count: number, parent: string) =>
    Array.from({ length: count }, (_, i) => `site${i}.${parent}`);

  it("stops new hostnames below one name once the name is over its limit", async function () {
    const results = await statuses(subdomains(25, "attacker.eth"));

    expect(results.slice(0, 20)).to.deep.equal(Array(20).fill(200));
    expect(results.slice(20)).to.deep.equal(Array(5).fill(429));
  });

  it("counts deeper levels against the same name", async function () {
    await statuses(subdomains(20, "attacker.eth"));

    expect(await ask("x.y.z.attacker.eth")).to.equal(429);
  });

  it("doesn't affect other names", async function () {
    await statuses(subdomains(25, "attacker.eth"));

    expect(await ask("www.other.eth")).to.equal(200);
  });

  it("keeps the existing limit per hostname", async function () {
    const results = await statuses(Array(12).fill("www.attacker.eth"));

    expect(results.slice(0, 10)).to.deep.equal(Array(10).fill(200));
    expect(results.slice(10)).to.deep.equal([429, 429]);
  });

  it("can be turned off with a name limit of 0", async function () {
    configuration.set((c) => {
      c.ask.rate.name_limit = 0;
    });

    const results = await statuses(subdomains(25, "attacker.eth"));

    expect(results).to.deep.equal(Array(25).fill(200));
  });
});
