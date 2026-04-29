import type { Request, Response } from "express";
import express from "express";
import type {
  IEnsResolverService,
  IEnsResolverServiceResolveEnsRet,
  IRecord,
} from "dweb-api-types/ens-resolver";
import bodyParser from "body-parser";
import {
  notSupported,
  blockedForLegalReasons,
  noContentHashSet,
} from "../expressErrors/index.js";
import cors from "cors";
import { IDomainQueryService } from "../services/DomainsQueryService/index.js";
import { ILoggerService } from "dweb-api-types/logger";
import { IDnsQuery } from "../dnsquery/index.js";
import { IArweaveResolver } from "dweb-api-types/arweave";
import { getDomainOfRequestFromGet, getTraceIdFromRequest } from "../utils/index.js";
import { IDomainRateLimitService } from "../services/DomainRateLimit/index.js";
import { IRequestContext } from "dweb-api-types/request-context";
import {
  ensureTrailingSlash,
  recordToProxyRecord,
} from "dweb-api-resolver/resolver/utils";
import { ServerConfiguration } from "../configuration/index.js";
import { IHostnameSubstitutionService } from "dweb-api-resolver/HostnameSubstitutionService";
import { IDataUrlResolverService } from "dweb-api-types/name-service";
import { ProxyRecord } from "dweb-api-types/dweb-api-resolver";
import { type Server as NodeHttpServer } from "http";

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
  (
    | ProxyServerErrorBlacklisted
    | ProxyServerErrorNotSupported
    | ProxyServerInternalServerError
  );

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

export class SharedServer {
  _configurationService: ServerConfiguration;
  _logger: ILoggerService;
  _domainQueryService: IDomainQueryService;
  _DnsQuery: IDnsQuery;
  _ensResolverService: IEnsResolverService;
  _arweaveResolver: IArweaveResolver;
  _domainRateLimitService: IDomainRateLimitService;
  _hostnameSubstitutionService: IHostnameSubstitutionService;
  _dataUrlResolverService: IDataUrlResolverService | null;

  constructor(
    configurationService: ServerConfiguration,
    logger: ILoggerService,
    domainQueryService: IDomainQueryService,
    ensResolverService: IEnsResolverService,
    arweaveResolver: IArweaveResolver,
    dnsQuery: IDnsQuery,
    domainRateLimitService: IDomainRateLimitService,
    hostnameSubstitutionService: IHostnameSubstitutionService,
    dataUrlResolverService: IDataUrlResolverService | null,
  ) {
    this._configurationService = configurationService;
    this._logger = logger;
    this._domainQueryService = domainQueryService;
    this._ensResolverService = ensResolverService;
    this._arweaveResolver = arweaveResolver;
    this._DnsQuery = dnsQuery;
    this._domainRateLimitService = domainRateLimitService;
    this._hostnameSubstitutionService = hostnameSubstitutionService;
    this._dataUrlResolverService = dataUrlResolverService;
  }

  requestHandler = async (
    request: IRequestContext,
    content: IRecord,
    req: Request,
    res: Response,
  ) => {
    if (!content) {
      this._logger.debug("no content", {
        ...request,
        origin: "requestHandler",
        context: {
          host: req.get("host"),
        },
      });
      notSupported(res);
      return;
    }
    if (content._tag === "ens-socials-redirect" || content._tag === "Record") {
      const proxyContent = await recordToProxyRecord(
        request,
        this._configurationService,
        this._logger,
        content,
      );
      this._logger.debug("content supported", {
        ...request,
        origin: "requestHandler",
        context: {
          host: req.get("host"),
          content: proxyContent,
        },
      });
      if (
        (proxyContent._tag === "ens-socials-redirect" &&
          !this._configurationService.getConfigEnsSocialsEndpoint()
            .getEnsSocialsEndpoint) ||
        proxyContent._tag === "ProxyRecordUnableToRedirect"
      ) {
        this._logger.debug("no content hash set", {
          ...request,
          origin: "requestHandler",
          context: {
            host: req.get("host"),
          },
        });
        noContentHashSet(res);
        return;
      }

      const sanitizedXContentLocation =
        extractSanitizedXContentLocationFromRecord(proxyContent); // remove protocol

      this._logger.debug("proxying content", {
        ...request,
        origin: "requestHandler",
        context: {
          host: req.get("host"),
          location: sanitizedXContentLocation,
          path: proxyContent.XContentPath,
        },
      });

      res.writeHead(200, {
        "X-Content-Location": sanitizedXContentLocation,
        "X-Content-Path": proxyContent.XContentPath,
        "X-Content-Storage-Type":
          content._tag === "ens-socials-redirect"
            ? undefined
            : (proxyContent.overrideCodecHeader ?? content.codec),
      });
      res.end();
      return;
    } else if (content._tag === "DataUriRecord") {
      //feature flag borrows/shared from DataUrl backend server
      const dataUrlConfig = this._configurationService
        .getDataUrlConfig()
        .getConfigDataUrlEndpoint();
      if (!dataUrlConfig) {
        this._logger.debug(
          "no data url config (DataUri feature gated behind DataUrl server config)",
          {
            ...request,
            origin: "requestHandler",
            context: {
              host: req.get("host"),
            },
          },
        );
        notSupported(res);
        return;
      }
      this._logger.debug("data uri record", {
        ...request,
        origin: "requestHandler",
        context: {
          host: req.get("host"),
          uri: content.uri,
        },
      });
      res.writeHead(308, {
        Location: content.uri,
      });
      res.end();
      return;
    } else if (content._tag === "DataUrlRecord") {
      const dataUrlConfig = this._configurationService
        .getDataUrlConfig()
        .getConfigDataUrlEndpoint();
      if (!dataUrlConfig) {
        this._logger.debug(
          "no data url config (DataUrl feature gated behind DataUrl server config)",
          {
            ...request,
            origin: "requestHandler",
            context: {
              host: req.get("host"),
            },
          },
        );
        notSupported(res);
        return;
      }
      this._logger.debug("data url record", {
        ...request,
        origin: "requestHandler",
        context: {
          host: req.get("host"),
          ensname: content.ensname,
          data: content.data,
        },
      });
      if (!this._dataUrlResolverService) {
        throw "DataUrlResolverService is null and should not be, maybe bad instantiation of base class?";
      }

      const data = content.data;
      const contentFrag = `/api/v1/dataurl/${encodeURIComponent(content.ensname)}/${Buffer.from(JSON.stringify(data)).toString("base64url")}`;
      const newEndpoint = new URL(dataUrlConfig);
      res.writeHead(200, {
        "X-Content-Location": sanitizeXContentLocation(newEndpoint.host),
        "X-Content-Path": ensureTrailingSlash(contentFrag),
      });
      res.end();
      return;
    }

    const _exhaustiveCheck: never = content;
    return _exhaustiveCheck;
  };

