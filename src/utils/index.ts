import { Request } from "express";
import { punycodeDomainPartsToUnicode } from "./punycodeConverter";
import {IHostnameSubstitutionService } from "../services/HostnameSubstitutionService";
import { VALID_ENS_TLDS } from "../configuration";

export function getDomainOfRequestFromGet(hostnameSubstitutionService: IHostnameSubstitutionService, req: Request, param = "domain") {
  let domain = req.query[param];
  if (typeof domain !== "string") {
    return null;
  }

  domain = hostnameSubstitutionService.substituteHostname(domain);

  domain = punycodeDomainPartsToUnicode(domain);
  if (hostnameIsENSTLD(domain)) {
    return domain;
  } else {
    return null;
  }
}

export function hostnameIsENSTLD(hostname: string) {
  return VALID_ENS_TLDS.find((tld) => hostname.endsWith("."+tld)) !== undefined;
}

export const ensureTrailingSlash = (path: string) => {
  if (path.endsWith("/")) {
    return path;
  } else {
    return path + "/";
  }
};

export function getTraceIdFromRequest(req: Request) {
  const trace_id_header = 'x-limo-id';
  const trace_id = typeof req.headers[trace_id_header] === "string" ? req.headers[trace_id_header] : "UNDEFINED_TRACE_ID";
  return trace_id;
}