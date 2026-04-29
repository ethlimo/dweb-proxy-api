import cluster, { type Worker as ClusterWorker } from "node:cluster";
import { availableParallelism } from "node:os";
import process from "node:process";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Server as NodeHttpServer } from "node:http";
import type { ILoggerService } from "dweb-api-types/logger";
import { withProcessLogger } from "./clusterLogger.js";

type StartFn = (
  registerServer: (server: NodeHttpServer) => void,
) => void | Promise<void>;

type ClusterOptions = {
  workers?: number;
  heartbeatMs?: number;
  noHeartbeatMs?: number;
  maxInflight?: number;
  maxLagMs?: number;
  overloadGraceMs?: number;
  requestTimeoutMs?: number;
  headersTimeoutMs?: number;
  keepAliveTimeoutMs?: number;
  catastrophicRestarts?: number;
  catastrophicWindowMs?: number;
  logger?: ILoggerService;
};

type ClusterNumericOptions = Required<Omit<ClusterOptions, "logger">>;

const DEFAULTS: ClusterNumericOptions = {
  workers: Math.max(2, availableParallelism()),
  heartbeatMs: 1000,
  noHeartbeatMs: 5000,
  maxInflight: 500,
  maxLagMs: 1000,
  overloadGraceMs: 10000,
  requestTimeoutMs: 30000,
  headersTimeoutMs: 35000,
  keepAliveTimeoutMs: 5000,
  catastrophicRestarts: 8,
  catastrophicWindowMs: 30000,
};

if (
  typeof DEFAULTS !== "undefined" &&
  DEFAULTS &&
  typeof DEFAULTS.requestTimeoutMs === "number" &&
  typeof DEFAULTS.headersTimeoutMs === "number" &&
  DEFAULTS.requestTimeoutMs < DEFAULTS.headersTimeoutMs
) {
  DEFAULTS.requestTimeoutMs = DEFAULTS.headersTimeoutMs;
}

type WorkerHeartbeat = {
  type: "heartbeat";
  inflight: number;
  sockets: number;
  lagP99Ms: number;
};

/** Sanitise a numeric option: returns `value` when it is a finite number >= `min`, otherwise `def`. */
function sanitize(value: number, def: number, min: number = 1): number {
  return Number.isFinite(value) && value >= min ? value : def;
}

export function runClustered(
  start: StartFn,
  opts: ClusterOptions = {},
): () => void {
  const { logger, ...numericOpts } = opts;
  const raw = { ...DEFAULTS, ...numericOpts };

  // Validate and clamp all numeric options. For every option except
  // `workers`, invalid values (NaN, non-finite, or below the minimum)
  // fall back to the documented defaults. `workers` instead uses `1`
  // as a special non-clustered mode when the provided value is invalid.
  const o: ClusterNumericOptions = {
    workers: sanitize(raw.workers, 1, 1),
    heartbeatMs: sanitize(raw.heartbeatMs, DEFAULTS.heartbeatMs),
    noHeartbeatMs: sanitize(raw.noHeartbeatMs, DEFAULTS.noHeartbeatMs),
    maxInflight: sanitize(raw.maxInflight, DEFAULTS.maxInflight),
    maxLagMs: sanitize(raw.maxLagMs, DEFAULTS.maxLagMs),
    overloadGraceMs: sanitize(raw.overloadGraceMs, DEFAULTS.overloadGraceMs, 0),
    requestTimeoutMs: sanitize(raw.requestTimeoutMs, DEFAULTS.requestTimeoutMs),
    headersTimeoutMs: sanitize(raw.headersTimeoutMs, DEFAULTS.headersTimeoutMs),
    keepAliveTimeoutMs: sanitize(
      raw.keepAliveTimeoutMs,
      DEFAULTS.keepAliveTimeoutMs,
      0,
    ),
    catastrophicRestarts: sanitize(
      raw.catastrophicRestarts,
      DEFAULTS.catastrophicRestarts,
    ),
    catastrophicWindowMs: sanitize(
      raw.catastrophicWindowMs,
      DEFAULTS.catastrophicWindowMs,
    ),
  };

  // Normalise workers to a positive integer.
  const workerCount = Math.floor(o.workers);

  // Non-clustered mode: when workers <= 1 (including invalid/zero/negative
  // values that were coerced to 1 above), or when this is already a worker
  // process, run start() directly in the current process.
  if (!cluster.isPrimary || workerCount <= 1) {
    const cleanups: Array<() => void> = [];
    void runWorker(start, o, logger, cleanups);
    // runWorker populates `cleanups` asynchronously (after its first await).
    // Callers must flush pending microtasks (e.g. via setImmediate) before
    // invoking this handle to guarantee all teardown callbacks are registered.
    return () => {
      for (const fn of cleanups) fn();
      cleanups.length = 0;
    };
  }

  // Primary process: fork `workerCount` workers and supervise them.
  cluster.schedulingPolicy = cluster.SCHED_RR;

  const lastHeartbeat = new Map<number, number>();
  const restartTimestamps: number[] = [];
  let shuttingDown = false;

  const forkWorker = () => {
    const worker = cluster.fork();

    lastHeartbeat.set(worker.id, Date.now());

    worker.on("message", (msg: WorkerHeartbeat) => {
      if (msg?.type === "heartbeat") {
        lastHeartbeat.set(worker.id, Date.now());
      }
    });

    return worker;
  };

  for (let i = 0; i < workerCount; i++) {
    forkWorker();
  }

  const watchdog = setInterval(
    () => {
      const now = Date.now();

      for (const worker of Object.values(cluster.workers ?? {})) {
        if (!worker) continue;

        const last = lastHeartbeat.get(worker.id) ?? 0;
        if (now - last > o.noHeartbeatMs) {
          worker.kill("SIGKILL");
        }
      }
    },
    Math.min(o.heartbeatMs, 1000),
  );
  watchdog.unref();

  const onClusterExit = (worker: ClusterWorker) => {
    lastHeartbeat.delete(worker.id);

    if (shuttingDown) return;

    const now = Date.now();
    restartTimestamps.push(now);

    while (
      restartTimestamps.length &&
      now - restartTimestamps[0]! > o.catastrophicWindowMs
    ) {
      restartTimestamps.shift();
    }

    if (restartTimestamps.length >= o.catastrophicRestarts) {
      process.exit(1);
      return;
    }

    forkWorker();
  };

  cluster.on("exit", onClusterExit);

  const shutdownPrimary = () => {
    shuttingDown = true;
    clearInterval(watchdog);

    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.process.kill("SIGTERM");
    }

    setTimeout(() => {
      for (const worker of Object.values(cluster.workers ?? {})) {
        worker?.process.kill("SIGKILL");
      }
      process.exit(0);
    }, 5000).unref();
  };

  process.on("SIGTERM", shutdownPrimary);
  process.on("SIGINT", shutdownPrimary);

  return () => {
    // Test-oriented teardown: stops supervision timers and removes listeners
    // without sending signals to workers or calling process.exit().
    // In production, use shutdownPrimary() (triggered via SIGTERM/SIGINT).
    clearInterval(watchdog);
    cluster.removeListener("exit", onClusterExit);
    process.removeListener("SIGTERM", shutdownPrimary);
    process.removeListener("SIGINT", shutdownPrimary);
  };
}

