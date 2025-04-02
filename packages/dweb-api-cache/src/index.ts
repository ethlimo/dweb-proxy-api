import { Redis } from "ioredis";
import { serialize } from "typeserializer";
import NodeCache from "node-cache";
import { ILoggerService } from "dweb-api-types/dist/logger.js";
import redisMock from "ioredis-mock";
import { IRequestContext } from "dweb-api-types/dist/request-context.js";
import { IRedisClient } from "dweb-api-types/dist/redis.js";
import { ICacheService, INamedMemoryCache } from "dweb-api-types/dist/cache.js";
import { ZodType } from "zod";
import { ICacheConfig, IRedisConfig } from "dweb-api-types/dist/config.js";

interface TheRedisPartsWeUse {
  get: typeof Redis.prototype.get;
  set: typeof Redis.prototype.set;
  ttl: (key: string) => Promise<number>;
  incr: typeof Redis.prototype.incr;
  expire: typeof Redis.prototype.expire;
}

export abstract class AbstractRedisClient implements IRedisClient {
  _redis: TheRedisPartsWeUse;
  _configurationService: IRedisConfig;
  _timeout = 1000;

  private _wait(ms: number, reason: string) {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`AbstractRedisClient timeout: ${reason}`)),
        ms,
      ),
    );
  }

  constructor(_redis: TheRedisPartsWeUse, _configurationService: IRedisConfig) {
    this._redis = _redis;
    this._configurationService = _configurationService;
  }

  private _racePromise<T>(ms: number, reason: string, promise: Promise<T>) {
    return Promise.race([promise, this._wait(ms, reason)]) as Promise<T>;
  }

  async get(key: string): Promise<string | null> {
    return this._racePromise(this._timeout, `get ${key}`, this._redis.get(key));
  }

  async set(key: string, value: string, duration: number): Promise<"OK"> {
    return this._racePromise(
      this._timeout,
      `set ${key}=${value} (duration: ${duration})`,
      this._redis.set(key, value, "EX", duration),
    );
  }

  async ttl(key: string): Promise<number> {
    return this._racePromise(this._timeout, `ttl ${key}`, this._redis.ttl(key));
  }
  async incr(key: string): Promise<number> {
    return this._racePromise(
      this._timeout,
      `incr ${key}`,
      this._redis.incr(key),
    );
  }
  async expire(key: string, duration: number): Promise<number> {
    return this._racePromise(
      this._timeout,
      `expire ${key} ${duration}`,
      this._redis.expire(key, duration),
    );
  }
}

export class MemoryCacheFactory {
  memoryCaches = new Map<string, INamedMemoryCache>();
  createNamedMemoryCacheFactory = (
    serviceName: string,
    logger: ILoggerService,
    configurationService: ICacheConfig,
  ): INamedMemoryCache => {
    if (this.memoryCaches.has(serviceName)) {
      return this.memoryCaches.get(serviceName)!;
    } else {
      const memoryCache = new NamedMemoryCache(
        logger,
        serviceName,
        configurationService,
      );
      this.memoryCaches.set(serviceName, memoryCache);
      return memoryCache;
    }
  };
}

export class RedisClient extends AbstractRedisClient {
  constructor(configurationService: IRedisConfig) {
    const redis = new Redis(configurationService.getRedisConfig().getUrl());
    super(redis, configurationService);
  }
}

export class TestRedisClient extends AbstractRedisClient {
  mappings = new Map<string, string | null>();

  //this is gross but it's necessary because the test suite does early binding of the server service
  proxy: AbstractRedisClient | null = null;

  constructor(configurationService: IRedisConfig) {
    const redis = new (redisMock as any)();
    super(redis, configurationService);

  }

  async get(key: string): Promise<string | null> {
    if (this.proxy) {
      return this.proxy.get(key);
    }
    return this.mappings.get(key) || null;
  }

  async set(key: string, value: string, duration: number): Promise<"OK"> {
    if (this.proxy) {
      return this.proxy.set(key, value, duration);
    }
    this.mappings.set(key, value);
    return "OK";
  }

