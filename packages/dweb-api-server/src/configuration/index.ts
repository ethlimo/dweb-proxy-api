import {
  IAskEndpointConfig,
  IConfigHostnameSubstitution,
  IConfigurationArweave,
  IConfigurationEnsSocials,
  IConfigurationEthereum,
  IConfigurationEthereumFailover,
  IConfigurationGnosis,
  IConfigurationBase,
  ICacheConfig,
  IConfigurationIpfs,
  IConfigurationServerAsk,
  IConfigurationServerDnsquery,
  IConfigurationServerRouter,
  IDomainQueryConfig,
  IRedisConfig,
  IConfigurationSwarm,
  IConfigurationLogger,
  IConfigurationKubo,
} from "dweb-api-types/dist/config";
import { parseRawConfig } from "dweb-api-resolver/dist/HostnameSubstitutionService/parseRawConfig";
export const VALID_ENS_TLDS = ["eth", "gno", "art"];

const configuration = {
  // Ethereum JSON RPC endpoint
  ethereum: {
    rpc: process.env.ETH_RPC_ENDPOINT || "http://192.168.1.7:8845",
    failover_primary: process.env.ETH_RPC_ENDPOINT_FAILOVER_PRIMARY || null,
    failover_secondary: process.env.ETH_RPC_ENDPOINT_FAILOVER_SECONDARY || null,
    provider_stall_timeout_ms: parseInt(
      process.env.ETH_PROVIDER_STALL_TIMEOUT_MS || "200",
    ), //see fallbackProviderConfig.stallTimeout
    provider_timeout_ms: parseInt(
      process.env.ETH_PROVIDER_TIMEOUT_MS || "7000",
    ), //see provider._getConnection().timeout
    quorum: parseInt(process.env.ETH_PROVIDER_QUORUM || "1"),
  },
  gnosis: {
    rpc: process.env.GNO_RPC_ENDPOINT || "https://rpc.gnosischain.com",
  },
  base: {
    rpc: process.env.BASE_RPC_ENDPOINT || "https://mainnet.base.org",
  },
  // Storage backends
  ipfs: {
    backend: process.env.IPFS_TARGET || "http://localhost:8080",
    auth: process.env.IPFS_AUTH_KEY || null,
    //if true, proxies {cid}.{ipfs/ipns}.IPFS_TARGET
    subdomainSupport:
      process.env.IPFS_SUBDOMAIN_SUPPORT === "true" ? true : false,
    //ms before we give up and just return an ipns record
    kubo_timeout_ms: parseInt(process.env.IPFS_KUBO_TIMEOUT_MS || "2500"),
    //this has no default because we assume this isn't available
    kubo_api_url:
      (process.env.IPFS_KUBO_API_URL &&
        new URL(process.env.IPFS_KUBO_API_URL)) ||
      undefined,
  },
  arweave: {
    backend: process.env.ARWEAVE_TARGET || "https://arweave.net",
  },
  swarm: {
    backend: process.env.SWARM_TARGET || "https://api.gateway.ethswarm.org",
  },
  redis: {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  },
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || "300"),
  },
  // Proxy
  router: {
    listen: process.env.LISTEN_PORT || 8888,
    origin: "LIMO Proxy",
    hostnameSubstitutionConfig:
      process.env.LIMO_HOSTNAME_SUBSTITUTION_CONFIG ||
      JSON.stringify({
        "eth.limo": "eth",
        "eth.local": "eth",
        "gno.limo": "gno",
        "gno.local": "gno"
      }),
  },
  // Server ask endpoint
  ask: {
    listen: process.env.ASK_LISTEN_PORT || 9090,
    enabled: process.env.ASK_ENABLED || "false",
    rate: {
      limit: Number(process.env.ASK_RATE_LIMIT ?? 10),
      //configuration.ask.rate.period: input in minutes, actual value in seconds
      period: Number(process.env.ASK_RATE_PERIOD ?? 15) * 60,
      enabled: false, //set via limit = 0
    },
    //this is applied before the suffix transformation
    max_label_limit: Number(process.env.ASK_MAX_LABEL_LIMIT ?? 10),
  },
  //dns-query isolated endpoint (DOH)
  dnsquery: {
    listen: process.env.DNSQUERY_LISTEN_PORT || 11000,
    enabled: process.env.DNSQUERY_ENABLED === "false" ? false : true,
  },
  tests: {
    hostname: "vitalik.eth",
  },
  ens: {
    socialsEndpoint: (ens: string) => {
      return `https://landing.nimi.page${ens ? "/?ens=" + encodeURI(ens) : ""}`;
    },
    socialsEndpointEnabled:
      process.env.ENS_SOCIALS_ENDPOINT_ENABLED === "true" ? true : false,
  },
  domainsapi: {
    ttl: 60,
    endpoint: process.env.DOMAINSAPI_ENDPOINT,
    max_hops: 5, //e.g. asdf.limo -> whatever -> whatever.eth
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
};
configuration.ask.rate.enabled = configuration.ask.rate.limit > 0;

