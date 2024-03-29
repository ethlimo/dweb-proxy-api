import { Request } from "express";
import { IConfigurationService } from "../configuration";

export function getDomainOfRequestFromGet(configurationSvc: IConfigurationService, req: Request, param = "domain") {
  const configuration = configurationSvc.get();
  let domain = req.query[param];
  if (typeof domain !== "string") {
    return null;
  }
  let { host } = configuration.ask;
  if (domain.endsWith("." + host)) {
    domain = domain.split("." + host)[0] + ".eth";
  }
  if (domain.endsWith("." + host)) {
    domain = domain.split("." + host)[0] + ".eth";
  }
  if (hostnameIsENSTLD(domain)) {
    return domain;
  } else {
    return null;
  }
}

//prerequisite: host in the form a.b.c.d, tld=1 <=> tld=d
export function stripSubdomainsFromHost(host: string, tld = 1) {
  if (host.length && host.length >= 2) {
    return host
      .split(".")
      .slice(-1 - tld)
      .join(".");
  } else {
    return null;
  }
}

export function hostnameIsENSTLD(hostname: string) {
  return hostname.endsWith(".eth") || hostname.endsWith(".art");
}

export const ensureTrailingSlash = (path: string) => {
  if (path.endsWith("/")) {
    return path;
  } else {
    return path + "/";
  }
};
