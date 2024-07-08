const DITYPES = {
  EnsService: Symbol.for("EnsService"),
  Web3NameSdkService: Symbol.for("Web3NameSdkService"),
  EnsResolverService: Symbol.for("EnsResolverService"),
  LoggerService: Symbol.for("LoggerService"),
  DomainQuerySuperagentService: Symbol.for("DomainQuerySuperagentService"),
  DomainQueryService: Symbol.for("DomainQueryService"),
  CacheService: Symbol.for("CacheService"),
  NamedMemoryCacheFactory: Symbol("NamedMemoryCacheFactory"),
  RedisClient: Symbol("RedisClient"),
  ConfigurationService: Symbol("ConfigurationService"),
  ArweaveResolver: Symbol("ArweaveResolver"),
  DnsQuery: Symbol("DnsQuery"),
  DomainRateLimitService: Symbol("DomainRateLimitService"),
  KuboApiService: Symbol("KuboApiService"),
  HostnameSubstitutionService: Symbol("HostnameSubstitutionService"),
  NameServiceFactory: Symbol("NameServiceFactory"),
};

export { DITYPES };
