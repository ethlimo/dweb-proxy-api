import { LoggerFactory, WarpFactory } from "warp-contracts";
import { base32 } from "rfc4648";
import { ILoggerService } from "dweb-api-types/dist/logger.js";
import { IRequestContext } from "dweb-api-types/dist/request-context.js";
import { IArweaveResolver } from "dweb-api-types/dist/arweave.js";

LoggerFactory.INST.setOptions({ LogLevel: "none" });

export class ArweaveResolver implements IArweaveResolver {
  warp = WarpFactory.forMainnet({ inMemory: true, dbLocation: "./warpdb" });
  _logger: ILoggerService;

  constructor(logger: ILoggerService) {
    this._logger = logger;
  }

  arweaveContractQuery = async (request: IRequestContext, tx_id: string) => {
    try {
      const contract = this.warp.pst(tx_id);

      const state = await contract.readState();
      return state;
    } catch (error) {
      this._logger.info("invalid arweave tx id", {
        ...request,
        origin: "arweaveContractQuery",
        context: {
          tx_id: tx_id,
          error: error,
        },
      });
      return undefined;
    }
  };

  resolveArweave = async (
    request: IRequestContext,
    tx_id: string,
    ens_name: string,
  ) => {
    const state = await this.arweaveContractQuery(request, tx_id);
    if (!state) {
      return tx_id;
    }
    const records = (state.cachedValue.state as any).records || {};
    const keys = Object.keys(records);
    if (keys.length == 0) {
      return tx_id;
    }

    var match: string | null = null;

    keys.forEach((key: string) => {
      if (ens_name.startsWith(key)) {
        if (match == null || match.length < key.length) {
          match = key;
        }
      }
    });

    if (match != null) {
      const ret = records[match].transactionId;
      if (typeof ret === "string") {
        return ret;
      } else {
        this._logger.error(
          //`resolveArweave: invalid record ${match} found for ${tx_id} ${ens_name}`,
          "invalid arweave record found",
          {
            ...request,
            origin: "resolveArweave",
            context: {
              match: match,
              tx_id: tx_id,
              ens_name: ens_name,
            },
          },
        );
      }
    }

    if (keys.indexOf("@") != -1) {
      const ret = records["@"].transactionId as string;
      if (typeof ret === "string") {
        return ret;
      } else {
        this._logger.error("invalid arweave @ record found", {
          ...request,
          origin: "resolveArweave",
          context: {
            tx_id: tx_id,
            ens_name: ens_name,
            records,
          },
        });
      }
    }

    this._logger.warn("no arweave @ record found", {
      ...request,
      origin: "resolveArweave",
      context: {
        tx_id: tx_id,
        ens_name: ens_name,
        records,
      },
    });

    return tx_id;
  };
}

export const arweaveTxIdToArweaveSandboxSubdomainId = async (
  request: IRequestContext,
  logger: ILoggerService,
  tx_id: string,
) => {
  try {
    return base32
      .stringify(Buffer.from(tx_id, "base64"), { pad: false })
      .toLowerCase();
  } catch (e) {
    logger.error("invalid arweave tx id", {
      ...request,
      origin: "arweaveTxIdToArweaveSandboxSubdomainId",
      context: {
        tx_id: tx_id,
        error: e,
      },
    });
    return undefined;
  }
};

export const arweaveUrlToSandboxSubdomain = async (
  request: IRequestContext,
  logger: ILoggerService,
  tx_id: string,
  arweave_gateway: URL,
): Promise<URL> => {
  const subdomain = await arweaveTxIdToArweaveSandboxSubdomainId(
    request,
    logger,
    tx_id,
  );
  if (!subdomain) {
    return arweave_gateway;
  }

  const url = new URL(arweave_gateway.toString());
  url.host = subdomain + "." + url.host;

  return url;
};
