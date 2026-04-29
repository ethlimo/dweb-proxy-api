import { recordNamespaceToUrlHandlerMap } from "./const.js";
import { ILoggerService } from "dweb-api-types/logger";
import { arweaveUrlToSandboxSubdomain } from "./arweave.js";
import { IRequestContext } from "dweb-api-types/request-context";
import { IRecord } from "dweb-api-types/ens-resolver";
import { ProxyRecord } from "dweb-api-types/dweb-api-resolver";
import {
  IConfigurationArweave,
  IConfigurationEnsSocials,
  IConfigurationIpfs,
  IConfigurationSwarm,
} from "dweb-api-types/config";

export const ensureTrailingSlash = (path: string) => {
  if (path.endsWith("/")) {
    return path;
  } else {
    return path + "/";
  }
};

export const trimExtraneousTrailingSlashes = (path: string) => {
  return path.replace(/\/+$/, "/");
};

export const trimExtraneousLeadingSlashes = (path: string) => {
  return path.replace(/^\/+/, "/");
};

/**
 * Extracts an explicit port number from a URL string.
 * Only extracts from the authority section to avoid matching :<digits> in paths/query/fragments.
 * Supports both IPv6 ([host]:port) and regular (host:port) formats.
 *
 * @param urlString - The original URL string
 * @returns The port number as a string, or null if no explicit port is found
 */