  parseHostnameFromRequest = (req: Request) => {
    const host = req.headers["host"];
    if (!host) {
      throw "Unexpected host header not set";
    }
    let hostFromHeader = host.split(":")[0];
    return this._hostnameSubstitutionService.substituteHostname(hostFromHeader);
  };
  proxyServerLogic = async (
    request: IRequestContext,
    unprocessedHostname: string,
  ): Promise<ProxyServerLogicRet> => {
    let hostname;
    try {
      hostname = await this._domainQueryService.checkLinkedDomains(
        request,
        unprocessedHostname,
      );
    } catch (e) {
      this._logger.error("caught error when checking linked domains", {
        ...request,
        origin: "proxyServerLogic",
        context: {
          error: e,
        },
      });
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
    let blacklisted = false;
    try {
      blacklisted = await this._domainQueryService.checkBlacklist(
        request,
        hostname,
      );
    } catch (e) {
      this._logger.error("caught error when checking blacklist", {
        ...request,
        origin: "proxyServerLogic",
        context: {
          error: e,
        },
      });
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
    const location = await this._ensResolverService.resolveEns(
      request,
      hostname,
    );
    this._logger.debug("resolved ens", {
      ...request,
      origin: "proxyServerLogic",
      context: {
        hostname: hostname,
        location: location,
      },
    });
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
}

export class Server extends SharedServer {
  proxyServer = async (req: Request, res: Response): Promise<null> => {
    const hostname: string | null = this.parseHostnameFromRequest(req);
    let isError: ProxyServerLogicRet;
    const trace_id = getTraceIdFromRequest(req);
    const request: IRequestContext = {
      trace_id,
    };
    try {
      isError = await this.proxyServerLogic(request, hostname);
    } catch (e) {
      this._logger.error("unrecoverable error", {
        ...request,
        origin: "proxyServer",
        context: {
          error: e,
          hostname: hostname,
        },
      });
      res.writeHead(500);
      res.end();
      return null;
    }
    if (isError._tag === "ProxyServerError") {
      if (isError._type === "ProxyServerErrorBlacklisted") {
        this._logger.debug("hostname is blacklisted", {
          ...request,
          origin: "proxyServer",
          context: {
            hostname: hostname,
          },
        });
        blockedForLegalReasons(res);
        return null;
      } else if (isError._type === "ProxyServerNotSupported") {
        this._logger.debug(`content not supported`, {
          ...request,
          origin: "proxyServer",
          context: {
            hostname: hostname,
          },
        });
        notSupported(res);
        return null;
      } else if (isError._type === "ProxyServerInternalServerError") {
        this._logger.error(`internal server error`, {
          ...request,
          origin: "proxyServer",
          context: {
            hostname: hostname,
          },
        });
        res.writeHead(500);
        res.end();
        return null;
      }
    } else {
      this._logger.debug("content supported", {
        ...request,
        origin: "proxyServer",
        context: {
          hostname: hostname,
          content: isError.ret,
        },
      });
      this.requestHandler(request, isError.ret.record, req, res);
      return null;
    }

    const _exhaustiveCheck: never = isError;
    return _exhaustiveCheck;
  };
  /*
    Ask endpoint for Caddy server
    endpoint for caddy to determine if certificates should be distributed to subdomain
    should have a timeout before automatically denying
    200 -> success, otherwise no cert
  */
  public caddy = async (req: Request, res: Response): Promise<null> => {
    const askEndpointConfig = this._configurationService.getConfigAskEndpoint();
    const socialsEndpointConfig =
      this._configurationService.getConfigEnsSocialsEndpoint();

    const hostname_obj = getDomainOfRequestFromGet(
      this._hostnameSubstitutionService,
      req,
      "domain",
    );
    const trace_id = getTraceIdFromRequest(req);
    const request: IRequestContext = {
      trace_id,
    };
    if (
      !hostname_obj ||
      hostname_obj.domain_without_suffix_substitutions.length > 256
    ) {
      notSupported(res);
      return null;
    }

    const hostname = hostname_obj.domain;

    const domain_label_count =
      hostname_obj.domain_without_suffix_substitutions.split(".").length;
    if (domain_label_count > askEndpointConfig.getMaxLabelLimit()) {
      this._logger.info("domain label count exceeded", {
        ...request,
        origin: "caddy",
        context: {
          hostname,
          originally_requested_hostname:
            hostname_obj.domain_without_suffix_substitutions,
          domain_label_count,
        },
      });
      notSupported(res);
      return null;
    }

    if (askEndpointConfig.getRateEnabled() && !req.headers["x-health-check"]) {
      const rateLimited = await this._domainRateLimitService.incrementRateLimit(
        request,
        hostname,
        askEndpointConfig.getRateLimit(),
        askEndpointConfig.getRatePeriod(),
      );
      if (rateLimited.countOverMax) {
        this._logger.error("rate limited", {
          ...request,
          origin: "caddy",
          context: {
            hostname: hostname,
          },
        });
        res.writeHead(429);
        res.end();
        return null;
      }
    }

    let isError: ProxyServerLogicRet;
    try {
      isError = await this.proxyServerLogic(request, hostname);
    } catch (e) {
      this._logger.error("unrecoverable error", {
        ...request,
        origin: "caddy",
        context: {
          hostname: hostname,
          error: e,
        },
      });
      res.writeHead(500);
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
        res.writeHead(500);
        res.end();
        return null;
      }
    } else {
      if (
        (isError.ret.record?._tag === "ens-socials-redirect" ||
          !isError.ret.resolverExists) &&
        !socialsEndpointConfig.getEnsSocialsEndpoint
      ) {
        res.writeHead(404);
      } else {
        res.writeHead(200);
      }
      res.end();
      return null;
    }
    return isError; //this should be of type never, otherwise there's an unexhausted codepath
  };
  start = (registerServer: (server: NodeHttpServer) => void = () => {}) => {
    const routerConfig = this._configurationService.getRouterConfig();
    const dnsqueryRouterConfig =
      this._configurationService.getDnsqueryRouterConfig();
    const askRouterConfig = this._configurationService.getAskRouterConfig();

    proxyExpress.all("/{*splat}", this.proxyServer.bind(this));
    const proxyServer = proxyExpress.listen(routerConfig.getRouterListenPort());
    registerServer(proxyServer);

    dnsqueryExpress.post(
      "/dns-query",
      [bodyParser.raw({ type: "application/dns-message", limit: "2kb" })],
      async (req: Request, res: Response) => {
        await this._DnsQuery.dnsqueryPost(req, res);
      },
    );

    dnsqueryExpress.get(
      "/dns-query",
      [bodyParser.json({ limit: "2kb" })],
      async (req: Request, res: Response) => {
        await this._DnsQuery.dnsqueryGet(req, res);
      },
    );

    if (dnsqueryRouterConfig.getDnsqueryRouterEnabled()) {
      const dnsServer = dnsqueryExpress.listen(
        dnsqueryRouterConfig.getDnsqueryRouterListenPort(),
        () => {
          this._logger.info("DNS query server started", {
            trace_id: "UNDEFINED_TRACE_ID",
            origin: "start",
            context: {
              listen: dnsqueryRouterConfig.getDnsqueryRouterListenPort(),
            },
          });
        },
      );
      registerServer(dnsServer);
    }

    if (askRouterConfig.getAskRouterEnabled()) {
      askExpress.get("/ask", this.caddy.bind(this));
      const askServer = askExpress.listen(
        askRouterConfig.getAskRouterListenPort(),
        () => {
          this._logger.info("Ask server started", {
            trace_id: "UNDEFINED_TRACE_ID",
            origin: "start",
            context: {
              listen: askRouterConfig.getAskRouterListenPort(),
            },
          });
        },
      );
      registerServer(askServer);
    }
  };
}

function sanitizeXContentLocation(xContentLocation: string) {
  const tmp = xContentLocation.replace(/\/+$/, ""); // remove trailing slashes
  return tmp.replace(/^[^:]+:\/\//, ""); // remove protocol
}
function extractSanitizedXContentLocationFromRecord(
  proxyContent: IRecord & ProxyRecord,
) {
  return sanitizeXContentLocation(proxyContent.XContentLocation);
}
