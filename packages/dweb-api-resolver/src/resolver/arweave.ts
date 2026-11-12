import { LoggerFactory, WarpFactory } from "warp-contracts";
import { base32 } from "rfc4648";
import { ILoggerService } from "dweb-api-types/logger";
import { IRequestContext } from "dweb-api-types/request-context";
import { IArweaveResolver } from "dweb-api-types/arweave";

LoggerFactory.INST.setOptions({ LogLevel: "none" });

// Reading an ANT's records means evaluating the SmartWeave contract behind
// the tx id. Without a sandbox plugin warp runs the contract source with
// `new Function` in this process, and it can still reach `process`,
// `global` and `fetch`. The tx id comes from the ENS contenthash, so
// anyone could point a name at their own contract and have it executed
// here. Contracts are therefore only evaluated when their source tx id is
// in `antSourceWhitelist` (ARWEAVE_ANT_SOURCE_WHITELIST), and not at all
// when the list is empty. In that case arweave:// ids are used as is.
export class ArweaveResolver implements IArweaveResolver {
  _warp: ReturnType<typeof WarpFactory.forMainnet> | null = null;
  _logger: ILoggerService;
  _antSourceWhitelist: string[];

  constructor(logger: ILoggerService, antSourceWhitelist: string[] = []) {
    this._logger = logger;
    this._antSourceWhitelist = antSourceWhitelist;
  }

  get warp() {
    if (!this._warp) {
      this._warp = WarpFactory.forMainnet({
        inMemory: true,
        dbLocation: "./warpdb",
      });
    }
    return this._warp;
  }

  arweaveContractQuery = async (request: IRequestContext, tx_id: string) => {
    if (this._antSourceWhitelist.length === 0) {
      return undefined;
    }
    try {
      const contract = this.warp.pst(tx_id).setEvaluationOptions({
        // warp checks this before it evaluates any contract source
        whitelistSources: this._antSourceWhitelist,
      });

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

  // Modify hostname to add subdomain
  const url = new URL(arweave_gateway.toString());
  url.hostname = subdomain + "." + url.hostname;

  return url;
};
