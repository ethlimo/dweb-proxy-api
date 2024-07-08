import { inject, injectable } from "inversify";
import { ErrorSuccess } from "../../utils/ErrorSuccess";
import { IRequestContext } from "../lib/index";
import { ILoggerService } from "../LoggerService";
import { DITYPES } from "../../dependencies/types";
export type Tag = "IEnsServiceError";
export type ErrorType = "error";

export interface INameService {
  getContentHash(
    request: IRequestContext,
    name: string,
  ): Promise<ErrorSuccess<string | null, Tag, ErrorType>>;
}

export interface INameServiceFactory {
  getNameServiceForDomain(request: IRequestContext, domain: string): INameService;
}


//FIXME: this isn't how inversify expects factories, but it doesn't really matter
@injectable()
export class NameServiceFactory implements INameServiceFactory {
  _logger: ILoggerService;
  _ensService: INameService;
  _web3NameSdkService: INameService;

  constructor(
    @inject(DITYPES.LoggerService) logger: ILoggerService,
    @inject(DITYPES.EnsService) ensService: INameService,
    @inject(DITYPES.Web3NameSdkService) web3NameSdkService: INameService,
  ) {
    this._logger = logger;
    this._ensService = ensService;
    this._web3NameSdkService = web3NameSdkService;
  }

  getNameServiceForDomain(request: IRequestContext, domain: string): INameService {
    if(domain.endsWith(".gno")) {
      this._logger.debug("Using Web3NameSdkService for domain " + domain, {
        ...request,
        origin: "NameServiceFactory",
      });
      return this._web3NameSdkService;
    }
    this._logger.debug("Using EnsService for domain " + domain, {
      ...request,
      origin: "NameServiceFactory",
    });
    return this._ensService;
  }
}