async function runWorker(
  start: StartFn,
  o: ClusterNumericOptions,
  logger?: ILoggerService,
  cleanups?: Array<() => void>,
): Promise<void> {
  const log = logger ? withProcessLogger(logger) : undefined;
  const servers = new Set<NodeHttpServer>();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();

  let inflight = 0;
  let sockets = 0;
  let overloadedSince = 0;

  const registerServer = (server: NodeHttpServer) => {
    servers.add(server);

    server.requestTimeout = o.requestTimeoutMs;
    server.headersTimeout = o.headersTimeoutMs;
    server.keepAliveTimeout = o.keepAliveTimeoutMs;

    server.on("request", (_req, res) => {
      inflight += 1;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        inflight -= 1;
      };

      res.on("finish", finish);
      res.on("close", finish);
    });

    server.on("connection", (socket) => {
      sockets += 1;
      socket.on("close", () => {
        sockets -= 1;
      });
    });

    server.on("error", (err) => {
      log?.error("Server error, shutting down worker", {
        origin: "cluster.ts",
        trace_id: "UNDEFINED_TRACE_ID",
        context: {
          errorMessage: err instanceof Error ? err.message : String(err),
          errorStack: err instanceof Error ? err.stack : undefined,
          errorCode: (err as any)?.code,
        },
      });
      process.exit(1);
    });
  };

  await Promise.resolve(start(registerServer));

  const beat = setInterval(() => {
    const lagP99Ms = lag.percentile(99) / 1e6;

    process.send?.({
      type: "heartbeat",
      inflight,
      sockets,
      lagP99Ms,
    } satisfies WorkerHeartbeat);

    const overloaded = inflight > o.maxInflight && lagP99Ms > o.maxLagMs;

    if (overloaded) {
      if (!overloadedSince) overloadedSince = Date.now();
      if (Date.now() - overloadedSince >= o.overloadGraceMs) {
        process.exit(1);
      }
    } else {
      overloadedSince = 0;
    }

    lag.reset();
  }, o.heartbeatMs);
  beat.unref();

  const shutdownWorker = () => {
    clearInterval(beat);

    for (const server of servers) {
      try {
        server.close();
      } catch {
        // ignore
      }
    }

    setTimeout(() => process.exit(0), 5000).unref();
  };

  // Register a teardown function so callers (e.g. tests) can clean up the
  // interval, lag monitor, and signal listeners without triggering process.exit.
  cleanups?.push(() => {
    clearInterval(beat);
    lag.disable();
    process.removeListener("SIGTERM", shutdownWorker);
    process.removeListener("SIGINT", shutdownWorker);
  });

  process.on("SIGTERM", shutdownWorker);
  process.on("SIGINT", shutdownWorker);
}
