import { IRequestContext } from "./request-context.js";
import { ZodType } from "zod";

export interface ICacheService {
  memoize: <RT>(
    request: IRequestContext,
    fThunk: () => Promise<Awaited<RT>>,
    schema: ZodType<RT>,
    dbPrefix: string,
    key: string,
  ) => Promise<Awaited<RT>>;
  getTtl: (
    request: IRequestContext,
    dbPrefix: string,
    key: string,
  ) => Promise<number | undefined>;
}

export interface INamedMemoryCache {
  getServiceName(): string;
  put: <T>(request: IRequestContext, key: string, v: T, ttl?: number) => void;
  get: <T>(request: IRequestContext, key: string) => Promise<T | undefined>;
  getTtl: (
    request: IRequestContext,
    key: string,
  ) => Promise<number | undefined>;
}
