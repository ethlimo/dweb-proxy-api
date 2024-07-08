import { Container } from "inversify";
import { DITYPES } from "../../dependencies/types";
import { INameService } from "../../services/NameService";
import { TestResolverService } from "../TestResolverService";
import { IDomainQuerySuperagentService, TestDomainQuerySuperagentService } from "../../services/DomainsQueryService";
import { IRedisClient, TestLaggyRedisClientProxy, TestRedisClient } from "../../services/CacheService";
import { IConfigurationService, TestConfigurationService } from "../../configuration";
import { IArweaveResolver } from "../../services/EnsResolverService/arweave";
import { createApplicationConfigurationBindingsManager } from "../../dependencies/inversify.config";
import { EnvironmentConfiguration } from "../../dependencies/BindingsManager";
import { IHostnameSubstitutionService } from "../../services/HostnameSubstitutionService";

export type HarnessType = {
    AppContainer: Container;
    testEnsService: TestResolverService;
    testRedisClient: TestRedisClient;
    testArweaveResolverService: TestResolverService;
    testDomainQuerySuperagentService: TestDomainQuerySuperagentService;
    testConfigurationService: TestConfigurationService;
    hostnameSubstitionService: IHostnameSubstitutionService;
    web3NameSdkService: TestResolverService;
};

export const buildAppContainer = ():HarnessType => {
    const bindingsManager = createApplicationConfigurationBindingsManager();
    const AppContainer = bindingsManager.bindAll(EnvironmentConfiguration.Development).container;
    return {
        AppContainer,
        testEnsService: AppContainer.get<INameService>(DITYPES.EnsService) as TestResolverService,
        testRedisClient: AppContainer.get<IRedisClient>(DITYPES.RedisClient) as TestRedisClient,
        testArweaveResolverService: AppContainer.get<IArweaveResolver>(DITYPES.ArweaveResolver) as TestResolverService,
        testDomainQuerySuperagentService: AppContainer.get<IDomainQuerySuperagentService>(DITYPES.DomainQuerySuperagentService) as TestDomainQuerySuperagentService,
        testConfigurationService: AppContainer.get<IConfigurationService>(DITYPES.ConfigurationService) as TestConfigurationService,
        hostnameSubstitionService: AppContainer.get<IHostnameSubstitutionService>(DITYPES.HostnameSubstitutionService),
        web3NameSdkService: AppContainer.get<INameService>(DITYPES.Web3NameSdkService) as TestResolverService,
    };
};