//throw early if the hostname substitution configuration is invalid
{
  parseRawConfig(configuration.router.hostnameSubstitutionConfig);
}

export class TestConfigurationService implements ServerConfiguration {
  private configuration: typeof configuration;

  constructor() {
    this.configuration = JSON.parse(JSON.stringify(configuration));
    this.configuration.ethereum.rpc = "http://localhost:69420"; //ethers is shimmed
    this.configuration.ethereum.failover_primary = null;
    this.configuration.ethereum.failover_secondary = null;
    this.configuration.ethereum.quorum = 1;
    this.configuration.ethereum.provider_stall_timeout_ms = 200;
    this.configuration.ipfs.backend = "https://ipfs"; //ipfs is never actually queried
    this.configuration.ipfs.auth = null;
    this.configuration.ipfs.subdomainSupport = true;
    this.configuration.redis.url = "redis://redis"; //redis is shimmed
    this.configuration.ask.enabled = "false";
    this.configuration.dnsquery.enabled = false;
    this.configuration.cache.ttl = 69;
    this.configuration.logging.level = "debug";
    this.configuration.swarm.backend = "https://swarm"; //swarm is never actually queried
    this.configuration.arweave.backend = "https://arweave"; //arweave is never actually queried
    this.configuration.ens.socialsEndpoint = (ens: string) => {
      return `https://socials.com?name=${ens}`;
    };
    this.configuration.domainsapi.endpoint = "https://domainsapi"; //this needs to be set otherwise it will short circuit to not blacklisted
    this.configuration.ask.rate.enabled = false;
    //the rate limiter being set to 2 ensures that any shared state between test cases causes a test failure explosion
    //this is a good thing, as it means that debugging a bug in the test harness is easier
    //the rate limiter is a good smell test for accidental shared state in the test harness because it's a state machine and there are definitely at least 2 cases that can hit it
    //a bug in the test harness was discovered because there were tests that were erroring out due to rate limiting being triggered erroneously
    //the problem was that beforeEach and afterEach weren't being called because mocha's 'it' wasn't getting a correct binding to the Mocha.Suite
    //mocha relies on stateful access of Mocha.Suite (the thisvar in a 'describe' function) to do something similar to what our test harness does on top of Mocha
    //for more information, look up why mocha doesn't support arrow functions and requires using regular `function (params) {}` blocks
    this.configuration.ask.rate.limit = 2;
    this.configuration.ask.rate.period = 30;
    //we choose not to test with this because the default behavior for the kubo service is to die quickly and revert to the regular behavior where kubo is absent
    this.configuration.ipfs.kubo_api_url = undefined;
  }

  set(callback: (configuration: typeof this.configuration) => void) {
    callback(this.configuration);
  }

