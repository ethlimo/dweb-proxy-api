import { Redis } from "ioredis";
import { inject, injectable } from "inversify";
import { serialize } from "typeserializer";
import NodeCache from "node-cache";
import { ILoggerService } from "../LoggerService";
import { DITYPES } from "../../dependencies/types";
import { Container } from "inversify";
import { ZodType } from "zod";
import { IConfigurationService } from "../../configuration";
import redisMock from "ioredis-mock";

export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, duration: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  expire(key: string, duration: number): Promise<number>;
  incr(key: string): Promise<number>;
}
@injectable()
export class AbstractRedisClient implements IRedisClient {
  _redis: Redis;
  _configurationService: IConfigurationService;
  constructor() {
  }

  async get(key: string): Promise<string | null> {
    return this._redis.get(key);
  }

  async set(key: string, value: string, duration: number): Promise<"OK"> {
    return this._redis.set(key, value, "EX", duration);
  }

  async ttl(key: string): Promise<number> {
    return this._redis.ttl(key);
  }
  async incr(key: string): Promise<number> {
    return this._redis.incr(key);
  };
  async expire(key: string, duration: number): Promise<number> {
    return this._redis.expire(key, duration);
  }
}

export interface INamedMemoryCache {
  getServiceName(): string;
  put: <T>(key: string, v: T, ttl?: Number) => void;
  get: <T>(key: string) => Promise<T | undefined>;
  getTtl: (key: string) => Promise<number | undefined>;
}

export class MemoryCacheFactory {
  memoryCaches = new Map<string, INamedMemoryCache>();
  createNamedMemoryCacheFactory = (
    container: Container,
    serviceName: string,
  ): INamedMemoryCache => {
    if (this.memoryCaches.has(serviceName)) {
      return this.memoryCaches.get(serviceName)!;
    } else {
      const namedMemoryCache = this.memoryCaches.get(serviceName);
      if (namedMemoryCache) {
        return namedMemoryCache;
      } else {
        const v = new NamedMemoryCache(
          container.get<ILoggerService>(DITYPES.LoggerService),
          serviceName,
          container.get<IConfigurationService>(DITYPES.ConfigurationService),
        );
        this.memoryCaches.set(serviceName, v);
        return v;
      }
    }
  };
}

@injectable()
export class RedisClient extends AbstractRedisClient {
  constructor(@inject(DITYPES.ConfigurationService) configurationService: IConfigurationService) {
    super();
    this._redis = new Redis(configurationService.get().redis.url);
    this._configurationService = configurationService;
  }
}

@injectable()
export class TestRedisClient extends AbstractRedisClient {
  mappings = new Map<string, string | null>();
  constructor(@inject(DITYPES.ConfigurationService) configurationService: IConfigurationService) {
    super();
    this._configurationService = configurationService;
    this._redis = new redisMock();
  }

  async get(key: string): Promise<string | null> {
    return this.mappings.get(key) || null;
  }

  async set(key: string, value: string, duration: number): Promise<"OK"> {
    this.mappings.set(key, value);
    return "OK";
  }

  async ttl(key: string): Promise<number> {
    return 69;
  }
}

@injectable()
export class NamedMemoryCache implements INamedMemoryCache {
  _configurationService: IConfigurationService;
  private _cache: NodeCache;

  private _logger: ILoggerService;
  private _serviceName: string;
  public async put<T>(key: string, v: T, ttl?: number) {
    const configuration = this._configurationService.get();
    this._logger.debug(`${this._serviceName} memoryCache: interning ${key}`);
    if (ttl) {
      this._cache.set<T>(
        key,
        v,
        Math.min(Math.max(ttl, 1), configuration.cache.ttl),
      );
    } else {
      this._cache.set<T>(key, v, configuration.cache.ttl);
    }
  }
  async get<T>(key: string): Promise<T | undefined> {
    const v = this._cache.get<T>(key);
    return v;
  }

  public getServiceName(): string {
    return this._serviceName;
  }

  public constructor(
    @inject(DITYPES.LoggerService) logger: ILoggerService,
    @inject("serviceName") serviceName: string,
    @inject(DITYPES.ConfigurationService) configurationService: IConfigurationService,
  ) {
    this._logger = logger;
    this._serviceName = serviceName;
    this._configurationService = configurationService;
    this._cache = new NodeCache({
      stdTTL: this._configurationService.get().cache.ttl,
    });
    this._cache.on("expired", function (key, value) {
      const currDate = new Date();
      logger.info(
        `PID ${
          process.pid
        } Expired memcache for ${key} with value of ${JSON.stringify(
          value,
        )} at ${currDate.toLocaleString()}`,
      ); //implements #13
    });
  }

  public async getTtl(key: string): Promise<number | undefined> {
    return this._cache.getTtl(key);
  }
}

