import "@ensdomains/ethers-patch-v6";
import { describe, it, before } from "mocha";
import { expect } from "chai";
import { EnsResolver, JsonRpcProvider } from "ethers";

const RPC_URL =
  process.env.ETH_RPC_ENDPOINT ?? "https://ethereum.publicnode.com";

describe("ENSv2 patch", function () {
  let provider: JsonRpcProvider;

  before(function () {
    provider = new JsonRpcProvider(RPC_URL);
  });

  it("patches EnsResolver.fromName and preserves fromNameOld", function () {
    expect((EnsResolver as any).fromNameOld).to.be.a("function");
    expect(EnsResolver.fromName).to.not.equal((EnsResolver as any).fromNameOld);
  });

  it("resolves ur.integration-tests.eth to 0x2222 via Universal Resolver", async function () {
    const address = await provider.resolveName("ur.integration-tests.eth");
    expect(address?.toLowerCase()).to.equal(
      "0x2222222222222222222222222222222222222222",
    );
  });

  it("resolves ur.integration-tests.eth to 0x1111 via unpatched resolver", async function () {
    const resolver = await (EnsResolver as any).fromNameOld(
      provider,
      "ur.integration-tests.eth",
    );
    const address = await resolver?.getAddress();
    expect(address?.toLowerCase()).to.equal(
      "0x1111111111111111111111111111111111111111",
    );
  });

});