  getServerConfiguration() {
    return configurationToServerConfiguration(this.configuration);
  }

  getConfigAskEndpoint = () => {
    return this.getServerConfiguration().getConfigAskEndpoint();
  };

  getHostnameSubstitutionConfig = () => {
    return this.getServerConfiguration().getHostnameSubstitutionConfig();
  };

  getConfigArweaveBackend = () => {
    return this.getServerConfiguration().getConfigArweaveBackend();
  };

  getConfigEnsSocialsEndpoint = () => {
    return this.getServerConfiguration().getConfigEnsSocialsEndpoint();
  };

  getConfigEthereumBackend = () => {
    return this.getServerConfiguration().getConfigEthereumBackend();
  };

  getConfigEthereumFailover = () => {
    return this.getServerConfiguration().getConfigEthereumFailover();
  };

  getConfigGnosisBackend = () => {
    return this.getServerConfiguration().getConfigGnosisBackend();
  };

  getConfigBaseBackend = () => {
    return this.getServerConfiguration().getConfigBaseBackend();
  };

  getCacheConfig = () => {
    return this.getServerConfiguration().getCacheConfig();
  };

  getDomainQueryConfig = () => {
    return this.getServerConfiguration().getDomainQueryConfig();
  };

  getRedisConfig = () => {
    return this.getServerConfiguration().getRedisConfig();
  };

  getRouterConfig = () => {
    return this.getServerConfiguration().getRouterConfig();
  };

  getConfigSwarmBackend = () => {
    return this.getServerConfiguration().getConfigSwarmBackend();
  };

  getLoggerConfig = () => {
    return this.getServerConfiguration().getLoggerConfig();
  };

  getConfigIpfsBackend = () => {
    return this.getServerConfiguration().getConfigIpfsBackend();
  };

  getAskRouterConfig = () => {
    return this.getServerConfiguration().getAskRouterConfig();
  };

  getDnsqueryRouterConfig = () => {
    return this.getServerConfiguration().getDnsqueryRouterConfig();
  };

  getKuboConfiguration = () => {
    return this.getServerConfiguration().getKuboConfiguration();
  };
}

/**
 *
 * NOTE: The following functions are used to convert the configuration object to the respective configuration interfaces
 * the parameter config is explicitly destructured to ensure that refactoring at either end of the configuration pipeline will cause specific errors
 * changes made to these interfaces must be purposeful
 *
 * the configuration object is destructured into getters for the respective domain and then recombined
 * config -> IXconfig & IYconfig & IZConfig -> ServerConfig
 *
 */

export const configurationToIAskEndpointConfig = (config: {
  ask: {
    rate: {
      limit: number;
      period: number;
      enabled: boolean;
    };
    max_label_limit: number;
  };
}): IAskEndpointConfig => {
  return {
    getConfigAskEndpoint: () => {
      return {
        getRateLimit: () => config.ask.rate.limit,
        getRatePeriod: () => config.ask.rate.period,
        getRateEnabled: () => config.ask.rate.enabled,
        getMaxLabelLimit: () => config.ask.max_label_limit,
      };
    },
  };
};

export const configurationToIConfigHostnameSubstitution = (config: {
  router: {
    hostnameSubstitutionConfig: string;
  };
}): IConfigHostnameSubstitution => {
  return {
    getHostnameSubstitutionConfig: () => {
      return parseRawConfig(config.router.hostnameSubstitutionConfig);
    },
  };
};

export const configurationToIConfigurationArweave = (config: {
  arweave: {
    backend: string;
  };
}): IConfigurationArweave => {
  return {
    getConfigArweaveBackend: () => {
      return {
        getBackend: () => config.arweave.backend,
      };
    },
  };
};

