import type {
  IConfigHostnameSubstitution,
  IConfigurationArweave,
  IConfigurationEnsSocials,
  IConfigurationEthereum,
  IConfigurationGnosis,
  IConfigurationIpfs,
  IConfigurationLogger,
  IConfigurationSwarm,
} from "dweb-api-types/dist/config.js";
import { JsonLoggerService } from "dweb-api-logger/dist/jsonlogger.js";
import {
  EnsResolverService,
  IEnsResolverServiceResolveEnsRet,
} from "dweb-api-resolver/dist/resolver/index.js";
import { PassthroughCacheService } from "dweb-api-cache/dist/passthrough.js";
import { NameServiceFactory } from "dweb-api-resolver/dist/nameservice/index.js";
import { EnsService } from "dweb-api-resolver/dist/nameservice/EnsService.js";
import { Web3NameSdkService } from "dweb-api-resolver/dist/nameservice/Web3NameSdkService.js";
import { ArweaveResolver } from "dweb-api-resolver/dist/resolver/arweave.js";
import { HostnameSubstitutionService } from "dweb-api-resolver/dist/HostnameSubstitutionService/index.js";
import {
  recordToProxyRecord,
  ensureTrailingSlash,
  trimExtraneousTrailingSlashes,
} from "dweb-api-resolver/dist/resolver/utils.js";
import { recordNamespaceToUrlHandlerMap } from "dweb-api-resolver/dist/resolver/const.js";
import { ContentTypeParser } from "@helia/verified-fetch";
import { fileTypeFromBuffer } from "@sgtpooki/file-type";

export type ServiceWorkerConfig = IConfigurationLogger &
  IConfigurationGnosis &
  IConfigurationEthereum &
  IConfigHostnameSubstitution &
  IConfigurationIpfs &
  IConfigurationArweave &
  IConfigurationSwarm &
  IConfigurationEnsSocials & {
    verifiedFetch: boolean;
  };

export const createServiceWorker = async (config: ServiceWorkerConfig) => {
  const logger = new JsonLoggerService();
  const cache = new PassthroughCacheService();
  const ensService = new EnsService(config, logger);
  const web3NameSdk = new Web3NameSdkService(config, logger);
  const factory = new NameServiceFactory(logger, ensService, web3NameSdk);
  const arweave = new ArweaveResolver(logger);
  const resolver = new EnsResolverService(
    logger,
    cache,
    arweave,
    null,
    factory,
  );
  const hostnameSubstitutionService = new HostnameSubstitutionService(
    config,
    logger,
  );

  return {
    resolver,
    hostnameSubstitutionService,
    logger,
  };
};

export type ServiceWorkerServices = Awaited<
  ReturnType<typeof createServiceWorker>
>;

export const createConfig = (
  urlOfHost: URL | null,
  ipfsBackend: URL,
  arweaveBackend: URL,
): ServiceWorkerConfig => {
  const host = urlOfHost?.hostname;
  const ETH_RPC_ENDPOINT = process.env.ETH_RPC_ENDPOINT;
  if (!ETH_RPC_ENDPOINT) {
    throw "ETH_RPC_ENDPOINT not set";
  }
  return {
    getLoggerConfig: () => ({
      getLevel: () => "info",
    }),
    getConfigGnosisBackend: () => ({
      getBackend: () => "https://rpc.gnosischain.com",
    }),
    getConfigEthereumBackend: () => ({
      getBackend: () => ETH_RPC_ENDPOINT,
    }),
    getHostnameSubstitutionConfig: () => ({
      ...((host && {
        [host]: "eth",
      }) ||
        {}),
      localhost: "vitalik.eth",
    }),
    getConfigIpfsBackend: () => ({
      getBackend: () => ipfsBackend.toString(),
      getSubdomainSupport: () => true,
    }),
    getConfigArweaveBackend: () => ({
      getBackend: () => arweaveBackend.toString(),
    }),
    getConfigSwarmBackend: () => ({
      getBackend: () => "https://api.gateway.ethswarm.org",
    }),
    getConfigEnsSocialsEndpoint: () => ({
      getEnsSocialsEndpoint: null,
    }),
    verifiedFetch:
      process.env.SERVICE_WORKER_TRUSTLESS?.toLowerCase() === "true",
  };
};

