import { describe, it } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { register } from "prom-client";
import { instrumentServer, startLocalMetricsServer } from "./metrics.js";
import { runClustered } from "./cluster.js";

const listening = (server: http.Server) =>
  new Promise<number>((resolve) => {
    const done = () => resolve((server.address() as AddressInfo).port);
    if (server.listening) done();
    else server.once("listening", done);
  });

const get = (port: number, path: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      })
      .on("error", reject);
  });

const freePort = async () => {
  const s = http.createServer().listen(0, "127.0.0.1");
  const port = await listening(s);
  await new Promise((resolve) => s.close(resolve));
  return port;
};

const app = () =>
  http.createServer((req, res) => {
    res.writeHead(req.url === "/missing" ? 404 : 200);
    res.end();
  });

describe("metrics", function () {
  it("counts requests per port and status", async function () {
    const server = app().listen(0, "127.0.0.1");
    instrumentServer(server);
    const port = await listening(server);
    const metricsServer = startLocalMetricsServer(await freePort(), () => {});
    const metricsPort = await listening(metricsServer);

    try {
      await get(port, "/");
      await get(port, "/");
      await get(port, "/missing");

      const { status, body } = await get(metricsPort, "/metrics");
      expect(status).to.equal(200);
      expect(body).to.contain(
        `dweb_http_requests_total{port="${port}",status="200"} 2`,
      );
      expect(body).to.contain(
        `dweb_http_requests_total{port="${port}",status="404"} 1`,
      );
      expect(body).to.contain(
        `dweb_http_request_duration_seconds_count{port="${port}"} 3`,
      );
      expect((await get(metricsPort, "/other")).status).to.equal(404);
    } finally {
      server.close();
      metricsServer.close();
    }
  });

  it("is served by runClustered when metricsPort is set", async function () {
    const metricsPort = await freePort();
    let server: http.Server | null = null;
    const stop = runClustered(
      (register) => {
        server = app().listen(0, "127.0.0.1");
        register(server);
      },
      { workers: 1, metricsPort },
    );
    await new Promise((resolve) => setImmediate(resolve));

    try {
      const port = await listening(server!);
      await get(port, "/");
      const { status, body } = await get(metricsPort, "/metrics");
      expect(status).to.equal(200);
      expect(body).to.contain(
        `dweb_http_requests_total{port="${port}",status="200"} 1`,
      );
      // default node metrics are enabled by the worker
      expect(body).to.contain("process_cpu_seconds_total");
      expect(body).to.contain("nodejs_eventloop_lag_p99_seconds");
    } finally {
      stop();
      server!.close();
    }
  });

  it("keeps the process running when the metrics port is taken", async function () {
    // same interfaces the metrics server listens on
    const taken = http.createServer().listen(0);
    const port = await listening(taken);
    try {
      const error = await new Promise<Error>((resolve) => {
        startLocalMetricsServer(port, resolve);
      });
      expect((error as any).code).to.equal("EADDRINUSE");
    } finally {
      taken.close();
    }
  });

  it("doesn't record anything when metricsPort is not set", async function () {
    let server: http.Server | null = null;
    const stop = runClustered(
      (register) => {
        server = app().listen(0, "127.0.0.1");
        register(server);
      },
      { workers: 1 },
    );
    await new Promise((resolve) => setImmediate(resolve));

    try {
      const port = await listening(server!);
      await get(port, "/");
      const recorded = await register.getSingleMetricAsString(
        "dweb_http_requests_total",
      );
      expect(recorded).to.not.contain(`port="${port}"`);
    } finally {
      stop();
      server!.close();
    }
  });
});
