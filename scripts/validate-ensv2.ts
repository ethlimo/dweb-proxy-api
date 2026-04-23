/**
 * ENSv2 Readiness Validation Script
 * https://docs.ens.domains/web/ensv2-readiness
 *
 * Tests:
 * 1. Universal Resolver - ur.integration-tests.eth should return 0x2222...2222
 * 2. CCIP Read            - test.offchaindemo.eth should return 0x779981590E7Ccc0CFAe8040Ce7151324747cDb97
 *
 * Usage: npx tsx scripts/validate-ensv2.ts <RPC_URL>
 *   e.g. npx tsx scripts/validate-ensv2.ts https://eth.llamarpc.com
 */

import "@ensdomains/ethers-patch-v6";
import { JsonRpcProvider } from "ethers";

const RPC_URL = process.argv[2];
if (!RPC_URL) {
  console.error("Usage: npx tsx scripts/validate-ensv2.ts <RPC_URL>");
  process.exit(1);
}

const provider = new JsonRpcProvider(RPC_URL);

async function check(label: string, name: string, expected: string) {
  process.stdout.write(`[${label}] Resolving ${name} ... `);
  try {
    const address = await provider.resolveName(name);
    if (address?.toLowerCase() === expected.toLowerCase()) {
      console.log(`PASS (${address})`);
      return true;
    } else {
      console.log(`FAIL — got ${address ?? "null"}, expected ${expected}`);
      return false;
    }
  } catch (err) {
    console.log(`ERROR — ${err}`);
    return false;
  }
}

const results = await Promise.all([
  check(
    "Universal Resolver",
    "ur.integration-tests.eth",
    "0x2222222222222222222222222222222222222222",
  ),
  check(
    "CCIP Read",
    "test.offchaindemo.eth",
    "0x779981590E7Ccc0CFAe8040Ce7151324747cDb97",
  ),
]);

const allPassed = results.every(Boolean);
console.log(`\n${allPassed ? "✓ All ENSv2 checks passed" : "✗ Some checks failed"}`);
process.exit(allPassed ? 0 : 1);
