import { describe, it } from "mocha";
import { expect } from "chai";
import * as z from "zod";
import RedisMock from "ioredis-mock";
import { createRequest, createResponse } from "node-mocks-http";
import { InflightLookups } from "dweb-api-cache/inflight";
import {
  AbstractRedisClient,
  LocallyCachedRedisCacheService,
  MemoryCacheFactory,
  TestLaggyRedisClientProxy,
  TestRedisClient,
} from "dweb-api-cache";
import type { ILoggerService } from "dweb-api-types/logger";
import type { INamedMemoryCache } from "dweb-api-types/cache";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager.js";
import { Server } from "../server/index.js";
import { TestConfigurationService } from "../configuration/index.js";

const request = { trace_id: "TEST_TRACE_ID" };
const env = EnvironmentConfiguration.Development;

// A promise the test resolves or rejects by hand, so it decides when the
// lookup finishes instead of guessing with timers.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: Error) => ({ ok: false as const, error }),
  );

// Each call gets the next of the given attempts, so a test can make the
// first lookup fail and the retry succeed.
function scriptedLookup<T>(...attempts: Array<() => Promise<T>>) {
  const lookup = () => {
    const attempt = attempts[lookup.calls] ?? attempts[attempts.length - 1]!;
    lookup.calls++;
    return attempt();
  };
  lookup.calls = 0;
  return lookup;
}

const failsAtOnce = (message: string) =>
  scriptedLookup<string>(async () => {
    throw new Error(message);
  });

const quietLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as ILoggerService;

// lets everything that is already queued (promise callbacks, the awaits
// inside memoize) run before the test goes on
const flush = () => new Promise((r) => setImmediate(r));

