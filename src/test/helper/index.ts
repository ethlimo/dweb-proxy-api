import { Container, interfaces } from "inversify";
import { DITYPES } from "../../dependencies/types";
import { IEnsService } from "../../services/EnsService";
import { TestResolverService } from "../TestResolverService";
import { EnsResolverService, IEnsResolverService } from "../../services/EnsResolverService";
import { ILoggerService, TestLoggerService } from "../../services/LoggerService";
import { DomainQueryService, DomainQuerySuperagentService, IDomainQueryService, IDomainQuerySuperagentService, TestDomainQuerySuperagentService } from "../../services/DomainsQueryService";
import { ICacheService, IRedisClient, LocallyCachedRedisCacheService, MemoryCacheFactory, NamedMemoryCache, RedisClient, TestRedisClient } from "../../services/CacheService";
import { IConfigurationService, TestConfigurationService } from "../../configuration";
import { IArweaveResolver } from "../../services/EnsResolverService/arweave";
import { DnsQuery, IDnsQuery } from "../../dnsquery";
import { DomainRateLimitService, IDomainRateLimitService } from "../../services/DomainRateLimit";

export type HarnessType = {
    AppContainer: Container;
    testEnsService: TestResolverService;
    testRedisClient: TestRedisClient;
    testArweaveResolverService: TestResolverService;
    testDomainQuerySuperagentService: TestDomainQuerySuperagentService;
    testConfigurationService: TestConfigurationService;
};

export const buildAppContainer = ():HarnessType => {
    const AppContainer = new Container();
    AppContainer.bind<IEnsService>(DITYPES.EnsService).to(TestResolverService).inSingletonScope();

    AppContainer.bind<IEnsResolverService>(DITYPES.EnsResolverService).to(
        EnsResolverService,
    ).inSingletonScope();
    AppContainer.bind<ILoggerService>(DITYPES.LoggerService).to(TestLoggerService).inSingletonScope();
    AppContainer.bind<IDomainQuerySuperagentService>(
        DITYPES.DomainQuerySuperagentService,
    ).to(TestDomainQuerySuperagentService).inSingletonScope();
    //TODO: this is probably fine to query against the dev instance
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

    AppContainer.bind<IRedisClient>(DITYPES.RedisClient).to(TestRedisClient).inSingletonScope();

    AppContainer.bind<IConfigurationService>(DITYPES.ConfigurationService).to(TestConfigurationService).inSingletonScope();

    AppContainer.bind<IArweaveResolver>(DITYPES.ArweaveResolver).to(TestResolverService).inSingletonScope();

    AppContainer.bind<IDnsQuery>(DITYPES.DnsQuery).to(DnsQuery).inSingletonScope();
    
    AppContainer.bind<IDomainRateLimitService>(DITYPES.DomainRateLimitService).to(DomainRateLimitService).inSingletonScope();
    
    return {
        AppContainer,
        testEnsService: AppContainer.get<IEnsService>(DITYPES.EnsService) as TestResolverService,
        testRedisClient: AppContainer.get<IRedisClient>(DITYPES.RedisClient) as TestRedisClient,
        testArweaveResolverService: AppContainer.get<IArweaveResolver>(DITYPES.ArweaveResolver) as TestResolverService,
        testDomainQuerySuperagentService: AppContainer.get<IDomainQuerySuperagentService>(DITYPES.DomainQuerySuperagentService) as TestDomainQuerySuperagentService,
        testConfigurationService: AppContainer.get<IConfigurationService>(DITYPES.ConfigurationService) as TestConfigurationService,
    };
};