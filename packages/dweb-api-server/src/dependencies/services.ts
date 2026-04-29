import type { ServerConfiguration } from "../configuration/index.js";
import {
  TestConfigurationService,
  getDefaultServerConfiguration,
} from "../configuration/index.js";
import type { IDnsQuery } from "../dnsquery/index.js";
import { DnsQuery } from "../dnsquery/index.js";
import type {
  IDomainQueryService,
  IDomainQuerySuperagentService,
} from "../services/DomainsQueryService/index.js";
import {
  DomainQueryService,
  DomainQuerySuperagentService,
  TestDomainQuerySuperagentService,
} from "../services/DomainsQueryService/index.js";
import { TestResolverService } from "../test/TestResolverService.js";
import type { IDomainRateLimitService } from "../services/DomainRateLimit/index.js";
import { DomainRateLimitService } from "../services/DomainRateLimit/index.js";
import { KuboApiService } from "../services/KuboApiService/index.js";
import {
  EnvironmentBinding,
  EnvironmentConfiguration,
} from "./BindingsManager.js";
import type { ILoggerService } from "dweb-api-types/logger";
import type { IRedisClient } from "dweb-api-types/redis";
import type {
  ICacheService,
  INamedMemoryCache,
} from "dweb-api-types/cache";
import type { IKuboApiService } from "dweb-api-types/kubo-api";
import type {
  IDataUrlResolverService,
  INameService,
  INameServiceFactory,
} from "dweb-api-types/name-service";
import type { IArweaveResolver } from "dweb-api-types/arweave";
import type { IEnsResolverService } from "dweb-api-types/ens-resolver";
import { EnsResolverService } from "dweb-api-resolver/resolver";
import type { IHostnameSubstitutionService } from "dweb-api-resolver/HostnameSubstitutionService";
import { HostnameSubstitutionService } from "dweb-api-resolver/HostnameSubstitutionService";
import { ArweaveResolver } from "dweb-api-resolver/resolver/arweave";
import {
  MemoryCacheFactory,
  RedisClient,
  TestRedisClient,
  LocallyCachedRedisCacheService,
} from "dweb-api-cache";
import { TestLoggerService, LoggerService } from "dweb-api-logger";
import { NameServiceFactory } from "dweb-api-resolver/nameservice";
import { Web3NameSdkService } from "dweb-api-resolver/nameservice/Web3NameSdkService";
import { EnsService } from "dweb-api-resolver/nameservice/EnsService";

