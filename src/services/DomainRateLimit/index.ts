import { inject, injectable } from "inversify";
import { DITYPES } from "../../dependencies/types";
import { IRedisClient } from "../CacheService";
import { ILoggerService } from "../LoggerService";

export interface IDomainRateLimitServiceRet {
    countOverMax: boolean,
    count: number,
    ttl: number
}

export interface IDomainRateLimitService {
    incrementRateLimit(domain: string, maxQueries: number, intervalInSeconds: number): Promise<IDomainRateLimitServiceRet>;
}

@injectable()
export class DomainRateLimitService implements IDomainRateLimitService {
    _redisClient: IRedisClient;
    _logger: ILoggerService;

    constructor(@inject(DITYPES.RedisClient) redisClient: IRedisClient, @inject(DITYPES.LoggerService) logger: ILoggerService) {
        this._redisClient = redisClient;
        this._logger = logger;
    }

    async incrementRateLimit(domain: string, maxQueries: number, intervalInSeconds: number): Promise<IDomainRateLimitServiceRet> {
        const key = `rate_limit/${domain}`;
        const count = await this._redisClient.incr(key);
        var ttl = await this._redisClient.ttl(key);
        this._logger.debug(`Rate limit key ${key} incremented to ${count}, TTL is ${ttl}`);
        if(ttl < 1) {
            await this._redisClient.expire(key, intervalInSeconds);
            ttl = intervalInSeconds
            this._logger.debug(`Rate limit key ${key} expired, setting new TTL to ${intervalInSeconds}`);
        }
        return {
            countOverMax: count > maxQueries,
            count: count,
            ttl: ttl
        }
    }
}