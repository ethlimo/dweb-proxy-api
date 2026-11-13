import { describe, it } from "mocha";
import { expect } from "chai";
import * as z from "zod";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager.js";
import { TestLaggyRedisClientProxy, TestRedisClient } from "dweb-api-cache";

const request = { trace_id: "TEST_TRACE_ID" };

describe("cache memoize", function () {
  it("calls the wrapped function once when it throws", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const cache = await services.cacheService.getBinding(
      EnvironmentConfiguration.Development,
    );

    let calls = 0;
    const failing = async (): Promise<string> => {
      calls++;
      throw new Error("rpc is down");
    };

    let caught: unknown = null;
    try {
      await cache.memoize(request, failing, z.string(), "test", "failing.eth");
    } catch (e) {
      caught = e;
    }

    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.equal("rpc is down");
    expect(calls).to.equal(1);
  });

  it("calls the wrapped function once when redis is down", async function () {
    const env = EnvironmentConfiguration.Development;
    const services = await createApplicationConfigurationBindingsManager();
    const redis = (await services.redisClient.getBinding(
      env,
    )) as TestRedisClient;
    redis.setProxy(
      new TestLaggyRedisClientProxy(
        await services.configuration.getBinding(env),
      ),
    );
    const cache = await services.cacheService.getBinding(env);

    let calls = 0;
    const ok = async () => {
      calls++;
      return "bafy";
    };
    const failing = async (): Promise<string> => {
      calls++;
      throw new Error("rpc is down");
    };

    expect(
      await cache.memoize(request, ok, z.string(), "test", "ok.eth"),
    ).to.equal("bafy");
    expect(calls).to.equal(1);

    calls = 0;
    let caught: unknown = null;
    try {
      await cache.memoize(request, failing, z.string(), "test", "failing.eth");
    } catch (e) {
      caught = e;
    }
    expect(caught).to.be.instanceOf(Error);
    expect(calls).to.equal(1);
  });

  it("still returns a value when it succeeds", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const cache = await services.cacheService.getBinding(
      EnvironmentConfiguration.Development,
    );

    let calls = 0;
    const ok = async () => {
      calls++;
      return "bafy";
    };

    const first = await cache.memoize(
      request,
      ok,
      z.string(),
      "test",
      "ok.eth",
    );
    const second = await cache.memoize(
      request,
      ok,
      z.string(),
      "test",
      "ok.eth",
    );

    expect(first).to.equal("bafy");
    expect(second).to.equal("bafy");
    expect(calls).to.equal(1);
  });
});
