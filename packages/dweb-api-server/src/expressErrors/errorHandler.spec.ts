import { describe, it } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { errorHandler } from "./index.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;

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

describe("errorHandler", function () {
  it("doesn't send error details to the client", async function () {
    const app = express();
    // force the mode where express would normally print the stack trace
    app.set("env", "development");
    app.get("/throws", async () => {
      throw new Error("something internal at /some/secret/path.ts");
    });
    app.use(errorHandler(logger, "test"));

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.on("listening", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const { status, body } = await get(port, "/throws");
      expect(status).to.equal(500);
      expect(body).to.not.contain("something internal");
      expect(body).to.not.contain("/some/secret/path.ts");
      expect(body).to.not.contain("errorHandler.spec");
    } finally {
      server.close();
    }
  });
});
