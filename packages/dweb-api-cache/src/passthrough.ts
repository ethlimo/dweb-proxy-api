import { ICacheService } from "dweb-api-types/dist/cache.js";
import { IRequestContext } from "dweb-api-types/dist/request-context";
import { ZodType } from "zod";

export class PassthroughCacheService implements ICacheService {
  async memoize<RT>(
    _request: IRequestContext,
    fThunk: () => Promise<Awaited<RT>>,
    _schema: ZodType<RT>,
    _dbPrefix: string,
    _key: string,
  ): Promise<Awaited<RT>> {
    // Directly execute fThunk and return the result, without caching
    return await fThunk();
  }

  async getTtl(
    _request: IRequestContext,
    _dbPrefix: string,
    _key: string,
  ): Promise<number | undefined> {
    // Since this is a passthrough, there is no TTL to return
    return undefined;
  }
}
