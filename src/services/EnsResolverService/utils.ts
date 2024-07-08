import { ProxyRecord, Record } from ".";
import { recordNamespaceToUrlHandlerMap } from "./const";
import { ensureTrailingSlash } from "../../utils";
import { IConfigurationService } from "../../configuration";
import { ILoggerService } from "../LoggerService";
import { arweaveUrlToSandboxSubdomain } from "./arweave";
import { IRequestContext } from "../lib";
export const recordToProxyRecord = async (
  request: IRequestContext,
  configurationSvc: IConfigurationService,
  logger: ILoggerService,
  record: NonNullable<Record>
): Promise<Record & ProxyRecord> => {
  const configuration = configurationSvc.get();
  var path = "/";
  if (record._tag === "ens-socials-redirect") {
    const redirectUrl = new URL(
      configuration.ens.socialsEndpoint(record.ensName),
    );
    return {
      ...record,
      XContentLocation: redirectUrl.origin,
      XContentPath: ensureTrailingSlash(redirectUrl.pathname + redirectUrl.search),
    };
  } else if (record._tag === "Record") {
    if (record.codec === "ipfs-ns" || record.codec === "ipns-ns") {
      const url = new URL(configuration.ipfs.backend);
      const urlSafeIpfsOrIpns = recordNamespaceToUrlHandlerMap[record.codec];
      var path = "/";
      if (configuration.ipfs.subdomainSupport) {

        let DoHContentIdentifier = record.DoHContentIdentifier;
        if(record.codec === "ipns-ns") {
          DoHContentIdentifier = normalizeUrlFragmentForIpfsSubdomainGateway(DoHContentIdentifier);
        }
        url.host = `${DoHContentIdentifier}.${urlSafeIpfsOrIpns}.${url.host}`;
      } else {
        path = `/${urlSafeIpfsOrIpns}/${record.DoHContentIdentifier}/`;
      }
      return {
        ...record,
        XContentLocation: url.toString(),
        XContentPath: path,
      };
    } else if (record.codec === "arweave-ns") {
      const backend = new URL(configuration.arweave.backend);
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
        XContentLocation: configuration.swarm.backend,
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
export function normalizeUrlFragmentForIpfsSubdomainGateway(DoHContentIdentifier: string): string {
  return [...DoHContentIdentifier].map((c) => {
    if(c == '.') {
      return '-';
    } else if(c == '-') {
      return '--';
    } else {
      return c;
    }
  }).join("");
}