export const extractExplicitPort = (urlString: string): string | null => {
  const authorityStart = urlString.indexOf("//");
  if (authorityStart === -1) {
    return null;
  }

  const afterSlashes = urlString.slice(authorityStart + 2);
  const authorityEndRel = afterSlashes.search(/[/?#]/);
  const authority =
    authorityEndRel === -1
      ? afterSlashes
      : afterSlashes.slice(0, authorityEndRel);

  // First, try IPv6-style [host]:port
  let portMatch = authority.match(/\]:(\d+)$/);
  if (!portMatch) {
    // Fallback to generic host:port
    portMatch = authority.match(/:(\d+)$/);
  }

  return portMatch ? portMatch[1] : null;
};

/**
 * Constructs a URL string from a URL object while preserving an explicit port.
 * This bypasses the WHATWG URL API's automatic normalization of default ports
 * (443 for HTTPS, 80 for HTTP). Also handles IPv6 literals and userinfo preservation.
 *
 * @param url - The URL object to convert to string
 * @param explicitPort - The port number to preserve (if null, uses url.toString())
 * @returns The URL string with the port preserved
 */
export const constructUrlWithPort = (
  url: URL,
  explicitPort: string | null,
): string => {
  if (!explicitPort) {
    return url.toString();
  }

  // Ensure IPv6 literals are correctly bracketed when combined with a port
  // url.hostname already includes brackets for IPv6 addresses, so use it as-is
  const hostForPort = url.hostname;

  // Preserve userinfo (username/password) to match URL.toString() behavior
  let userinfo = "";
  if (url.username) {
    userinfo = url.username;
    if (url.password) {
      userinfo += `:${url.password}`;
    }
    userinfo += "@";
  }

  return `${url.protocol}//${userinfo}${hostForPort}:${explicitPort}${url.pathname}${url.search}${url.hash}`;
};

export interface ProxyRecordUnableToRedirect {
  _tag: "ProxyRecordUnableToRedirect";
  record: IRecord;
}

export const recordToProxyRecord = async (
  request: IRequestContext,
  config: IConfigurationEnsSocials &
    IConfigurationIpfs &
    IConfigurationArweave &
    IConfigurationSwarm,
  logger: ILoggerService,
  record: NonNullable<IRecord>,
): Promise<
  ((IRecord & ProxyRecord) | ProxyRecordUnableToRedirect) & {
    overrideCodecHeader?: string;
  }
> => {
  const socialsEndpointConfig = config.getConfigEnsSocialsEndpoint();
  const ipfsConfig = config.getConfigIpfsBackend();
  const arweaveConfig = config.getConfigArweaveBackend();
  const swarmConfig = config.getConfigSwarmBackend();
  var path = "/";
  var overrideCodecHeader: string | undefined = undefined;
  if (record._tag === "ens-socials-redirect") {
    if (!socialsEndpointConfig.getEnsSocialsEndpoint) {
      return {
        _tag: "ProxyRecordUnableToRedirect",
        record: record,
      };
    }
    const redirectUrl = new URL(
      socialsEndpointConfig.getEnsSocialsEndpoint(record.ensName),
    );
    return {
      ...record,
      XContentLocation: redirectUrl.origin,
      XContentPath: ensureTrailingSlash(
        redirectUrl.pathname + redirectUrl.search,
      ),
    };
  } else if (record._tag === "Record") {
    if (record.codec === "ipfs-ns" || record.codec === "ipns-ns") {
      const url = new URL(ipfsConfig.getBackend());
      var path = "/";
      const urlSafeIpfsOrIpns = recordNamespaceToUrlHandlerMap[record.codec];
      if (ipfsConfig.getSubdomainSupport()) {
        let DoHContentIdentifier = record.DoHContentIdentifier;
        if (record.codec === "ipns-ns") {
          DoHContentIdentifier =
            normalizeUrlFragmentForIpfsSubdomainGateway(DoHContentIdentifier);
        }
        /*
          if the DoHContentIdentifier is less than 64 characters, it can not be encoded as a DNS fragment
          we must encode this in the proxy logic because the IPFS gateway will perform a DoH query
          the DoH query must not resolve to ensname-eth.ipns.gateway because that will cause a loop
        */
        const encodedEnsName = normalizeUrlFragmentForIpfsSubdomainGateway(
          record.ensName,
        );
        if (record.DoHContentIdentifier.length < 64) {
          url.host = `${DoHContentIdentifier}.${urlSafeIpfsOrIpns}.${url.host}`;
        } else if (encodedEnsName.length < 64) {
          url.host = `${encodedEnsName}.ipns.${url.host}`;
          overrideCodecHeader = "ipns-ns";
        } else {
          logger.error("IPNS name can not be encoded as a DNS fragment", {
            ...request,
            origin: "recordToProxyRecord",
            context: {
              record,
            },
          });
          throw new Error("IPNS name can not be encoded as a DNS fragment");
        }
      } else {
        path = `/${urlSafeIpfsOrIpns}/${record.DoHContentIdentifier}/`;
      }
      return {
        ...record,
        XContentLocation: url.toString(),
        XContentPath: path,
        overrideCodecHeader,
      };
    } else if (record.codec === "arweave-ns") {
      const backendString = arweaveConfig.getBackend();
      const backend = new URL(backendString);

      // Extract explicit port from the original backend string
      const explicitPort = extractExplicitPort(backendString);

      const resultUrl = await arweaveUrlToSandboxSubdomain(
        request,
        logger,
        record.DoHContentIdentifier,
        backend,
      );

      // Construct URL with port preservation
      // Note: We cannot use url.port = explicitPort because the URL API
      // automatically normalizes default ports (443 for https, 80 for http)
      const xContentLocation = constructUrlWithPort(resultUrl, explicitPort);

      return {
        ...record,
        XContentLocation: xContentLocation,
        XContentPath: ensureTrailingSlash("/" + record.DoHContentIdentifier),
      };
    } else if (record.codec === "swarm") {
      return {
        ...record,
        XContentLocation: swarmConfig.getBackend(),
        XContentPath: ensureTrailingSlash(
          "/bzz/" + record.DoHContentIdentifier,
        ),
      };
    }
    //record.codec should be never due to exhaustivity check
    return record.codec;
  } else if (record._tag === "DataUriRecord") {
    return {
      ...record,
      XContentLocation: record.uri,
      XContentPath: "/",
    };
  } else if (record._tag === "DataUrlRecord") {
    const encoding = Buffer.from(JSON.stringify(record.data)).toString(
      "base64url",
    );
    return {
      ...record,
      XContentLocation: encodeURIComponent(record.ensname),
      XContentPath: ensureTrailingSlash(`/${encoding}/`),
    };
  } else {
    //record should be never due to exhaustivity check
    return record;
  }
};
export function normalizeUrlFragmentForIpfsSubdomainGateway(
  DoHContentIdentifier: string,
): string {
  return [...DoHContentIdentifier]
    .map((c) => {
      if (c == ".") {
        return "-";
      } else if (c == "-") {
        return "--";
      } else {
        return c;
      }
    })
    .join("");
}