export const createBrowserConfig = () => {
  if (!process.env.IPFS_TARGET) {
    throw "Invalid IPFS target";
  }

  const urlOfHost = process.env.SW_BUNDLE_PUBLIC_URL
    ? new URL(process.env.SW_BUNDLE_PUBLIC_URL)
    : null;
  return createConfig(
    urlOfHost?.hostname?.startsWith("localhost") ? null : urlOfHost,
    new URL(process.env.IPFS_TARGET),
    new URL("https://permagate.io"),
  );
};

export type UrlIsNotEnsName = {
  _tag: "UrlIsNotEnsName";
  url: URL;
};

export type UrlIsRecord = {
  _tag: "URLIsRecord";
  record: IEnsResolverServiceResolveEnsRet;
  pathName: string;
};

export const resolveUrlToProxyRecord = async (
  location: string,
  svcs: ServiceWorkerServices,
): Promise<UrlIsNotEnsName | UrlIsRecord> => {
  const { hostnameSubstitutionService, resolver } = svcs;

  const sanitizedLocation = location;

  const url = new URL(sanitizedLocation);
  url.host = url.host.split(":")[0];
  //substituteHostname always strips protocol
  const new_location =
    "https://" + hostnameSubstitutionService.substituteHostname(url.toString());
  //verify new_location has a valid protocol

  const new_url = new URL(new_location);
  new_url.hostname = new_url.hostname.split(":")[0];
  new_url.search = "";
  //TODO: this should be hostnameIsEnsTld
  if (!new_url.hostname.endsWith(".eth")) {
    return {
      _tag: "UrlIsNotEnsName",
      url: new URL(sanitizedLocation),
    };
  }

  const response = await resolver.resolveEns(
    { trace_id: "service-worker" },
    new_url.hostname,
  );

  return {
    _tag: "URLIsRecord",
    record: response,
    pathName: new URL(sanitizedLocation).pathname,
  };
};

type ProxyRecordAlias = Awaited<ReturnType<typeof recordToProxyRecord>>;

export const resolveRecordToProxyRecord = async (
  recordWrapper: UrlIsRecord,
  config: ServiceWorkerConfig,
  svcs: ServiceWorkerServices,
): Promise<ProxyRecordAlias | null> => {
  const { logger } = svcs;
  const { record } = recordWrapper;
  const unwrappedRecord = record.record;

  if (!unwrappedRecord) {
    logger.error("failed to receive record", {
      origin: "service-worker-registration",
      trace_id: "service-worker-registration",
      context: { recordWrapper },
    });
    return null;
  }

  logger.info("received record", {
    origin: "service-worker",
    trace_id: "service-worker",
    context: { unwrappedRecord },
  });
  const proxyRecord = await recordToProxyRecord(
    { trace_id: "service-worker" },
    config,
    logger,
    unwrappedRecord,
  );

  return proxyRecord;
};

export const resolveProxyRecordToURL = async (
  proxyRecord: ProxyRecordAlias,
  pathName: string,
  _config: ServiceWorkerConfig,
  svcs: ServiceWorkerServices,
): Promise<URL | null> => {
  const { logger } = svcs;
  if (proxyRecord._tag === "ProxyRecordUnableToRedirect") {
    logger.error("Redirect is not available ", {
      origin: "service-worker",
      trace_id: "service-worker",
      context: { proxyRecord },
    });
    return null;
  } else if (proxyRecord._tag === "ens-socials-redirect") {
    logger.error("Redirect is unimplemented ", {
      origin: "service-worker",
      trace_id: "service-worker",
      context: { proxyRecord },
    });
    return null;
  } else {
    logger.info("Redirecting to ", {
      origin: "service-worker",
      trace_id: "service-worker",
      context: { proxyRecord },
    });
    const redirect_url = new URL(
      ensureTrailingSlash(proxyRecord.XContentLocation) +
        proxyRecord.XContentPath,
    );
    redirect_url.pathname += pathName;
    redirect_url.pathname = trimExtraneousTrailingSlashes(
      trimExtraneousTrailingSlashes(redirect_url.pathname),
    );
    return redirect_url;
  }
};

