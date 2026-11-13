import { describe, it } from "mocha";
import { expect } from "chai";
import EventEmitter from "events";
import { createRequest, createResponse } from "node-mocks-http";
import { Server } from "./index.js";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager.js";
import { TestConfigurationService } from "../configuration/index.js";

const env = EnvironmentConfiguration.Development;

const record = {
  _tag: "DataUrlRecord" as const,
  ensname: "hook.eth",
  data: {
    functionSignature: "getData()",
    functionCall: "getData()",
    returnType: "(string)",
    target: {
      chainId: 1,
      address: "0x0000000000000000000000000000000000000001",
    },
  },
};

// X-Content-Location the proxy answers with for a data url record
const contentLocation = async (endpoint: string, port: string | null) => {
  const services = await createApplicationConfigurationBindingsManager();
  const configuration = (await services.configuration.getBinding(
    env,
  )) as TestConfigurationService;
  configuration.set((conf) => {
    conf.dataurl.endpoint = new URL(endpoint);
    conf.dataurl.endpointPort = port;
  });
  const server = new Server(
    configuration,
    await services.logger.getBinding(env),
    await services.domainQuery.getBinding(env),
    await services.ensResolver.getBinding(env),
    await services.arweaveResolver.getBinding(env),
    await services.dnsQuery.getBinding(env),
    await services.domainRateLimit.getBinding(env),
    await services.hostnameSubstitution.getBinding(env),
    // only has to be set, the proxy route never calls it
    {} as any,
  );
  const req = createRequest({
    method: "GET",
    url: "/",
    headers: { host: "hook.eth" },
  });
  const res = createResponse({ eventEmitter: EventEmitter });
  await server.requestHandler({ trace_id: "TEST_TRACE_ID" }, record, req, res);
  expect(res.statusCode).to.equal(200);
  return res.getHeader("x-content-location");
};

describe("X-Content-Location for data url records", () => {
  it("keeps an explicit default port 443 from DATAURL_ENDPOINT", async () => {
    expect(
      await contentLocation("https://dataurl.example:443", "443"),
    ).to.equal("dataurl.example:443");
  });

  it("keeps a non-default port", async () => {
    expect(
      await contentLocation("http://dweb-proxy-api:12500", "12500"),
    ).to.equal("dweb-proxy-api:12500");
  });

  it("doesn't append a port when DATAURL_ENDPOINT has none", async () => {
    expect(await contentLocation("https://dataurl.example", null)).to.equal(
      "dataurl.example",
    );
  });
});