export interface ICacheService {
  memoize: <RT>(
    fThunk: () => Promise<Awaited<RT>>,
    schema: ZodType<RT>,
    dbPrefix: string,
    key: string,
  ) => Promise<Awaited<RT>>;
  getTtl: (dbPrefix: string, key: string) => Promise<number | undefined>;
}

@injectable()
export class RedisCacheService implements ICacheService {
  private _redisClient: IRedisClient;
  _logger: ILoggerService;
  _configurationService: IConfigurationService;

  public constructor(
    @inject(DITYPES.LoggerService) logger: ILoggerService,
    @inject(DITYPES.RedisClient) redisClient: IRedisClient,
    @inject(DITYPES.ConfigurationService) configurationService: IConfigurationService,
  ) {
    this._logger = logger;
    this._redisClient = redisClient;
    this._configurationService = configurationService;
  }

  public async memoize<RT>(
    fThunk: () => Promise<Awaited<RT>>,
    schema: ZodType<RT>,
    dbPrefix: string,
    key: string,
  ): Promise<Awaited<RT>> {
    const configuration = this._configurationService.get();
    const cKey = `${dbPrefix}/${key}`;
    const defaultTtl = configuration.cache.ttl;
    try {
      var cachedValue = await this._redisClient.get(cKey);
      const redisTTL = await this._redisClient.ttl(cKey);
      var ttl = defaultTtl;

      if (redisTTL && redisTTL >= 1) {
        ttl = Math.min(redisTTL, defaultTtl);
      }

      if (cachedValue) {
        const parsedValue = schema.parse(JSON.parse(cachedValue)); // validate against schema
        if (parsedValue) {
          return await parsedValue;
        } else {
          this._logger.error(
            `Failed to parse cached value for key ${cKey} with value ${cachedValue}, treating as uncached in redis layer`,
          );
          cachedValue = null;
        }
      }

      const result = await fThunk();
      try {
        this._logger.info(
          `Setting cache value for key ${cKey} with ttl ${ttl}`,
        );
        await this._redisClient.set(cKey, serialize(result), ttl);
      } catch (e) {
        this._logger.error(`Failed to set cache value for key ${cKey}: ${e}`);
      }
      return result;
    } catch (e) {
      this._logger.error(
        `RedisCacheService: Received error when querying ${cKey} ${e}`,
      );
      return fThunk();
    }
  }

  public async getTtl(dbPrefix: string, key: string): Promise<number> {
    const cKey = `${dbPrefix}/${key}`;
    return await this._redisClient.ttl(cKey);
  }
}

@injectable()
export class LocallyCachedRedisCacheService<T> implements ICacheService {
  _innerRedis: ICacheService;
  _innerMemoryCache: INamedMemoryCache;
  _logger: ILoggerService;
  _configurationService: IConfigurationService;

  public constructor(
    @inject(DITYPES.LoggerService) logger: ILoggerService,
    @inject(DITYPES.RedisClient) redisClient: IRedisClient,
    @inject(DITYPES.NamedMemoryCacheFactory)
    innerMemoryCacheFactory: (str: string) => INamedMemoryCache,
    @inject(DITYPES.ConfigurationService) configurationService: IConfigurationService,
  ) {
    this._logger = logger;
    this._configurationService = configurationService;
    this._innerRedis = new RedisCacheService(logger, redisClient, configurationService);
    this._innerMemoryCache = innerMemoryCacheFactory("LocallyCachedRedisCache");
  }

  public async memoize<RT>(
    fThunk: () => Promise<Awaited<RT>>,
    schema: ZodType<RT>,
    dbPrefix: string,
    key: string,
  ): Promise<Awaited<RT>> {
    const configuration = this._configurationService.get();
    const cKey = `${dbPrefix}/${key}`;
    const defaultTtl = configuration.cache.ttl;

    try {
      const cachedValue = await this._innerMemoryCache.get<RT>(cKey);
      if (cachedValue) {
        this._logger.info(
          `LocallyCachedRedisCacheService: returning cached value for key ${cKey} via memory cache`,
        );
        return cachedValue;
      }

      const result = await this._innerRedis.memoize<RT>(
        fThunk,
        schema,
        dbPrefix,
        key,
      );
      const ttl = Math.min(
        (await this._innerRedis.getTtl(dbPrefix, key)) || defaultTtl,
        defaultTtl,
      );
      this._logger.info(
        `LocallyCachedRedisCacheService: setting cached value for key ${cKey} via memory cache with ttl ${ttl}`,
      );
      this._innerMemoryCache.put<RT>(cKey, result, ttl);
      return result;
    } catch (e) {
      this._logger.error(e);
      return fThunk();
    }
  }

  public async getTtl(
    dbPrefix: string,
    key: string,
  ): Promise<number | undefined> {
    //return ttl from _innerMemoryCache before redis cache
    const cKey = `${dbPrefix}/${key}`;
    const cachedValue = await this._innerMemoryCache.getTtl(cKey);
    if (cachedValue) {
      return cachedValue;
    } else {
      return await this._innerRedis.getTtl(dbPrefix, key);
    }
  }
}
