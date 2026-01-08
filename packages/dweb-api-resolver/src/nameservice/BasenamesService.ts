import { JsonRpcProvider } from "ethers";
import { ILoggerService } from "dweb-api-types/dist/logger";
import { IRequestContext } from "dweb-api-types/dist/request-context";
import { INameService } from "dweb-api-types/dist/name-service";
import { IConfigurationBase } from "dweb-api-types/dist/config";
import { getContentHashFallback } from "./utils.js";
import { namehash } from "ethers";

const L2_RESOLVER_ADDRESS = "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD";
const L2_RESOLVER_ABI = [
  "function contenthash(bytes32 node) view returns (bytes)",
];

export class BasenamesService implements INameService {
  _configurationService: IConfigurationBase;
  provider: JsonRpcProvider;
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
    this._logger = logger;
  }

  async getContentHash(
    request: IRequestContext,
    name: string,
  ): Promise<string | null> {
    this._logger.debug("BasenamesService: resolving contenthash", {
      ...request,
      origin: "BasenamesService",
      context: { name },
    });

    try {
      const node = namehash(name);

      this._logger.debug("BasenamesService: querying L2 resolver", {
        ...request,
        origin: "BasenamesService",
        context: { name, node, resolver: L2_RESOLVER_ADDRESS },
      });

      const { Contract } = await import("ethers");
      const contract = new Contract(
        L2_RESOLVER_ADDRESS,
        L2_RESOLVER_ABI,
        this.provider,
      );

      const contenthashBytes = await contract.contenthash(node);

      if (!contenthashBytes || contenthashBytes === "0x") {
        this._logger.debug("BasenamesService: no contenthash set", {
          ...request,
          origin: "BasenamesService",
          context: { name },
        });
        return null;
      }

      const decoded = getContentHashFallback(
        request,
        this._logger,
        contenthashBytes,
        name,
        "BasenamesService",
      );

      this._logger.debug("BasenamesService: contenthash resolved", {
        ...request,
        origin: "BasenamesService",
        context: { name, contenthash: decoded },
      });

      return decoded;
    } catch (error: any) {
      this._logger.error("BasenamesService: error resolving contenthash", {
        ...request,
        origin: "BasenamesService",
        context: {
          name,
          error: error.message || error,
        },
      });
      return null;
    }
  }
}