export const configurationToIConfigurationEnsSocials = (config: {
  ens: {
    socialsEndpoint: (ens: string) => string;
    socialsEndpointEnabled: boolean;
  };
}): IConfigurationEnsSocials => {
  return {
    getConfigEnsSocialsEndpoint: () => {
      return {
        getEnsSocialsEndpoint:
          (config.ens.socialsEndpointEnabled && config.ens.socialsEndpoint) ||
          null,
      };
    },
  };
};

export const configurationToIConfigurationEthereum = (config: {
  ethereum: {
    rpc: string;
  };
}): IConfigurationEthereum => {
  return {
    getConfigEthereumBackend: () => {
      return {
        getBackend: () => config.ethereum.rpc,
      };
    },
  };
};

export const configurationToIConfigurationEthereumFailover = (config: {
  ethereum: {
    provider_stall_timeout_ms: number;
    provider_timeout_ms: number;
    quorum: number;
    failover_primary: string | null;
    failover_secondary: string | null;
  };
}): IConfigurationEthereumFailover => {
  return {
    getConfigEthereumFailover: () => {
      return {
        getStallTimeout: () => config.ethereum.provider_stall_timeout_ms,
        getProviderStallTimeout: () => config.ethereum.provider_timeout_ms,
        getQuorum: () => config.ethereum.quorum,
        getPrimaryFailoverBackend: () => config.ethereum.failover_primary,
        getSecondaryFailoverBackend: () => config.ethereum.failover_secondary,
      };
    },
  };
};

export const configurationToIConfigurationGnosis = (config: {
  gnosis: {
    rpc: string;
  };
}): IConfigurationGnosis => {
  return {
    getConfigGnosisBackend: () => {
      return {
        getBackend: () => config.gnosis.rpc,
      };
    },
  };
};

export const configurationToIConfigurationBase = (config: {
  base: {
    rpc: string;
  };
}): IConfigurationBase => {
  return {
    getConfigBaseBackend: () => {
      return {
        getBackend: () => config.base.rpc,
      };
    },
  };
};

export const configurationToICacheConfig = (config: {
  cache: {
    ttl: number;
  };
}): ICacheConfig => {
  return {
    getCacheConfig: () => {
      return {
        getTtl: () => config.cache.ttl,
      };
    },
  };
};

export const configurationToIDomainQueryConfig = (config: {
  domainsapi: {
    endpoint: string | undefined;
    max_hops: number;
  };
}): IDomainQueryConfig => {
  const endpoint = config.domainsapi.endpoint;
  return {
    getDomainQueryConfig: () =>
      (endpoint && {
        getDomainsApiEndpoint: () => endpoint,
        getMaxHops: () => config.domainsapi.max_hops,
      }) ||
      null,
  };
};

export const configurationToIRedisConfig = (config: {
  redis: {
    url: string;
  };
}): IRedisConfig => {
  return {
    getRedisConfig: () => {
      return {
        getUrl: () => config.redis.url,
      };
    },
  };
};

export const configurationToIConfigurationServerAsk = (config: {
  ask: {
    listen: string | number;
    enabled: string;
  };
}): IConfigurationServerAsk => {
  return {
    getAskRouterConfig: () => {
      return {
        getAskRouterListenPort: () => config.ask.listen.toString(),
        getAskRouterEnabled: () => config.ask.enabled === "true",
      };
    },
  };
};

export const configurationToIConfigurationServerDnsquery = (config: {
  dnsquery: {
    listen: string | number;
    enabled: boolean;
  };
}): IConfigurationServerDnsquery => {
  return {
    getDnsqueryRouterConfig: () => {
      return {
        getDnsqueryRouterListenPort: () => config.dnsquery.listen.toString(),
        getDnsqueryRouterEnabled: () => config.dnsquery.enabled,
      };
    },
  };
};

export const configurationToIConfigurationServerRouter = (config: {
  router: {
    listen: string | number;
    origin: string;
  };
}): IConfigurationServerRouter => {
  return {
    getRouterConfig: () => {
      return {
        getRouterListenPort: () => config.router.listen.toString(),
        getRouterOrigin: () => config.router.origin,
      };
    },
  };
};

