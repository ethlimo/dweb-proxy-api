import { createWeb3Name } from "@web3-name-sdk/core";
import { IRequestContext } from "dweb-api-types/dist/request-context.js";
import { ILoggerService } from "dweb-api-types/dist/logger.js";
import { INameService } from "dweb-api-types/dist/name-service.js";
import {
  IConfigurationEthereum,
  IConfigurationGnosis,
} from "dweb-api-types/dist/config.js";
import { getContentHashFallback } from "./utils.js";

export class Web3NameSdkService implements INameService {
  _configurationService: IConfigurationGnosis & IConfigurationEthereum;
  _logger: ILoggerService;
  //type exposed by imports
  _web3name: ReturnType<typeof createWeb3Name>;

  constructor(
    configurationService: IConfigurationGnosis & IConfigurationEthereum,
    logger: ILoggerService,
  ) {
    this._configurationService = configurationService;
    this._logger = logger;
    this._web3name = createWeb3Name({
      isDev: false,
      rpcUrl: this._configurationService
        .getConfigEthereumBackend()
        .getBackend(),
    });
  }

  async getContentHash(
    request: IRequestContext,
    name: string,
  ): Promise<string | null> {
    const res = await this._web3name.getContentHash({
      name,
      rpcUrl: this._configurationService.getConfigGnosisBackend().getBackend(),
    });
    if (!res) {
      return null;
    }
    return getContentHashFallback(
      request,
      this._logger,
      res,
      name,
      "Web3NameSdkService",
    );
  }
}
