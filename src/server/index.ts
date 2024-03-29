import express, { Request, Response } from "express";
import {
  IEnsResolverService,
  IEnsResolverServiceResolveEnsRet,
  Record,
} from "../services/EnsResolverService";
import bodyParser from "body-parser";
import { notSupported, blockedForLegalReasons, noContentHashSet } from "../expressErrors";
import cors from "cors";
import { IDomainQueryService } from "../services/DomainsQueryService";
import { DITYPES } from "../dependencies/types";
import { punycodeDomainPartsToUnicode } from "../utils/punycodeConverter";
import { recordToProxyRecord } from "../services/EnsResolverService/utils";
import { inject, injectable } from "inversify";
import { IConfigurationService } from "../configuration";
import { ILoggerService } from "../services/LoggerService";
import { IDnsQuery } from "../dnsquery";
import { IArweaveResolver } from "../services/EnsResolverService/arweave";
import { getDomainOfRequestFromGet, stripSubdomainsFromHost } from "../utils";
import { IDomainRateLimitService } from "../services/DomainRateLimit";

interface ProxyServerErrorNotSupported {
  _type: "ProxyServerNotSupported";
}
interface ProxyServerErrorBlacklisted {
  _type: "ProxyServerErrorBlacklisted";
}
interface ProxyServerInternalServerError {
  _type: "ProxyServerInternalServerError";
}

interface ProxyServerErrorTag {
  _tag: "ProxyServerError";
}

type ProxyServerError = ProxyServerErrorTag &
  (ProxyServerErrorBlacklisted | ProxyServerErrorNotSupported | ProxyServerInternalServerError);

type ProxyServerLogicRet =
  | ProxyServerError
  | {
      _tag: "ProxyServerSuccess";
      ret: IEnsResolverServiceResolveEnsRet;
    };

const askExpress = express();
const dnsqueryExpress = express();
const proxyExpress = express();

dnsqueryExpress.use(cors());

@injectable()
export class Server {
  _configurationService: IConfigurationService;
  _logger: ILoggerService;
  _domainQueryService: IDomainQueryService;
  _DnsQuery: IDnsQuery;
  _ensResolverService: IEnsResolverService;
  _arweaveResolver: IArweaveResolver;
  _domainRateLimitService: IDomainRateLimitService;

  constructor(
    @inject(DITYPES.ConfigurationService) configurationService: IConfigurationService,
    @inject(DITYPES.LoggerService) logger: ILoggerService,
    @inject(DITYPES.DomainQueryService) domainQueryService: IDomainQueryService,
    @inject(DITYPES.EnsResolverService) ensResolverService: IEnsResolverService,
    @inject(DITYPES.ArweaveResolver) arweaveResolver: IArweaveResolver,
    @inject(DITYPES.DnsQuery) dnsQuery: IDnsQuery,
    @inject(DITYPES.DomainRateLimitService) domainRateLimitService: IDomainRateLimitService
  ) {
    this._configurationService = configurationService;
    this._logger = logger;
    this._domainQueryService = domainQueryService;
    this._ensResolverService = ensResolverService;
    this._arweaveResolver = arweaveResolver;
    this._DnsQuery = dnsQuery;
    this._domainRateLimitService = domainRateLimitService;
  }

  requestHandler = async (content: Record, req: Request, res: Response) => {
    const configuration = this._configurationService.get();
    if (!content) {
      this._logger.debug(`requestHandler: no content ${req.get("host")}`);
      notSupported(res);
      return;
    }
    if (
      content._tag === "ens-socials-redirect" ||
      content.codec === "ipfs-ns" ||
      content.codec === "ipns-ns" ||
      content.codec === "arweave-ns" ||
      content.codec === "swarm"
    ) {
      const proxyContent = await recordToProxyRecord(this._configurationService, this._logger, content);
      this._logger.debug(`requestHandler: ${req.get("host")} is supported, proxyContent: ${JSON.stringify(proxyContent)}`);
      if(proxyContent._tag === "ens-socials-redirect" && !configuration.ens.socialsEndpointEnabled) {
        this._logger.debug(`requestHandler: ${req.get("host")} is not redirecting`);
        noContentHashSet(res);
        return;
      }

      const xContentLocation = proxyContent.XContentLocation.replace(/\/+$/, ""); // remove trailing slashes
      const xContentLocationWithoutProtocol = xContentLocation.replace(
        /^[^:]+:\/\//,
        "",
      ); // remove protocol

      this._logger.debug(`requestHandler: proxying to ${xContentLocationWithoutProtocol} ${proxyContent.XContentPath}`);

      res.writeHead(200, {
        "X-Content-Location": xContentLocationWithoutProtocol,
        "X-Content-Path": proxyContent.XContentPath,
        "X-Content-Storage-Type": content._tag === "ens-socials-redirect" ? undefined : content.codec,
      });
      res.end();
      return;
    }
  
    let _exhaustiveCheck: never = content.codec;
    return _exhaustiveCheck;
  }
  parseHostnameFromRequest = (req: Request, res: Response) => {
    const configuration = this._configurationService.get();
    const host = req.headers["host"];
    if (!host) {
      throw "Unexpected host header not set";
    }
    let hostHeader = host.split(":")[0];
    let hostname: string | null = punycodeDomainPartsToUnicode(hostHeader);
    if (!hostname) {
      throw "unexpected null hostname";
    }
    if (hostname.endsWith(configuration.router.host)) {
      hostname =
        hostname.substring(
          0,
          hostname.length - configuration.router.host.length,
        ) + "eth";
    }
    return hostname;
  };
  proxyServerLogic = async (
    unprocessedHostname: string,
  ): Promise<ProxyServerLogicRet> => {
    var hostname;
    try {
      hostname = await this._domainQueryService.checkLinkedDomains(unprocessedHostname);
    } catch (e) {
      this._logger.error(`proxyServerLogic: ${e}`);
      return {
        _tag: "ProxyServerError",
        _type: "ProxyServerInternalServerError",
      };
    }
    if (!hostname) {
      return {
        _tag: "ProxyServerError",
        _type: "ProxyServerNotSupported",
      };
    }
    var blacklisted;
    try {
      blacklisted = await this._domainQueryService.checkBlacklist(hostname)
    } catch(e) {
      this._logger.error(`proxyServerLogic: ${e}`);
      return {
        _tag: "ProxyServerError",
        _type: "ProxyServerInternalServerError",
      };
    }
    if (blacklisted) {
      return {
        _tag: "ProxyServerError",
        _type: "ProxyServerErrorBlacklisted",
      };
    }
    let location = await this._ensResolverService.resolveEns(hostname);
    this._logger.debug(`proxyServerLogic: location for ${hostname}: ${JSON.stringify(location)}`)
    if (!location) {
      return {
        _tag: "ProxyServerError",
        _type: "ProxyServerNotSupported",
      };
    } else {
      return {
        _tag: "ProxyServerSuccess",
        ret: location,
      };
    }
  };

