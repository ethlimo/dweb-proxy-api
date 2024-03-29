import { Container, interfaces } from "inversify";
import { EnsService, IEnsService } from "./services/EnsService";
import { DITYPES } from "./dependencies/types";
import {
  EnsResolverService,
  IEnsResolverService,
} from "./services/EnsResolverService";
import { ILoggerService, LoggerService } from "./services/LoggerService";
import {
  DomainQueryService,
  DomainQuerySuperagentService,
  IDomainQueryService,
  IDomainQuerySuperagentService,
} from "./services/DomainsQueryService";
import {
  RedisCacheService,
  ICacheService,
  INamedMemoryCache,
  NamedMemoryCache,
  IRedisClient,
  RedisClient,
  LocallyCachedRedisCacheService,
  MemoryCacheFactory,
} from "./services/CacheService";
import { DefaultConfigurationService, IConfigurationService } from "./configuration";
import { ArweaveResolver, IArweaveResolver } from "./services/EnsResolverService/arweave";
import { DnsQuery, IDnsQuery } from "./dnsquery";
import { DomainRateLimitService, IDomainRateLimitService } from "./services/DomainRateLimit";

//NOTE: services added to this should also be mocked in src/test/helper/index.ts

const AppContainer = new Container();
AppContainer.bind<IEnsService>(DITYPES.EnsService).to(EnsService).inSingletonScope();
AppContainer.bind<IEnsResolverService>(DITYPES.EnsResolverService).to(
  EnsResolverService,

);
AppContainer.bind<ILoggerService>(DITYPES.LoggerService).to(LoggerService).inSingletonScope();
AppContainer.bind<IDomainQuerySuperagentService>(
  DITYPES.DomainQuerySuperagentService,
).to(DomainQuerySuperagentService).inSingletonScope();

AppContainer.bind<IDomainQueryService>(DITYPES.DomainQueryService).to(
  DomainQueryService,
).inSingletonScope();

AppContainer.bind<ICacheService>(DITYPES.CacheService).to(
  LocallyCachedRedisCacheService,
).inSingletonScope();

const memoryCaches = new MemoryCacheFactory();

AppContainer.bind<interfaces.Factory<NamedMemoryCache>>(
  DITYPES.NamedMemoryCacheFactory,
).toFactory((context) => {
  return <T>(str: string) => {
    return memoryCaches.createNamedMemoryCacheFactory(AppContainer, str);
  };
});

AppContainer.bind<IRedisClient>(DITYPES.RedisClient).to(RedisClient).inSingletonScope();

AppContainer.bind<IConfigurationService>(DITYPES.ConfigurationService).to(DefaultConfigurationService).inSingletonScope();

AppContainer.bind<IArweaveResolver>(DITYPES.ArweaveResolver).to(ArweaveResolver).inSingletonScope();

AppContainer.bind<IDnsQuery>(DITYPES.DnsQuery).to(DnsQuery).inSingletonScope();

AppContainer.bind<IDomainRateLimitService>(DITYPES.DomainRateLimitService).to(DomainRateLimitService).inSingletonScope();

export { AppContainer };
