import {
  errorBuilder,
  blockedForLegalReasons,
} from "../expressErrors/index.js";
import type { Question, RecordType } from "dns-packet";
import dnsPacket from "dns-packet";
import type {
  IEnsResolverService,
  IRecord,
} from "dweb-api-types/ens-resolver";
import type { Request, Response } from "express";
import type { IDomainQueryService } from "../services/DomainsQueryService/index.js";
import { getTraceIdFromRequest, hostnameIsENSTLD } from "../utils/index.js";
import type { ILoggerService } from "dweb-api-types/logger";
import type { IRequestContext } from "dweb-api-types/request-context";
import type {
  ICacheConfig,
  IConfigurationLogger,
} from "dweb-api-types/config";
import { recordNamespaceToUrlHandlerMap } from "dweb-api-resolver/resolver/const";
import { punycodeDomainPartsToUnicode } from "dweb-api-resolver/punycodeConverter";
type DoHPacket = {
  Status: string;
  TC: boolean;
  Question: {
    name: string;
    type: number;
  }[];
  Answer: {
    name: string;
    data: string;
    type: number;
    ttl: number;
  }[];
};

export interface IDnsQuery {
  dnsqueryPost: (req: Request, res: Response) => Promise<void>;
  dnsqueryGet: (req: Request, res: Response) => Promise<void>;
}

type conf = IConfigurationLogger & ICacheConfig;