  proxyServer = async  (
    req: Request,
    res: Response,
  ): Promise<null> => {
    var hostname: string | null = this.parseHostnameFromRequest(req, res);
    var isError: ProxyServerLogicRet;
    try {
      isError = await this.proxyServerLogic(hostname);
    } catch(e) {
      this._logger.error(`proxyServer: ${e}`);
      res.status(500);
      res.end();
      return null;
    }
    if (isError._tag === "ProxyServerError") {
      if (isError._type === "ProxyServerErrorBlacklisted") {
        this._logger.debug(`proxyServer: ${hostname} is blacklisted`);
        blockedForLegalReasons(res);
        return null;
      } else if (isError._type === "ProxyServerNotSupported") {
        this._logger.debug(`proxyServer: ${hostname} is not supported`);
        notSupported(res);
        return null;
      } else if (isError._type === "ProxyServerInternalServerError") {
        this._logger.error(`proxyServer: internal server error ${hostname}`);
        res.status(500);
        res.end();
        return null;
      }
    } else {
      this._logger.debug(`proxyServer: ${hostname} is supported`);
      this.requestHandler(isError.ret.record, req, res);
      return null;
    }
  
    let _exhaustiveCheck: never = isError;
    return _exhaustiveCheck;
  };
  /*
    Ask endpoint for Caddy server
    endpoint for caddy to determine if certificates should be distributed to subdomain
    should have a timeout before automatically denying
    200 -> success, otherwise no cert
  */
  public caddy = async (req: Request, res: Response): Promise<null> => {
    const configuration = this._configurationService.get();
    const hostname = getDomainOfRequestFromGet(this._configurationService, req, "domain");
    if (typeof hostname !== "string" || hostname.length > 512) {
      notSupported(res);
      return null;
    }

    var basedomain = stripSubdomainsFromHost(hostname);
    if (!basedomain) {
      this._logger.error(`caddy: ${hostname} is not supported, no basedomain`);
      notSupported(res);
      return null;
    }
    if(configuration.ask.rate.enabled && !req.headers['x-health-check']) {
      const rateLimited = await this._domainRateLimitService.incrementRateLimit(basedomain, configuration.ask.rate.limit, configuration.ask.rate.period);
      if(rateLimited.countOverMax) {
        this._logger.error(`caddy: ${hostname} is rate limited`);
        res.status(429);
        res.end();
        return null;
      }
    }

    var isError:ProxyServerLogicRet;
    try {
      isError = await this.proxyServerLogic(hostname);
    } catch(e) {
      this._logger.error(`caddy: ${e}`);
      res.status(500);
      res.end();
      return null;
    }

    if (isError._tag === "ProxyServerError") {
      if (isError._type === "ProxyServerErrorBlacklisted") {
        blockedForLegalReasons(res);
        return null;
      } else if (isError._type === "ProxyServerNotSupported") {
        notSupported(res);
        return null;
      } else if (isError._type === "ProxyServerInternalServerError") {
        res.status(500);
        res.end();
        return null;
      }
    } else {
      if((isError.ret.record?._tag === "ens-socials-redirect" || !isError.ret.resolverExists) && !configuration.ens.socialsEndpointEnabled) {
        res.status(404);
      } else {
        res.status(200);
      }
      res.end();
      return null;
    }
    return isError; //this should be of type never, otherwise there's an unexhausted codepath
  };
  start = () => {
    const configuration = this._configurationService.get();
    proxyExpress.all("*", this.proxyServer.bind(this));
    proxyExpress.listen(configuration.router.listen);
    dnsqueryExpress.post(
      "/dns-query",
      [bodyParser.raw({ type: "application/dns-message", limit: "2kb" })],
      this._DnsQuery.dnsqueryPost.bind(this._DnsQuery),
    );
    dnsqueryExpress.get(
      "/dns-query",
      [bodyParser.json({ limit: "2kb" })],
      this._DnsQuery.dnsqueryGet.bind(this._DnsQuery),
    );
    if (configuration.dnsquery.enabled) {
      dnsqueryExpress.listen(configuration.dnsquery.listen, () => {
        this._logger.info(
          `DOH server started, listening on ${configuration.dnsquery.listen}`,
        );
      });
    }
    switch (configuration.ask.enabled) {
      case "true":
        askExpress.get("/ask", this.caddy.bind(this));
        askExpress.listen(configuration.ask.listen, () => {
          this._logger.info(
            `Ask server started, listening on ${configuration.ask.listen}`,
          );
        });
        break;
    }
  };
}
