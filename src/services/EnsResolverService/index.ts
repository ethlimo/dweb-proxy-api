import { CID } from "multiformats";
import { bases } from "multiformats/basics";
import { inject, injectable } from "inversify";
import { DITYPES } from "../../dependencies/types";
import { IEnsService } from "../EnsService";
import { ILoggerService } from "../LoggerService";
import { ICacheService } from "../CacheService";
import PeerId from "peer-id";
import * as z from "zod";
import { IArweaveResolver } from "./arweave";

const RECORD_CODEC_TYPE = z.enum(["ipfs-ns", "ipns-ns", "arweave-ns", "swarm"]);

const Record = z
  .union([
    z.object({
      _tag: z.literal("Record"),
      codec: RECORD_CODEC_TYPE,
      DoHContentIdentifier: z.string(),
    }),
    z.object({
      _tag: z.literal("ens-socials-redirect"),
      ensName: z.string(),
    }),
  ])
  .nullable();

export type Record = z.infer<typeof Record>;
export interface ProxyRecord {
  XContentLocation: string;
  XContentPath: string;
}

const calculateIpfsIpnsSubdomainRecord = (
  method: "ipfs-ns" | "ipns-ns",
  peerIdOrCid: string,
): Record => {
  return {
    _tag: "Record",
    codec: method,
    DoHContentIdentifier: peerIdOrCid,
  };
};

export async function parseRecord(
  logger: ILoggerService,
  content: string,
  hostname: string,
): Promise<Record> {
  if (content.startsWith("ipfs://")) {
    const ipfsval = content.split("ipfs://")[1];
    var base32Cid = formatCid(logger, ipfsval, hostname);
    if (!base32Cid) {
      return null;
    }
    return calculateIpfsIpnsSubdomainRecord("ipfs-ns", base32Cid);
  } else if (content.startsWith("ipns://")) {
    const ipnsval = content.split("ipns://")[1];
    var base36PeerId = getPeerId(logger, ipnsval, hostname);
    if (!base36PeerId) {
      logger.error(`parseRecord: ipns://${ipnsval} not supported`);
      return null;
    }
    return calculateIpfsIpnsSubdomainRecord("ipns-ns", base36PeerId);
  } else if (content.startsWith("arweave://")) {
    const cleanPath = content.split("arweave://")[1];
    return {
      _tag: "Record",
      codec: "arweave-ns",
      DoHContentIdentifier: cleanPath,
    };
  } else if (content.startsWith("bzz://")) {
    const cleanPath = content.split("bzz://")[1];
    return {
      _tag: "Record",
      codec: "swarm",
      DoHContentIdentifier: cleanPath,
    };
  } else {
    return null;
  }
}

export function getPeerId(logger: ILoggerService, value: string, hostname: string) {
  var peerId;
  try {
    peerId = PeerId.createFromB58String(value);
  } catch (err) {
    switch (err.message) {
      case "Non-base58btc character":
        logger.info(
          `Non-base58btc character: ${value}. Probably using DNSLink for ${hostname}`,
        );
        return value;
      default:
        logger.error(
          `Error converting IPNS PeerID ${value} for ${hostname}: ${err.message}`,
        );
        return null;
    }
  }
  try {
    const peerIdCid = formatCid(logger, peerId.toString(), hostname, "peerId");
    return peerIdCid;
  } catch (err) {
    logger.error(
      `Error formatting IPNS PeerID ${value} for ${hostname}: ${err.message}`,
    );
    return null;
  }
}

type baseKeys = keyof typeof bases;

function formatCid(
  logger: ILoggerService,
  value: string,
  hostname: string,
  format?: "peerId",
) {
  try {
    const prefix = value.substring(0, 1);
    const base = Object.keys(bases)
      .map((key: baseKeys) => bases[key])
      .filter((x) => {
        return x.prefix.toString() === prefix;
      })[0];
    if (!base) {
      if (prefix === "Q") {
        return CID.parse(value).toV1().toString();
      }
      throw `Base prefix lookup failed ${prefix}`;
    } else {
      var cid;
      if (format === "peerId") {
        cid = CID.parse(value, base).toV1().toString(bases.base36);
      } else {
        cid = CID.parse(value, base).toV1().toString(bases.base32);
      }
      return cid;
    }
  } catch (err) {
    logger.error(
      `Error converting IPFS multihash ${value} for ${hostname}: ${err}`,
    );
    return null;
  }
}

const IEnsResolverServiceResolveEnsRet = z.object({
  record: Record,
  resolverExists: z.boolean(),
});

export type IEnsResolverServiceResolveEnsRet = z.infer<
  typeof IEnsResolverServiceResolveEnsRet
>;

export interface IEnsResolverService {
  resolveEns(hostname: string): Promise<IEnsResolverServiceResolveEnsRet>;
}

@injectable()
export class EnsResolverService implements IEnsResolverService {
  private _ensService: IEnsService;
  private _logger: ILoggerService;
  private _cacheService: ICacheService;
  private _arweaveResolver: IArweaveResolver;

  constructor(
    @inject(DITYPES.EnsService) ensService: IEnsService,
    @inject(DITYPES.LoggerService) logger: ILoggerService,
    @inject(DITYPES.CacheService) cacheService: ICacheService,
    @inject(DITYPES.ArweaveResolver) arweaveResolver: IArweaveResolver,
  ) {
    this._ensService = ensService;
    this._logger = logger;
    this._cacheService = cacheService;
    this._arweaveResolver = arweaveResolver;
  }
  //uncached internal implementation
  private async _resolveEns(
    hostname: string,
  ): Promise<IEnsResolverServiceResolveEnsRet> {
    try {
      let contentHash = await this._ensService.getContentHash(hostname);
      this._logger.debug(`_resolveEns: contentHash for ${hostname}: ${JSON.stringify(contentHash)}`);
      if (contentHash.error) {
        throw contentHash.reason;
      }

      var res = contentHash.result;

      if (!res) {
        return {
          record: {
            _tag: "ens-socials-redirect",
            ensName: hostname,
          },
          resolverExists: false,
        };
      }

      if (res.startsWith("arweave://")) {
        const ar_id = res.split("arweave://")[1];
        this._logger.debug(`_resolveEns: ar_id for ${hostname}: ${ar_id}`);
        res = "arweave://" + (await this._arweaveResolver.resolveArweave(ar_id, hostname));
      }
      const r: Record = await parseRecord(this._logger, res, hostname);
      this._logger.debug(`_resolveEns: record for ${hostname}: ${JSON.stringify(r)}`);
      const retval: IEnsResolverServiceResolveEnsRet = {
        record: r,
        resolverExists: true,
      };

      return retval;
    } catch (err) {
      this._logger.error(`Unable to resolve ${hostname}: ${err}`);
      throw err;
    }
  }
  public async resolveEns(
    hostname: string,
  ): Promise<IEnsResolverServiceResolveEnsRet> {
    return await this._cacheService.memoize(
      () => this._resolveEns(hostname),
      IEnsResolverServiceResolveEnsRet,
      "resolveEns",
      hostname,
    );
  }
}
