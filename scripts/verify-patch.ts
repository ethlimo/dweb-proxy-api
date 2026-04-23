/**
 * Verifies ENSv2 patch behavior by comparing patched vs unpatched resolution
 * of ur.integration-tests.eth.
 *
 * The patch exposes resolveName(name, "old") to call the original unpatched
 * implementation, so both paths can be tested on the same provider instance.
 *
 * Expected:
 *   before patch (unpatched): 0x1111111111111111111111111111111111111111
 *   after patch  (patched):   0x2222222222222222222222222222222222222222
 *
 * Usage: npx tsx scripts/verify-patch.ts <RPC_URL>
 */

import "@ensdomains/ethers-patch-v6";
import { JsonRpcProvider, EnsResolver } from "ethers";

const RPC_URL = process.argv[2];
if (!RPC_URL) {
  console.error("Usage: npx tsx scripts/verify-patch.ts <RPC_URL>");
  process.exit(1);
}

const NAME = "ur.integration-tests.eth";
const BEFORE = "0x1111111111111111111111111111111111111111";
const AFTER  = "0x2222222222222222222222222222222222222222";

const provider = new JsonRpcProvider(RPC_URL);

async function resolveViaOldResolver(name: string): Promise<string | null> {
  // EnsResolver.fromNameOld is the pre-patch fromName — uses the ENS registry
  // directly instead of the new UniversalResolver proxy.
  const resolver = await (EnsResolver as any).fromNameOld(provider, name);
  if (!resolver) return null;
  return resolver.getAddress();
}

async function main() {
  console.log(`Resolving: ${NAME}\n`);

  // Unpatched path — EnsResolver.fromNameOld uses the old ENS registry lookup
  const before = await resolveViaOldResolver(NAME);
  const beforePass = before?.toLowerCase() === BEFORE.toLowerCase();
  console.log(`BEFORE (unpatched, EnsResolver.fromNameOld): ${before}`);
  console.log(`  expected: ${BEFORE}  ${beforePass ? "✓ PASS" : "✗ FAIL"}\n`);

  // Patched path — provider.resolveName uses the new Universal Resolver proxy
  const after = await provider.resolveName(NAME);
  const afterPass = after?.toLowerCase() === AFTER.toLowerCase();
  console.log(`AFTER  (patched,   provider.resolveName):    ${after}`);
  console.log(`  expected: ${AFTER}  ${afterPass ? "✓ PASS" : "✗ FAIL"}\n`);

  const ok = beforePass && afterPass;
  console.log(ok ? "✓ Patch verified" : "✗ Verification failed");
  process.exit(ok ? 0 : 1);
}

main();
