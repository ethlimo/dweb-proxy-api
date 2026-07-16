import { Contract, JsonRpcProvider, ZeroAddress, namehash } from "ethers";
import { ILoggerService } from "dweb-api-types/logger";
import { IRequestContext } from "dweb-api-types/request-context";
import {
  DecodedCodecString,
  DecodedDataUri,
  DecodedDataUrl,
  INameService,
} from "dweb-api-types/name-service";
import { IConfigurationBase } from "dweb-api-types/config";
import { getContentHashFallback } from "./utils.js";

const BASE_CHAIN_ID = 8453;
/*
  Basenames uses an ENS-style registry deployed on Base mainnet; each name's
  resolver is looked up through it rather than hardcoding the default
  L2Resolver so that names assigned a custom resolver still resolve.
  https://github.com/base-org/basenames#deployments
*/
const BASENAMES_REGISTRY_ADDRESS = "0xB94704422c2a1E396835A571837Aa5AE53285a95";
const REGISTRY_ABI = ["function resolver(bytes32 node) view returns (address)"];
const RESOLVER_ABI = [
  "function contenthash(bytes32 node) view returns (bytes)",
];

export class BasenamesService implements INameService {
  _configurationService: IConfigurationBase;
  provider: JsonRpcProvider;
  registry: Contract;
  _logger: ILoggerService;

  constructor(
    configurationService: IConfigurationBase,
    logger: ILoggerService,
  ) {
    this._configurationService = configurationService;
    const baseConfig = this._configurationService.getConfigBaseBackend();
    const rpc = baseConfig.getBackend();

    this.provider = new JsonRpcProvider(rpc, undefined, {
      staticNetwork: true,
    });
    this.registry = new Contract(
      BASENAMES_REGISTRY_ADDRESS,
      REGISTRY_ABI,
      this.provider,
    );
    this._logger = logger;
  }

  /*
    RPC failures are deliberately not caught here: a thrown error propagates
    to the resolver's failure path instead of being cached as "no record".
  */
  async getContentHash(
    request: IRequestContext,
    name: string,
  ): Promise<DecodedCodecString | DecodedDataUri | DecodedDataUrl | null> {
    const node = namehash(name);

    const resolverAddress: string = await this.registry.resolver(node);
    if (!resolverAddress || resolverAddress === ZeroAddress) {
      this._logger.debug("BasenamesService: no resolver", {
        ...request,
        origin: "BasenamesService",
        context: {
          name,
          node,
        },
      });
      return null;
    }

    const resolver = new Contract(resolverAddress, RESOLVER_ABI, this.provider);
    const contenthashBytes: string = await resolver.contenthash(node);

    if (!contenthashBytes || contenthashBytes === "0x") {
      this._logger.debug("BasenamesService: no contenthash set", {
        ...request,
        origin: "BasenamesService",
        context: {
          name,
          node,
          resolver: resolverAddress,
        },
      });
      return null;
    }

    return getContentHashFallback(
      request,
      this._logger,
      contenthashBytes,
      name,
      "BasenamesService",
    );
  }

  getChainId(): number {
    return BASE_CHAIN_ID;
  }
}
