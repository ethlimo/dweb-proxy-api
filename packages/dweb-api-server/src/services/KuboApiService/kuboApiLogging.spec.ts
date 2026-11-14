import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ILoggerServiceContext } from "dweb-api-types/logger";
import { KuboApiService } from "./index.js";

const AUTH = "a3VibzpzZWNyZXQtYXV0aA==";
const URL_PASSWORD = "url-secret";
const IPNS_NAME =
  "ipns://k51qzi5uqu5dipklqpo2uq7advlajxx5wxob0mwyqbxb5zu4htblc4bjipy834";

// Keeps every log call and renders it the way winston's json format would
// see it: all enumerable fields, nested objects included, cycles skipped.
class RecordingLogger {
  entries: { level: string; message: string; context: unknown }[] = [];

  private record(level: string) {
    return (message: string, context: ILoggerServiceContext) => {
      this.entries.push({ level, message, context: context.context });
    };
  }

  debug = this.record("debug");
  info = this.record("info");
  warn = this.record("warn");
  error = this.record("error");

  text() {
    const seen = new WeakSet<object>();
    return JSON.stringify(this.entries, (_key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    });
  }
}

let kubo: http.Server | null = null;

const startKubo = async (handler: http.RequestListener) => {
  kubo = http.createServer(handler).listen(0, "127.0.0.1");
  await new Promise((resolve) => kubo!.once("listening", resolve));
  return (kubo.address() as AddressInfo).port;
};

const kuboService = (logger: RecordingLogger, port: number, timeoutMs = 2000) =>
  new KuboApiService(logger, {
    getKuboConfiguration: () => ({
      getKuboApiUrl: () =>
        new URL(`http://kubo:${URL_PASSWORD}@127.0.0.1:${port}/`),
      getKuboAuth: () => AUTH,
      getKuboTimeoutMs: () => timeoutMs,
    }),
  });

describe("KuboApiService logging", function () {
  afterEach(function () {
    kubo?.closeAllConnections();
    kubo?.close();
    kubo = null;
  });

  it("logs the configured endpoint without its credentials", async function () {
    const logger = new RecordingLogger();
    const port = await startKubo((_req, res) => res.end());
    kuboService(logger, port);

    expect(logger.text()).to.include(`127.0.0.1:${port}`);
    expect(logger.text()).to.not.include(URL_PASSWORD);
  });

  it("logs a failed resolve by status and message, without the request", async function () {
    const logger = new RecordingLogger();
    const port = await startKubo((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ Message: "could not resolve name", Code: 0 }));
    });

    const result = await kuboService(logger, port).resolveIpnsName(
      { trace_id: "TEST_TRACE_ID" },
      IPNS_NAME,
    );

    expect(result).to.equal(null);
    const failure = logger.entries.find(
      (e) => e.message === "Failed to resolve IPNS name",
    );
    expect(failure?.context).to.deep.include({
      status: 500,
      message: "could not resolve name",
    });
    expect(logger.text()).to.not.include(AUTH);
    expect(logger.text()).to.not.include(URL_PASSWORD);
  });

  it("doesn't log credentials when kubo doesn't answer in time", async function () {
    const logger = new RecordingLogger();
    const port = await startKubo(() => {});

    const result = await kuboService(logger, port, 200).resolveIpnsName(
      { trace_id: "TEST_TRACE_ID" },
      IPNS_NAME,
    );

    expect(result).to.equal(null);
    expect(logger.text()).to.not.include(AUTH);
    expect(logger.text()).to.not.include(URL_PASSWORD);
  });
});