export const createApplicationConfigurationBindingsManager = async () => {
  const configuration = new EnvironmentBinding<ServerConfiguration>({
    [EnvironmentConfiguration.Production]: async () =>
      getDefaultServerConfiguration(),
    [EnvironmentConfiguration.Development]: async () =>
      new TestConfigurationService(),
  });
  const logger = new EnvironmentBinding<ILoggerService>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new LoggerService(await configuration.getBinding(env)),
    [EnvironmentConfiguration.Development]: async (env) =>
      new TestLoggerService(await configuration.getBinding(env)),
  });

  const _namedMemoryCacheFactory = new MemoryCacheFactory();

  const namedMemoryCacheFactory = new EnvironmentBinding<
    (x: string) => INamedMemoryCache
  >({
    [EnvironmentConfiguration.Production]: async (env) => {
      const l = await logger.getBinding(env);
      const c = await configuration.getBinding(env);
      return (serviceName: string) =>
        _namedMemoryCacheFactory.createNamedMemoryCacheFactory(
          serviceName,
          l,
          c,
        );
    },
    [EnvironmentConfiguration.Development]: async (env) => {
      const l = await logger.getBinding(env);
      const c = await configuration.getBinding(env);
      return (serviceName: string) =>
        _namedMemoryCacheFactory.createNamedMemoryCacheFactory(
          serviceName,
          l,
          c,
        );
    },
  });

  const redisClient = new EnvironmentBinding<IRedisClient>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new RedisClient(await configuration.getBinding(env)),
    [EnvironmentConfiguration.Development]: async (env) =>
      new TestRedisClient(await configuration.getBinding(env)),
  });

  const cacheService = new EnvironmentBinding<ICacheService>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new LocallyCachedRedisCacheService(
        await logger.getBinding(env),
        await redisClient.getBinding(env),
        await namedMemoryCacheFactory.getBinding(env),
        await configuration.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: async (env) =>
      new LocallyCachedRedisCacheService(
        await logger.getBinding(env),
        await redisClient.getBinding(env),
        await namedMemoryCacheFactory.getBinding(env),
        await configuration.getBinding(env),
      ),
  });

  const hostnameSubstitution =
    new EnvironmentBinding<IHostnameSubstitutionService>({
      [EnvironmentConfiguration.Production]: async (env) =>
        new HostnameSubstitutionService(
          await configuration.getBinding(env),
          await logger.getBinding(env),
        ),
      [EnvironmentConfiguration.Development]: async (env) =>
        new HostnameSubstitutionService(
          await configuration.getBinding(env),
          await logger.getBinding(env),
        ),
    });

  const domainQuerySuperagent =
    new EnvironmentBinding<IDomainQuerySuperagentService>({
      [EnvironmentConfiguration.Production]: async (env) =>
        new DomainQuerySuperagentService(await configuration.getBinding(env)),
      [EnvironmentConfiguration.Development]: async () =>
        new TestDomainQuerySuperagentService(),
    });

  const domainQuery = new EnvironmentBinding<IDomainQueryService>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new DomainQueryService(
        await logger.getBinding(env),
        await domainQuerySuperagent.getBinding(env),
        await cacheService.getBinding(env),
        await configuration.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: async (env) =>
      new DomainQueryService(
        await logger.getBinding(env),
        await domainQuerySuperagent.getBinding(env),
        await cacheService.getBinding(env),
        await configuration.getBinding(env),
      ),
  });

  const kuboApi = new EnvironmentBinding<IKuboApiService>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new KuboApiService(
        await logger.getBinding(env),
        await configuration.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: async (env) =>
      new KuboApiService(
        await logger.getBinding(env),
        await configuration.getBinding(env),
      ),
  });

  const web3NameSdk = new EnvironmentBinding<INameService>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new Web3NameSdkService(
        await configuration.getBinding(env),
        await logger.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: async () =>
      new TestResolverService(),
  });

  const createNameService = async (
    env: EnvironmentConfiguration,
  ): Promise<EnsService> => {
    const v = new EnsService(
      await configuration.getBinding(env),
      await cacheService.getBinding(env),
      await logger.getBinding(env),
    );
    await v.init();
    return v;
  };

  const ensService = new EnvironmentBinding<INameService>({
    [EnvironmentConfiguration.Production]: createNameService,
    [EnvironmentConfiguration.Development]: async () =>
      new TestResolverService(),
  });

  const domainRateLimit = new EnvironmentBinding<IDomainRateLimitService>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new DomainRateLimitService(
        await redisClient.getBinding(env),
        await logger.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: async (env) =>
      new DomainRateLimitService(
        await redisClient.getBinding(env),
        await logger.getBinding(env),
      ),
  });

  const arweaveResolver = new EnvironmentBinding<IArweaveResolver>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new ArweaveResolver(await logger.getBinding(env)),
    [EnvironmentConfiguration.Development]: async () =>
      new TestResolverService(),
  });

  const nameServiceFactory = new EnvironmentBinding<INameServiceFactory>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new NameServiceFactory(
        await logger.getBinding(env),
        await ensService.getBinding(env),
        await web3NameSdk.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: async (env) =>
      new NameServiceFactory(
        await logger.getBinding(env),
        await ensService.getBinding(env),
        await web3NameSdk.getBinding(env),
      ),
  });

  const ensResolver = new EnvironmentBinding<IEnsResolverService>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new EnsResolverService(
        await logger.getBinding(env),
        await cacheService.getBinding(env),
        await arweaveResolver.getBinding(env),
        await kuboApi.getBinding(env),
        await nameServiceFactory.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: async (env) =>
      new EnsResolverService(
        await logger.getBinding(env),
        await cacheService.getBinding(env),
        await arweaveResolver.getBinding(env),
        await kuboApi.getBinding(env),
        await nameServiceFactory.getBinding(env),
      ),
  });

  const dnsQuery = new EnvironmentBinding<IDnsQuery>({
    [EnvironmentConfiguration.Production]: async (env) =>
      new DnsQuery(
        await logger.getBinding(env),
        await configuration.getBinding(env),
        await domainQuery.getBinding(env),
        await ensResolver.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: async (env) =>
      new DnsQuery(
        await logger.getBinding(env),
        await configuration.getBinding(env),
        await domainQuery.getBinding(env),
        await ensResolver.getBinding(env),
      ),
  });

  const dataUrlResolverService =
    new EnvironmentBinding<IDataUrlResolverService>({
      [EnvironmentConfiguration.Production]: createNameService,
      [EnvironmentConfiguration.Development]: () => {
        throw new Error("Not implemented");
      },
    });

  return {
    configuration,
    logger,
    namedMemoryCacheFactory,
    redisClient,
    cacheService,
    hostnameSubstitution,
    domainQuerySuperagent,
    domainQuery,
    kuboApi,
    web3NameSdk,
    ensService,
    domainRateLimit,
    arweaveResolver,
    nameServiceFactory,
    ensResolver,
    dnsQuery,
    dataUrlResolverService,
  };
};
