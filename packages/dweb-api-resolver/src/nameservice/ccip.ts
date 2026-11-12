import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { AbstractProvider } from "ethers";
import type { ILoggerService } from "dweb-api-types/logger";

// CCIP-read (EIP-3668) gateway urls come from the resolver contract, so
// anyone who controls a resolver decides where this server sends requests.
// Only allow https urls that point at public addresses, otherwise a
// resolver could make us call services on our own network.

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  // nat64, blocked as a whole instead of unpacking it
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !blocked.check(address, "ipv4");
  }
  if (family === 6) {
    // ipv4-mapped (::ffff:a.b.c.d). Not added to the BlockList because node
    // matches plain ipv4 addresses against that range too.
    if (address.toLowerCase().startsWith("::ffff:")) {
      return false;
    }
    return !blocked.check(address, "ipv6");
  }
  return false;
}

export async function isAllowedCcipUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(host)) {
    return isPublicAddress(host);
  }
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return (
      addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address))
    );
  } catch {
    return false;
  }
}

// Wraps provider.ccipReadFetch so that only allowed gateway urls are used.
// If none are left ethers treats it as a failed lookup.
export function restrictCcipRead(
  provider: AbstractProvider,
  logger: ILoggerService,
) {
  const original = provider.ccipReadFetch.bind(provider);
  provider.ccipReadFetch = async (tx, calldata, urls) => {
    const allowed: string[] = [];
    for (const url of urls) {
      if (await isAllowedCcipUrl(url)) {
        allowed.push(url);
      } else {
        logger.info("ignoring CCIP-read url that is not public https", {
          trace_id: "UNDEFINED_TRACE_ID",
          origin: "restrictCcipRead",
          context: {
            url,
            to: tx.to,
          },
        });
      }
    }
    return original(tx, calldata, allowed);
  };
  return provider;
}
