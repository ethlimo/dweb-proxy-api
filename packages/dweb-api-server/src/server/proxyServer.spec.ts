import { describe, it } from "mocha";
import { expect } from "chai";
import EventEmitter from "events";
import { createRequest, createResponse } from "node-mocks-http";
import { Server } from "./index.js";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager.js";
import { TestConfigurationService } from "../configuration/index.js";
import { TestResolverService } from "../test/TestResolverService.js";

describe("proxyServer error handling", function () {
  it("returns 500 when the resolved record can't be mapped to a gateway url", async function () {
    const env = EnvironmentConfiguration.Development;
    const services = await createApplicationConfigurationBindingsManager();
    const configuration = (await services.configuration.getBinding(
      env,
    )) as TestConfigurationService;
    configuration.set((conf) => {
      conf.ipfs.subdomainSupport = true;
    });

    // Both the DNSLink value and the normalized ENS name are 64+ chars, so
    // neither fits into a single DNS label and recordToProxyRecord throws.
    const name = "a".repeat(40) + "." + "b".repeat(40) + ".eth";
    const ensService = (await services.ensService.getBinding(
      env,
    )) as TestResolverService;
    ensService.set(
      name,
      "ipns://en." + "w".repeat(40) + "." + "x".repeat(25) + ".org",
    );

    const server = new Server(
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

    const req = createRequest({ method: "GET", headers: { host: name } });
    const res = createResponse({ eventEmitter: EventEmitter });
    await server.proxyServer(req, res);

    expect(res._isEndCalled()).to.equal(true);
    expect(res.statusCode).to.equal(500);
  });
});