describe("InflightLookups", function () {
  it("runs one lookup for concurrent callers of the same key", async function () {
    const inflight = new InflightLookups(5000);
    const pending = deferred<{ codec: string }>();
    const lookup = scriptedLookup(() => pending.promise);

    const first = inflight.run("vitalik.eth", "req-1", lookup);
    const others = ["req-2", "req-3", "req-4"].map((id) =>
      inflight.run("vitalik.eth", id, lookup),
    );
    const original = { codec: "ipfs://bafy" };
    pending.resolve(original);

    expect(await first).to.equal(original);
    for (const value of await Promise.all(others)) {
      expect(value).to.deep.equal(original);
      // everyone gets their own copy, like a memory cache hit
      expect(value).to.not.equal(original);
    }
    expect(lookup.calls).to.equal(1);
    expect(inflight.size).to.equal(0);
  });

  it("keeps different keys apart", async function () {
    const inflight = new InflightLookups(5000);
    const seen: string[] = [];
    const lookup = (name: string) => async () => {
      seen.push(name);
      return name;
    };

    const [a, b] = await Promise.all([
      inflight.run("a.eth", "req-1", lookup("a.eth")),
      inflight.run("b.eth", "req-2", lookup("b.eth")),
    ]);

    expect([a, b]).to.deep.equal(["a.eth", "b.eth"]);
    expect(seen).to.deep.equal(["a.eth", "b.eth"]);
  });

  it("lets the ones that joined a failed lookup try once more, together", async function () {
    const inflight = new InflightLookups(5000);
    const first = deferred<string>();
    const lookup = scriptedLookup(
      () => first.promise,
      async () => "bafy",
    );

    const started = settle(inflight.run("flaky.eth", "req-1", lookup));
    const joined = ["req-2", "req-3", "req-4"].map((id) =>
      settle(inflight.run("flaky.eth", id, lookup)),
    );
    first.reject(new Error("connection reset"));

    // the one that made the failed attempt sees its error, like before
    const own = await started;
    expect(own.ok).to.equal(false);
    expect((own as { error: Error }).error.message).to.equal(
      "connection reset",
    );
    for (const result of await Promise.all(joined)) {
      expect(result).to.deep.equal({ ok: true, value: "bafy" });
    }
    // one retry for all three, not one each
    expect(lookup.calls).to.equal(2);
    expect(inflight.size).to.equal(0);
  });

  it("retries with the lookup of the first caller that joined", async function () {
    // matters for the logs: the retry runs with that request's context,
    // not with the one of the request whose attempt failed
    const inflight = new InflightLookups(5000);
    const failed = failsAtOnce("connection reset");
    const second = scriptedLookup(async () => "from req-2");
    const third = scriptedLookup(async () => "from req-3");

    const results = await Promise.all([
      settle(inflight.run("flaky.eth", "req-1", failed)),
      settle(inflight.run("flaky.eth", "req-2", second)),
      settle(inflight.run("flaky.eth", "req-3", third)),
    ]);

    expect(results.map((r) => r.ok)).to.deep.equal([false, true, true]);
    expect(
      results.slice(1).map((r) => (r as { value: string }).value),
    ).to.deep.equal(["from req-2", "from req-2"]);
    expect([failed.calls, second.calls, third.calls]).to.deep.equal([1, 1, 0]);
  });

  it("gives everyone the error when the retry fails too", async function () {
    const inflight = new InflightLookups(5000);
    const lookup = failsAtOnce("rpc is down");

    const results = await Promise.all(
      ["req-1", "req-2", "req-3", "req-4"].map((id) =>
        settle(inflight.run("down.eth", id, lookup)),
      ),
    );

    for (const result of results) {
      expect(result.ok).to.equal(false);
      expect((result as { error: Error }).error.message).to.equal(
        "rpc is down",
      );
    }
    expect(lookup.calls).to.equal(2);
    expect(inflight.size).to.equal(0);

    // nothing is kept, the next caller starts over
    expect(
      await inflight.run("down.eth", "req-5", async () => "back"),
    ).to.equal("back");
  });

  it("keeps a backend that is down at two lookups per burst of requests", async function () {
    const inflight = new InflightLookups(5000);
    const lookup = failsAtOnce("connection refused");
    const burst = () =>
      Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          settle(inflight.run("down.eth", `req-${i}`, lookup)),
        ),
      );

    expect((await burst()).every((r) => !r.ok)).to.equal(true);
    expect(lookup.calls).to.equal(2);
    expect((await burst()).every((r) => !r.ok)).to.equal(true);
    expect(lookup.calls).to.equal(4);
  });

  it("doesn't retry a lookup that failed after maxJoinMs", async function () {
    let now = 0;
    const inflight = new InflightLookups(5000, () => now);
    const timingOut = deferred<string>();
    const lookup = scriptedLookup(
      () => timingOut.promise,
      async () => "bafy",
    );

    const results = ["req-1", "req-2", "req-3"].map((id) =>
      settle(inflight.run("timeout.eth", id, lookup)),
    );
    now = 5000;
    timingOut.reject(new Error("timeout"));

    for (const result of await Promise.all(results)) {
      expect(result.ok).to.equal(false);
    }
    expect(lookup.calls).to.equal(1);
    expect(inflight.size).to.equal(0);
  });

  it("only shares a lookup while it runs", async function () {
    const inflight = new InflightLookups(5000);
    let lookups = 0;
    const lookup = async () => ++lookups;

    expect(await inflight.run("x.eth", "req-1", lookup)).to.equal(1);
    expect(await inflight.run("x.eth", "req-2", lookup)).to.equal(2);
  });

  it("doesn't join a lookup older than maxJoinMs", async function () {
    let now = 0;
    const inflight = new InflightLookups(5000, () => now);
    const stuck = deferred<string>();
    const notCalled = async () => "not called";

    const first = inflight.run("slow.eth", "req-1", () => stuck.promise);
    now = 4999;
    const joined = inflight.run("slow.eth", "req-2", notCalled);
    now = 5000;
    const fresh = deferred<string>();
    const second = inflight.run("slow.eth", "req-3", () => fresh.promise);
    now = 5001;
    const joinedSecond = inflight.run("slow.eth", "req-4", notCalled);

    // the old lookup finishing must not drop the newer one from the map
    stuck.resolve("old");
    expect(await first).to.equal("old");
    expect(await joined).to.equal("old");
    expect(inflight.size).to.equal(1);

    fresh.resolve("new");
    expect(await second).to.equal("new");
    expect(await joinedSecond).to.equal("new");
    expect(inflight.size).to.equal(0);
  });

  it("handles a lookup that throws before returning a promise", async function () {
    const inflight = new InflightLookups(5000);
    const result = await settle(
      inflight.run("sync.eth", "req-1", () => {
        throw new Error("bad input");
      }),
    );

    expect(result.ok).to.equal(false);
    expect(inflight.size).to.equal(0);
  });

  it("says who started the lookup a caller would join", async function () {
    let now = 0;
    const inflight = new InflightLookups(5000, () => now);
    const pending = deferred<string>();

    expect(inflight.joinable("k.eth")).to.equal(undefined);
    const running = inflight.run("k.eth", "req-1", () => pending.promise);
    expect(inflight.joinable("k.eth")).to.deep.equal({ startedBy: "req-1" });
    now = 5000;
    expect(inflight.joinable("k.eth")).to.equal(undefined);

    pending.resolve("bafy");
    await running;
    now = 0;
    expect(inflight.joinable("k.eth")).to.equal(undefined);
  });

  it("leaves no unhandled rejections behind", async function () {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const inflight = new InflightLookups(5000);
      // alone, with joiners and a failing retry, and a synchronous throw;
      // every caller handles its own promise, nothing else may be left
      await settle(inflight.run("a.eth", "r1", failsAtOnce("down")));
      const lookup = failsAtOnce("down");
      await Promise.all(
        ["r1", "r2", "r3"].map((id) =>
          settle(inflight.run("b.eth", id, lookup)),
        ),
      );
      await settle(
        inflight.run("c.eth", "r1", () => {
          throw new Error("sync");
        }),
      );
      await flush();
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).to.deep.equal([]);
  });
});

