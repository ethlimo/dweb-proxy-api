import { IRequestContext } from "dweb-api-types/dist/request-context.js";
import { ILoggerService } from "dweb-api-types/dist/logger.js";
import {
  INameService,
  INameServiceFactory,
} from "dweb-api-types/dist/name-service.js";
export type Tag = "IEnsServiceError";
export type ErrorType = "error";

export class NameServiceFactory implements INameServiceFactory {
  _logger: ILoggerService;
  _ensService: INameService;
  _web3NameSdkService: INameService;
  _basenamesService: INameService | null;

  constructor(
    logger: ILoggerService,
    ensService: INameService,
    web3NameSdkService: INameService,
    basenamesService?: INameService,
  ) {
    this._logger = logger;
    this._ensService = ensService;
    this._web3NameSdkService = web3NameSdkService;
    this._basenamesService = basenamesService || null;
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
    if (domain.endsWith(".base.eth") && this._basenamesService) {
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
}
