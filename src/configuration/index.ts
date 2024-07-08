import {injectable } from "inversify";

export const VALID_ENS_TLDS = [
  "eth",
  "gno",
  "art",
]


//FIXME: ???
const createHostname = (...args: string[]) => {
  var ret = [];
  for (const v of args) {
    ret.push(v.replace(".", ""));
  }
  return ret;
};

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
  gnosis: {
    rpc: process.env.GNO_RPC_ENDPOINT || "https://rpc.gnosischain.com",
  },
  // Storage backends
  ipfs: {
    backend: process.env.IPFS_TARGET || "http://127.0.0.1:8080",
    auth: process.env.IPFS_AUTH_KEY || null,
    //if true, proxies {cid}.{ipfs/ipns}.IPFS_TARGET
    subdomainSupport:
      process.env.IPFS_SUBDOMAIN_SUPPORT === "true" ? true : false,
    //ms before we give up and just return an ipns record
    kubo_timeout_ms: parseInt(process.env.IPFS_KUBO_TIMEOUT_MS || "2500"),
    //this has no default because we assume this isn't available
    kubo_api_url: process.env.IPFS_KUBO_API_URL && new URL(process.env.IPFS_KUBO_API_URL) || undefined,
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
    purge_pattern: process.env.PURGE_CACHE_PATTERN || `*.eth.limo`,
  },
  // Proxy
  router: {
    listen: process.env.LISTEN_PORT || 8888,
    origin: "LIMO Proxy",
    hostnameSubstitutionConfig: process.env.LIMO_HOSTNAME_SUBSTITUTION_CONFIG || JSON.stringify({
      "eth.limo": "eth",
      "eth.local": "eth",
      "gno.limo": "gno",
      "gno.local": "gno",
    })
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

  get(): IConfiguration {
    return this.configuration;
  }

  set(callback: (configuration: IConfiguration) => void) {
    callback(this.configuration)
  }
}