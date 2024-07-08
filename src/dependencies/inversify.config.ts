import { interfaces } from "inversify";
import { BindingsManager, EnvironmentConfiguration } from "./BindingsManager";
import { IConfigurationService, DefaultConfigurationService, TestConfigurationService } from "../configuration";
import { IDnsQuery, DnsQuery } from "../dnsquery";
import { ICacheService, LocallyCachedRedisCacheService, IRedisClient, RedisClient, TestRedisClient, MemoryCacheFactory, INamedMemoryCache } from "../services/CacheService";
import { IDomainQueryService, DomainQueryService, IDomainQuerySuperagentService, DomainQuerySuperagentService, TestDomainQuerySuperagentService } from "../services/DomainsQueryService";
import { IEnsResolverService, EnsResolverService } from "../services/EnsResolverService";
import { IArweaveResolver, ArweaveResolver } from "../services/EnsResolverService/arweave";
import { INameService, INameServiceFactory, NameServiceFactory } from "../services/NameService";
import { ILoggerService, LoggerService, TestLoggerService } from "../services/LoggerService";
import { TestResolverService } from "../test/TestResolverService";
import { DomainRateLimitService, IDomainRateLimitService } from "../services/DomainRateLimit";
import { IKuboApiService, KuboApiService } from "../services/KuboApiService";
import { EnsService } from "../services/NameService/EnsService";
import { HostnameSubstitutionService, IHostnameSubstitutionService } from "../services/HostnameSubstitutionService";
import { Web3NameSdkService } from "../services/NameService/Web3NameSdkService";

export const createApplicationConfigurationBindingsManager = () => {
  const bindingsManager = new BindingsManager();
  bindingsManager.registerBinding<INameService>({
    key: "EnsService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: EnsService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: TestResolverService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: EnsService,
      },
    }
  });
  bindingsManager.registerBinding<INameService>({
    key: "Web3NameSdkService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: Web3NameSdkService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: TestResolverService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: Web3NameSdkService,
      },
    }
  });

  bindingsManager.registerBinding<IEnsResolverService>({
    key: "EnsResolverService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: EnsResolverService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: EnsResolverService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: EnsResolverService,
      },
    }
  });

  bindingsManager.registerBinding<ILoggerService>({
    key: "LoggerService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: LoggerService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: TestLoggerService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: LoggerService,
      },
    }
  });

  bindingsManager.registerBinding<IDomainQueryService>({
    key: "DomainQueryService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: DomainQueryService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: DomainQueryService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: DomainQueryService,
      },
    }
  });

  bindingsManager.registerBinding<IDomainQuerySuperagentService>({
    key: "DomainQuerySuperagentService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: DomainQuerySuperagentService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: TestDomainQuerySuperagentService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: TestDomainQuerySuperagentService,
      },
    }
  });

  bindingsManager.registerBinding<ICacheService>({
    key: "CacheService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: LocallyCachedRedisCacheService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: LocallyCachedRedisCacheService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: LocallyCachedRedisCacheService,
      },
    }
  });

  bindingsManager.registerBinding<IRedisClient>({
    key: "RedisClient",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: RedisClient,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: TestRedisClient,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: TestRedisClient,
      },
    }
  });

  bindingsManager.registerBinding<IConfigurationService>({
    key: "ConfigurationService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: DefaultConfigurationService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: TestConfigurationService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: TestConfigurationService,
      },
    }
  });

  bindingsManager.registerBinding<IArweaveResolver>({
    key: "ArweaveResolver",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: ArweaveResolver,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: TestResolverService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: ArweaveResolver,
      },
    }
  });

  bindingsManager.registerBinding<IDnsQuery>({
    key: "DnsQuery",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: DnsQuery,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: DnsQuery,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: DnsQuery,
      },
    }
  });

  const memoryCaches = new MemoryCacheFactory();

  const cacheFactoryFunction = (context: interfaces.Context): <T>(str: string) => INamedMemoryCache => {
    return <T>(str: string) => {
      return memoryCaches.createNamedMemoryCacheFactory(context, str);
    };
  };

  bindingsManager.registerBinding<INamedMemoryCache>({
    key: "NamedMemoryCacheFactory",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "factory",
        factory: cacheFactoryFunction,
      },
      [EnvironmentConfiguration.Development]: {
        type: "factory",
        factory: cacheFactoryFunction,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "factory",
        factory: cacheFactoryFunction,
      },
    }
  });
  bindingsManager.registerBinding<IDomainRateLimitService>({
    key: "DomainRateLimitService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: DomainRateLimitService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: DomainRateLimitService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: DomainRateLimitService,
      },
    }
  });
  bindingsManager.registerBinding<IKuboApiService>({
    key: "KuboApiService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: KuboApiService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: KuboApiService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: KuboApiService,
      },
    }
  });
  bindingsManager.registerBinding<IHostnameSubstitutionService>({
    key: "HostnameSubstitutionService",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: HostnameSubstitutionService,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: HostnameSubstitutionService,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: HostnameSubstitutionService,
      },
    }
  });
  bindingsManager.registerBinding<INameServiceFactory>({
    key: "NameServiceFactory",
    config: {
      [EnvironmentConfiguration.Production]: {
        type: "class",
        theConstructor: NameServiceFactory,
      },
      [EnvironmentConfiguration.Development]: {
        type: "class",
        theConstructor: NameServiceFactory,
      },
      [EnvironmentConfiguration.LiveDataIntegration]: {
        type: "class",
        theConstructor: NameServiceFactory,
      },
    }
  
  });
  return bindingsManager;
};

export const createProductionAppContainer = () => {
  return createApplicationConfigurationBindingsManager().bindAll(EnvironmentConfiguration.Production);
};