  async ttl(key: string): Promise<number> {
    if (this.proxy) {
      return this.proxy.ttl(key);
    }
    return 69;
  }

  async incr(key: string): Promise<number> {
    if (this.proxy) {
      return this.proxy.incr(key);
    }
    return 70;
  }

  async expire(key: string, duration: number): Promise<number> {
    if (this.proxy) {
      return this.proxy.expire(key, duration);
    }
    return 71;
  }

  setProxy(proxy: AbstractRedisClient | null) {
    this.proxy = proxy;
  }
}

export class NamedMemoryCache implements INamedMemoryCache {
  _configurationService: ICacheConfig;
  private _cache: NodeCache;

  private _logger: ILoggerService;
  private _serviceName: string;
  public async put<T>(
    request: IRequestContext,
    key: string,
    v: T,
    ttl?: number,
  ) {
    const configuration = this._configurationService.getCacheConfig();
    this._logger.debug(`interning ${key}`, {
      ...request,
      origin: "NamedMemoryCache",
    });
    if (ttl) {
      this._cache.set<T>(
        key,
        v,
        Math.min(Math.max(ttl, 1), configuration.getTtl()),
      );
    } else {
      this._cache.set<T>(key, v, configuration.getTtl());
    }
  }
  async get<T>(request: IRequestContext, key: string): Promise<T | undefined> {
    const v = this._cache.get<T>(key);
    return v;
  }

  public getServiceName(): string {
    return this._serviceName;
  }

  public constructor(
    logger: ILoggerService,
    serviceName: string,
    configurationService: ICacheConfig,
  ) {
    this._configurationService = configurationService;
    this._logger = logger;
    this._serviceName = serviceName;
    this._cache = new NodeCache({
      stdTTL: this._configurationService.getCacheConfig().getTtl(),
    });
    this._cache.on("expired", function (key, value) {
      logger.info("expired key", {
        origin: "NodeCache expired",
        trace_id: "N/A",
        context: {
          key: key,
          value: value,
        },
      }); //implements #13
    });
  }

  public async getTtl(
    request: IRequestContext,
    key: string,
  ): Promise<number | undefined> {
    return this._cache.getTtl(key);
  }
}

export class RedisCacheService implements ICacheService {
  private _redisClient: IRedisClient;
  _logger: ILoggerService;
  _configurationService: IRedisConfig & ICacheConfig;

  public constructor(
    logger: ILoggerService,
    redisClient: IRedisClient,
    configurationService: IRedisConfig & ICacheConfig,
  ) {
    this._logger = logger;
    this._redisClient = redisClient;
    this._configurationService = configurationService;
  }

  public async memoize<RT>(
    request: IRequestContext,
    fThunk: () => Promise<Awaited<RT>>,
    schema: ZodType<RT>,
    dbPrefix: string,
    key: string,
  ): Promise<Awaited<RT>> {
    const cacheConfig = this._configurationService.getCacheConfig();
    const cKey = `${dbPrefix}/${key}`;
    const defaultTtl = cacheConfig.getTtl();
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
            `Failed to parse cached value for, treating as uncached in redis layer`,
            {
              ...request,
              origin: "RedisCacheService",
              context: {
                key: cKey,
                value: cachedValue,
              },
            },
          );
          cachedValue = null;
        }
      }

      const result = await fThunk();
      try {
        this._logger.info("Setting cache value", {
          ...request,
          origin: "RedisCacheService",
          context: {
            key: cKey,
            value: result,
            ttl: ttl,
          },
        });
        await this._redisClient.set(cKey, serialize(result), ttl);
      } catch (e) {
        this._logger.error("Failed to set cache value", {
          ...request,
          origin: "RedisCacheService",
          context: {
            key: cKey,
            value: result,
            ttl: ttl,
          },
        });
      }
      return result;
    } catch (e) {
      this._logger.error("received error when querying cache", {
        ...request,
        origin: "RedisCacheService",
        context: {
          key: cKey,
          error: e,
        },
      });
      return fThunk();
    }
  }

  public async getTtl(
    request: IRequestContext,
    dbPrefix: string,
    key: string,
  ): Promise<number> {
    const cKey = `${dbPrefix}/${key}`;
    return await this._redisClient.ttl(cKey);
  }
}

