import { inject, injectable } from "inversify";

//FIXME: ???
const createHostname = (...args: string[]) => {
  var ret = [];
  for (const v of args) {
    ret.push(v.replace(".", ""));
  }

  return ret;
};

//FIXME: sanity check next 3 lines? also configuration.cache.purge_pattern seems wrong?
const defaultTld = process.env.DOMAIN_TLD || ".limo";
const defaultHostname = process.env.DOMAIN_TLD_HOSTNAME || "eth";
const defaultHost = createHostname(defaultHostname, defaultTld).join(".");
const configuration = {
  // Ethereum JSON RPC endpoint
  ethereum: {
    rpc: process.env.ETH_RPC_ENDPOINT || "http://192.168.1.7:8845",
    failover_primary: process.env.ETH_RPC_ENDPOINT_FAILOVER_PRIMARY || null,
    failover_secondary: process.env.ETH_RPC_ENDPOINT_FAILOVER_SECONDARY || null,
    provider_stall_timeout_ms: parseInt(process.env.ETH_PROVIDER_STALL_TIMEOUT_MS || "200"), //see fallbackProviderConfig.stallTimeout
    provider_timeout_ms: parseInt(process.env.ETH_PROVIDER_TIMEOUT_MS || "7000"), //see provider._getConnection().timeout
    quorum: parseInt(process.env.ETH_PROVIDER_QUORUM || "1"),

  },
  // Storage backends
  ipfs: {
    backend: process.env.IPFS_TARGET || "http://127.0.0.1:8080",
    auth: process.env.IPFS_AUTH_KEY || null,
    //if true, proxies {cid}.{ipfs/ipns}.IPFS_TARGET
    subdomainSupport:
      process.env.IPFS_SUBDOMAIN_SUPPORT === "true" ? true : false,
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
    purge: process.env.PURGE_CACHE_ON_START === "true" ? true : false,
    purge_count: parseInt(process.env.PURGE_CACHE_COUNT || "20000"),
    purge_pattern: process.env.PURGE_CACHE_PATTERN || `*.${defaultHostname}`,
  },
  // Proxy
  router: {
    listen: process.env.LISTEN_PORT || 8888,
    origin: "LIMO Proxy",
    host: defaultHost,
  },
  // Server ask endpoint
  ask: {
    listen: process.env.ASK_LISTEN_PORT || 9090,
    host: defaultHost,
    enabled: process.env.ASK_ENABLED || "false",
    rate: {
      limit: Number(process.env.ASK_RATE_LIMIT ?? 10),
      //configuration.ask.rate.period: input in minutes, actual value in seconds
      period: Number(process.env.ASK_RATE_PERIOD ?? 15) * 60,
      enabled: false, //set via limit = 0
    },
  },
  //dns-query isolated endpoint (DOH)
  dnsquery: {
    listen: process.env.DNSQUERY_LISTEN_PORT || 11000,
    host: defaultHost,
    enabled: process.env.DNSQUERY_ENABLED === "false" ? false : true,
  },
  tests: {
    hostname: "vitalik.eth",
  },
  ens: {
    socialsEndpoint: (ens: string) => {
      return `https://landing.nimi.page${ens ? "/?ens=" + encodeURI(ens) : ""}`;
    },
    socialsEndpointEnabled: process.env.ENS_SOCIALS_ENDPOINT_ENABLED === "true" ? true : false,
  },
  domainsapi: {
    ttl: 60,
    endpoint: process.env.DOMAINSAPI_ENDPOINT,
    max_hops: 5, //e.g. asdf.limo -> whatever -> whatever.eth
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
  }
};
configuration.ask.rate.enabled = configuration.ask.rate.limit > 0;

export type IConfiguration = typeof configuration;
export interface IConfigurationService {
  get(): IConfiguration;
}

@injectable()
export class DefaultConfigurationService implements IConfigurationService {
  get(): IConfiguration {
    return configuration;
  }
}

@injectable()
export class TestConfigurationService implements IConfigurationService {

  configuration: IConfiguration;

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
      return `https://socials.com?name=${ens}`
    };
    this.configuration.domainsapi.endpoint = "https://domainsapi"; //this needs to be set otherwise it will short circuit to not blacklisted
    this.configuration.router.host = "asdf.local";
    this.configuration.ask.host = "asdf.local";
    this.configuration.ask.rate.enabled = false;
    this.configuration.ask.rate.limit = 99999;
    this.configuration.ask.rate.period = 99999;
  }

  get(): IConfiguration {
    return this.configuration;
  }

  set(callback: (configuration: IConfiguration) => void) {
    callback(this.configuration)
  }
}