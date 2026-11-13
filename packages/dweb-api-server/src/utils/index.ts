import { Request } from "express";
import { punycodeDomainPartsToUnicode } from "dweb-api-resolver/punycodeConverter";
import { VALID_ENS_TLDS } from "../configuration/index.js";
import { IHostnameSubstitutionService } from "dweb-api-resolver/HostnameSubstitutionService";

export type GetDomainOfRequestFromGetReturnType = {
  domain: string;
  domain_without_suffix_substitutions: string;
} | null;

export function getDomainOfRequestFromGet(
  hostnameSubstitutionService: IHostnameSubstitutionService,
  req: Request,
  param = "domain",
): GetDomainOfRequestFromGetReturnType {
  let domain = req.query[param];
  if (typeof domain !== "string") {
    return null;
  }

  domain = punycodeDomainPartsToUnicode(domain);
  const domain_without_suffix_substitutions = domain;
  domain = hostnameSubstitutionService.substituteHostname(domain);

  if (hostnameIsENSTLD(domain)) {
    return {
      domain,
      domain_without_suffix_substitutions,
    };
  } else {
    return null;
  }
}

// Longest name DNS allows (RFC 1035), not counting the trailing dot.
// Anything longer can't be a real ENS/DNS name, and the blacklist check
// does one domains api lookup per label, so we reject these up front.
export const MAX_DOMAIN_NAME_LENGTH = 253;

export function isDomainNameTooLong(name: string) {
  return name.length > MAX_DOMAIN_NAME_LENGTH;
}

export function hostnameIsENSTLD(hostname: string) {
  return (
    VALID_ENS_TLDS.find((tld) => hostname.endsWith("." + tld)) !== undefined
  );
}

export function getTraceIdFromRequest(req: Request) {
  const trace_id_header = "x-limo-id";
  const trace_id =
    typeof req.headers[trace_id_header] === "string"
      ? req.headers[trace_id_header]
      : "UNDEFINED_TRACE_ID";
  return trace_id;
}