describe("cache memoize with concurrent misses", function () {
  it("calls the wrapped function once and caches the result", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const cache = await services.cacheService.getBinding(env);
    const pending = deferred<string>();
    const lookup = scriptedLookup(() => pending.promise);

    const results = Array.from({ length: 50 }, () =>
      cache.memoize(request, lookup, z.string(), "test", "concurrent.eth"),
    );
    pending.resolve("bafy");

    expect(new Set(await Promise.all(results))).to.deep.equal(
      new Set(["bafy"]),
    );
    expect(lookup.calls).to.equal(1);
    expect(
      await cache.memoize(
        request,
        lookup,
        z.string(),
        "test",
        "concurrent.eth",
      ),
    ).to.equal("bafy");
    expect(lookup.calls).to.equal(1);
  });

  it("recovers from one failed attempt without failing the requests that joined it", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const cache = await services.cacheService.getBinding(env);
    const first = deferred<string>();
    const lookup = scriptedLookup(
      () => first.promise,
      async () => "bafy",
    );

    const results = Array.from({ length: 10 }, () =>
      settle(cache.memoize(request, lookup, z.string(), "test", "flaky.eth")),
    );
    first.reject(new Error("connection reset"));

    const settled = await Promise.all(results);
    expect(settled.filter((r) => !r.ok)).to.have.length(1);
    expect(settled.filter((r) => r.ok)).to.have.length(9);
    expect(lookup.calls).to.equal(2);
  });

  it("calls a failing function twice in total and tries again on the next request", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const cache = await services.cacheService.getBinding(env);
    const lookup = failsAtOnce("rpc is down");

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        settle(cache.memoize(request, lookup, z.string(), "test", "down.eth")),
      ),
    );

    expect(results.every((r) => !r.ok)).to.equal(true);
    expect(lookup.calls).to.equal(2);

    const ok = async () => "bafy";
    expect(
      await cache.memoize(request, ok, z.string(), "test", "down.eth"),
    ).to.equal("bafy");
  });

  it("shares a lookup that returns null", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const cache = await services.cacheService.getBinding(env);
    const pending = deferred<null>();
    const lookup = scriptedLookup(() => pending.promise);

    const results = Array.from({ length: 10 }, () =>
      cache.memoize(request, lookup, z.null(), "test", "no-record.eth"),
    );
    pending.resolve(null);

    expect(await Promise.all(results)).to.deep.equal(Array(10).fill(null));
    expect(lookup.calls).to.equal(1);
  });

  it("shares the lookup when redis is down too", async function () {
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
    const lookup = scriptedLookup(async () => "bafy");

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        cache.memoize(request, lookup, z.string(), "test", "redis-down.eth"),
      ),
    );

    expect(new Set(results)).to.deep.equal(new Set(["bafy"]));
    expect(lookup.calls).to.equal(1);
  });

  it("falls back to the function when the memory cache fails, as before", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const configuration = await services.configuration.getBinding(env);
    const brokenMemory = {
      get: async () => {
        throw new Error("memory cache broken");
      },
      put: async () => {},
      getTtl: async () => undefined,
      getServiceName: () => "broken",
    } as unknown as INamedMemoryCache;
    const cache = new LocallyCachedRedisCacheService(
      quietLogger,
      await services.redisClient.getBinding(env),
      () => brokenMemory,
      configuration,
    );
    const lookup = scriptedLookup(async () => "bafy");

    expect(
      await cache.memoize(request, lookup, z.string(), "test", "broken.eth"),
    ).to.equal("bafy");
    expect(lookup.calls).to.equal(1);
  });

  it("does one lookup per process when processes share redis", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const configuration = await services.configuration.getBinding(env);
    class SharedRedis extends AbstractRedisClient {}
    const redisMock = new RedisMock();
    await redisMock.flushall();
    // ioredis-mock instances share their data, like processes on one redis
    const newProcess = () => {
      const memory = new MemoryCacheFactory();
      return new LocallyCachedRedisCacheService(
        quietLogger,
        new SharedRedis(new RedisMock(), configuration),
        (name) =>
          memory.createNamedMemoryCacheFactory(
            name,
            quietLogger,
            configuration,
          ),
        configuration,
      );
    };
    const pending = deferred<string>();
    const lookup = scriptedLookup(() => pending.promise);

    const [first, second] = [newProcess(), newProcess()];
    const results = [first, second].flatMap((cache) =>
      Array.from({ length: 10 }, () =>
        cache.memoize(request, lookup, z.string(), "test", "shared.eth"),
      ),
    );
    await flush();
    pending.resolve("bafy");

    expect(new Set(await Promise.all(results))).to.deep.equal(
      new Set(["bafy"]),
    );
    expect(lookup.calls).to.equal(2);
    // a third process finds it in redis
    expect(
      await newProcess().memoize(
        request,
        lookup,
        z.string(),
        "test",
        "shared.eth",
      ),
    ).to.equal("bafy");
    expect(lookup.calls).to.equal(2);
  });

  it("logs which request a waiting request is tied to", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const configuration = await services.configuration.getBinding(env);
    const debugLines: Array<{ message: string; context: unknown }> = [];
    const logger = {
      ...quietLogger,
      debug: (message: string, meta: { context?: unknown }) =>
        debugLines.push({ message, context: meta.context }),
    } as unknown as ILoggerService;
    const memory = new MemoryCacheFactory();
    const cache = new LocallyCachedRedisCacheService(
      logger,
      await services.redisClient.getBinding(env),
      (name) =>
        memory.createNamedMemoryCacheFactory(name, logger, configuration),
      configuration,
    );
    const pending = deferred<string>();
    const lookup = () => pending.promise;

    const first = cache.memoize(
      { trace_id: "first" },
      lookup,
      z.string(),
      "test",
      "traced.eth",
    );
    const second = cache.memoize(
      { trace_id: "second" },
      lookup,
      z.string(),
      "test",
      "traced.eth",
    );
    // memoize awaits the memory cache before it joins, let that happen
    await flush();
    pending.resolve("bafy");
    await Promise.all([first, second]);

    const waiting = debugLines.filter(
      (l) => l.message === "waiting for a lookup another request started",
    );
    expect(waiting).to.deep.equal([
      {
        message: "waiting for a lookup another request started",
        context: { key: "test/traced.eth", startedBy: "first" },
      },
    ]);
  });
});

