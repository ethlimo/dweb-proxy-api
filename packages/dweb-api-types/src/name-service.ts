import { RecordEntryDecodedEIP8121Hook } from "./ens-resolver.js";
import { IRequestContext } from "./request-context.js";
import { DecodedEIP8121Hook } from "@ethlimo/ens-hooks";
export type DecodedDataUri = {
  _tag: "DecodedDataUri";
  data: string;
};

export type DecodedDataUrl = {
  _tag: "DecodedDataUrl";

  data: DecodedEIP8121Hook;
  callData: Uint8Array;
};

export interface DecodedCodecString {
  _tag: "DecodedCodecString";
  codec: string;
}
export interface INameService {
  getContentHash(
    request: IRequestContext,
    name: string,
  ): Promise<DecodedCodecString | DecodedDataUri | DecodedDataUrl | null>;

  getChainId(): number;
}

export interface INameServiceFactory {
  getNameServiceForDomain(
    request: IRequestContext,
    domain: string,
  ): INameService;

  getNameServiceForCointype(
    request: IRequestContext,
    cointype: number,
  ): INameService | undefined;
}

export interface IEnsServiceDataUrlRet {
  _tag: "ens-dataurl";
  data: string;
}

export interface IDataUrlResolverService {
  resolveDataUrl(
    request: IRequestContext,
    decodedDataUrl: RecordEntryDecodedEIP8121Hook,
  ): Promise<IEnsServiceDataUrlRet>;
}
