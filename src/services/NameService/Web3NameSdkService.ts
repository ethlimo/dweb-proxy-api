import { createWeb3Name } from '@web3-name-sdk/core'
import { decode, getCodec } from "@ensdomains/content-hash";
import { IRequestContext } from '../lib';
import { ErrorSuccess } from '../../utils/ErrorSuccess';
import { ILoggerService } from '../LoggerService';
import { IConfigurationService } from '../../configuration';
import { ErrorType, INameService } from '.';
import { inject, injectable } from 'inversify';
import { DITYPES } from '../../dependencies/types';


@injectable()
export class Web3NameSdkService implements INameService {
  _configurationService: IConfigurationService;
  _logger: ILoggerService;
  //type exposed by imports
  _web3name: ReturnType<typeof createWeb3Name>;

  constructor(@inject(DITYPES.ConfigurationService) configurationService: IConfigurationService, @inject(DITYPES.LoggerService) logger: ILoggerService) {
    this._configurationService = configurationService;
    this._logger = logger;
    this._web3name = createWeb3Name({
      isDev: false,
      rpcUrl: this._configurationService.get().ethereum.rpc
    })
  }

  async getContentHash(
    request: IRequestContext,
    name: string,
  ): Promise<
    ErrorSuccess<
      string | null,
      "IEnsServiceError",
      ErrorType,
      { }
    >
  > {
    const res = await this._web3name.getContentHash({name, rpcUrl: this._configurationService.get().gnosis.rpc});
    if(!res) {
      return {
        error: false,
        result: null,
      };
    }
    //TODO: this is the same as the fallback in EnsService, should be refactored
    const codec = getCodec(res);
    const content = decode(res);
    if (!codec || !content) {
      this._logger.error(
        'unsupported fallback decode operation',
        {
          ...request,
          origin: 'Web3NameSdkService',
          context: {
            name,
            codec,
            content,
          }
        }
      );
      return {
        error: false,
        result: null,
      };
    }
    const contentHashDecoded = `${codec}://${content}`;
    this._logger.debug('getContentHash', {
      ...request,
      origin: 'Web3NameSdkService',
      context: {
        name,
        contentHash: contentHashDecoded
      }
    });
    return {
      error: false,
      result: contentHashDecoded,
    };
  }
}