import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DomainQuerySuperagentService } from "./index.js";

describe("DomainQuerySuperagentService", function () {
  let server: http.Server;
  let endpoint: string;

  before(function (done) {
    // accepts the connection but never answers
    server = http.createServer(() => {});
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      endpoint = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after(function () {
    server.closeAllConnections();
    server.close();
  });

  it("gives up when the domains api doesn't respond", async function () {
    const service = new DomainQuerySuperagentService({
      getDomainQueryConfig: () => ({
        getDomainsApiEndpoint: () => endpoint,
        getMaxHops: () => 5,
        getTimeoutMs: () => 200,
      }),
    });

    let caught: any = null;
    try {
      await service.query("hanging.eth");
    } catch (e) {
      caught = e;
    }

    expect(caught).to.not.equal(null);
    expect(caught.timeout).to.equal(200);
  });
});
