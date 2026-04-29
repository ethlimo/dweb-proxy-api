import { z } from "zod";
import { IRequestContext } from "./request-context.js";

export const RECORD_CODEC_TYPE = z.enum([
  "ipfs-ns",
  "ipns-ns",
  "arweave-ns",
  "swarm",
]);

/*
export interface EIP8121Target {
    chainId: number;
    address: string;
}
export interface DecodedEIP8121Hook {
    functionSignature: string;
    functionCall: string;
    returnType: string;
    target: EIP8121Target;
}
*/

export const DecodedEIP8121HookSchema = z.object({
  functionSignature: z.string(),
  functionCall: z.string(),
  returnType: z.string(),
  target: z.object({
    chainId: z.number(),
    address: z.string(),
  }),
});

export const RecordEntryDecodedEIP8121HookSchema = z.object({
  _tag: z.literal("DataUrlRecord"),
  ensname: z.string(),
  data: DecodedEIP8121HookSchema,
});

export type RecordEntryDecodedEIP8121Hook = z.infer<
  typeof RecordEntryDecodedEIP8121HookSchema
>;

export const Record = z
  .union([
    z.object({
      _tag: z.literal("Record"),
      codec: RECORD_CODEC_TYPE,
      DoHContentIdentifier: z.string(),
      ensName: z.string(),
    }),
    z.object({
      _tag: z.literal("DataUriRecord"),
      uri: z.string(),
    }),
    z.object({
      _tag: z.literal("ens-socials-redirect"),
      ensName: z.string(),
    }),
    RecordEntryDecodedEIP8121HookSchema,
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
