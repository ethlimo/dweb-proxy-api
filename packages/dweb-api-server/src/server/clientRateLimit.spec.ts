import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { applyTrustProxy, clientRateLimit } from "./clientRateLimit.js";

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
    expect([...service.keys.keys()].sort()).to.deep.equal([
      "client/1.1.1.1",
      "client/2.2.2.2",
    ]);
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
});