export type FetchableByUrl = {
  _tag: "FetchableByUrl";
  url: URL;
};

export type FetchableByVerifiedFetch = {
  _tag: "FetchableByVerifiedFetch";
  hostname: string;
};

export const resolveUrl = async (
  location: string,
  config: ServiceWorkerConfig,
  svcs: ServiceWorkerServices,
): Promise<
  FetchableByUrl | FetchableByVerifiedFetch | UrlIsNotEnsName | null
> => {
  const { logger } = svcs;
  const proxyRecord = await resolveUrlToProxyRecord(location, svcs);
  if (proxyRecord._tag === "UrlIsNotEnsName") {
    logger.info("URL is not an ENS name", {
      origin: "service-worker",
      trace_id: "service-worker",
      context: { location },
    });
    return proxyRecord;
  }
  const resolvedProxyRecord = await resolveRecordToProxyRecord(
    proxyRecord,
    config,
    svcs,
  );
  if (!resolvedProxyRecord) {
    logger.error("Failed to resolve proxy record", {
      origin: "service-worker",
      trace_id: "service-worker",
      context: { proxyRecord },
    });
    return null;
  }

  if (
    config.verifiedFetch &&
    resolvedProxyRecord._tag === "Record" &&
    (resolvedProxyRecord.codec === "ipfs-ns" ||
      resolvedProxyRecord.codec === "ipns-ns")
  ) {
    const protocol =
      recordNamespaceToUrlHandlerMap[
        resolvedProxyRecord.codec as "ipfs-ns" | "ipns-ns"
      ];
    const contentIdentifier = resolvedProxyRecord.DoHContentIdentifier;
    const locationUrl = new URL(location);
    const url = protocol + "://" + contentIdentifier + locationUrl.pathname;

    console.log("location", locationUrl, "url", url);
    logger.info("Mapping verified fetch", {
      origin: "service-worker",
      trace_id: "service-worker",
      context: { url: url.toString(), location: location, resolvedProxyRecord },
    });
    return {
      _tag: "FetchableByVerifiedFetch",
      hostname: url,
    };
  }

  const resolvedUrl = await resolveProxyRecordToURL(
    resolvedProxyRecord,
    proxyRecord.pathName,
    config,
    svcs,
  );

  if (!resolvedUrl) {
    logger.error("Failed to resolve URL", {
      origin: "service-worker",
      trace_id: "service-worker",
      context: { resolvedProxyRecord },
    });
    return null;
  }

  return {
    _tag: "FetchableByUrl",
    url: resolvedUrl,
  };
};

// default from verified-fetch is application/octect-stream, which forces a download. This is not what we want for MANY file types.
export const defaultMimeType = "text/html";

export const contentTypeParser: ContentTypeParser = async (bytes, fileName) => {
  const detectedType = (await fileTypeFromBuffer(bytes))?.mime;
  if (detectedType != null) {
    return detectedType;
  }
  if (fileName == null) {
    // no other way to determine file-type.
    return defaultMimeType;
  }

  // no need to include file-types listed at https://github.com/SgtPooki/file-type#supported-file-types
  console.log(fileName);
  switch (fileName.split(".").pop()) {
    case "css":
      return "text/css";
    case "html":
      return "text/html";
    case "js":
      return "application/javascript";
    case "json":
      return "application/json";
    case "txt":
      return "text/plain";
    case "woff2":
      return "font/woff2";
    // see bottom of https://github.com/SgtPooki/file-type#supported-file-types
    case "svg":
      return "image/svg+xml";
    case "csv":
      return "text/csv";
    case "doc":
      return "application/msword";
    case "xls":
      return "application/vnd.ms-excel";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "msi":
      return "application/x-msdownload";
    default:
      return defaultMimeType;
  }
};
