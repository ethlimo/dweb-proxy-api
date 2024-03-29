import { FallbackProvider, ethers, JsonRpcProvider, EnsResolver, Provider, AbstractProvider } from "ethers";
import { ErrorSuccess } from "../../utils/ErrorSuccess";
import { inject, injectable } from "inversify";
import { decode, getCodec } from "@ensdomains/content-hash";
import { ILoggerService } from "../LoggerService";
import { DITYPES } from "../../dependencies/types";
import { FallbackProviderConfig } from "ethers/lib.commonjs/providers/provider-fallback";
import { IConfigurationService } from "../../configuration";
export type Tag = "IEnsServiceError";
export type ErrorType = "error";

export interface IEnsService {
  getContentHash(
    name: string,
  ): Promise<ErrorSuccess<string | null, Tag, ErrorType>>;
}

const getEnsContentHash = async (provider: AbstractProvider, logger: ILoggerService, name: string):Promise<string|null> => {
  const res = await provider.getResolver(name);
  if (!res) {
    logger.debug(`EnsService: no resolver for ${name}`);
    return null;
  }
  try {
    const contentHash = await res.getContentHash();
    return contentHash
  } catch (e) {
    if (e?.code === "UNSUPPORTED_OPERATION" && e?.info?.data) {
      logger.debug(`EnsService: entering fallback for ${e.info.data}`);
      const content = decode(e.info.data);
      const codec = getCodec(e.info.data);
      if (!codec || !content) {
        logger.error(
          `EnsService: unsupported fallback decode operation, codec: name: ${name}, codec: ${codec}, content: ${content}`,
        );
        return null;
      }
      return `${codec}://${content}`;
    } else {
      throw e;
    }
  }
}

@injectable()
export class EnsService implements IEnsService {
  _configurationService: IConfigurationService;
  provider: FallbackProvider;
  _logger: ILoggerService;
  constructor(@inject(DITYPES.ConfigurationService) configurationService: IConfigurationService, @inject(DITYPES.LoggerService) logger: ILoggerService) {
    this._configurationService = configurationService;
    const configuration = this._configurationService.get()
    const providers = [new JsonRpcProvider(configuration.ethereum.rpc, undefined, {staticNetwork: true})];
    if (configuration.ethereum.failover_primary) {
      logger.info("EnsService: adding failover_primary")
      providers.push(new JsonRpcProvider(configuration.ethereum.failover_primary, undefined, {staticNetwork: true}));
    }
    if (configuration.ethereum.failover_secondary) {
      logger.info("EnsService: adding failover_secondary")
      providers.push(new JsonRpcProvider(configuration.ethereum.failover_secondary, undefined, {staticNetwork: true}));
    }
    const providers_as_config:FallbackProviderConfig[] = providers.map((provider, index) => {
      provider._getConnection().timeout = configuration.ethereum.provider_timeout_ms;
      return {
        provider,
        priority: index === 0 ? 0 : 1,
        weight: 1,
        stallTimeout: configuration.ethereum.provider_stall_timeout_ms,
      }
    });

    this.provider = new FallbackProvider(providers_as_config, configuration.ethereum.quorum);
    this._logger = logger;
  }

  async getContentHash(
    name: string,
  ): Promise<
    ErrorSuccess<
      string | null,
      "IEnsServiceError",
      ErrorType,
      { }
    >
  > {
    const res = await getEnsContentHash(this.provider, this._logger, name);
    return {
      error: false,
      result: res,
    };
  }
}