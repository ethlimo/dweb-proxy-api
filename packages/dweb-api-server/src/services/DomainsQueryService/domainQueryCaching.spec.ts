import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import type { Response } from "superagent";
import { createApplicationConfigurationBindingsManager } from "../../dependencies/services.js";
import { EnvironmentConfiguration } from "../../dependencies/BindingsManager.js";
import {
  DomainQueryService,
  type IDomainQuerySuperagentService,
} from "./index.js";

const env = EnvironmentConfiguration.Development;
const request = { trace_id: "TEST_TRACE_ID" };

type Answer = number | Record<string, unknown>;

// Domains api stand-in. Each domain gets its scripted answers in order, an
// http status that the client reports as an error, or the json body of a
// 200. Domains without (more) answers get a 404, like an unknown domain.
class ScriptedDomainsApi implements IDomainQuerySuperagentService {
  private answers = new Map<string, Answer[]>();
  calls = new Map<string, number>();

  answer(domain: string, ...answers: Answer[]) {
    this.answers.set(domain, [...(this.answers.get(domain) ?? []), ...answers]);
  }

  query = async (domain: string) => {
    this.calls.set(domain, (this.calls.get(domain) ?? 0) + 1);
    const answer = this.answers.get(domain)?.shift() ?? 404;
    if (typeof answer === "number") {
      return {
        error: { status: answer, message: `status ${answer}`, path: "/query" },
        text: "",
      } as unknown as Response;
    }
    return {
      error: null,
      text: JSON.stringify({ domain, ...answer }),
    } as unknown as Response;
  };
}

describe("DomainQueryService caching of domains api answers", function () {
  let api: ScriptedDomainsApi;
  let service: DomainQueryService;

  beforeEach(async function () {
    const services = await createApplicationConfigurationBindingsManager();
    api = new ScriptedDomainsApi();
    service = new DomainQueryService(
      await services.logger.getBinding(env),
      api,
      await services.cacheService.getBinding(env),
      await services.configuration.getBinding(env),
    );
  });

  for (const status of [400, 403, 429, 500]) {
    it(`asks again after a ${status} instead of reusing the fallback`, async function () {
      api.answer("blocked.eth", status, { blacklisted: true });

      // while the api can't answer the domain is treated as not listed...
      expect(await service.checkBlacklist(request, "blocked.eth")).to.equal(
        false,
      );
      // ...but the next request gets the real answer
      expect(await service.checkBlacklist(request, "blocked.eth")).to.equal(
        true,
      );
    });
  }

  it("asks again after a response it can't read", async function () {
    api.answer("blocked.eth", { blacklisted: "yes" }, { blacklisted: true });

    expect(await service.checkBlacklist(request, "blocked.eth")).to.equal(
      false,
    );
    expect(await service.checkBlacklist(request, "blocked.eth")).to.equal(true);
  });

  it("still caches real answers, a 404 included", async function () {
    api.answer("blocked.eth", { blacklisted: true });

    for (let i = 0; i < 3; i++) {
      await service.domainQuery(request, "blocked.eth");
      await service.domainQuery(request, "unknown.eth");
    }

    expect(api.calls.get("blocked.eth")).to.equal(1);
    expect(api.calls.get("unknown.eth")).to.equal(1);
  });
});