export class LocallyCachedRedisCacheService<T> implements ICacheService {
  _innerRedis: ICacheService;
  _innerMemoryCache: INamedMemoryCache;
  _logger: ILoggerService;
  _configurationService: IRedisConfig & ICacheConfig;

  public constructor(
    logger: ILoggerService,
    redisClient: IRedisClient,
    innerMemoryCacheFactory: (str: string) => INamedMemoryCache,
    configurationService: IRedisConfig & ICacheConfig,
  ) {
    this._logger = logger;
    this._configurationService = configurationService;
    this._innerRedis = new RedisCacheService(
      logger,
      redisClient,
      configurationService,
    );
    this._innerMemoryCache = innerMemoryCacheFactory("LocallyCachedRedisCache");
  }

  public async memoize<RT>(
    request: IRequestContext,
    fThunk: () => Promise<Awaited<RT>>,
    schema: ZodType<RT>,
    dbPrefix: string,
    key: string,
  ): Promise<Awaited<RT>> {
    const cacheConfig = this._configurationService.getCacheConfig();
    const cKey = `${dbPrefix}/${key}`;
    const defaultTtl = cacheConfig.getTtl();

    try {
      const cachedValue = await this._innerMemoryCache.get<RT>(request, cKey);
      if (cachedValue) {
        this._logger.info(
          "LocallyCachedRedisCacheService: returning cached value memory cache",
          {
            ...request,
            origin: "LocallyCachedRedisCacheService",
            context: {
              key: cKey,
              value: cachedValue,
            },
          },
        );
        return cachedValue;
      }

      const result = await this._innerRedis.memoize<RT>(
        request,
        fThunk,
        schema,
        dbPrefix,
        key,
      );
      const ttl = Math.min(
        (await this._innerRedis.getTtl(request, dbPrefix, key)) || defaultTtl,
        defaultTtl,
      );
      this._logger.info("setting cached value for via memory cache", {
        ...request,
        origin: "LocallyCachedRedisCacheService",
        context: {
          key: cKey,
          value: result,
          ttl: ttl,
        },
      });
      this._innerMemoryCache.put<RT>(request, cKey, result, ttl);
      return result;
    } catch (e) {
      this._logger.error("memoize error", {
        ...request,
        origin: "LocallyCachedRedisCacheService",
        context: {
          key: cKey,
          error: e,
        },
      });
      return fThunk();
    }
  }

  public async getTtl(
    request: IRequestContext,
    dbPrefix: string,
    key: string,
  ): Promise<number | undefined> {
    //return ttl from _innerMemoryCache before redis cache
    const cKey = `${dbPrefix}/${key}`;
    const cachedValue = await this._innerMemoryCache.getTtl(request, cKey);
    if (cachedValue) {
      return cachedValue;
    } else {
      return await this._innerRedis.getTtl(request, dbPrefix, key);
    }
  }
}

class TestLaggyRedisClientInnerRedis implements TheRedisPartsWeUse {
  inner = () =>
    new Promise((_, reject) => {
      setTimeout(() => reject("Error: timeout"), 100000);
    });

  get(key: string): Promise<string> {
    return this.inner() as any;
  }

  set(key: string, value: string): Promise<"OK"> {
    return this.inner() as any;
  }

  ttl(key: string): Promise<number> {
    return this.inner() as any;
  }

  incr(key: string): Promise<number> {
    return this.inner() as any;
  }

  expire(key: string, seconds: number): Promise<number> {
    return this.inner() as any;
  }
}

export class TestLaggyRedisClientProxy extends AbstractRedisClient {
  constructor(configurationService: IRedisConfig) {
    const redis = new TestLaggyRedisClientInnerRedis();
    super(redis, configurationService);
    this._timeout = 5;
  }
}
