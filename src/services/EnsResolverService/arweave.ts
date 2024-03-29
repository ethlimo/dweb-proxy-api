import { LoggerFactory, WarpFactory } from "warp-contracts";
import { base32 } from "rfc4648";
import { ILoggerService } from "../LoggerService";
import { inject, injectable } from "inversify";
import { DITYPES } from "../../dependencies/types";

LoggerFactory.INST.setOptions({ LogLevel: "none" });

export interface IArweaveResolver {
  resolveArweave: (tx_id: string, ens_name: string) => Promise<string>;
};

@injectable()
export class ArweaveResolver implements IArweaveResolver {

  warp = WarpFactory.forMainnet({ inMemory: true, dbLocation: "./warpdb" });
  _logger: ILoggerService;

  constructor(@inject(DITYPES.LoggerService) logger: ILoggerService) {
    this._logger = logger;
  }

  arweaveContractQuery = async (tx_id: string) => {
    try {
      const contract = this.warp.pst(tx_id);

      const state = await contract.readState();
      return state;
    } catch (error) {
      this._logger.info(
        `arweaveContractQuery: invalid arweave tx_id ${tx_id} ${error}`,
      );
      return undefined;
    }
  };

  resolveArweave = async (tx_id: string, ens_name: string) => {
    const state = await this.arweaveContractQuery(tx_id);
    if (!state) {
      return tx_id;
    }
    const records = (state.cachedValue.state as any).records || {};
    const keys = Object.keys(records);
    if (keys.length == 0) {
      return tx_id;
    }

    var match: string | null = null;

    //BUG: this uses longest prefix matching on the ens name, which means that it is technically incorrect
    //     what we should be doing is requiring subdomains to be explicit to the ENS name
    //     I don't know if there's a funny edge case here

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
          `resolveArweave: invalid record ${match} found for ${tx_id} ${ens_name}`,
        );
      }
    }

    if (keys.indexOf("@") != -1) {
      const ret = records["@"].transactionId as string;
      if (typeof ret === "string") {
        return ret;
      } else {
        this._logger.error(
          `resolveArweave: invalid @ record found for ${tx_id} ${ens_name}`,
        );
      }
    }

    this._logger.warn(
      `resolveArweave: fallback no @ record found for ${tx_id} ${ens_name}`,
    );

    return tx_id;
  };
}

export const arweaveTxIdToArweaveSandboxSubdomainId = async (logger: ILoggerService, tx_id: string) => {
  try {
    return base32
      .stringify(Buffer.from(tx_id, "base64"), { pad: false })
      .toLowerCase();
  } catch (e) {
    logger.error(
      `arweaveTxIdToArweaveSandboxSubdomainId: invalid tx_id ${tx_id} ${e}`,
    );
    return undefined;
  }
};

export const arweaveUrlToSandboxSubdomain = async (
  logger: ILoggerService,
  tx_id: string,
  arweave_gateway: URL,
): Promise<URL> => {
  const subdomain = await arweaveTxIdToArweaveSandboxSubdomainId(logger, tx_id);
  if (!subdomain) {
    return arweave_gateway;
  }

  const url = new URL(arweave_gateway.toString());
  url.host = subdomain + "." + url.host;

  return url;
};