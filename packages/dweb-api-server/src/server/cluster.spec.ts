import { describe, it, before, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import cluster from "node:cluster";
import { runClustered } from "./cluster.js";
import {
  TestConfigurationService,
  parsePositiveInt,
} from "../configuration/index.js";
import { Server } from "./index.js";
import { DataUrlProxy } from "./DataUrlProxy.js";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager.js";
import type { Server as NodeHttpServer } from "http";

describe("parsePositiveInt", function () {
  it("returns the parsed value for a valid positive integer string", function () {
    expect(parsePositiveInt("4", 1)).to.equal(4);
    expect(parsePositiveInt("300", 100)).to.equal(300);
  });

  it("returns the fallback for undefined (missing env var)", function () {
    expect(parsePositiveInt(undefined, 42)).to.equal(42);
  });

  it("returns the fallback for an empty string", function () {
    expect(parsePositiveInt("", 42)).to.equal(42);
  });

  it("returns the fallback for a non-numeric string", function () {
    expect(parsePositiveInt("abc", 10)).to.equal(10);
    expect(parsePositiveInt("not-a-number", 5)).to.equal(5);
  });

  it("returns the fallback for zero", function () {
    expect(parsePositiveInt("0", 8)).to.equal(8);
  });

  it("returns the fallback for negative values", function () {
    expect(parsePositiveInt("-1", 8)).to.equal(8);
    expect(parsePositiveInt("-100", 8)).to.equal(8);
  });

  it("returns the fallback for floating-point strings that truncate to 0", function () {
    expect(parsePositiveInt("0.9", 7)).to.equal(7);
  });

  it("accepts floating-point strings that truncate to a positive integer", function () {
    // parseInt("2.9") === 2, which is >= 1
    expect(parsePositiveInt("2.9", 7)).to.equal(2);
  });
});

describe("cluster startup", function () {
  const openServers: NodeHttpServer[] = [];

  afterEach(function (done) {
    let pending = openServers.length;
    if (pending === 0) return done();
    for (const server of openServers.splice(0)) {
      server.close(() => {
        pending--;
        if (pending === 0) done();
      });
    }
  });

  describe("cluster config plumbing", function () {
    it("getClusterConfig() returns a well-formed config with numeric values", function () {
      const config = new TestConfigurationService();
      const clusterConfig = config.getClusterConfig();

      expect(clusterConfig.getWorkers()).to.be.a("number");
      expect(clusterConfig.getMaxInflight()).to.be.a("number");
      expect(clusterConfig.getMaxLagMs()).to.be.a("number");
      expect(clusterConfig.getOverloadGraceMs()).to.be.a("number");
      expect(clusterConfig.getNoHeartbeatMs()).to.be.a("number");
      expect(clusterConfig.getCatastrophicRestarts()).to.be.a("number");
      expect(clusterConfig.getCatastrophicWindowMs()).to.be.a("number");
      // Sanity-check that the values are positive
      expect(clusterConfig.getMaxInflight()).to.be.greaterThan(0);
      expect(clusterConfig.getNoHeartbeatMs()).to.be.greaterThan(0);
    });

    it("getClusterConfig() reflects custom values set via TestConfigurationService.set()", function () {
      const config = new TestConfigurationService();
      config.set((c) => {
        c.cluster.workers = 8;
        c.cluster.maxInflight = 42;
        c.cluster.maxLagMs = 500;
        c.cluster.overloadGraceMs = 12000;
        c.cluster.noHeartbeatMs = 9999;
        c.cluster.catastrophicRestarts = 5;
        c.cluster.catastrophicWindowMs = 60000;
      });
      const clusterConfig = config.getClusterConfig();

      expect(clusterConfig.getWorkers()).to.equal(8);
      expect(clusterConfig.getMaxInflight()).to.equal(42);
      expect(clusterConfig.getMaxLagMs()).to.equal(500);
      expect(clusterConfig.getOverloadGraceMs()).to.equal(12000);
      expect(clusterConfig.getNoHeartbeatMs()).to.equal(9999);
      expect(clusterConfig.getCatastrophicRestarts()).to.equal(5);
      expect(clusterConfig.getCatastrophicWindowMs()).to.equal(60000);
    });
  });

  describe("runClustered in the primary process", function () {
    let originalSigintListeners: Function[] | undefined;
    let originalSigtermListeners: Function[] | undefined;
    let originalClusterExitListeners: Function[] | undefined;
    let sandbox: sinon.SinonSandbox;
    let clusterCleanup: (() => void) | undefined;

    before(function () {
      // Cluster workers inherit the mocha process; skip these tests when
      // running inside a worker to prevent recursive cluster-fork loops.
      if (!cluster.isPrimary) {
        this.skip();
        return;
      }

      // Snapshot existing listeners so we can restore them after each test.
      originalSigintListeners = process.listeners("SIGINT");
      originalSigtermListeners = process.listeners("SIGTERM");
      originalClusterExitListeners = cluster.listeners("exit");
    });

    beforeEach(function () {
      if (!cluster.isPrimary) return;

      sandbox = sinon.createSandbox();
      clusterCleanup = undefined;

      // Stub cluster.fork so tests that use workers > 1 never spawn real
      // child processes.  A real fork would re-run the mocha entrypoint
      // (and potentially the full test suite) in every worker, making the
      // suite slow/flaky.  The fake worker satisfies every property that
      // runClustered's primary-process code accesses.
      let nextId = 1;
      sandbox.stub(cluster, "fork").callsFake(() => {
        const id = nextId++;
        return {
          id,
          on: sinon.stub().returnsThis(),
          kill: sinon.stub(),
          disconnect: sinon.stub(),
          removeAllListeners: sinon.stub(),
          process: { kill: sinon.stub() },
        } as unknown as ReturnType<typeof cluster.fork>;
      });
    });

    afterEach(async function () {
      if (!cluster.isPrimary) return;

      // Flush pending microtasks so that runWorker's async setup (beat
      // interval, lag monitor, process listeners) has a chance to register
      // its cleanup callbacks before we invoke them.  runWorker's only async
      // boundary is `await Promise.resolve(start(registerServer))`, which
      // resolves in a single microtask tick; setImmediate fires after all
      // pending microtasks are drained, so cleanups are guaranteed to be
      // populated by the time the callback runs.
      await new Promise<void>((resolve) => setImmediate(resolve));

      clusterCleanup?.();
      clusterCleanup = undefined;

      // Restore all sinon stubs (including the cluster.fork stub).
      sandbox?.restore();

      // Restore original signal and cluster listeners to avoid leaks.
      if (originalSigintListeners) {
        process.removeAllListeners("SIGINT");
        for (const listener of originalSigintListeners) {
          process.on("SIGINT", listener as any);
        }
      }

      if (originalSigtermListeners) {
        process.removeAllListeners("SIGTERM");
        for (const listener of originalSigtermListeners) {
          process.on("SIGTERM", listener as any);
        }
      }

      if (originalClusterExitListeners) {
        cluster.removeAllListeners("exit");
        for (const listener of originalClusterExitListeners) {
          cluster.on("exit", listener as any);
        }
      }
    });

    it("falls back to non-clustered mode and calls start() when workers is 0", function () {
      // start() is called synchronously inside runWorker (before the first
      // await), so we can assert this without a done() callback.
      let startCalled = false;
      clusterCleanup = runClustered((_registerServer) => {
        startCalled = true;
      }, { workers: 0 });
      expect(startCalled).to.be.true;
    });

    it("falls back to non-clustered mode and calls start() when workers is NaN", function () {
      let startCalled = false;
      clusterCleanup = runClustered((_registerServer) => {
        startCalled = true;
      }, { workers: NaN });
      expect(startCalled).to.be.true;
    });

    it("falls back to non-clustered mode and calls start() when workers is negative", function () {
      let startCalled = false;
      clusterCleanup = runClustered((_registerServer) => {
        startCalled = true;
      }, { workers: -5 });
      expect(startCalled).to.be.true;
    });

    it("runs in non-clustered mode (calls start()) when workers is 1", function () {
      let startCalled = false;
      clusterCleanup = runClustered((_registerServer) => {
        startCalled = true;
      }, { workers: 1 });
      expect(startCalled).to.be.true;
    });

    it("does not invoke start() (primary forks workers instead)", function () {
      let startCalled = false;
      clusterCleanup = runClustered(() => {
        startCalled = true;
      }, { workers: 2 });
      // In the primary process start() is never called — workers are forked instead.
      expect(startCalled).to.be.false;
      expect((cluster.fork as sinon.SinonStub).callCount).to.equal(2);
    });

    it("accepts custom options without throwing", function () {
      expect(() => {
        clusterCleanup = runClustered(() => {}, {
          workers: 2,
          maxInflight: 100,
          maxLagMs: 500,
        });
      }).to.not.throw();
      expect((cluster.fork as sinon.SinonStub).callCount).to.equal(2);
    });
  });

  describe("registerServer is invoked for each listener", function () {
    async function buildDevServices() {
      const svcBindings =
        await createApplicationConfigurationBindingsManager();
      const env = EnvironmentConfiguration.Development;
      const [
        config,
        logger,
        domainQuery,
        ensResolver,
        arweaveResolver,
        dnsQuery,
        domainRateLimit,
        hostnameSubstitution,
      ] = await Promise.all([
        svcBindings.configuration.getBinding(env),
        svcBindings.logger.getBinding(env),
        svcBindings.domainQuery.getBinding(env),
        svcBindings.ensResolver.getBinding(env),
        svcBindings.arweaveResolver.getBinding(env),
        svcBindings.dnsQuery.getBinding(env),
        svcBindings.domainRateLimit.getBinding(env),
        svcBindings.hostnameSubstitution.getBinding(env),
      ]);
      return {
        config: config as TestConfigurationService,
        logger,
        domainQuery,
        ensResolver,
        arweaveResolver,
        dnsQuery,
        domainRateLimit,
        hostnameSubstitution,
      };
    }

    it("DataUrlProxy.start() calls registerServer exactly once", async function () {
      const svc = await buildDevServices();
      // Port 0 lets the OS assign a free port, avoiding conflicts
      svc.config.set((c) => {
        c.dataurl.server.port = 0;
      });

      const dataUrlProxy = new DataUrlProxy(
        svc.config,
        svc.logger,
        svc.domainQuery,
        svc.ensResolver,
        svc.arweaveResolver,
        svc.dnsQuery,
        svc.domainRateLimit,
        svc.hostnameSubstitution,
        null,
      );

      const registered: NodeHttpServer[] = [];
      dataUrlProxy.start((server) => {
        registered.push(server);
        openServers.push(server);
      });

      expect(registered).to.have.length(1);
    });

    it("Server.start() calls registerServer once when dnsquery and ask are disabled", async function () {
      const svc = await buildDevServices();
      svc.config.set((c) => {
        c.router.listen = 0;
        c.dnsquery.enabled = false;
        c.ask.enabled = "false";
      });

      const server = new Server(
        svc.config,
        svc.logger,
        svc.domainQuery,
        svc.ensResolver,
        svc.arweaveResolver,
        svc.dnsQuery,
        svc.domainRateLimit,
        svc.hostnameSubstitution,
        null,
      );

      const registered: NodeHttpServer[] = [];
      server.start((s) => {
        registered.push(s);
        openServers.push(s);
      });

      expect(registered).to.have.length(1);
    });

    it("Server.start() calls registerServer for each enabled listener", async function () {
      const svc = await buildDevServices();
      svc.config.set((c) => {
        c.router.listen = 0;
        c.dnsquery.enabled = true;
        c.dnsquery.listen = 0;
        c.ask.enabled = "true";
        c.ask.listen = 0;
      });

      const server = new Server(
        svc.config,
        svc.logger,
        svc.domainQuery,
        svc.ensResolver,
        svc.arweaveResolver,
        svc.dnsQuery,
        svc.domainRateLimit,
        svc.hostnameSubstitution,
        null,
      );

      const registered: NodeHttpServer[] = [];
      server.start((s) => {
        registered.push(s);
        openServers.push(s);
      });

      // proxy + dnsquery + ask = 3 listeners
      expect(registered).to.have.length(3);
    });
  });
});
