import {
  ServerConfiguration,
  TestConfigurationService,
  getDefaultServerConfiguration,
} from "../configuration";
import { IDnsQuery, DnsQuery } from "../dnsquery";
import {
  IDomainQueryService,
  DomainQueryService,
  IDomainQuerySuperagentService,
  DomainQuerySuperagentService,
  TestDomainQuerySuperagentService,
} from "../services/DomainsQueryService";
import { TestResolverService } from "../test/TestResolverService";
import {
  DomainRateLimitService,
  IDomainRateLimitService,
} from "../services/DomainRateLimit";
import { KuboApiService } from "../services/KuboApiService";
import {
  EnvironmentBinding,
  EnvironmentConfiguration,
} from "./BindingsManager";
import { ILoggerService } from "dweb-api-types/dist/logger";
import { IRedisClient } from "dweb-api-types/dist/redis";
import { ICacheService, INamedMemoryCache } from "dweb-api-types/dist/cache";
import { IKuboApiService } from "dweb-api-types/dist/kubo-api";
import {
  INameService,
  INameServiceFactory,
} from "dweb-api-types/dist/name-service";
import { IArweaveResolver } from "dweb-api-types/dist/arweave";
import { IEnsResolverService } from "dweb-api-types/dist/ens-resolver";
import { EnsResolverService } from "dweb-api-resolver/dist/resolver/index";
import {
  HostnameSubstitutionService,
  IHostnameSubstitutionService,
} from "dweb-api-resolver/dist/HostnameSubstitutionService/index";
import { ArweaveResolver } from "dweb-api-resolver/dist/resolver/arweave";
import {
  MemoryCacheFactory,
  RedisClient,
  TestRedisClient,
  LocallyCachedRedisCacheService,
} from "dweb-api-cache/dist";
import { TestLoggerService, LoggerService } from "dweb-api-logger/dist/index";
import { NameServiceFactory } from "dweb-api-resolver/dist/nameservice/index";
import {} from "dweb-api-resolver/dist/resolver/index";
import { Web3NameSdkService } from "dweb-api-resolver/dist/nameservice/Web3NameSdkService";
import { EnsService } from "dweb-api-resolver/dist/nameservice/EnsService";

