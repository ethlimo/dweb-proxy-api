import superagent, { Response } from "superagent";
import { ILoggerService } from "../LoggerService";
import { inject, injectable } from "inversify";
import { DITYPES } from "../../dependencies/types";
import { hostnameIsENSTLD } from "../../utils";
import { ICacheService } from "../CacheService";
import * as z from "zod";
import { IConfigurationService } from "../../configuration";

//passthrough because we want to preserve the full query response
const DomainQueryValueCodec = z.object({
  blacklisted: z.boolean().optional(),
  domain: z.string(),
  canonical_name: z.string().optional(),
}).passthrough();

const createDefaultDomainQueryValue = (domain:string): DomainQueryValue => ({
  domain,
  blacklisted: false,
  canonical_name: undefined,
});

export type DomainQueryValue = z.infer<typeof DomainQueryValueCodec>;

export interface IDomainQueryService {
  domainQuery: (domain: string) => Promise<DomainQueryValue | null>;
  checkBlacklist: (domain: string) => Promise<boolean>;
  checkLinkedDomains: (domain: string) => Promise<string | null>;
}

//shallow mock for testing
export interface IDomainQuerySuperagentService {
  query: (domain: string) => Promise<Response>;
}

@injectable()
export class DomainQuerySuperagentService
  implements IDomainQuerySuperagentService
{
  _configurationService: IConfigurationService;
  constructor(@inject(DITYPES.ConfigurationService) configurationService: IConfigurationService) {
    this._configurationService = configurationService;
  }

  public async query(domain: string) {
    const configuration = this._configurationService.get();
    return await superagent
      .get(`${configuration.domainsapi.endpoint}/query`)
      .query({ domain })
      .ok((res) => res.status < 500);
  }
}

@injectable()
export class DomainQueryService implements IDomainQueryService {
  _logger: ILoggerService;
  _superAgentSvc: IDomainQuerySuperagentService;
  _cacheService: ICacheService;
  _configurationService: IConfigurationService;
  constructor(
    @inject(DITYPES.LoggerService) logger: ILoggerService,
    @inject(DITYPES.DomainQuerySuperagentService) superAgentSvc: IDomainQuerySuperagentService,
    @inject(DITYPES.CacheService) cacheService: ICacheService,
    @inject(DITYPES.ConfigurationService) configurationService: IConfigurationService,
  ) {
    this._logger = logger;
    this._superAgentSvc = superAgentSvc;
    this._cacheService = cacheService;
    this._configurationService = configurationService;
  }
  domainQuery = async (domain: string): Promise<DomainQueryValue> => this._cacheService.memoize(() => this.domainQueryInternal(domain), DomainQueryValueCodec, "domainQuery", domain)
  domainQueryInternal = async (domain: string): Promise<DomainQueryValue> => {
    const configuration = this._configurationService.get();
    if (!configuration.domainsapi.endpoint) {
      this._logger.error(
        "domainQuery: domainsapi endpoint not set up properly, short circuiting checks",
      );
      return createDefaultDomainQueryValue(domain);
    }
    if (!domain) {
      this._logger.error("domainQuery: received empty string domain");
      return createDefaultDomainQueryValue(domain);
    }

    const ret = await this._superAgentSvc.query(domain);
    if (ret.error) {
      if(ret.error.status === 404) {
        this._logger.debug(`domainQuery: serving default value for ${domain}`);
      } else {
        this._logger.error(
          `domainQuery: ${configuration.domainsapi.endpoint}${ret.error.path} returned ${ret.error.status} (${ret.error.message})`,
        );
        //FIXME: might be necessary to assume blacklist if we get a 500? we need to pass a value that doesn't get cached
      }
      return createDefaultDomainQueryValue(domain);
    } else {
      try {
        const json = JSON.parse(ret.text);
        const payload = DomainQueryValueCodec.parse(json);
        return payload;
      } catch (e) {
        this._logger.error(`domainQuery: could not deserialize ${e}`);
        return createDefaultDomainQueryValue(domain);
      }
    }
  };

  checkBlacklist = async (domain: string) => {
    if (!domain) {
      return false;
    }
    
    const explode = domain.split(".");

    for (var i = 0; i < explode.length; i++) {
      const subdomain = explode.slice(i).join(".");
      const query = await this.domainQuery(subdomain);
      if (query && query["blacklisted"]) {
        return true;
      }
    }

    return false;
  };
  /**
   * precondition: domain must eventually terminate with a canonical_name entry ending in .eth
   */
  checkLinkedDomains = async (domain: string): Promise<string | null> => {
    const configuration = this._configurationService.get();
    //cycle detection is inbuilt via max_hops, if max_hops is expected to be large then needs hashmap of visited domains
    var tries = configuration.domainsapi.max_hops;
    var found = false;
    if (!domain) {
      return null;
    }
    var search: string | null = domain;
    do {
      if (!search) {
        break;
      } else if (hostnameIsENSTLD(search)) {
        found = true;
        break;
      } else {
        const tmp = await this.domainQuery(search);
        search = tmp?.canonical_name ?? null;
      }
      tries = tries - 1;
    } while (tries > 0 && !found);
    if (!found) {
      this._logger.error(
        `checkLinkedDomains: ${domain} queried but no canonical_name link exists`,
      );
    }
    return search;
  };
}

@injectable()
export class TestDomainQuerySuperagentService implements IDomainQuerySuperagentService {
  blacklistMap: Map<string, boolean>;
  canonicalNameMap: Map<string, string>;
  public error = false;
  setBlacklist = (domain: string, blacklisted: boolean) => {
    this.blacklistMap.set(domain, blacklisted);
  }
  setCanonicalName = (domain: string, canonicalName: string) => {
    this.canonicalNameMap.set(domain, canonicalName);
  }
  constructor() {
    this.blacklistMap = new Map();
    this.canonicalNameMap = new Map();
  }

  query = async (domain: string) => {
    if(this.error) {
      return {
        error: {
          status: 500,
          message: "test error",
          path: "/query",
        },
        text: null,
      } as any as Response;
    }
    return {
      error: null,
      text: JSON.stringify({
        blacklisted: this.blacklistMap.get(domain) ?? undefined,
        domain,
        canonical_name: this.canonicalNameMap.get(domain) ?? domain,
      }),
    } as any as Response;
  };
}