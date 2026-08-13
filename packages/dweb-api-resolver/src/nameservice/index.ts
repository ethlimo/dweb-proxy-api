import { IRequestContext } from "dweb-api-types/request-context";
import { ILoggerService } from "dweb-api-types/logger";
import { INameService, INameServiceFactory } from "dweb-api-types/name-service";
import { IConfigurationBase } from "dweb-api-types/config";
export type Tag = "IEnsServiceError";
export type ErrorType = "error";

export class NameServiceFactory implements INameServiceFactory {
  _logger: ILoggerService;
  _ensService: INameService;
  _web3NameSdkService: INameService;
  _basenamesService: INameService | null;
  _baseConfiguration: IConfigurationBase | null;

  constructor(
    logger: ILoggerService,
    ensService: INameService,
    web3NameSdkService: INameService,
    basenamesService?: INameService | null,
    baseConfiguration?: IConfigurationBase | null,
  ) {
    this._logger = logger;
    this._ensService = ensService;
    this._web3NameSdkService = web3NameSdkService;
    this._basenamesService = basenamesService || null;
    this._baseConfiguration = baseConfiguration || null;
  }

  getNameServiceForDomain(
    request: IRequestContext,
    domain: string,
  ): INameService {
    if (domain.endsWith(".gno")) {
      this._logger.debug("Using Web3NameSdkService for domain " + domain, {
        ...request,
        origin: "NameServiceFactory",
      });
      return this._web3NameSdkService;
    }
    if (
      domain.endsWith(".base.eth") &&
      this._basenamesService &&
      (this._baseConfiguration
        ? this._baseConfiguration.getConfigBaseBackend().getEnabled()
        : true)
    ) {
      this._logger.debug("Using BasenamesService for domain " + domain, {
        ...request,
        origin: "NameServiceFactory",
      });
      return this._basenamesService;
    }
    this._logger.debug("Using EnsService for domain " + domain, {
      ...request,
      origin: "NameServiceFactory",
    });
    return this._ensService;
  }

  getNameServiceForCointype(
    request: IRequestContext,
    cointype: number,
  ): INameService | undefined {
    if (cointype === 60) {
      this._logger.debug("Using EnsService for cointype " + cointype, {
        ...request,
        origin: "NameServiceFactory",
      });
      return this._ensService;
    }

    return undefined;
  }
}
