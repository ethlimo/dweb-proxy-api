import { describe, it } from "mocha";
import { expect } from "chai";
import { ArweaveResolver } from "../../src/resolver/arweave.js";

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop } as any;
const request = { trace_id: "TEST_TRACE_ID" };

// stands in for warp, records what the resolver asked for
const fakeWarp = (records: Record<string, { transactionId: string }>) => {
  const calls: { txId: string; options: any }[] = [];
  return {
    calls,
    warp: {
      pst: (txId: string) => {
        const call = { txId, options: null as any };
        calls.push(call);
        const contract = {
          setEvaluationOptions: (options: any) => {
            call.options = options;
            return contract;
          },
          readState: async () => ({ cachedValue: { state: { records } } }),
        };
        return contract;
      },
    },
  };
};

describe("ArweaveResolver", () => {
  it("doesn't evaluate any contract without a source whitelist", async () => {
    const resolver = new ArweaveResolver(logger);
    const fake = fakeWarp({ "@": { transactionId: "resolved" } });
    resolver._warp = fake.warp as any;

    const result = await resolver.resolveArweave(request, "antTxId", "x.eth");

    expect(result).to.equal("antTxId");
    expect(fake.calls).to.have.length(0);
  });

  it("only evaluates whitelisted contract sources", async () => {
    const resolver = new ArweaveResolver(logger, ["knownAntSource"]);
    const fake = fakeWarp({ "@": { transactionId: "resolved" } });
    resolver._warp = fake.warp as any;

    const result = await resolver.resolveArweave(request, "antTxId", "x.eth");

    expect(result).to.equal("resolved");
    expect(fake.calls).to.have.length(1);
    expect(fake.calls[0].options).to.deep.equal({
      whitelistSources: ["knownAntSource"],
    });
  });

  it("doesn't create a warp instance unless it is needed", () => {
    const resolver = new ArweaveResolver(logger);
    expect(resolver._warp).to.equal(null);
  });
});