export const createApplicationConfigurationBindingsManager = () => {
  const configuration = new EnvironmentBinding<ServerConfiguration>({
    [EnvironmentConfiguration.Production]: () =>
      getDefaultServerConfiguration(),
    [EnvironmentConfiguration.Development]: () =>
      new TestConfigurationService(),
  });
  const logger = new EnvironmentBinding<ILoggerService>({
    [EnvironmentConfiguration.Production]: (env) =>
      new LoggerService(configuration.getBinding(env)),
    [EnvironmentConfiguration.Development]: (env) =>
      new TestLoggerService(configuration.getBinding(env)),
  });

  const _namedMemoryCacheFactory = new MemoryCacheFactory();

  const namedMemoryCacheFactory = new EnvironmentBinding<
    (x: string) => INamedMemoryCache
  >({
    [EnvironmentConfiguration.Production]: (env) => (serviceName: string) =>
      _namedMemoryCacheFactory.createNamedMemoryCacheFactory(
        serviceName,
        logger.getBinding(env),
        configuration.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: (env) => (serviceName: string) =>
      _namedMemoryCacheFactory.createNamedMemoryCacheFactory(
        serviceName,
        logger.getBinding(env),
        configuration.getBinding(env),
      ),
  });

  const redisClient = new EnvironmentBinding<IRedisClient>({
    [EnvironmentConfiguration.Production]: (env) =>
      new RedisClient(configuration.getBinding(env)),
    [EnvironmentConfiguration.Development]: (env) =>
      new TestRedisClient(configuration.getBinding(env)),
  });

  const cacheService = new EnvironmentBinding<ICacheService>({
    [EnvironmentConfiguration.Production]: (env) =>
      new LocallyCachedRedisCacheService(
        logger.getBinding(env),
        redisClient.getBinding(env),
        namedMemoryCacheFactory.getBinding(env),
        configuration.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: (env) =>
      new LocallyCachedRedisCacheService(
        logger.getBinding(env),
        redisClient.getBinding(env),
        namedMemoryCacheFactory.getBinding(env),
        configuration.getBinding(env),
      ),
  });

  const hostnameSubstitution =
    new EnvironmentBinding<IHostnameSubstitutionService>({
      [EnvironmentConfiguration.Production]: (env) =>
        new HostnameSubstitutionService(
          configuration.getBinding(env),
          logger.getBinding(env),
        ),
      [EnvironmentConfiguration.Development]: (env) =>
        new HostnameSubstitutionService(
          configuration.getBinding(env),
          logger.getBinding(env),
        ),
    });

  const domainQuerySuperagent =
    new EnvironmentBinding<IDomainQuerySuperagentService>({
      [EnvironmentConfiguration.Production]: (env) =>
        new DomainQuerySuperagentService(configuration.getBinding(env)),
      [EnvironmentConfiguration.Development]: (_env) =>
        new TestDomainQuerySuperagentService(),
    });

  const domainQuery = new EnvironmentBinding<IDomainQueryService>({
    [EnvironmentConfiguration.Production]: (env) =>
      new DomainQueryService(
        logger.getBinding(env),
        domainQuerySuperagent.getBinding(env),
        cacheService.getBinding(env),
        configuration.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: (env) =>
      new DomainQueryService(
        logger.getBinding(env),
        domainQuerySuperagent.getBinding(env),
        cacheService.getBinding(env),
        configuration.getBinding(env),
      ),
  });

  const kuboApi = new EnvironmentBinding<IKuboApiService>({
    [EnvironmentConfiguration.Production]: (env) =>
      new KuboApiService(logger.getBinding(env), configuration.getBinding(env)),
    [EnvironmentConfiguration.Development]: (env) =>
      new KuboApiService(logger.getBinding(env), configuration.getBinding(env)),
  });

  const web3NameSdk = new EnvironmentBinding<INameService>({
    [EnvironmentConfiguration.Production]: (env) =>
      new Web3NameSdkService(
        configuration.getBinding(env),
        logger.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: (_env) => new TestResolverService(),
  });

  const ensService = new EnvironmentBinding<INameService>({
    [EnvironmentConfiguration.Production]: (env) =>
      new EnsService(configuration.getBinding(env), logger.getBinding(env)),
    [EnvironmentConfiguration.Development]: (_env) => new TestResolverService(),
  });

  const domainRateLimit = new EnvironmentBinding<IDomainRateLimitService>({
    [EnvironmentConfiguration.Production]: (env) =>
      new DomainRateLimitService(
        redisClient.getBinding(env),
        logger.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: (env) =>
      new DomainRateLimitService(
        redisClient.getBinding(env),
        logger.getBinding(env),
      ),
  });

  const arweaveResolver = new EnvironmentBinding<IArweaveResolver>({
    [EnvironmentConfiguration.Production]: (env) =>
      new ArweaveResolver(logger.getBinding(env)),
    [EnvironmentConfiguration.Development]: (_env) => new TestResolverService(),
  });

  const nameServiceFactory = new EnvironmentBinding<INameServiceFactory>({
    [EnvironmentConfiguration.Production]: (env) =>
      new NameServiceFactory(
        logger.getBinding(env),
        ensService.getBinding(env),
        web3NameSdk.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: (env) =>
      new NameServiceFactory(
        logger.getBinding(env),
        ensService.getBinding(env),
        web3NameSdk.getBinding(env),
      ),
  });

  const ensResolver = new EnvironmentBinding<IEnsResolverService>({
    [EnvironmentConfiguration.Production]: (env) =>
      new EnsResolverService(
        logger.getBinding(env),
        cacheService.getBinding(env),
        arweaveResolver.getBinding(env),
        kuboApi.getBinding(env),
        nameServiceFactory.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: (env) =>
      new EnsResolverService(
        logger.getBinding(env),
        cacheService.getBinding(env),
        arweaveResolver.getBinding(env),
        kuboApi.getBinding(env),
        nameServiceFactory.getBinding(env),
      ),
  });

  const dnsQuery = new EnvironmentBinding<IDnsQuery>({
    [EnvironmentConfiguration.Production]: (env) =>
      new DnsQuery(
        logger.getBinding(env),
        configuration.getBinding(env),
        domainQuery.getBinding(env),
        ensResolver.getBinding(env),
      ),
    [EnvironmentConfiguration.Development]: (env) =>
      new DnsQuery(
        logger.getBinding(env),
        configuration.getBinding(env),
        domainQuery.getBinding(env),
        ensResolver.getBinding(env),
      ),
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
  };
};