export class DnsQuery implements IDnsQuery {
  _logger: ILoggerService;
  _configurationService: conf;
  _domainQueryService: IDomainQueryService;
  _ensResolverService: IEnsResolverService;
  constructor(
    logger: ILoggerService,
    configuration: conf,
    domainQueryService: IDomainQueryService,
    ensResolverService: IEnsResolverService,
  ) {
    this._logger = logger;
    this._configurationService = configuration;
    this._domainQueryService = domainQueryService;
    this._ensResolverService = ensResolverService;
  }
  logHeaderError = (request: IRequestContext, header: string, req: Request) => {
    const val = req.header(header);
    this._logger.error("unexpected header", {
      ...request,
      origin: "dnsquery",
      context: {
        header,
        value: val,
      },
    });
  };
  questionToEnsAnswer = async (
    request: IRequestContext,
    question: dnsPacket.Question,
  ): Promise<dnsPacket.TxtAnswer | null> => {
    if (
      question.type.toLowerCase() !== "txt" ||
      !hostnameIsENSTLD(question.name)
    ) {
      this._logger.info("ignoring question", {
        ...request,
        origin: "dnsquery",
        context: {
          question: question.name,
          type: question.type,
        },
      });
      return null;
    }
    this._logger.info("processing request for ${question.name}", {
      ...request,
      origin: "dnsquery",
      context: {
        question: question.name,
        type: question.type,
      },
    });
    let dohDomain: string;
    if (question.name.startsWith("_dnslink.")) {
      dohDomain = question.name.split("_dnslink.")[1];
      this._logger.info("handled dnslink prefix", {
        ...request,
        origin: "dnsquery",
        context: {
          question: question.name,
          type: question.type,
          dohDomain,
        },
      });
    } else {
      dohDomain = question.name;
    }

    const result = await this._ensResolverService.resolveEns(
      request,
      punycodeDomainPartsToUnicode(dohDomain),
    );

    const link = recordToDnslink(result.record);
    if (!link) {
      return null;
    }
    const cacheConfig = this._configurationService.getCacheConfig();
    const retData = [];
    for (let i = 0; i < link.length; i += 255) {
      retData.push(link.substring(i, i + 255));
    }
    return {
      name: question.name,
      ttl: cacheConfig.getTtl(),
      data: retData,
      type: "TXT",
    };
  };
  handleDnsQuery = async (
    request: IRequestContext,
    dnsRequest: dnsPacket.Packet,
  ) => {
    const responses = [];
    if (!dnsRequest.questions) {
      dnsRequest.questions = [];
    }
    if (dnsRequest.questions.length > 5) {
      return {
        error: true,
        code: 400,
        message: "Too many questions",
        srvfail: false,
      };
    }

    let srvfail = false;

    for (const question of dnsRequest.questions) {
      const ret = await this.questionToEnsAnswer(request, question);
      if (ret) {
        this._logger.info("response to question", {
          ...request,
          origin: "dnsquery",
          context: {
            question: question.name,
            type: question.type,
            answer: ret.data,
          },
        });
        responses.push(ret);
      } else {
        this._logger.error("no respionse", {
          ...request,
          origin: "dnsquery",
          context: {
            question: question.name,
            type: question.type,
          },
        });
        srvfail = true;
      }
    }

    try {
      const responsePacket = dnsPacket.encode({
        id: dnsRequest.id,
        type: "response",
        questions: dnsRequest.questions,
        answers: responses,
      });

      return {
        payload: true,
        data: responsePacket,
        code: 200,
        srvfail,
      };
    } catch (e: unknown) {
      this._logger.error("When building dns response packet: ", {
        ...request,
        origin: "dnsquery",
        context: {
          error: e,
        },
      });
      return {
        error: true,
        code: 500,
        message: "Internal server error",
      };
    }
  };
  dnsqueryPost = async (req: Request, res: Response) => {
    const trace_id = getTraceIdFromRequest(req);
    const request = {
      trace_id,
    };
    if (req.header("accept") !== "application/dns-message") {
      this.logHeaderError(request, "accept", req);
      errorBuilder(res, 415);
      return;
    }

    if (req.headers["content-type"] !== "application/dns-message") {
      this.logHeaderError(request, "content-type", req);
      errorBuilder(res, 415);
      return;
    }

    const requestBody: string = req.body;
    let dnsRequest;
    try {
      dnsRequest = dnsPacket.decode(Buffer.from(requestBody));
    } catch (e: unknown) {
      this._logger.error("dnsqueryPost: could not decode DNS packet", {
        ...request,
        origin: "dnsquery",
        context: {
          error: e,
        },
      });
      errorBuilder(res, 500);
      return;
    }

    if (dnsRequest.questions) {
      for (const question of dnsRequest.questions) {
        if (
          await this._domainQueryService.checkBlacklist(
            request,
            punycodeDomainPartsToUnicode(question.name),
          )
        ) {
          blockedForLegalReasons(res);
          return;
        }
      }
    }

    const responsePacket = await this.handleDnsQuery(request, dnsRequest);
    if (responsePacket.error) {
      errorBuilder(res, responsePacket.code, responsePacket.message);
      return;
    } else if (responsePacket.payload) {
      const data = new Uint8Array(responsePacket.data);
      res.writeHead(200, {
        "Content-Type": "application/dns-message",
      });
      res.write(data);
      res.end();
    }
  };
  dnsqueryGet = async (req: Request, res: Response) => {
    const trace_id = getTraceIdFromRequest(req);
    const request: IRequestContext = {
      trace_id,
    };
    let dnsRequest: dnsPacket.Packet | null = null;
    //TODO: is name already punycoded? how does it behave with utf8?
    //TODO: from the docs, RFC 4343 backslash escapes are accepted
    //not clear on how to unescape this
    const { query } = req;
    const name = query.name;
    const type = query.type || "TXT";

    if (typeof name !== "string" || typeof type !== "string") {
      errorBuilder(res, 400);
      return;
    }
    if (name) {
      //default to TXT type
      const q: Question = {
        name: name,
        type: type as RecordType, //we don't really care if they passed us erroneous data
      };
      dnsRequest = {
        id: 0,
        type: "response",
        flags: 256,
        // flag_qr: false,
        // flag_aa: false,
        // flag_tc: false,
        // flag_rd: true,
        // flag_ra: false,
        // flag_z: false,
        // flag_ad: false,
        // flag_cd: false,
        questions: [q],
        answers: [],
        authorities: [],
        additionals: [],
      };
    }
    if (dnsRequest && dnsRequest.questions) {
      for (const question of dnsRequest.questions) {
        if (
          await this._domainQueryService.checkBlacklist(
            request,
            punycodeDomainPartsToUnicode(question.name),
          )
        ) {
          blockedForLegalReasons(res);
          return;
        }
      }
    }

    let result;
    try {
      result = dnsRequest && (await this.handleDnsQuery(request, dnsRequest));
    } catch (e: unknown) {
      this._logger.error("dnsqueryGet: error handling dns query", {
        ...request,
        origin: "dnsquery",
        context: {
          error: e,
        },
      });
      res.writeHead(200);
      const errorPacket: DoHPacket = {
        Question: [],
        Answer: [],
        Status: "2",
        TC: false,
      };
      res.write(JSON.stringify(errorPacket));
      res.end();
      return;
    }
    if (!result) {
      res.writeHead(200);
      res.end();
      return;
    }
    if (result.payload) {
      const data = result.data;
      const decoded = dnsPacket.decode(data);

      const ret: DoHPacket = {
        Status: "0",
        TC: false,
        Question: [],
        Answer: [],
      };
      if (decoded.questions) {
        for (const q of decoded.questions) {
          //we only know how to handle txt
          let decoded_type = null;
          if (q.type === "TXT") {
            decoded_type = 16;
          } else {
            this._logger.error("unhandled question type", {
              ...request,
              origin: "dnsquery",
              context: {
                question: q.name,
                type: q.type,
              },
            });
            continue;
          }
          const tmp = {
            name: q.name,
            type: decoded_type,
          };
          ret.Question.push(tmp);
        }
      }

      const cacheConfig = this._configurationService.getCacheConfig();
      if (decoded.answers) {
        for (const a of decoded.answers) {
          if (a.type !== "TXT") {
            continue;
          }
          const tmp: {
            name: string;
            data: string;
            type: number;
            ttl: number;
          } | null = {
            name: "",
            data: "",
            type: 0,
            ttl: 1,
          };
          //we only know how to handle txt
          tmp.type = 16;
          tmp.name = a.name;
          tmp.data = (a.data as string[]).join("");
          tmp.ttl = Number(cacheConfig.getTtl());
          ret.Answer.push(tmp);
        }
      }
      res.writeHead(200, {
        "Content-Type": "application/x-javascript",
      });
      res.write(JSON.stringify(ret));

      res.end();
      return;
    } else {
      errorBuilder(res, result.code || 500, result.message);
      return;
    }
  };
}

const trimTrailingSlashFromPath = (p: string) => {
  if (p.length < 2) {
    return p;
  }
  if (p.charAt(p.length - 1) === "/") {
    return p.substring(0, p.length - 2);
  } else {
    return p;
  }
};

const recordToDnslink = (result: IRecord): string | null => {
  if (!result) {
    return null;
  } else if (result._tag === "ens-socials-redirect") {
    return null;
  } else if (result._tag === "Record") {
    const dnsLinkPrefix =
      result.codec === "arweave-ns"
        ? "ar://"
        : `/${recordNamespaceToUrlHandlerMap[result.codec]}/`;
    return `dnslink=${dnsLinkPrefix}${trimTrailingSlashFromPath(
      result.DoHContentIdentifier,
    )}`;
  } else if (result._tag === "DataUriRecord") {
    return null;
  } else if (result._tag === "DataUrlRecord") {
    return null;
  }

  const ret: never = result;
  //totality checking, if result.codec is not never that means Record changed
  return ret;
};
