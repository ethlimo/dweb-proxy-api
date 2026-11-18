import { describe, it, after } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server as NodeHttpServer } from "http";
import { DataUrlProxy } from "./DataUrlProxy.js";
import { TestConfigurationService } from "../configuration/index.js";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager.js";

const env = EnvironmentConfiguration.Development;

// stands in for the hook execution, returns whatever the test put in `data`
const fakeResolver = (data: string) => ({
  resolveDataUrl: async () => ({
    _tag: "ens-dataurl" as const,
    data: "0x" + Buffer.from(data, "utf8").toString("hex"),
  }),
});

const hookPayload = Buffer.from(
  JSON.stringify({
    functionSignature: "data()",
    functionCall: "data()",
    returnType: "(bytes)",
    target: {
      chainId: 1,
      address: "0x0000000000000000000000000000000000000001",
    },
  }),
).toString("base64url");

const openServers: NodeHttpServer[] = [];

const serve = async (data: string) => {
  const services = await createApplicationConfigurationBindingsManager();
  const configuration = (await services.configuration.getBinding(
    env,
  )) as TestConfigurationService;
  configuration.set((c) => {
    c.dataurl.server.port = 0;
  });
  const proxy = new DataUrlProxy(
    configuration,
    await services.logger.getBinding(env),
    await services.domainQuery.getBinding(env),
    await services.ensResolver.getBinding(env),
    await services.arweaveResolver.getBinding(env),
    await services.dnsQuery.getBinding(env),
    await services.domainRateLimit.getBinding(env),
    await services.hostnameSubstitution.getBinding(env),
    fakeResolver(data) as any,
  );
  let server: NodeHttpServer | undefined;
  proxy.start((s) => {
    server = s;
    openServers.push(s);
  });
  await new Promise<void>((resolve) =>
    server!.listening ? resolve() : server!.once("listening", resolve),
  );
  const port = (server!.address() as AddressInfo).port;

  return new Promise<{ status: number; type?: string; body: string }>(
    (resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port,
            path: `/api/v1/dataurl/x.eth/${hookPayload}`,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve({
                status: res.statusCode!,
                type: res.headers["content-type"],
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        )
        .on("error", reject);
    },
  );
};

describe("DataUrlProxy data url parsing", function () {
  after(function () {
    for (const server of openServers.splice(0)) {
      server.close();
    }
  });

  it("serves a plain data url", async function () {
    const res = await serve("data:text/plain,hello");
    expect(res.status).to.equal(200);
    expect(res.type).to.equal("text/plain");
    expect(res.body).to.equal("hello");
  });

  it("keeps commas in the content", async function () {
    const res = await serve("data:text/html,<p>a,b</p>");
    expect(res.status).to.equal(200);
    expect(res.type).to.equal("text/html");
    expect(res.body).to.equal("<p>a,b</p>");
  });

  it("accepts parameters like charset", async function () {
    const res = await serve("data:text/plain;charset=utf-8,hi");
    expect(res.status).to.equal(200);
    expect(res.type).to.equal("text/plain;charset=utf-8");
    expect(res.body).to.equal("hi");
  });

  it("decodes base64 after other parameters", async function () {
    const res = await serve(
      "data:text/html;charset=utf-8;base64," +
        Buffer.from("<p>hi</p>").toString("base64"),
    );
    expect(res.status).to.equal(200);
    expect(res.type).to.equal("text/html;charset=utf-8");
    expect(res.body).to.equal("<p>hi</p>");
  });

  it("keeps line breaks in the content", async function () {
    const res = await serve("data:text/html,<p>one</p>\n<p>two</p>");
    expect(res.status).to.equal(200);
    expect(res.body).to.equal("<p>one</p>\n<p>two</p>");
  });

  it("uses text/plain when the media type is left out", async function () {
    const res = await serve("data:,hello");
    expect(res.status).to.equal(200);
    expect(res.type).to.equal("text/plain;charset=US-ASCII");
    expect(res.body).to.equal("hello");
  });

  it("rejects a data url without a comma", async function () {
    const res = await serve("data:text/plain;base64");
    expect(res.status).to.equal(400);
  });
});
