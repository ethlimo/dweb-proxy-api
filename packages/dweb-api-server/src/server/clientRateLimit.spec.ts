import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  applyTrustProxy,
  clientKey,
  clientRateLimit,
  hashedClientKey,
} from "./clientRateLimit.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;

const config = (limit: number) => ({
  getClientRateLimitConfig: () => ({
    getLimit: () => limit,
    getPeriod: () => 60,
    getTrustProxy: () => "",
  }),
});

// in-memory stand-in for DomainRateLimitService
const memoryRateLimit = () => {
  const counts = new Map<string, number>();
  return {
    keys: counts,
    incrementRateLimit: async (
      _request: unknown,
      key: string,
      max: number,
      _period: number,
    ) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { countOverMax: count > max, count, ttl: 60 };
    },
  };
};

let server: http.Server | null = null;

const start = async (app: express.Express) => {
  app.get("/", (_req, res) => {
    res.end("ok");
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server!.on("listening", resolve));
  return (server.address() as AddressInfo).port;
};

const get = (port: number, headers: Record<string, string> = {}) =>
  new Promise<number>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/", headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      })
      .on("error", reject);
  });

describe("clientRateLimit", function () {
  afterEach(() => {
    server?.close();
    server = null;
  });

  it("returns 429 once a client goes over the limit", async function () {
    const app = express();
    app.use(clientRateLimit(config(2), memoryRateLimit() as any, logger));
    const port = await start(app);

    expect(await get(port)).to.equal(200);
    expect(await get(port)).to.equal(200);
    expect(await get(port)).to.equal(429);
  });

  it("does nothing when the limit is 0", async function () {
    const service = memoryRateLimit();
    const app = express();
    app.use(clientRateLimit(config(0), service as any, logger));
    const port = await start(app);

    for (let i = 0; i < 5; i++) {
      expect(await get(port)).to.equal(200);
    }
    expect(service.keys.size).to.equal(0);
  });

  it("ignores X-Forwarded-For unless trust proxy is set", async function () {
    const service = memoryRateLimit();
    const app = express();
    app.use(clientRateLimit(config(1), service as any, logger));
    const port = await start(app);

    expect(await get(port, { "x-forwarded-for": "1.1.1.1" })).to.equal(200);
    // a different spoofed address must not get a fresh counter
    expect(await get(port, { "x-forwarded-for": "2.2.2.2" })).to.equal(429);
  });

  it("counts per forwarded client ip behind a trusted proxy", async function () {
    const service = memoryRateLimit();
    const app = express();
    applyTrustProxy(app, "loopback");
    app.use(clientRateLimit(config(1), service as any, logger));
    const port = await start(app);

    expect(await get(port, { "x-forwarded-for": "1.1.1.1" })).to.equal(200);
    expect(await get(port, { "x-forwarded-for": "2.2.2.2" })).to.equal(200);
    expect(await get(port, { "x-forwarded-for": "1.1.1.1" })).to.equal(429);
    expect(service.keys.size).to.equal(2);
  });

  it("doesn't put client addresses in the store keys or the logs", async function () {
    const logged: unknown[] = [];
    const recordingLogger = {
      debug: (...args: unknown[]) => logged.push(args),
      info: (...args: unknown[]) => logged.push(args),
      warn: (...args: unknown[]) => logged.push(args),
      error: (...args: unknown[]) => logged.push(args),
    } as any;
    const service = memoryRateLimit();
    const app = express();
    applyTrustProxy(app, "loopback");
    app.use(clientRateLimit(config(1), service as any, recordingLogger));
    const port = await start(app);

    // the second request goes over the limit and gets logged
    await get(port, { "x-forwarded-for": "203.0.113.7" });
    expect(await get(port, { "x-forwarded-for": "203.0.113.7" })).to.equal(429);
    server!.close();

    const broken = express();
    applyTrustProxy(broken, "loopback");
    broken.use(
      clientRateLimit(
        config(1),
        {
          incrementRateLimit: async () => {
            throw new Error("redis down");
          },
        } as any,
        recordingLogger,
      ),
    );
    const brokenPort = await start(broken);
    await get(brokenPort, { "x-forwarded-for": "203.0.113.7" });

    expect(logged.length).to.be.greaterThan(0);
    expect(
      JSON.stringify(logged, (_k, v) => (v instanceof Error ? v.message : v)),
    ).to.not.include("203.0.113.7");
    for (const key of service.keys.keys()) {
      expect(key).to.not.include("203.0.113.7");
    }
  });

  it("lets requests through when the rate limit store fails", async function () {
    const app = express();
    const broken = {
      incrementRateLimit: async () => {
        throw new Error("redis down");
      },
    };
    app.use(clientRateLimit(config(1), broken as any, logger));
    const port = await start(app);

    expect(await get(port)).to.equal(200);
    expect(await get(port)).to.equal(200);
  });

  it("counts IPv6 clients per /64", async function () {
    const service = memoryRateLimit();
    const app = express();
    applyTrustProxy(app, "loopback");
    app.use(clientRateLimit(config(1), service as any, logger));
    const port = await start(app);

    const ip = (a: string) => ({ "x-forwarded-for": a });
    expect(await get(port, ip("2001:db8:1:2::1"))).to.equal(200);
    expect(await get(port, ip("2001:db8:1:2:ffff::42"))).to.equal(429);
    expect(await get(port, ip("2001:db8:1:3::1"))).to.equal(200);
  });
});

describe("clientKey", function () {
  it("keeps ipv4 addresses and unwraps ipv4-mapped ones", function () {
    expect(clientKey("1.2.3.4")).to.equal("1.2.3.4");
    expect(clientKey("::ffff:1.2.3.4")).to.equal("1.2.3.4");
  });

  it("reduces ipv6 addresses to their /64", function () {
    expect(clientKey("2001:db8:1:2::1")).to.equal("2001:db8:1:2::/64");
    expect(clientKey("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).to.equal(
      "2001:db8:1:2::/64",
    );
    expect(clientKey("2001:db8::1")).to.equal("2001:db8:0:0::/64");
    expect(clientKey("::1")).to.equal("0:0:0:0::/64");
    expect(clientKey("fe80::1%eth0")).to.equal("fe80:0:0:0::/64");
    expect(clientKey("64:ff9b::1.2.3.4")).to.equal("64:ff9b:0:0::/64");
  });
});

describe("hashedClientKey", function () {
  it("gives the same key for the same client and different ones otherwise", function () {
    expect(hashedClientKey("1.2.3.4")).to.equal(
      hashedClientKey("::ffff:1.2.3.4"),
    );
    expect(hashedClientKey("2001:db8:1:2::1")).to.equal(
      hashedClientKey("2001:db8:1:2:ffff::42"),
    );
    expect(hashedClientKey("1.2.3.4")).to.not.equal(hashedClientKey("1.2.3.5"));
  });

  it("depends on the secret, so processes with the same one share a key", function () {
    expect(hashedClientKey("1.2.3.4", "a")).to.equal(
      hashedClientKey("1.2.3.4", "a"),
    );
    expect(hashedClientKey("1.2.3.4", "a")).to.not.equal(
      hashedClientKey("1.2.3.4", "b"),
    );
    expect(hashedClientKey("1.2.3.4", "a")).to.not.include("1.2.3.4");
  });
});
