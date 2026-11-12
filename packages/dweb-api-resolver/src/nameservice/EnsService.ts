import { FallbackProvider, JsonRpcProvider, AbstractProvider } from "ethers";
import { ILoggerService } from "dweb-api-types/logger";
import { IRequestContext } from "dweb-api-types/request-context";
import {
  DecodedCodecString,
  DecodedDataUri,
  DecodedDataUrl,
  IDataUrlResolverService,
  IEnsServiceDataUrlRet,
  INameService,
} from "dweb-api-types/name-service";
import {
  IConfigurationEthereum,
  IConfigurationEthereumFailover,
} from "dweb-api-types/config";
import { getContentHashFallback } from "./utils.js";
import { Interface } from "ethers";
import { ICacheService } from "dweb-api-types/cache";
import { executeHook } from "@ethlimo/ens-hooks";
import { RecordEntryDecodedEIP8121Hook } from "dweb-api-types/ens-resolver";
// Side-effect import: patches ethers v6 to add ENSv2 support.
import "@ensdomains/ethers-patch-v6";

const getEnsContentHash = async (
  request: IRequestContext,
  provider: AbstractProvider,
  logger: ILoggerService,
  name: string,
): Promise<DecodedCodecString | DecodedDataUri | DecodedDataUrl | null> => {
  const res = await provider.getResolver(name);
  if (!res) {
    logger.debug("no resolver", {
      ...request,
      origin: "getEnsContentHash",
      context: {
        name: name,
      },
    });
    return null;
  }
  try {
    const contentHash = await res.getContentHash();
    return (
      (contentHash && {
        _tag: "DecodedCodecString",
        codec: contentHash,
      }) ||
      null
    );
  } catch (e: any) {
    if (e?.code === "UNSUPPORTED_OPERATION" && e?.info?.data) {
      logger.debug("entering fallback", {
        ...request,
        origin: "getEnsContentHash",
        context: {
          name: name,
          error: e,
        },
      });
      return getContentHashFallback(
        request,
        logger,
        e.info.data,
        name,
        "EnsService",
      );
    } else {
      throw e;
    }
  }
};

export class EnsService implements INameService, IDataUrlResolverService {
  _configurationService: IConfigurationEthereum &
    Partial<IConfigurationEthereumFailover>;
  provider: FallbackProvider;
  _logger: ILoggerService;
  _cacheService: ICacheService;

  chainid: number | undefined;

  constructor(
    configurationService: IConfigurationEthereum &
      Partial<IConfigurationEthereumFailover>,
    cacheService: ICacheService,
    logger: ILoggerService,
  ) {
    this._cacheService = cacheService;
    this._configurationService = configurationService;
    const ethereumConfig =
      this._configurationService.getConfigEthereumBackend();
    const failoverConfigOriginal =
      this._configurationService.getConfigEthereumFailover &&
      this._configurationService.getConfigEthereumFailover();
    const rpc = ethereumConfig.getBackend();
    const failoverConfig = {
      ...failoverConfigOriginal,
      getProviderStallTimeout:
        failoverConfigOriginal?.getProviderStallTimeout || (() => 10000),
      getStallTimeout: failoverConfigOriginal?.getStallTimeout || (() => 10000),
      getQuorum: failoverConfigOriginal?.getQuorum || (() => 1),
      getPrimaryFailoverBackend:
        failoverConfigOriginal?.getPrimaryFailoverBackend || (() => null),
      getSecondaryFailoverBackend:
        failoverConfigOriginal?.getSecondaryFailoverBackend || (() => null),
    };
    const primary_failover = failoverConfig.getPrimaryFailoverBackend();
    const secondary_failover = failoverConfig.getSecondaryFailoverBackend();
    const quorum = failoverConfig.getQuorum();
    const providers = [
      new JsonRpcProvider(rpc, undefined, {
        staticNetwork: true,
      }),
    ];
    if (primary_failover) {
      logger.info("EnsService: adding failover_primary", {
        trace_id: "UNKNOWN_TRACE_ID",
        origin: "EnsService",
      });
      providers.push(
        new JsonRpcProvider(primary_failover, undefined, {
          staticNetwork: true,
        }),
      );
    }
    if (secondary_failover) {
      logger.info("EnsService: adding failover_secondary", {
        trace_id: "UNKNOWN_TRACE_ID",
        origin: "EnsService",
      });
      providers.push(
        new JsonRpcProvider(secondary_failover, ethereumConfig.getChainId(), {
          staticNetwork: true,
        }),
      );
    }
    const providers_as_config: {
      provider: JsonRpcProvider;
      priority: number;
      weight: number;
      stallTimeout: number;
    }[] = providers.map((provider, index) => {
      provider._getConnection().timeout = failoverConfig.getStallTimeout();
      return {
        provider,
        priority: index,
        weight: 1,
        stallTimeout: failoverConfig.getProviderStallTimeout(),
      };
    });

    this.provider = new FallbackProvider(
      providers_as_config,
      ethereumConfig.getChainId(),
      {
        quorum: quorum,
      },
    );
    this._logger = logger;
  }

  async getContentHash(
    request: IRequestContext,
    name: string,
  ): Promise<DecodedCodecString | DecodedDataUri | DecodedDataUrl | null> {
    const res = await getEnsContentHash(
      request,
      this.provider,
      this._logger,
      name,
    );
    return res;
  }
  async init(): Promise<void> {
    const chainid = await this.provider.getNetwork().then((network) => {
      return network.chainId;
    });
    this.chainid = Number(chainid);
  }
  getChainId(): number {
    if (this.chainid === undefined) {
      throw new Error("Chain ID not set. Please call init() first.");
    }
    return this.chainid;
  }

  resolveInterface: Interface = new Interface([]);

  async resolveDataUrl(
    request: IRequestContext,
    decodedDataUrl: RecordEntryDecodedEIP8121Hook,
  ): Promise<IEnsServiceDataUrlRet> {
    this._logger.debug("resolveDataUrl", {
      ...request,
      origin: "resolveDataUrl",
      context: {
        decodedDataUrl,
      },
    });

    if (decodedDataUrl.data.target.chainId !== this.getChainId()) {
      throw new Error(`ENS Data URL hook execution failed: chainId mismatch`);
    }

    const ret = await executeHook(decodedDataUrl.data, {
      providerMap: new Map([[this.getChainId(), this.provider]]),
    });

    if (ret._tag === "HookExecutionError") {
      this._logger.debug("resolveDataUrl - hook execution error", {
        ...request,
        origin: "resolveDataUrl",
        context: {
          decodedDataUrl,
          error: ret,
        },
      });
      throw new Error(`ENS Data URL hook execution failed: ${ret.message}`);
    } else {
      ret.data;
    }

    this._logger.debug("resolveDataUrl", {
      ...request,
      origin: "resolveDataUrl",
      context: {
        decodedDataUrl,
      },
    });
    return {
      _tag: "ens-dataurl",
      data: ret.data,
    };
  }
}