export const configurationToIConfigurationSwarm = (config: {
  swarm: {
    backend: string;
  };
}): IConfigurationSwarm => {
  return {
    getConfigSwarmBackend: () => {
      return {
        getBackend: () => config.swarm.backend,
      };
    },
  };
};

export const configurationToIConfigurationLogger = (config: {
  logging: {
    level: string;
  };
}): IConfigurationLogger => {
  var level = config.logging.level;

  if (
    level != "debug" &&
    level != "info" &&
    level != "warn" &&
    level != "error"
  ) {
    console.warn(
      JSON.stringify({
        message: "Invalid log level, defaulting to info",
        level: level,
      }),
    );
    level = "info";
  }

  return {
    getLoggerConfig: () => {
      return {
        getLevel: () =>
          config.logging.level as "debug" | "info" | "warn" | "error",
      };
    },
  };
};

export const configurationToIConfigurationIpfs = (config: {
  ipfs: {
    backend: string;
    subdomainSupport: boolean;
  };
}): IConfigurationIpfs => {
  return {
    getConfigIpfsBackend: () => {
      return {
        getBackend: () => config.ipfs.backend,
        getSubdomainSupport: () => config.ipfs.subdomainSupport,
      };
    },
  };
};

export const configurationToIConfigurationKubo = (config: {
  ipfs: {
    kubo_timeout_ms: number;
    kubo_api_url: URL | undefined;
    auth: string | null;
  };
}): IConfigurationKubo => {
  return {
    getKuboConfiguration: () => {
      return {
        getKuboTimeoutMs: () => config.ipfs.kubo_timeout_ms as number | null,
        getKuboApiUrl: () => config.ipfs.kubo_api_url || null,
        getKuboAuth: () => config.ipfs.auth || null,
      };
    },
  };
};

export type ServerConfiguration = IConfigurationServerRouter &
  IConfigurationServerDnsquery &
  IConfigurationServerAsk &
  IConfigurationEnsSocials &
  IConfigurationIpfs &
  IConfigurationArweave &
  IConfigurationSwarm &
  IAskEndpointConfig &
  IConfigHostnameSubstitution &
  IConfigurationEthereum &
  IConfigurationEthereumFailover &
  IConfigurationGnosis &
  IConfigurationBase &
  ICacheConfig &
  IConfigurationServerDnsquery &
  IDomainQueryConfig &
  IRedisConfig &
  IConfigurationLogger &
  IConfigurationKubo;

export const configurationToServerConfiguration = (
  config: typeof configuration,
): ServerConfiguration & {
  _innerConfigurationObject: typeof configuration;
} => {
  return {
    ...configurationToIAskEndpointConfig(config),
    ...configurationToIConfigHostnameSubstitution(config),
    ...configurationToIConfigurationArweave(config),
    ...configurationToIConfigurationEnsSocials(config),
    ...configurationToIConfigurationEthereum(config),
    ...configurationToIConfigurationEthereumFailover(config),
    ...configurationToIConfigurationGnosis(config),
    ...configurationToIConfigurationBase(config),
    ...configurationToICacheConfig(config),
    ...configurationToIDomainQueryConfig(config),
    ...configurationToIRedisConfig(config),
    ...configurationToIConfigurationServerAsk(config),
    ...configurationToIConfigurationServerDnsquery(config),
    ...configurationToIConfigurationServerRouter(config),
    ...configurationToIConfigurationSwarm(config),
    ...configurationToIConfigurationLogger(config),
    ...configurationToIConfigurationIpfs(config),
    ...configurationToIConfigurationKubo(config),
    _innerConfigurationObject: config,
  };
};

export const getDefaultServerConfiguration = (): ServerConfiguration => {
  return configurationToServerConfiguration(
    JSON.parse(JSON.stringify(configuration)),
  );
};
