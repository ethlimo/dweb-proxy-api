export interface IConfigurationEnsSocials {
  getConfigEnsSocialsEndpoint: () => {
    getEnsSocialsEndpoint: null | ((ensName: string) => string);
  };
}

export interface IConfigurationIpfs {
  getConfigIpfsBackend: () => {
    getBackend: () => string;
    getSubdomainSupport: () => boolean;
  };
}

export interface IConfigurationArweave {
  getConfigArweaveBackend: () => {
    getBackend: () => string;
  };
}

export interface IConfigurationSwarm {
  getConfigSwarmBackend: () => {
    getBackend: () => string;
  };
}

export interface IConfigurationEthereum {
  getConfigEthereumBackend: () => {
    getBackend: () => string;
  };
}

export interface IConfigurationEthereumFailover {
  getConfigEthereumFailover: () => {
    getStallTimeout: () => number;
    getProviderStallTimeout: () => number;
    getQuorum: () => number;
    getPrimaryFailoverBackend: () => string | null;
    getSecondaryFailoverBackend: () => string | null;
  };
}

export interface IConfigurationGnosis {
  getConfigGnosisBackend: () => {
    getBackend: () => string;
  };
}

export type IConfigurationLogger = {
  getLoggerConfig: () => {
    getLevel: () => "warn" | "error" | "info" | "debug";
  };
};

export type HostnameSubstitutionConfiguration = {
  [key: string]: string;
};

export interface IConfigHostnameSubstitution {
  getHostnameSubstitutionConfig: () => HostnameSubstitutionConfiguration;
}

export interface IDomainQueryConfig {
  getDomainQueryConfig: () => {
    getDomainsApiEndpoint: () => string;
    getMaxHops: () => number;
  } | null;
}

export interface IRedisConfig {
  getRedisConfig: () => {
    getUrl: () => string;
  };
}

export interface ICacheConfig {
  getCacheConfig: () => {
    getTtl: () => number;
  };
}

export interface IAskEndpointConfig {
  getConfigAskEndpoint: () => {
    getMaxLabelLimit: () => number;
    getRateEnabled: () => boolean;
    getRateLimit: () => number;
    getRatePeriod: () => number;
  };
}

export interface IConfigurationServerRouter {
  getRouterConfig: () => {
    getRouterListenPort: () => string;
  };
}
export interface IConfigurationServerDnsquery {
  getDnsqueryRouterConfig: () => {
    getDnsqueryRouterListenPort: () => string;
    getDnsqueryRouterEnabled: () => boolean;
  };
}
export interface IConfigurationServerAsk {
  getAskRouterConfig: () => {
    getAskRouterListenPort: () => string;
    getAskRouterEnabled: () => boolean;
  };
}

export interface IConfigurationKubo {
  getKuboConfiguration: () => {
    getKuboApiUrl: () => URL | null;
    getKuboTimeoutMs: () => number | null;
    getKuboAuth: () => string | null;
  };
}
