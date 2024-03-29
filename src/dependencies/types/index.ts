const DITYPES = {
  EnsService: Symbol.for("EnsService"),
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
};

export { DITYPES };
