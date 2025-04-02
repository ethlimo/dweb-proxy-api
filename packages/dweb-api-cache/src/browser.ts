import { ICacheService } from "dweb-api-types/dist/cache.js";
import { IRequestContext } from "dweb-api-types/dist/request-context";
import { ILoggerService } from "dweb-api-types/dist/logger";
import { ZodType } from "zod";

export const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 1 day in milliseconds

export class IndexedDbCacheService implements ICacheService {
  private db: IDBDatabase | null = null;
  private _logger: ILoggerService;

  constructor(logger: ILoggerService) {
    this._logger = logger;
    this.openDatabase();
  }

  private async openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("cache-db", 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        db.createObjectStore("cache-store", { keyPath: "key" });
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        this._logger.info("IndexedDB opened successfully", {
          origin: "IndexedDbCacheService",
          trace_id: "open-db",
        });
        resolve();
      };

      request.onerror = (event) => {
        this._logger.error("Failed to open IndexedDB", {
          origin: "IndexedDbCacheService",
          trace_id: "open-db",
          context: { error: (event.target as IDBOpenDBRequest).error },
        });
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  private async storeInCache<RT>(
    request: IRequestContext,
    dbPrefix: string,
    key: string,
    value: RT,
    ttl: number = DEFAULT_TTL,
  ): Promise<void> {
    const now = Date.now();
    const expirationTime = now + ttl;

    const data = {
      key: `${dbPrefix}-${key}`,
      value: value,
      expiration: expirationTime,
    };

    if (!this.db) await this.openDatabase();

    try {
      const tx = this.db!.transaction("cache-store", "readwrite");
      const store = tx.objectStore("cache-store");
      await store.put(data);
      this._logger.debug("Data stored in cache", {
        origin: "IndexedDbCacheService",
        ...request,
        context: { key, dbPrefix, expirationTime },
      });
    } catch (error) {
      this._logger.error("Failed to store data in cache", {
        origin: "IndexedDbCacheService",
        ...request,
        context: { error },
      });
      throw error;
    }
  }

  private async retrieveFromCache<RT>(
    request: IRequestContext,
    dbPrefix: string,
    key: string,
  ): Promise<RT | null> {
    if (!this.db) await this.openDatabase();

    try {
      const tx = this.db!.transaction("cache-store", "readonly");
      const store = tx.objectStore("cache-store");
      const data = (await store.get(`${dbPrefix}-${key}`)) as unknown as
        | {
            key: string;
            value: RT;
            expiration: number;
          }
        | undefined;

      if (!data) {
        this._logger.info("Cache miss", {
          origin: "IndexedDbCacheService",
          ...request,
          context: { key, dbPrefix },
        });
        return null;
      }

      const now = Date.now();
      if (now > data.expiration) {
        await this.deleteFromCache(request, dbPrefix, key);
        this._logger.info("Cache entry expired", {
          origin: "IndexedDbCacheService",
          ...request,
          context: { key, dbPrefix },
        });
        return null;
      }

      this._logger.debug("Cache hit", {
        origin: "IndexedDbCacheService",
        ...request,
        context: { key, dbPrefix },
      });
      return data.value as RT;
    } catch (error) {
      this._logger.error("Failed to retrieve data from cache", {
        origin: "IndexedDbCacheService",
        ...request,
        context: { error },
      });
      throw error;
    }
  }

  private async deleteFromCache(
    request: IRequestContext,
    dbPrefix: string,
    key: string,
  ): Promise<void> {
    if (!this.db) await this.openDatabase();

    try {
      const tx = this.db!.transaction("cache-store", "readwrite");
      const store = tx.objectStore("cache-store");
      await store.delete(`${dbPrefix}-${key}`);
      this._logger.debug("Cache entry deleted", {
        origin: "IndexedDbCacheService",
        ...request,
        context: { key, dbPrefix },
      });
    } catch (error) {
      this._logger.error("Failed to delete cache entry", {
        origin: "IndexedDbCacheService",
        ...request,
        context: { error },
      });
      throw error;
    }
  }

  async memoize<RT>(
    request: IRequestContext,
    fThunk: () => Promise<Awaited<RT>>,
    schema: ZodType<RT>,
    dbPrefix: string,
    key: string,
  ): Promise<Awaited<RT>> {
    try {
      const cachedData = await this.retrieveFromCache<RT>(
        request,
        dbPrefix,
        key,
      );
      if (cachedData) {
        // Validate cached data against the schema
        const parsedData = schema.parse(cachedData);
        return await parsedData;
      }
    } catch (error) {
      this._logger.warn(
        "Cache retrieval or validation failed, executing fThunk",
        {
          origin: "IndexedDbCacheService",
          ...request,
          context: { key, dbPrefix, error },
        },
      );
      return await fThunk();
    }

    try {
      // If not in cache or validation fails, execute the function
      const result = await fThunk();
      await this.storeInCache(request, dbPrefix, key, result);

      return result;
    } catch (error) {
      this._logger.error("fThunk execution failed", {
        origin: "IndexedDbCacheService",
        ...request,
        context: { error },
      });
      throw error; // Propagate the error if fThunk throws
    }
  }

  async getTtl(
    request: IRequestContext,
    dbPrefix: string,
    key: string,
  ): Promise<number | undefined> {
    if (!this.db) await this.openDatabase();

    try {
      const tx = this.db!.transaction("cache-store", "readonly");
      const store = tx.objectStore("cache-store");
      const data = (await store.get(`${dbPrefix}-${key}`)) as unknown as
        | {
            key: string;
            value: unknown;
            expiration: number;
          }
        | undefined;

      if (!data) return undefined;

      const now = Date.now();
      if (now > data.expiration) {
        await this.deleteFromCache(request, dbPrefix, key);
        return undefined;
      }

      return data.expiration - now;
    } catch (error) {
      this._logger.error("Failed to get TTL", {
        origin: "IndexedDbCacheService",
        ...request,
        context: { error },
      });
      return undefined;
    }
  }
}
