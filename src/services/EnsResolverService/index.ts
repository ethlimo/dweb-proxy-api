import { CID } from "multiformats";
import { bases } from "multiformats/basics";
import { inject, injectable } from "inversify";
import { DITYPES } from "../../dependencies/types";
import { INameService, INameServiceFactory, NameServiceFactory } from "../NameService";
import { ILoggerService } from "../LoggerService";
import { ICacheService } from "../CacheService";
import { peerIdFromString } from '@libp2p/peer-id'
import * as z from "zod";
import { IArweaveResolver } from "./arweave";
import { IKuboApiService } from "../KuboApiService";
import { IRequestContext } from "../lib";

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
  request: IRequestContext,
  logger: ILoggerService,
  content: string,
  hostname: string,
): Promise<Record> {

  if (content.startsWith("ipfs://")) {
    const ipfsval = content.split("ipfs://")[1];
    var base32Cid = formatCid(request, logger, ipfsval, hostname);
    if (!base32Cid) {
      return null;
    }
    return calculateIpfsIpnsSubdomainRecord("ipfs-ns", base32Cid);
  } else if (content.startsWith("ipns://")) {
    const ipnsval = content.split("ipns://")[1];
    var base36PeerId = getPeerId(request, logger, ipnsval, hostname);
    if (!base36PeerId) {
      logger.error('not supported', {
        ...request,
        origin: 'parseRecord',
        context: {
          ipnsval: ipnsval,
        }
      });
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
//this is sort of redundant
//when ipns -> ipfs resolution is performed, we get the internal path representation instead of protocol representation
//this performs the conversion /ipns/... -> ipns://... so that ipns://... can be properly parsed by parseRecord
function ipfsInternalPathRepresentationToCanonicalProtocolRepresentation(content: string) {
  let contentIpfsInternalsSanitized = content;
  if (content.startsWith("/ipns/")) {
    contentIpfsInternalsSanitized = content.replace("/ipns/", "ipns://");
  } else if (content.startsWith("/ipfs/")) {
    contentIpfsInternalsSanitized = content.replace("/ipfs/", "ipfs://");
  }
  return contentIpfsInternalsSanitized;
}

export function getPeerId(request: IRequestContext, logger: ILoggerService, value: string, hostname: string) {
  var peerId;
  try {
    peerId = peerIdFromString(value).toCID().toString();
  } catch (err) {
    if (err instanceof RangeError && err.message.startsWith('Unable to decode multibase string')) {
      logger.info(
        'Unable to decode multibase string, probably using another ENS record for hostname',
        {
          ...request,
          origin: 'getPeerId',
          context: {
            value: value,
            hostname: hostname,
            error: err
          }
        }
      );
      return value;
    } 
    else if (err instanceof Error && err.message.startsWith('Non-base36 character')) {
      logger.info(
        `Non-base36 character, probably using DNSLink`,
        {
          ...request,
          origin: 'getPeerId',
          context: {
            value: value,
            hostname: hostname,
          }
        });
        return value;
      } 
    else {
      logger.error(
          'Error converting IPNS PeerID',
          {
            ...request,
            origin: 'getPeerId',
            context: {
              value: value,
              hostname: hostname,
              error: err
            }
          }
        );
        return null;
      }
    }
  try {
    const peerIdCid = formatCid(request, logger, peerId.toString(), hostname, "peerId");
    return peerIdCid;
  } catch (err) {
    logger.error(
      'Error formatting IPNS PeerID',
      {
        ...request,
        origin: 'getPeerId',
        context: {
          value: value,
          hostname: hostname,
          error: err
        }
      }
    );
    return null;
  }
}

type baseKeys = keyof typeof bases;

function formatCid(
  request: IRequestContext,
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
      'Error converting IPFS multihash',
      {
        ...request,
        origin: 'formatCid',
        context: {
          value: value,
          hostname: hostname,
          error: err
        }
      }
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
  resolveEns(request: IRequestContext, hostname: string): Promise<IEnsResolverServiceResolveEnsRet>;
}

@injectable()
export class EnsResolverService implements IEnsResolverService {
  private _logger: ILoggerService;
  private _cacheService: ICacheService;
  private _arweaveResolver: IArweaveResolver;
  private _kuboApiService: IKuboApiService;
  private _nameServiceFactory: INameServiceFactory;

  constructor(
    @inject(DITYPES.LoggerService) logger: ILoggerService,
    @inject(DITYPES.CacheService) cacheService: ICacheService,
    @inject(DITYPES.ArweaveResolver) arweaveResolver: IArweaveResolver,
    @inject(DITYPES.KuboApiService) kuboApiService: IKuboApiService,
    @inject(DITYPES.NameServiceFactory) nameServiceFactory: INameServiceFactory
  ) {
    this._logger = logger;
    this._cacheService = cacheService;
    this._arweaveResolver = arweaveResolver;
    this._kuboApiService = kuboApiService;
    this._nameServiceFactory = nameServiceFactory;
  }
  //uncached internal implementation
  private async _resolveEns(
    request: IRequestContext,
    hostname: string,
  ): Promise<IEnsResolverServiceResolveEnsRet> {
    try {
      const nameService = this._nameServiceFactory.getNameServiceForDomain(request, hostname);
      let contentHash = await nameService.getContentHash(request, hostname);
      this._logger.debug(
        'contenthash',
        {
          ...request,
          origin: 'resolveEns',
          context: {
            contentHash: contentHash
          }
        }
      )
      if (contentHash.error) {
        throw contentHash.reason;
      }

      let res = contentHash.result;

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
        this._logger.debug('ar_id', {
          ...request,
          origin: 'resolveEns',
          context: {
            ar_id: ar_id
          }
        });
        res = "arweave://" + (await this._arweaveResolver.resolveArweave(request, ar_id, hostname));
      } else if(res.startsWith("ipns://")) {
        this._logger.debug('resolving ipns', {
          ...request,
          origin: 'resolveEns',
          context: {
            res: res
          } 
        });
        let ret = (await this._kuboApiService.resolveIpnsName(request, res));

        if (ret) {
          res = ipfsInternalPathRepresentationToCanonicalProtocolRepresentation(ret);
        }
      }

      const r: Record = await parseRecord(request, this._logger, res, hostname);
      this._logger.debug('record', {
        ...request,
        origin: 'resolveEns',
        context: {
          record: r
        }
      });
      const retval: IEnsResolverServiceResolveEnsRet = {
        record: r,
        resolverExists: true,
      };

      return retval;
    } catch (err) {
      this._logger.error('resolution failure', {
        ...request,
        origin: 'resolveEns',
        context: {
          hostname: hostname,
          error: err
        }
      });
      throw err;
    }
  }
  public async resolveEns(
    request: IRequestContext,
    hostname: string,
  ): Promise<IEnsResolverServiceResolveEnsRet> {
    return await this._cacheService.memoize(
      request,
      () => this._resolveEns(request, hostname),
      IEnsResolverServiceResolveEnsRet,
      "resolveEns",
      hostname,
    );
  }
}
