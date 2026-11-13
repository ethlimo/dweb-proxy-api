import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import EventEmitter from "events";
import { createRequest, createResponse } from "node-mocks-http";
import { Server } from "./index.js";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager.js";
import { TestResolverService } from "../test/TestResolverService.js";

// 1000 labels, far beyond the 253 characters a DNS name can have
const longName = "a.".repeat(1000) + "eth";

describe("overlong domain names", function () {
  let server: Server;
  let dnsQuery: any;
  let domainsApiCalls: number;

  beforeEach(async function () {
    const env = EnvironmentConfiguration.Development;
    const services = await createApplicationConfigurationBindingsManager();

    const superagent: any =
      await services.domainQuerySuperagent.getBinding(env);
    const query = superagent.query.bind(superagent);
    domainsApiCalls = 0;
    superagent.query = async (domain: string) => {
      domainsApiCalls++;
      return query(domain);
    };

    const ensService = (await services.ensService.getBinding(
      env,
    )) as TestResolverService;
    ensService.set(longName, null);

    dnsQuery = await services.dnsQuery.getBinding(env);
    server = new Server(
      await services.configuration.getBinding(env),
      await services.logger.getBinding(env),
      await services.domainQuery.getBinding(env),
      await services.ensResolver.getBinding(env),
      await services.arweaveResolver.getBinding(env),
      dnsQuery,
      await services.domainRateLimit.getBinding(env),
      await services.hostnameSubstitution.getBinding(env),
      null,
    );
  });

  it("proxy route rejects them before any domains api lookup", async function () {
    const req = createRequest({ method: "GET", headers: { host: longName } });
    const res = createResponse({ eventEmitter: EventEmitter });
    await server.proxyServer(req, res);

    expect(res.statusCode).to.equal(422);
    expect(domainsApiCalls).to.equal(0);
  });

  it("DoH GET rejects them before any domains api lookup", async function () {
    const req = createRequest({
      method: "GET",
      url: "/dns-query",
      query: { name: longName, type: "TXT" },
    });
    const res = createResponse({ eventEmitter: EventEmitter });
    await dnsQuery.dnsqueryGet(req, res);

    expect(res.statusCode).to.equal(400);
    expect(domainsApiCalls).to.equal(0);
  });
});
