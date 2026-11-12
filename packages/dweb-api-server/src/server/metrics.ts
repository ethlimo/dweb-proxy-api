import cluster from "node:cluster";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  AggregatorRegistry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  register,
} from "prom-client";

// Prometheus metrics. Each process (or each worker in cluster mode) records
// into the default prom-client registry. The metrics endpoint runs in the
// primary process and, in cluster mode, collects from all workers.

const requests = new Counter({
  name: "dweb_http_requests_total",
  help: "HTTP requests handled, by listener port and status code",
  labelNames: ["port", "status"] as const,
});

const duration = new Histogram({
  name: "dweb_http_request_duration_seconds",
  help: "Time spent on HTTP requests, by listener port",
  labelNames: ["port"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const inflight = new Gauge({
  name: "dweb_http_requests_inflight",
  help: "HTTP requests currently being handled",
  aggregator: "sum",
});

let defaultMetricsStarted = false;

export function startDefaultMetrics() {
  if (!defaultMetricsStarted) {
    defaultMetricsStarted = true;
    collectDefaultMetrics();
    // prom-client only starts answering the primary's metrics requests
    // once an AggregatorRegistry has been created in the worker as well
    if (cluster.isWorker) {
      new AggregatorRegistry();
    }
  }
}

export function instrumentServer(server: http.Server) {
  server.on("request", (_req, res) => {
    const end = duration.startTimer();
    inflight.inc();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      inflight.dec();
      const port = String((server.address() as AddressInfo | null)?.port);
      // a closed connection without a response shows up as status 0
      const status = res.headersSent ? String(res.statusCode) : "0";
      requests.inc({ port, status });
      end({ port });
    };
    res.on("finish", finish);
    res.on("close", finish);
  });
}

export function startMetricsServer(
  port: number,
  collect: () => Promise<string>,
  contentType: string,
) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "GET" || req.url !== "/metrics") {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const body = await collect();
      res.writeHead(200, { "Content-Type": contentType });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  server.listen(port);
  return server;
}

// single process: serve this process' registry
export function startLocalMetricsServer(port: number) {
  return startMetricsServer(
    port,
    () => register.metrics(),
    register.contentType,
  );
}

// cluster primary: ask every worker for its metrics and merge them
export function startClusterMetricsServer(port: number) {
  const aggregator = new AggregatorRegistry();
  return startMetricsServer(
    port,
    () => aggregator.clusterMetrics(),
    aggregator.contentType,
  );
}
