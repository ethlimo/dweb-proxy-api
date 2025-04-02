import { FallbackProvider, JsonRpcProvider, AbstractProvider } from "ethers";
import { ILoggerService } from "dweb-api-types/dist/logger";
import { IRequestContext } from "dweb-api-types/dist/request-context";
import { INameService } from "dweb-api-types/dist/name-service";
import {
  IConfigurationEthereum,
  IConfigurationEthereumFailover,
} from "dweb-api-types/dist/config";
import { getContentHashFallback } from "./utils.js";
const getEnsContentHash = async (
  request: IRequestContext,
  provider: AbstractProvider,
  logger: ILoggerService,
  name: string,
): Promise<string | null> => {
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
    return contentHash;
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

export class EnsService implements INameService {
  _configurationService: IConfigurationEthereum &
    Partial<IConfigurationEthereumFailover>;
  provider: FallbackProvider;
  _logger: ILoggerService;
  constructor(
    configurationService: IConfigurationEthereum &
      Partial<IConfigurationEthereumFailover>,
    logger: ILoggerService,
  ) {
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
        new JsonRpcProvider(secondary_failover, undefined, {
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

    this.provider = new FallbackProvider(providers_as_config, quorum);
    this._logger = logger;
  }

  async getContentHash(
    request: IRequestContext,
    name: string,
  ): Promise<string | null> {
    const res = await getEnsContentHash(
      request,
      this.provider,
      this._logger,
      name,
    );
    return res;
  }
}
