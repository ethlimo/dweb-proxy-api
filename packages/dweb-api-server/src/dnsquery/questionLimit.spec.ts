import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import EventEmitter from "events";
import dnsPacket from "dns-packet";
import { createRequest, createResponse } from "node-mocks-http";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager.js";
import { TestResolverService } from "../test/TestResolverService.js";

const post = (questions: { name: string; type: "TXT" }[]) =>
  createRequest({
    method: "POST",
    url: "/dns-query",
    headers: {
      accept: "application/dns-message",
      "content-type": "application/dns-message",
    },
    body: dnsPacket.encode({ type: "query", id: 1, questions }),
  });

const questions = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `site${i}.eth`,
    type: "TXT" as const,
  }));

describe("DoH POST question limit", function () {
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
    for (const { name } of questions(6)) {
      ensService.set(name, null);
    }

    dnsQuery = await services.dnsQuery.getBinding(env);
  });

  it("rejects too many questions before any domains api lookup", async function () {
    const res = createResponse({ eventEmitter: EventEmitter });
    await dnsQuery.dnsqueryPost(post(questions(6)), res);

    expect(res.statusCode).to.equal(400);
    expect(domainsApiCalls).to.equal(0);
  });

  it("still checks the blacklist when the count is within the limit", async function () {
    const res = createResponse({ eventEmitter: EventEmitter });
    await dnsQuery.dnsqueryPost(post(questions(5)), res);

    expect(domainsApiCalls).to.be.greaterThan(0);
  });
});
