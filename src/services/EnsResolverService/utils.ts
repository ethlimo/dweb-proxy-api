import { ProxyRecord, Record } from ".";
import { recordNamespaceToUrlHandlerMap } from "./const";
import { ensureTrailingSlash } from "../../utils";
import { IConfigurationService } from "../../configuration";
import { ILoggerService } from "../LoggerService";
import { arweaveUrlToSandboxSubdomain } from "./arweave";
export const recordToProxyRecord = async (
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
      const urlSafeMethod = recordNamespaceToUrlHandlerMap[record.codec];
      var path = "/";
      if (configuration.ipfs.subdomainSupport) {
        url.host = `${record.DoHContentIdentifier}.${urlSafeMethod}.${url.host}`;
      } else {
        path = `/${urlSafeMethod}/${record.DoHContentIdentifier}/`;
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
