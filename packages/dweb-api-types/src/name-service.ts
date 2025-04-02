import { IRequestContext } from "./request-context.js";

export interface INameService {
  getContentHash(
    request: IRequestContext,
    name: string,
  ): Promise<string | null>;
}

export interface INameServiceFactory {
  getNameServiceForDomain(
    request: IRequestContext,
    domain: string,
  ): INameService;
}
