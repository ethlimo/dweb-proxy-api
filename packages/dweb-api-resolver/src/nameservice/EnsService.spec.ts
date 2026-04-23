import { describe, it, before } from "mocha";
import { expect } from "chai";
import { EnsResolver, JsonRpcProvider } from "ethers";
import { createStubInstance } from "sinon";
import { LoggerService } from "dweb-api-logger/dist/index.js";
import { getEnsContentHash } from "./EnsService.js";

const RPC_URL =
  process.env.ETH_RPC_ENDPOINT ?? "https://ethereum.publicnode.com";

const NAME = "ur.integration-tests.eth";
const request = { trace_id: "TEST_TRACE_ID" };

describe("ENSv2 patch", function () {
  let provider: JsonRpcProvider;
  const logger = createStubInstance(LoggerService);

  before(function () {
    provider = new JsonRpcProvider(RPC_URL);
  });

  it("patches EnsResolver.fromName and preserves fromNameOld", function () {
    expect((EnsResolver as any).fromNameOld).to.be.a("function");
    expect(EnsResolver.fromName).to.not.equal((EnsResolver as any).fromNameOld);
  });

  it("resolves content hash via Universal Resolver (patched)", async function () {
    const contentHash = await getEnsContentHash(request, provider, logger, NAME);
    expect(contentHash).to.equal(
      "ipfs://Qmaisz6NMhDB51cCvNWa1GMS7LU1pAxdF4Ld6Ft9kZEP2a",
    );
  });

  it("returns null via unpatched resolver", async function () {
    const patched = EnsResolver.fromName;
    EnsResolver.fromName = (EnsResolver as any).fromNameOld;
    try {
      const contentHash = await getEnsContentHash(request, provider, logger, NAME);
      expect(contentHash).to.be.null;
    } finally {
      EnsResolver.fromName = patched;
    }
  });
});
