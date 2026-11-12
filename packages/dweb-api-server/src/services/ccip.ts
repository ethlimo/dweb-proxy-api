import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import {
  FetchRequest,
  assert,
  makeError,
  type AbstractProvider,
  type FallbackProvider,
  type FetchCancelSignal,
  type FetchGetUrlFunc,
  type GetUrlResponse,
} from "ethers";
import type { ILoggerService } from "dweb-api-types/logger";

// CCIP-read (EIP-3668) gateway urls come from the resolver contract, so
// anyone who controls a resolver decides where this server sends requests.
// Only allow https urls that point at public addresses, otherwise a
// resolver could make us call services on our own network.
//
// This lives in the server package on purpose: dweb-api-resolver is also
// bundled into the service worker, which runs in the browser and can't use
// node:dns / node:https. The server applies it to the providers after
// creating the name services (see dependencies/services.ts).

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

// Early check so we don't even try urls that can't work: the scheme and
// ip literals. Hostnames are only checked in publicOnlyLookup when the
// socket connects. Resolving them here as well would mean a second DNS
// lookup for every url, and one that isn't covered by the request
// deadline.
export function isAllowedCcipUrl(
  url: string,
  options: Pick<CcipFetchOptions, "isAllowedAddress" | "allowHttp"> = {},
): boolean {
  const isAllowedAddress = options.isAllowedAddress ?? isPublicAddress;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && options.allowHttp)
  ) {
    return false;
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
  return !isIP(host) || isAllowedAddress(host);
}

type DnsLookupAll = (
  hostname: string,
  callback: (err: Error | null, addresses: dns.LookupAddress[]) => void,
) => void;

const defaultLookupAll: DnsLookupAll = (hostname, callback) =>
  dns.lookup(hostname, { all: true, verbatim: true }, callback);

// Checking a hostname before the request isn't enough, it could resolve
// to a public address then and to a private one when we connect (DNS
// rebinding). This lookup is what the socket actually uses, so the
// address we connect to is the one that gets checked.
export function publicOnlyLookup(
  lookupAll: DnsLookupAll = defaultLookupAll,
  isAllowedAddress: (address: string) => boolean = isPublicAddress,
): LookupFunction {
  return (hostname, options, callback) => {
    lookupAll(hostname, (err, addresses) => {
      if (err) {
        callback(err, "", 0);
        return;
      }
      const family = options.family === 6 ? 6 : options.family === 4 ? 4 : 0;
      const usable = addresses.filter(
        (a) => family === 0 || a.family === family,
      );
      if (
        usable.length === 0 ||
        usable.some((a) => !isAllowedAddress(a.address))
      ) {
        callback(
          Object.assign(
            new Error(`refusing to connect to ${hostname}: not public`),
            { code: "ECONNREFUSED" },
          ),
          "",
          0,
        );
        return;
      }
      if (options.all) {
        (callback as any)(null, usable);
      } else {
        callback(null, usable[0].address, usable[0].family);
      }
    });
  };
}

export type CcipFetchOptions = {
  // total time for one gateway request, including redirects and retries
  timeoutMs: number;
  // largest response body we accept from a gateway
  maxResponseBytes: number;
  lookupAll?: DnsLookupAll;
  // only meant for tests, which can't easily run a public https server
  isAllowedAddress?: (address: string) => boolean;
  allowHttp?: boolean;
};

// a gateway that needs more hops than this is broken anyway
const MAX_CCIP_REDIRECTS = 5;

export const defaultCcipFetchOptions: CcipFetchOptions = {
  timeoutMs: 10_000,
  maxResponseBytes: 1024 * 1024,
};

