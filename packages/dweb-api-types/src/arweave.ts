import { IRequestContext } from "./request-context.js";

export interface IArweaveResolver {
  resolveArweave: (
    request: IRequestContext,
    tx_id: string,
    ens_name: string,
  ) => Promise<string>;
}
