import { IRedisClient } from "dweb-api-types/dist/redis";
import { ILoggerService } from "dweb-api-types/dist/logger";
import { IRequestContext } from "dweb-api-types/dist/request-context";

export interface IDomainRateLimitServiceRet {
  countOverMax: boolean;
  count: number;
  ttl: number;
}

export interface IDomainRateLimitService {
  incrementRateLimit(
    request: IRequestContext,
    domain: string,
    maxQueries: number,
    intervalInSeconds: number,
  ): Promise<IDomainRateLimitServiceRet>;
}

export class DomainRateLimitService implements IDomainRateLimitService {
  _redisClient: IRedisClient;
  _logger: ILoggerService;

  constructor(redisClient: IRedisClient, logger: ILoggerService) {
    this._redisClient = redisClient;
    this._logger = logger;
  }

  async incrementRateLimit(
    request: IRequestContext,
    domain: string,
    maxQueries: number,
    intervalInSeconds: number,
  ): Promise<IDomainRateLimitServiceRet> {
    const key = `rate_limit/${domain}`;
    const count = await this._redisClient.incr(key);
    var ttl = await this._redisClient.ttl(key);
    this._logger.debug("Rate limit incremented", {
      ...request,
      origin: "DomainRateLimitService",
      context: {
        key: key,
        count: count,
        ttl: ttl,
      },
    });
    if (ttl < 1) {
      await this._redisClient.expire(key, intervalInSeconds);
      ttl = intervalInSeconds;
      this._logger.debug(`Rate limit expired, setting new TTL`, {
        ...request,
        origin: "DomainRateLimitService",
        context: {
          key: key,
          count: count,
          ttl: ttl,
        },
      });
    }
    return {
      countOverMax: count > maxQueries,
      count: count,
      ttl: ttl,
    };
  }
}
