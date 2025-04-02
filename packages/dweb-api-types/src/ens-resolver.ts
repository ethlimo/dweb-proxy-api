import { z } from "zod";
import { IRequestContext } from "./request-context.js";

export const RECORD_CODEC_TYPE = z.enum([
  "ipfs-ns",
  "ipns-ns",
  "arweave-ns",
  "swarm",
]);

export const Record = z
  .union([
    z.object({
      _tag: z.literal("Record"),
      codec: RECORD_CODEC_TYPE,
      DoHContentIdentifier: z.string(),
      ensName: z.string(),
    }),
    z.object({
      _tag: z.literal("ens-socials-redirect"),
      ensName: z.string(),
    }),
  ])
  .nullable();

export type IRecord = z.infer<typeof Record>;

export interface IEnsResolverService {
  resolveEns(
    request: IRequestContext,
    hostname: string,
  ): Promise<IEnsResolverServiceResolveEnsRet>;
}

export const ZodIEnsResolverServiceResolveEnsRet = z.object({
  record: Record,
  resolverExists: z.boolean(),
});

export type IEnsResolverServiceResolveEnsRet = z.infer<
  typeof ZodIEnsResolverServiceResolveEnsRet
>;
