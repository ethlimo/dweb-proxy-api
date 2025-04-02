import { recordNamespaceToUrlHandlerMap } from "./const.js";
import { ILoggerService } from "dweb-api-types/dist/logger.js";
import { arweaveUrlToSandboxSubdomain } from "./arweave.js";
import { IRequestContext } from "dweb-api-types/dist/request-context.js";
import { IRecord } from "dweb-api-types/dist/ens-resolver.js";
import { ProxyRecord } from "dweb-api-types/dist/dweb-api-resolver.js";
import {
  IConfigurationArweave,
  IConfigurationEnsSocials,
  IConfigurationIpfs,
  IConfigurationSwarm,
} from "dweb-api-types/dist/config.js";

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
      const backend = new URL(arweaveConfig.getBackend());
      return {
        ...record,
        XContentLocation: (
          await arweaveUrlToSandboxSubdomain(
            request,
            logger,
            record.DoHContentIdentifier,
            backend,
          )
        ).toString(),
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