describe("concurrent requests through the services", function () {
  const contenthash = {
    _tag: "DecodedCodecString" as const,
    codec: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  };

  // dev bindings with a contenthash lookup the test counts and finishes
  async function servicesWithSlowEns() {
    const services = await createApplicationConfigurationBindingsManager();
    const configuration = (await services.configuration.getBinding(
      env,
    )) as TestConfigurationService;
    configuration.set((c) => {
      c.ens.socialsEndpointEnabled = false;
    });
    const pending = deferred<typeof contenthash>();
    const ens = await services.ensService.getBinding(env);
    const ensLookups = { count: 0 };
    ens.getContentHash = async () => {
      ensLookups.count++;
      return pending.promise;
    };
    return { services, configuration, pending, ensLookups };
  }

  it("resolves a name once for concurrent resolveEns calls", async function () {
    const { services, pending, ensLookups } = await servicesWithSlowEns();
    const resolver = await services.ensResolver.getBinding(env);

    const results = Array.from({ length: 30 }, () =>
      resolver.resolveEns(request, "popular.eth"),
    );
    await flush();
    pending.resolve(contenthash);
    const resolved = await Promise.all(results);

    expect(ensLookups.count).to.equal(1);
    for (const r of resolved) {
      expect(r).to.deep.equal(resolved[0]);
    }
    // no two requests hold the same object
    expect(new Set(resolved).size).to.equal(30);
  });

  it("asks the domains api once per domain for concurrent blacklist checks", async function () {
    const services = await createApplicationConfigurationBindingsManager();
    const superagent = await services.domainQuerySuperagent.getBinding(env);
    const original = superagent.query.bind(superagent);
    const asked: string[] = [];
    superagent.query = async (domain: string) => {
      asked.push(domain);
      await flush();
      return original(domain);
    };
    const domainQuery = await services.domainQuery.getBinding(env);

    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        domainQuery.checkBlacklist(request, "popular.eth"),
      ),
    );

    expect(new Set(results)).to.deep.equal(new Set([false]));
    expect([...asked].sort()).to.deep.equal(["eth", "popular.eth"]);
  });

  it("serves concurrent proxy requests for one name with one ens lookup", async function () {
    const { services, configuration, pending, ensLookups } =
      await servicesWithSlowEns();
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
    const hit = async () => {
      const res = createResponse();
      await server.proxyServer(
        createRequest({ method: "GET", headers: { host: "popular.eth" } }),
        res,
      );
      return { status: res.statusCode, headers: res.getHeaders() };
    };

    const responses = Array.from({ length: 30 }, hit);
    // the blacklist check runs before the ens lookup, let all of them get
    // to the point where they wait for it
    for (let i = 0; i < 20; i++) await flush();
    pending.resolve(contenthash);
    const done = await Promise.all(responses);

    expect(ensLookups.count).to.equal(1);
    expect(new Set(done.map((r) => r.status))).to.deep.equal(new Set([200]));
    for (const r of done) {
      expect(r.headers).to.deep.equal(done[0]!.headers);
    }
  });
});
