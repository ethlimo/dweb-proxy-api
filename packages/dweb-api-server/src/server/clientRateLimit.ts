import type { Express, NextFunction, Request, Response } from "express";
import type { IClientRateLimitConfig } from "dweb-api-types/config";
import type { ILoggerService } from "dweb-api-types/logger";
import type { IDomainRateLimitService } from "../services/DomainRateLimit/index.js";
import { isIP } from "node:net";
import { getTraceIdFromRequest } from "../utils/index.js";

// TRUST_PROXY is passed to express as "trust proxy". Without it req.ip is
// the address of whatever connects to us, which behind Caddy is Caddy
// itself, so every client would share one counter.
// Accepts "true", a hop count, or a comma separated list of addresses /
// subnets / express presets like "loopback".
export function applyTrustProxy(app: Express, value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "false") {
    return;
  }
  if (trimmed === "true") {
    app.set("trust proxy", true);
  } else if (/^\d+$/.test(trimmed)) {
    app.set("trust proxy", Number(trimmed));
  } else {
    app.set(
      "trust proxy",
      trimmed.split(",").map((s) => s.trim()),
    );
  }
}

// Expands an IPv6 address into its 8 groups, without leading zeros.
function ipv6Groups(ip: string): string[] {
  let address = ip.split("%")[0].toLowerCase();
  // an embedded ipv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) is two groups
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    address =
      address.slice(0, v4.index) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }
  const [head, tail] = address.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const zeros =
    tail === undefined ? [] : Array(8 - front.length - back.length).fill("0");
  return [...front, ...zeros, ...back].map((g) => parseInt(g, 16).toString(16));
}

// Key the counter is stored under. IPv6 clients usually get a whole /64,
// so they are counted per /64, otherwise anyone could just rotate through
// their addresses to get around the limit.
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) {
    return mapped[1];
  }
  if (isIP(ip.split("%")[0]) !== 6) {
    return ip;
  }
  return `${ipv6Groups(ip).slice(0, 4).join(":")}::/64`;
}

export function clientRateLimit(
  config: IClientRateLimitConfig,
  rateLimitService: IDomainRateLimitService,
  logger: ILoggerService,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const settings = config.getClientRateLimitConfig();
    const limit = settings.getLimit();
    const ip = req.ip;
    if (!(limit > 0) || !ip) {
      next();
      return;
    }

    const request = { trace_id: getTraceIdFromRequest(req) };
    try {
      const result = await rateLimitService.incrementRateLimit(
        request,
        `client/${clientKey(ip)}`,
        limit,
        settings.getPeriod(),
      );
      if (result.countOverMax) {
        logger.info("client rate limited", {
          ...request,
          origin: "clientRateLimit",
          context: { ip, count: result.count },
        });
        res.writeHead(429, { "Retry-After": String(Math.max(result.ttl, 1)) });
        res.end();
        return;
      }
    } catch (e) {
      // if redis is down we'd rather serve requests than reject all of them
      logger.error("client rate limit check failed, letting request through", {
        ...request,
        origin: "clientRateLimit",
        context: { ip, error: e },
      });
    }
    next();
  };
}