// getUrl for ethers' FetchRequest used for CCIP gateway requests. Compared
// to the default one it only does https, checks the address at connect
// time, enforces a total deadline (the default only has a socket idle
// timeout, so a gateway sending a byte every few seconds never times out)
// and caps the response size.
//
// Redirects are followed here as well. If we returned a 301/302 to ethers
// it would follow it itself, but the request it creates for the new
// location uses the default getUrl, so a gateway could redirect us to an
// internal https host and skip every check above.
export function createCcipGetUrl(options: CcipFetchOptions): FetchGetUrlFunc {
  const isAllowedAddress = options.isAllowedAddress ?? isPublicAddress;
  const lookupFn = publicOnlyLookup(options.lookupAll, isAllowedAddress);

  const fetchOnce = (
    req: FetchRequest,
    href: string,
    expires: number,
    signal?: FetchCancelSignal,
  ) =>
    new Promise<GetUrlResponse>((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(href);
      } catch (e) {
        reject(e);
        return;
      }
      const insecure = url.protocol === "http:" && options.allowHttp;
      if (url.protocol !== "https:" && !insecure) {
        reject(
          makeError("CCIP gateway url must be https", "UNSUPPORTED_OPERATION"),
        );
        return;
      }
      const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
      // node skips the lookup function for ip literals
      if (isIP(host) && !isAllowedAddress(host)) {
        reject(
          makeError(
            `refusing to connect to ${host}: not public`,
            "UNSUPPORTED_OPERATION",
          ),
        );
        return;
      }

      const request = (insecure ? http : https).request(url, {
        method: req.method,
        headers: { ...req.headers },
        lookup: lookupFn,
      });
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        request.destroy();
        reject(error);
      };
      const deadline = setTimeout(
        () => fail(makeError("CCIP gateway request timeout", "TIMEOUT")),
        Math.max(expires - Date.now(), 0),
      );
      signal?.addListener(() =>
        fail(makeError("request cancelled", "CANCELLED")),
      );
      request.on("error", fail);
      request.on("response", (resp) => {
        const encoding = resp.headers["content-encoding"];
        if (encoding && encoding !== "identity") {
          fail(
            makeError(
              `unsupported content-encoding ${encoding}`,
              "UNSUPPORTED_OPERATION",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        resp.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxResponseBytes) {
            fail(
              makeError("CCIP gateway response too large", "BUFFER_OVERRUN"),
            );
            return;
          }
          chunks.push(chunk);
        });
        resp.on("error", fail);
        resp.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(resp.headers)) {
            headers[name] = Array.isArray(value)
              ? value.join(", ")
              : (value ?? "");
          }
          resolve({
            statusCode: resp.statusCode ?? 0,
            statusMessage: resp.statusMessage ?? "",
            headers,
            body: chunks.length ? new Uint8Array(Buffer.concat(chunks)) : null,
          });
        });
      });
      if (req.body) {
        request.write(Buffer.from(req.body));
      }
      request.end();
    });

  return async (req, signal) => {
    // one deadline for the request and all its redirects
    const expires = Date.now() + Math.min(req.timeout, options.timeoutMs);
    let href = req.url;
    for (let redirects = 0; ; redirects++) {
      const resp = await fetchOnce(req, href, expires, signal);
      const location = resp.headers["location"];
      // Same cases ethers follows. Anything else, including a redirect
      // for a POST, goes back to ethers, which doesn't follow those.
      if (
        (resp.statusCode !== 301 && resp.statusCode !== 302) ||
        req.method !== "GET" ||
        !location
      ) {
        return resp;
      }
      if (redirects >= MAX_CCIP_REDIRECTS) {
        throw makeError(
          "too many CCIP gateway redirects",
          "UNSUPPORTED_OPERATION",
        );
      }
      href = new URL(location, href).href;
    }
  };
}

// Replaces provider.ccipReadFetch with the same logic as ethers (EIP-3668:
// try the urls in order, 4xx stops, 5xx tries the next one) but only for
// allowed urls and with the getUrl above.
export function restrictCcipRead(
  provider: AbstractProvider,
  logger: ILoggerService,
  options: CcipFetchOptions = defaultCcipFetchOptions,
) {
  const getUrl = createCcipGetUrl(options);
  provider.ccipReadFetch = async (tx, calldata, urls) => {
    if (provider.disableCcipRead || urls.length === 0 || tx.to == null) {
      return null;
    }
    const sender = tx.to.toLowerCase();
    const data = calldata.toLowerCase();
    const errorMessages: string[] = [];

    for (const url of urls) {
      if (!isAllowedCcipUrl(url, options)) {
        logger.info("ignoring CCIP-read url that is not public https", {
          trace_id: "UNDEFINED_TRACE_ID",
          origin: "restrictCcipRead",
          context: { url, to: tx.to },
        });
        continue;
      }

      const href = url.replace("{sender}", sender).replace("{data}", data);
      const request = new FetchRequest(href);
      request.getUrlFunc = getUrl;
      request.timeout = options.timeoutMs;
      request.allowGzip = false;
      if (url.indexOf("{data}") === -1) {
        request.body = { data, sender };
      }

      let resp;
      try {
        resp = await request.send();
      } catch (error: any) {
        // connection problems, timeouts, refused addresses: try the next url
        errorMessages.push(error?.message ?? String(error));
        continue;
      }

      let errorMessage = "unknown error";
      try {
        const result = resp.bodyJson;
        if (result.data) {
          return result.data;
        }
        if (result.message) {
          errorMessage = result.message;
        }
      } catch {
        // not json, handled by the status checks below
      }
      // 4xx means the gateway doesn't have it, don't try the others
      assert(
        resp.statusCode < 400 || resp.statusCode >= 500,
        `response not found during CCIP fetch: ${errorMessage}`,
        "OFFCHAIN_FAULT",
        {
          reason: "404_MISSING_RESOURCE",
          transaction: tx,
          info: { url, errorMessage },
        },
      );
      errorMessages.push(errorMessage);
    }

    if (errorMessages.length === 0) {
      // every url was filtered out
      return null;
    }
    assert(
      false,
      `error encountered during CCIP fetch: ${errorMessages
        .map((m) => JSON.stringify(m))
        .join(", ")}`,
      "OFFCHAIN_FAULT",
      {
        reason: "500_SERVER_ERROR",
        transaction: tx,
        info: { urls, errorMessages },
      },
    );
  };
  return provider;
}

// The fallback provider and the providers behind it can each end up doing
// the CCIP-read request, so restrict all of them.
export function restrictFallbackProviderCcipRead(
  provider: FallbackProvider,
  logger: ILoggerService,
  options: CcipFetchOptions = defaultCcipFetchOptions,
) {
  restrictCcipRead(provider, logger, options);
  for (const config of provider.providerConfigs) {
    restrictCcipRead(config.provider, logger, options);
  }
  return provider;
}
