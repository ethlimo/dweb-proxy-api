import { describe, it } from "mocha";
import { expect } from "chai";
import { Web3NameSdkService } from "../../src/nameservice/Web3NameSdkService.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;
const config = {
  getConfigEthereumBackend: () => ({
    getBackend: () => "https://eth.example",
    getChainId: () => 1,
  }),
  getConfigGnosisBackend: () => ({ getBackend: () => "https://gno.example" }),
} as any;

describe("Web3NameSdkService", () => {
  it("runs the SDK lookup through the wrapper with both rpc endpoints", async () => {
    const seen: string[][] = [];
    const service = new Web3NameSdkService(config, logger, (endpoints, fn) => {
      seen.push(endpoints);
      return fn();
    });
    let sdkCalled = false;
    service._web3name = {
      getContentHash: async () => {
        sdkCalled = true;
        return undefined;
      },
    } as any;

    expect(await service.getContentHash({ trace_id: "t" }, "x.gno")).to.equal(
      null,
    );
    expect(sdkCalled).to.equal(true);
    expect(seen).to.deep.equal([
      ["https://eth.example", "https://gno.example"],
    ]);
  });
});
