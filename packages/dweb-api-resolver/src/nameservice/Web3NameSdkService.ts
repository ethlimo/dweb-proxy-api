import { createWeb3Name } from "@web3-name-sdk/core";
import { IRequestContext } from "dweb-api-types/request-context";
import { ILoggerService } from "dweb-api-types/logger";
import {
  DecodedCodecString,
  DecodedDataUri,
  DecodedDataUrl,
  INameService,
} from "dweb-api-types/name-service";
import {
  IConfigurationEthereum,
  IConfigurationGnosis,
} from "dweb-api-types/config";
import { getContentHashFallback } from "./utils.js";

// Runs the SDK call. The server passes one that limits which hosts the
// SDK may reach (see onlyFetchFrom in dweb-api-server), the service worker
// uses the default.
export type SdkCallWrapper = <T>(
  rpcEndpoints: string[],
  fn: () => Promise<T>,
) => Promise<T>;

export class Web3NameSdkService implements INameService {
  _configurationService: IConfigurationGnosis & IConfigurationEthereum;
  _logger: ILoggerService;
  //type exposed by imports
  _web3name: ReturnType<typeof createWeb3Name>;
  _wrapSdkCall: SdkCallWrapper;

  constructor(
    configurationService: IConfigurationGnosis & IConfigurationEthereum,
    logger: ILoggerService,
    wrapSdkCall: SdkCallWrapper = (_endpoints, fn) => fn(),
  ) {
    this._configurationService = configurationService;
    this._logger = logger;
    this._wrapSdkCall = wrapSdkCall;
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
  ): Promise<DecodedCodecString | DecodedDataUri | DecodedDataUrl | null> {
    const ethRpc = this._configurationService
      .getConfigEthereumBackend()
      .getBackend();
    const gnoRpc = this._configurationService
      .getConfigGnosisBackend()
      .getBackend();
    const res = await this._wrapSdkCall([ethRpc, gnoRpc], () =>
      this._web3name.getContentHash({ name, rpcUrl: gnoRpc }),
    );
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

  getChainId(): number {
    return 100;
  }
}
