import { IRequestContext } from "./request-context.js";

export interface IKuboApiService {
  resolveIpnsName(
    request: IRequestContext,
    name: string,
  ): Promise<string | null>;
}
